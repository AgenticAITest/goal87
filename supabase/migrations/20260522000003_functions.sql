-- ── Trigger: prevent late predictions ─────────────────────────────────────
-- Belt-and-braces against UI bugs. Applies to both INSERT and UPDATE,
-- and to all callers including admins (per spec).

CREATE OR REPLACE FUNCTION prevent_late_predictions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kickoff TIMESTAMPTZ;
BEGIN
  SELECT kickoff_at INTO v_kickoff FROM matches WHERE id = NEW.match_id;
  IF v_kickoff <= now() THEN
    RAISE EXCEPTION 'Cannot submit prediction: match kicked off at %', v_kickoff
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_late_predictions
  BEFORE INSERT OR UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION prevent_late_predictions();

-- ── Trigger: prevent profile self-elevation ────────────────────────────────
-- Prevents non-admin, non-service-role callers from changing status or is_admin.
-- Service-role calls have auth.uid() = NULL (bypasses this guard).

CREATE OR REPLACE FUNCTION prevent_profile_self_elevation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role: auth.uid() is NULL → allow anything
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins can change anything
  IF (SELECT is_admin FROM profiles WHERE id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Regular users cannot change status or is_admin
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'Cannot change status or is_admin'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_profile_self_elevation
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_profile_self_elevation();

-- ── settle_match(p_match_id) ───────────────────────────────────────────────
-- Idempotent. Advisory lock prevents concurrent calls from double-settling.
-- Settlement logic:
--   ≤1 participant        → void (zero-amount rows for audit)
--   ≥2 participants, 0 winners → void (zero-amount rows)
--   ≥2 participants, ≥1 winner → pot = (participants − winners) × stake
--                                 winner share = pot ÷ winners (integer, remainder dropped)
--                                 losers pay −stake each

CREATE OR REPLACE FUNCTION settle_match(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match        matches%ROWTYPE;
  v_stake        INT;
  v_participants INT;
  v_winners      INT;
  v_pot          INT;
  v_winner_share INT;
  v_pred         predictions%ROWTYPE;
BEGIN
  -- Transaction-level advisory lock; re-entrant within the same transaction
  -- (recalculate_match calls this after already holding the lock).
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id::TEXT));

  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match % not found', p_match_id;
  END IF;

  IF v_match.settled_at IS NOT NULL THEN
    RETURN;  -- idempotent
  END IF;

  IF v_match.status != 'FINISHED' THEN
    RAISE EXCEPTION 'match % is not FINISHED (status: %)', p_match_id, v_match.status;
  END IF;

  SELECT stake_idr INTO v_stake FROM tournaments WHERE id = v_match.tournament_id;

  SELECT COUNT(*) INTO v_participants FROM predictions WHERE match_id = p_match_id;

  -- ── ≤1 participant: void ─────────────────────────────────────────────────
  IF v_participants <= 1 THEN
    FOR v_pred IN SELECT * FROM predictions WHERE match_id = p_match_id LOOP
      INSERT INTO settlements (match_id, user_id, amount_idr, is_winner, is_void)
      VALUES (p_match_id, v_pred.user_id, 0, false, false);
    END LOOP;
    UPDATE matches SET settled_at = now(), settled_by = 'auto' WHERE id = p_match_id;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_winners
  FROM predictions
  WHERE match_id = p_match_id
    AND predicted_home = v_match.ft_home
    AND predicted_away = v_match.ft_away;

  -- ── No winners: void ─────────────────────────────────────────────────────
  IF v_winners = 0 THEN
    FOR v_pred IN SELECT * FROM predictions WHERE match_id = p_match_id LOOP
      INSERT INTO settlements (match_id, user_id, amount_idr, is_winner, is_void)
      VALUES (p_match_id, v_pred.user_id, 0, false, false);
    END LOOP;
    UPDATE matches SET settled_at = now(), settled_by = 'auto' WHERE id = p_match_id;
    RETURN;
  END IF;

  -- ── Winners exist: settle ─────────────────────────────────────────────────
  v_pot          := (v_participants - v_winners) * v_stake;
  v_winner_share := v_pot / v_winners;  -- integer division; sub-IDR remainder dropped

  FOR v_pred IN SELECT * FROM predictions WHERE match_id = p_match_id LOOP
    IF v_pred.predicted_home = v_match.ft_home
       AND v_pred.predicted_away = v_match.ft_away THEN
      INSERT INTO settlements (match_id, user_id, amount_idr, is_winner)
      VALUES (p_match_id, v_pred.user_id, v_winner_share, true);
    ELSE
      INSERT INTO settlements (match_id, user_id, amount_idr, is_winner)
      VALUES (p_match_id, v_pred.user_id, -v_stake, false);
    END IF;
  END LOOP;

  UPDATE matches SET settled_at = now(), settled_by = 'auto' WHERE id = p_match_id;
