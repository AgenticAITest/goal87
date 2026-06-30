-- ============================================================================
-- Self-healing settlement: record the exact score each match was settled on, so
-- the worker can compare it against the live provider score on EVERY poll and
-- re-settle on any drift — instead of the old poll-to-poll diff, which a single
-- missed/failed cycle (or a correction arriving in a non-FINISHED poll) could
-- defeat permanently.
--
-- Incident that motivated this (2026-06-30): Germany–Paraguay (group, 1-1 draw)
-- settled on a transient 2-1 FINISHED snapshot (a 10' goal still counted by the
-- provider, later disallowed). The provider corrected to 1-1 — the live score
-- updated, but the frozen settlement never reconciled, because the re-settle
-- baseline had already been overwritten to 1-1 and the diff vanished.
--
-- After this migration: matches.settled_home/settled_away hold the score the
-- match was settled on; the worker recalculates whenever ft_* drifts from them.
--
-- Run ONCE in the Supabase SQL Editor (filename order). Pause the worker first.
-- ============================================================================

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS settled_home INT,
  ADD COLUMN IF NOT EXISTS settled_away INT;

-- ── settle_match: same as 20260622000002, but also stamps the settled-on score ─
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

  -- Stamp the score this match was settled on, so the worker can detect later
  -- provider corrections (ft_* drifting from settled_*) and re-settle.
  UPDATE matches SET settled_at = now(), settled_by = 'auto',
         settled_home = v_match.ft_home, settled_away = v_match.ft_away
   WHERE id = p_match_id;
END $$;

-- ── Backfill the settled-on score for existing settled matches ──────────────
-- Source of truth = the frozen ledger settlement row (the actual score each
-- match was settled on), NOT the current ft_* — so any pre-existing desync
-- surfaces as a drift and the worker auto-recalcs it on the next poll.
UPDATE matches m
SET settled_home = split_part(l.score, '-', 1)::int,
    settled_away = split_part(l.score, '-', 2)::int
FROM (
  SELECT DISTINCT ON (match_id) match_id, score
  FROM ledger
  WHERE entry_type = 'settlement' AND score IS NOT NULL AND score <> 'void'
  ORDER BY match_id, seq DESC
) l
WHERE m.id = l.match_id
  AND m.status = 'FINISHED' AND m.settled_at IS NOT NULL;

-- Matches settled with no payout ledger row (e.g. 0 predictions): baseline = ft,
-- so they don't trigger a spurious recalc loop on first deploy.
UPDATE matches
SET settled_home = ft_home, settled_away = ft_away
WHERE status = 'FINISHED' AND settled_at IS NOT NULL
  AND settled_home IS NULL AND ft_home IS NOT NULL;

-- verification: rows here are matches whose live score no longer matches the
-- score they were settled on — the worker will recalc each on its next poll.
SELECT id, home_team, away_team, ft_home, ft_away, settled_home, settled_away
FROM matches
WHERE status = 'FINISHED' AND settled_at IS NOT NULL
  AND (ft_home IS DISTINCT FROM settled_home OR ft_away IS DISTINCT FROM settled_away);
