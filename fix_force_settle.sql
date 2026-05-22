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

  UPDATE matches
     SET status = 'FINISHED'
   WHERE id = p_match_id
     AND status != 'FINISHED';

  PERFORM settle_match(p_match_id);

  INSERT INTO audit_log (actor_id, action, target_type, target_id)
  VALUES (auth.uid(), 'match_force_settle', 'match', p_match_id);
END;
$$;