END;
$$;

-- ── void_match(p_match_id, p_admin_id) ────────────────────────────────────
-- For POSTPONED / CANCELLED matches called by the score worker (p_admin_id = NULL)
-- or by admin from the UI (p_admin_id = admin profile id).

CREATE OR REPLACE FUNCTION void_match(p_match_id UUID, p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pred predictions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id::TEXT));

  IF (SELECT settled_at FROM matches WHERE id = p_match_id) IS NOT NULL THEN
    RETURN;  -- idempotent
  END IF;

  FOR v_pred IN SELECT * FROM predictions WHERE match_id = p_match_id LOOP
    INSERT INTO settlements (match_id, user_id, amount_idr, is_winner, is_void)
    VALUES (p_match_id, v_pred.user_id, 0, false, false);
  END LOOP;

  UPDATE matches
    SET settled_at = now(),
        settled_by = coalesce(p_admin_id::TEXT, 'auto')
  WHERE id = p_match_id;

  IF p_admin_id IS NOT NULL THEN
    INSERT INTO audit_log (actor_id, action, target_type, target_id)
    VALUES (p_admin_id, 'match_void', 'match', p_match_id);
  END IF;
END;
$$;

-- ── recalculate_match(p_match_id, p_admin_id) ─────────────────────────────
-- Admin-only. Voids current settlements and re-settles with the corrected score
-- already written to matches.ft_home / ft_away.

CREATE OR REPLACE FUNCTION recalculate_match(p_match_id UUID, p_admin_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id::TEXT));

  -- Snapshot current (incorrect) settlements for the audit record
  SELECT jsonb_agg(to_jsonb(s))
  INTO v_before
  FROM settlements s
  WHERE match_id = p_match_id AND is_void = false;

  -- Void all active settlements for this match
  UPDATE settlements
    SET is_void   = true,
        voided_at = now(),
        voided_by = p_admin_id
  WHERE match_id = p_match_id AND is_void = false;

  -- Reset settled_at so settle_match can re-run (it is a no-op if settled_at IS NOT NULL)
  UPDATE matches SET settled_at = NULL WHERE id = p_match_id;

  -- Re-settle with the corrected score now in matches.ft_home / ft_away
  PERFORM settle_match(p_match_id);

  INSERT INTO audit_log (actor_id, action, target_type, target_id, before_data)
  VALUES (p_admin_id, 'match_recalculate', 'match', p_match_id, v_before);
END;
$$;

-- ── leaderboard(p_tournament_id) ──────────────────────────────────────────
-- Returns one row per participant (anyone with ≥1 prediction in the tournament).
-- balance_idr = SUM of non-void settlement amounts.
-- Tiebreaker: earliest submitted_at among winning predictions.
-- Callable by any active authenticated user; SECURITY DEFINER bypasses RLS to
-- aggregate settlement amounts the caller wouldn't normally see individually.

CREATE OR REPLACE FUNCTION leaderboard(p_tournament_id UUID)
RETURNS TABLE (
  user_id          UUID,
  display_name     TEXT,
  balance_idr      BIGINT,
  first_correct_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_active() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    p.id                                              AS user_id,
    p.display_name,
    coalesce(SUM(s.amount_idr), 0)::BIGINT           AS balance_idr,
    MIN(CASE WHEN s.is_winner THEN pr.submitted_at END) AS first_correct_at
  FROM profiles p
  JOIN predictions pr ON pr.user_id = p.id
  JOIN matches m
    ON m.id = pr.match_id
   AND m.tournament_id = p_tournament_id
  LEFT JOIN settlements s
    ON s.match_id = pr.match_id
   AND s.user_id  = p.id
   AND s.is_void  = false
  GROUP BY p.id, p.display_name
  ORDER BY balance_idr DESC, first_correct_at ASC NULLS LAST;
END;
$$;
