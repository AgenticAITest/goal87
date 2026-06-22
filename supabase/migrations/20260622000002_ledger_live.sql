-- ============================================================================
-- Step 5 (DB): make the ledger the live source of truth.
--   - settle_match / recalculate_match / void_match append ledger rows and
--     maintain the stored balance (profiles.balance_idr) in-function.
--   - leaderboard() reads the ledger (corrected) instead of settlements, and
--     filters to active members (hides the suspended Ridwan account).
--   - Fresh ledger backfill at the end: catches any match that settled in the
--     gap since the rebuild and re-syncs balances. Idempotent.
-- Run ONCE in the Supabase SQL Editor. Pause the score-worker during the run.
-- ============================================================================

-- ── settle_match: settle + ledger + balance (single pass) ───────────────────
CREATE OR REPLACE FUNCTION settle_match(p_match_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match        matches%ROWTYPE;
  v_stake        INT;
  v_participants INT;
  v_winners      INT;
  v_pot          INT;
  v_share        INT;
  v_amt          BIGINT;
  v_is_winner    BOOLEAN;
  v_before       BIGINT;
  v_after        BIGINT;
  v_pred         predictions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id::TEXT));

  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'match % not found', p_match_id; END IF;
  IF v_match.settled_at IS NOT NULL THEN RETURN; END IF;  -- idempotent
  IF v_match.status != 'FINISHED' THEN
    RAISE EXCEPTION 'match % is not FINISHED (status: %)', p_match_id, v_match.status;
  END IF;

  SELECT stake_idr INTO v_stake FROM tournaments WHERE id = v_match.tournament_id;
  SELECT COUNT(*) INTO v_participants FROM predictions WHERE match_id = p_match_id;
  SELECT COUNT(*) INTO v_winners FROM predictions
   WHERE match_id = p_match_id
     AND predicted_home = v_match.ft_home AND predicted_away = v_match.ft_away;

  IF v_participants > 1 AND v_winners > 0 THEN
    v_pot   := (v_participants - v_winners) * v_stake;
    v_share := v_pot / v_winners;                       -- integer division
  END IF;

  FOR v_pred IN SELECT * FROM predictions WHERE match_id = p_match_id LOOP
    IF v_participants <= 1 OR v_winners = 0 THEN
      v_amt := 0; v_is_winner := false;
    ELSIF v_pred.predicted_home = v_match.ft_home AND v_pred.predicted_away = v_match.ft_away THEN
      v_amt := v_share; v_is_winner := true;
    ELSE
      v_amt := -v_stake; v_is_winner := false;
    END IF;

    -- raw settlement row (kept as the per-match log)
    INSERT INTO settlements (match_id, user_id, amount_idr, is_winner, is_void)
    VALUES (p_match_id, v_pred.user_id, v_amt, v_is_winner, false);

    -- stored balance + ledger entry
    SELECT balance_idr INTO v_before FROM profiles WHERE id = v_pred.user_id;
    v_before := COALESCE(v_before, 0);
    v_after  := v_before + v_amt;
    UPDATE profiles SET balance_idr = v_after WHERE id = v_pred.user_id;

    INSERT INTO ledger (user_id, tournament_id, match_id, entry_type, prediction, score,
                        amount_idr, balance_before, balance_after, occurred_at, note)
    VALUES (v_pred.user_id, v_match.tournament_id, p_match_id, 'settlement',
            v_pred.predicted_home || '-' || v_pred.predicted_away,
            COALESCE(v_match.ft_home || '-' || v_match.ft_away, 'void'),
            v_amt, v_before, v_after, v_match.kickoff_at, NULL);
  END LOOP;

  UPDATE matches SET settled_at = now(), settled_by = 'auto' WHERE id = p_match_id;
END $$;

