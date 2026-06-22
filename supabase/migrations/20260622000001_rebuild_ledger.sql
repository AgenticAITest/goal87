-- ============================================================================
-- Rebuild: corrected transaction ledger + merged Ridwan account
-- Run ONCE in the Supabase SQL Editor. Safe to re-run (idempotent):
--   - archives are created only on the first run (capture original state)
--   - openings are read from profiles_archive, never from live (possibly-updated) balances
--   - the ledger table is dropped & rebuilt from current (corrected) predictions each run
--
-- Scope decisions (locked with the user):
--   - Old Ridwan "Ridwan Cahyawijaya" (suspended) folds into "ridwan thamrin" (active).
--   - Merged Ridwan opening = 0 (the manual 100k transfer is superseded by real history).
--   - settlements stays as immutable as-booked history (archived); ledger is the new truth.
--   - This step does NOT touch the UI or settle_match. Stops after verification.
-- ============================================================================

DO $$
DECLARE
  OLD_RIDWAN CONSTANT uuid := 'e6504c97-14c4-4e52-ac06-3b2f01df583f';
  NEW_RIDWAN CONSTANT uuid := 'f212c3ae-5721-4c38-96ec-723d24e6199b';
  TID        CONSTANT uuid := '3cb0cb79-92e2-45b6-9131-64744a37abfd';
  v_stake int;
  v_start timestamptz;
  m record;
  p record;
  v_participants int;
  v_winners int;
  v_pot int;
  v_amt bigint;
  v_before bigint;
  v_after bigint;
BEGIN
  SELECT stake_idr, start_at INTO v_stake, v_start FROM tournaments WHERE id = TID;

  -- 1. ARCHIVES (first run only) — immutable snapshot of original state ---------
  IF to_regclass('public.settlements_archive') IS NULL THEN
    EXECUTE 'CREATE TABLE settlements_archive AS SELECT * FROM settlements';
  END IF;
  IF to_regclass('public.predictions_archive') IS NULL THEN
    EXECUTE 'CREATE TABLE predictions_archive AS SELECT * FROM predictions';
  END IF;
  IF to_regclass('public.profiles_archive') IS NULL THEN
    EXECUTE 'CREATE TABLE profiles_archive AS SELECT * FROM profiles';
  END IF;

  -- 2. MERGE RIDWAN'S PREDICTIONS (in place) -----------------------------------
  ALTER TABLE predictions DISABLE TRIGGER trg_prevent_late_predictions;

  -- drop old-account duplicates where the new account already predicted the match
  DELETE FROM predictions o
   WHERE o.user_id = OLD_RIDWAN
     AND EXISTS (SELECT 1 FROM predictions n
                  WHERE n.user_id = NEW_RIDWAN AND n.match_id = o.match_id);

  -- reassign the remaining old-account predictions to the new account
  UPDATE predictions SET user_id = NEW_RIDWAN WHERE user_id = OLD_RIDWAN;

  ALTER TABLE predictions ENABLE TRIGGER trg_prevent_late_predictions;

  -- 3. (RE)CREATE LEDGER TABLE -------------------------------------------------
  DROP TABLE IF EXISTS ledger;
  CREATE TABLE ledger (
    seq            bigserial PRIMARY KEY,
    user_id        uuid NOT NULL REFERENCES profiles(id),
    tournament_id  uuid NOT NULL REFERENCES tournaments(id),
    match_id       uuid REFERENCES matches(id),
    entry_type     text NOT NULL,                 -- 'opening' | 'settlement'
    prediction     text,
    score          text,
    amount_idr     bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after  bigint NOT NULL,
    occurred_at    timestamptz NOT NULL,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE ledger DISABLE ROW LEVEL SECURITY;   -- mirror settlements/predictions
  CREATE INDEX idx_ledger_user       ON ledger(user_id, seq);
  CREATE INDEX idx_ledger_tournament ON ledger(tournament_id, seq);
  CREATE INDEX idx_ledger_match      ON ledger(match_id);

  -- running balances during build
  DROP TABLE IF EXISTS _run;
  CREATE TEMP TABLE _run (user_id uuid PRIMARY KEY, bal bigint);

  -- 4a. OPENING entries — from ARCHIVE balances (stable across re-runs).
  --     Exclude old Ridwan; merged Ridwan opens at 0.
  INSERT INTO _run (user_id, bal)
  SELECT id, CASE WHEN id = NEW_RIDWAN THEN 0 ELSE balance_idr END
    FROM profiles_archive
   WHERE id <> OLD_RIDWAN;

  INSERT INTO ledger (user_id, tournament_id, match_id, entry_type, amount_idr,
                      balance_before, balance_after, occurred_at, note)
  SELECT user_id, TID, NULL, 'opening', bal, 0, bal, v_start, 'carry-over opening'
    FROM _run
   ORDER BY bal DESC;

  -- 4b. SETTLEMENT entries — recompute every settled match in kickoff order ----
  FOR m IN
    SELECT * FROM matches
     WHERE tournament_id = TID AND settled_at IS NOT NULL
     ORDER BY kickoff_at, id
  LOOP
    SELECT count(*) INTO v_participants FROM predictions WHERE match_id = m.id;
    SELECT count(*) INTO v_winners FROM predictions
      WHERE match_id = m.id AND predicted_home = m.ft_home AND predicted_away = m.ft_away;

    FOR p IN SELECT * FROM predictions WHERE match_id = m.id LOOP
      IF v_participants <= 1 OR v_winners = 0 THEN
        v_amt := 0;
      ELSIF p.predicted_home = m.ft_home AND p.predicted_away = m.ft_away THEN
        v_pot := (v_participants - v_winners) * v_stake;
        v_amt := v_pot / v_winners;          -- integer division (matches settle_match)
      ELSE
        v_amt := -v_stake;
      END IF;

      SELECT bal INTO v_before FROM _run WHERE user_id = p.user_id;
      IF v_before IS NULL THEN
        v_before := 0;
        INSERT INTO _run (user_id, bal) VALUES (p.user_id, 0);
      END IF;
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

  -- 5. SYNC STORED BALANCE to ledger endings -----------------------------------
  UPDATE profiles pr SET balance_idr = r.bal FROM _run r WHERE pr.id = r.user_id;
  UPDATE profiles SET balance_idr = 0 WHERE id = OLD_RIDWAN;  -- folded in

  DROP TABLE _run;
END $$;

-- 6. VERIFICATION — compare to ledger_preview.csv ----------------------------
SELECT p.display_name, p.status, p.balance_idr AS ledger_ending
  FROM profiles p
 WHERE p.id <> 'e6504c97-14c4-4e52-ac06-3b2f01df583f'
 ORDER BY p.balance_idr DESC;

-- expected:
--   KS Liem            1,500,000
--   Wiwi Yahya           450,000
--   ridwan thamrin       300,000
--   Lukman Cahyawijaya   300,000
--   Erwin Adhiwijaya     150,000
--   surjaman jahja      -900,000
--   drinks morebeers  -1,100,000

-- sanity: ledger settlement entries must net to zero (zero-sum game)
SELECT COALESCE(SUM(amount_idr),0) AS settlement_net_should_be_zero
  FROM ledger WHERE entry_type = 'settlement';
