-- Make api_match_id nullable so manually-created test fixtures don't need an API ID
ALTER TABLE matches ALTER COLUMN api_match_id DROP NOT NULL;

-- Tag tournaments created for sandbox testing
ALTER TABLE tournaments ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT false;

-- Wipe all test data in one admin call
CREATE OR REPLACE FUNCTION admin_wipe_test_data()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  SELECT COUNT(*) INTO v_count FROM tournaments WHERE is_test = true;

  DELETE FROM settlements
  WHERE match_id IN (
    SELECT m.id FROM matches m
    INNER JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.is_test = true
  );

  DELETE FROM predictions
  WHERE match_id IN (
    SELECT m.id FROM matches m
    INNER JOIN tournaments t ON t.id = m.tournament_id
    WHERE t.is_test = true
  );

  DELETE FROM matches
  WHERE tournament_id IN (SELECT id FROM tournaments WHERE is_test = true);

  DELETE FROM tournaments WHERE is_test = true;

  RETURN v_count;
END;
$$;