-- ── recalculate_match: reverse (balance + ledger), void, re-settle ──────────
CREATE OR REPLACE FUNCTION recalculate_match(p_match_id UUID, p_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before_data JSONB;
  v_match       matches%ROWTYPE;
  s             RECORD;
  v_before      BIGINT;
  v_after       BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id::TEXT));
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;

  SELECT jsonb_agg(to_jsonb(s2)) INTO v_before_data
    FROM settlements s2 WHERE match_id = p_match_id AND is_void = false;

  -- reverse the balance effect of the current active settlements + ledger trail
  FOR s IN SELECT * FROM settlements WHERE match_id = p_match_id AND is_void = false LOOP
    SELECT balance_idr INTO v_before FROM profiles WHERE id = s.user_id;
    v_before := COALESCE(v_before, 0);
    v_after  := v_before - s.amount_idr;
    UPDATE profiles SET balance_idr = v_after WHERE id = s.user_id;
    INSERT INTO ledger (user_id, tournament_id, match_id, entry_type, amount_idr,
                        balance_before, balance_after, occurred_at, note)
    VALUES (s.user_id, v_match.tournament_id, p_match_id, 'reversal', -s.amount_idr,
            v_before, v_after, now(), 'recalc reversal');
  END LOOP;

  UPDATE settlements SET is_void = true, voided_at = now(), voided_by = p_admin_id
   WHERE match_id = p_match_id AND is_void = false;
  UPDATE matches SET settled_at = NULL WHERE id = p_match_id;

  PERFORM settle_match(p_match_id);   -- re-settles + new ledger + balance

  INSERT INTO audit_log (actor_id, action, target_type, target_id, before_data)
  VALUES (p_admin_id, 'match_recalculate', 'match', p_match_id, v_before_data);
END $$;

-- ── void_match: zero-amount settlements + ledger trail (balance unchanged) ──
CREATE OR REPLACE FUNCTION void_match(p_match_id UUID, p_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match matches%ROWTYPE;
  v_pred  predictions%ROWTYPE;
  v_bal   BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_match_id::TEXT));
  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match.settled_at IS NOT NULL THEN RETURN; END IF;  -- idempotent

  FOR v_pred IN SELECT * FROM predictions WHERE match_id = p_match_id LOOP
    INSERT INTO settlements (match_id, user_id, amount_idr, is_winner, is_void)
    VALUES (p_match_id, v_pred.user_id, 0, false, false);

    SELECT balance_idr INTO v_bal FROM profiles WHERE id = v_pred.user_id;
    v_bal := COALESCE(v_bal, 0);
    INSERT INTO ledger (user_id, tournament_id, match_id, entry_type, prediction, score,
                        amount_idr, balance_before, balance_after, occurred_at, note)
    VALUES (v_pred.user_id, v_match.tournament_id, p_match_id, 'settlement',
            v_pred.predicted_home || '-' || v_pred.predicted_away, 'void',
            0, v_bal, v_bal, v_match.kickoff_at, 'match void');
  END LOOP;

  UPDATE matches
     SET settled_at = now(), settled_by = COALESCE(p_admin_id::TEXT, 'auto')
   WHERE id = p_match_id;

  IF p_admin_id IS NOT NULL THEN
    INSERT INTO audit_log (actor_id, action, target_type, target_id)
    VALUES (p_admin_id, 'match_void', 'match', p_match_id);
  END IF;
END $$;

