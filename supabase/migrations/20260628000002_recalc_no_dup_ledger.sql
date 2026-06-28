-- ============================================================================
-- Patch recalculate_match() so it stops leaving duplicate ledger rows.
--
-- The previous version (20260622000002) reversed the balance, wrote a 'reversal'
-- ledger row, voided the settlements, re-settled — but never removed the ORIGINAL
-- 'settlement' ledger row. Result: a recalc'd match had S0 + reversal + S1 in the
-- ledger. profiles.balance_idr stayed correct (the three net out) but leaderboard()
-- sums only 'settlement' rows, so it double-counted every recalc'd match.
--
-- New behaviour: reverse the balance from the active settlements, DELETE this
-- match's existing 'settlement'/'reversal' ledger rows, then re-settle fresh.
-- The ledger ends with exactly one settlement row per player for the match, so
-- leaderboard() and profiles.balance_idr always agree. The pre-recalc state is
-- still captured in audit_log.before_data. This also SELF-HEALS any match that
-- still carries old duplicate rows: the next recalc cleans them.
--
-- Idempotent (CREATE OR REPLACE). No data is changed by defining the function.
-- ============================================================================

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

  -- snapshot the pre-recalc settlements for the audit trail
  SELECT jsonb_agg(to_jsonb(s2)) INTO v_before_data
    FROM settlements s2 WHERE match_id = p_match_id AND is_void = false;

  -- reverse the balance effect of the current active settlements
  FOR s IN SELECT * FROM settlements WHERE match_id = p_match_id AND is_void = false LOOP
    SELECT balance_idr INTO v_before FROM profiles WHERE id = s.user_id;
    v_before := COALESCE(v_before, 0);
    v_after  := v_before - s.amount_idr;
    UPDATE profiles SET balance_idr = v_after WHERE id = s.user_id;
  END LOOP;

  -- drop this match's prior ledger rows so the re-settlement leaves exactly one
  -- settlement row per player (prevents leaderboard() double-counting). The
  -- audit_log row below preserves the superseded state.
  DELETE FROM ledger WHERE match_id = p_match_id AND entry_type IN ('settlement','reversal');

  UPDATE settlements SET is_void = true, voided_at = now(), voided_by = p_admin_id
   WHERE match_id = p_match_id AND is_void = false;
  UPDATE matches SET settled_at = NULL WHERE id = p_match_id;

  PERFORM settle_match(p_match_id);   -- re-settles: fresh settlement rows + balance

  INSERT INTO audit_log (actor_id, action, target_type, target_id, before_data)
  VALUES (p_admin_id, 'match_recalculate', 'match', p_match_id, v_before_data);
END $$;
