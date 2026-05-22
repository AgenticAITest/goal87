-- ── admin_override_match_status ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_override_match_status(
  p_match_id  UUID,
  p_new_status match_status
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status match_status;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  SELECT status INTO v_old_status FROM matches WHERE id = p_match_id;

  UPDATE matches SET status = p_new_status WHERE id = p_match_id;

  INSERT INTO audit_log (actor_id, action, target_type, target_id, before_data, after_data)
  VALUES (
    auth.uid(), 'match_status_override', 'match', p_match_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_new_status)
  );
END;
$$;

-- ── admin_override_match_score ─────────────────────────────────────────────
-- Only writes the score. Admin must separately trigger recalculate if needed.
CREATE OR REPLACE FUNCTION admin_override_match_score(
  p_match_id UUID,
  p_ft_home  INT,
  p_ft_away  INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before JSONB;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  SELECT jsonb_build_object('ft_home', ft_home, 'ft_away', ft_away)
  INTO v_before FROM matches WHERE id = p_match_id;

  UPDATE matches SET ft_home = p_ft_home, ft_away = p_ft_away WHERE id = p_match_id;

  INSERT INTO audit_log (actor_id, action, target_type, target_id, before_data, after_data)
  VALUES (
    auth.uid(), 'match_score_override', 'match', p_match_id,
    v_before,
    jsonb_build_object('ft_home', p_ft_home, 'ft_away', p_ft_away)
  );
END;
$$;

-- ── admin_force_settle ─────────────────────────────────────────────────────
-- Sets status = FINISHED (if not already) then calls settle_match().
-- Admin should not need to do a separate status override first.
CREATE OR REPLACE FUNCTION admin_force_settle(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  -- Ensure match is FINISHED so settle_match() won't reject it
  UPDATE matches
     SET status = 'FINISHED'
   WHERE id = p_match_id
     AND status != 'FINISHED';

  PERFORM settle_match(p_match_id);

  INSERT INTO audit_log (actor_id, action, target_type, target_id)
  VALUES (auth.uid(), 'match_force_settle', 'match', p_match_id);
END;
$$;

-- ── admin_submit_prediction ────────────────────────────────────────────────
-- Admin enters or updates a prediction on behalf of a player.
-- The prevent_late_predictions trigger still applies — kickoff lock is enforced.
CREATE OR REPLACE FUNCTION admin_submit_prediction(
  p_user_id       UUID,
  p_match_id      UUID,
  p_predicted_home INT,
  p_predicted_away INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO predictions (user_id, match_id, predicted_home, predicted_away, submitted_by)
  VALUES (p_user_id, p_match_id, p_predicted_home, p_predicted_away, auth.uid())
  ON CONFLICT (user_id, match_id) DO UPDATE
    SET predicted_home = EXCLUDED.predicted_home,
        predicted_away = EXCLUDED.predicted_away,
        submitted_by   = auth.uid(),
        submitted_at   = now();

  INSERT INTO audit_log (actor_id, action, target_type, target_id)
  VALUES (auth.uid(), 'prediction_admin_entry', 'prediction', p_match_id);
END;
$$;