-- ── leaderboard: tournament P&L from the LEDGER, active members only ────────
CREATE OR REPLACE FUNCTION leaderboard(p_tournament_id UUID)
RETURNS TABLE (
  user_id          UUID,
  display_name     TEXT,
  balance_idr      BIGINT,
  first_correct_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_active() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    coalesce(SUM(l.amount_idr), 0)::BIGINT                                 AS balance_idr,
    MIN(CASE WHEN l.amount_idr > 0 THEN pr.submitted_at END)               AS first_correct_at
  FROM profiles p
  JOIN predictions pr ON pr.user_id = p.id
  JOIN matches m ON m.id = pr.match_id AND m.tournament_id = p_tournament_id
  LEFT JOIN ledger l
    ON l.user_id = p.id AND l.match_id = pr.match_id AND l.entry_type = 'settlement'
  WHERE p.status = 'active'
  GROUP BY p.id, p.display_name
  ORDER BY balance_idr DESC, first_correct_at ASC NULLS LAST;
END $$;

-- ── Fresh ledger backfill (idempotent) — catches gap matches, re-syncs ──────
DO $$
DECLARE
  OLD_RIDWAN CONSTANT uuid := 'e6504c97-14c4-4e52-ac06-3b2f01df583f';
  NEW_RIDWAN CONSTANT uuid := 'f212c3ae-5721-4c38-96ec-723d24e6199b';
  TID        CONSTANT uuid := '3cb0cb79-92e2-45b6-9131-64744a37abfd';
  v_stake int; v_start timestamptz;
  m record; p record;
  v_participants int; v_winners int; v_pot int; v_amt bigint;
  v_before bigint; v_after bigint;
BEGIN
  SELECT stake_idr, start_at INTO v_stake, v_start FROM tournaments WHERE id = TID;

  DROP TABLE IF EXISTS ledger;
  CREATE TABLE ledger (
    seq            bigserial PRIMARY KEY,
    user_id        uuid NOT NULL REFERENCES profiles(id),
    tournament_id  uuid NOT NULL REFERENCES tournaments(id),
    match_id       uuid REFERENCES matches(id),
    entry_type     text NOT NULL,
    prediction     text,
    score          text,
    amount_idr     bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after  bigint NOT NULL,
    occurred_at    timestamptz NOT NULL,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE ledger DISABLE ROW LEVEL SECURITY;
  CREATE INDEX idx_ledger_user       ON ledger(user_id, seq);
  CREATE INDEX idx_ledger_tournament ON ledger(tournament_id, seq);
  CREATE INDEX idx_ledger_match      ON ledger(match_id);

  DROP TABLE IF EXISTS _run;
  CREATE TEMP TABLE _run (user_id uuid PRIMARY KEY, bal bigint);
  INSERT INTO _run (user_id, bal)
  SELECT id, CASE WHEN id = NEW_RIDWAN THEN 0 ELSE balance_idr END
    FROM profiles_archive WHERE id <> OLD_RIDWAN;

  INSERT INTO ledger (user_id, tournament_id, match_id, entry_type, amount_idr,
                      balance_before, balance_after, occurred_at, note)
  SELECT user_id, TID, NULL, 'opening', bal, 0, bal, v_start, 'carry-over opening'
    FROM _run ORDER BY bal DESC;

  FOR m IN SELECT * FROM matches WHERE tournament_id = TID AND settled_at IS NOT NULL
           ORDER BY kickoff_at, id LOOP
    SELECT count(*) INTO v_participants FROM predictions WHERE match_id = m.id;
    SELECT count(*) INTO v_winners FROM predictions
      WHERE match_id = m.id AND predicted_home = m.ft_home AND predicted_away = m.ft_away;
    FOR p IN SELECT * FROM predictions WHERE match_id = m.id LOOP
      IF v_participants <= 1 OR v_winners = 0 THEN v_amt := 0;
      ELSIF p.predicted_home = m.ft_home AND p.predicted_away = m.ft_away THEN
        v_pot := (v_participants - v_winners) * v_stake; v_amt := v_pot / v_winners;
      ELSE v_amt := -v_stake; END IF;
      SELECT bal INTO v_before FROM _run WHERE user_id = p.user_id;
      IF v_before IS NULL THEN v_before := 0; INSERT INTO _run VALUES (p.user_id, 0); END IF;
      v_after := v_before + v_amt;
      UPDATE _run SET bal = v_after WHERE user_id = p.user_id;
      INSERT INTO ledger (user_id, tournament_id, match_id, entry_type, prediction, score,
                          amount_idr, balance_before, balance_after, occurred_at, note)
      VALUES (p.user_id, TID, m.id, 'settlement',
              p.predicted_home || '-' || p.predicted_away,
              COALESCE(m.ft_home || '-' || m.ft_away, 'void'),
              v_amt, v_before, v_after, m.kickoff_at, NULL);
    END LOOP;
  END LOOP;

  UPDATE profiles pr SET balance_idr = r.bal FROM _run r WHERE pr.id = r.user_id;
  UPDATE profiles SET balance_idr = 0 WHERE id = OLD_RIDWAN;
  DROP TABLE _run;
END $$;

-- verification
SELECT p.display_name, p.status, p.balance_idr
  FROM profiles p WHERE p.id <> 'e6504c97-14c4-4e52-ac06-3b2f01df583f'
 ORDER BY p.balance_idr DESC;
SELECT COALESCE(SUM(amount_idr),0) AS settlement_net_should_be_zero
  FROM ledger WHERE entry_type = 'settlement';
