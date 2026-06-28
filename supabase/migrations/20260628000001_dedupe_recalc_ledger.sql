-- ============================================================================
-- Fix leaderboard() double-counting left by admin match recalculations.
--
-- Background
-- ----------
-- recalculate_match() reverses a match's settlement (a 'reversal' ledger row),
-- voids the old settlement rows, then re-settles (a fresh 'settlement' ledger
-- row). It does NOT delete the ORIGINAL 'settlement' ledger row. So a recalc'd
-- match ends up with three ledger rows per player:
--     S0  settlement  (original, now superseded)
--     R   reversal    (= -S0, note 'recalc reversal')
--     S1  settlement  (corrected)
-- profiles.balance_idr is CORRECT (it nets S0 + R + S1 = S1). But leaderboard()
-- sums only entry_type='settlement' rows, so it counts S0 + S1 and double-counts
-- the match. Verified live: only the Egypt–Iran match (1-1, score was wrongly
-- 1-2 making Lukman the sole winner) is affected — KS/Wiwi/Erwin/ridwan were
-- charged an extra S0 of -100k each in the leaderboard, Lukman an extra +400k.
--
-- This removes, for every recalc'd match, the superseded settlement rows (any
-- 'settlement' that has a LATER 'settlement' for the same player+match) and the
-- matching 'reversal' rows — keeping only the corrected settlement. Net ledger
-- sum per player is unchanged (S0 and R cancel), so profiles.balance_idr stays
-- correct AND leaderboard() now matches it. Idempotent; handles multi-recalc.
--
-- Run ONCE in the Supabase SQL Editor. Safe to run with the worker live (it only
-- touches historical settled-match rows), but pausing it is still recommended.
-- ============================================================================

BEGIN;

-- 1) drop the superseded original settlement rows (a later settlement exists)
DELETE FROM ledger l
 WHERE l.entry_type = 'settlement'
   AND EXISTS (
     SELECT 1 FROM ledger l2
      WHERE l2.match_id = l.match_id
        AND l2.user_id  = l.user_id
        AND l2.entry_type = 'settlement'
        AND l2.seq > l.seq
   );

-- 2) drop the reversal rows that paired with those originals
DELETE FROM ledger
 WHERE entry_type = 'reversal'
   AND note = 'recalc reversal';

-- ── VERIFY (inside the transaction; ROLLBACK if anything looks wrong) ────────
-- (a) No match/player should have more than one settlement row now:
SELECT match_id, user_id, count(*) AS settlement_rows
  FROM ledger WHERE entry_type = 'settlement'
 GROUP BY match_id, user_id HAVING count(*) > 1;          -- expect 0 rows

-- (b) Stored balance must still equal the full ledger sum for every active member,
--     AND now also equal opening + settlement-only sum (what leaderboard shows):
SELECT p.display_name, p.balance_idr AS stored,
       (SELECT COALESCE(SUM(l.amount_idr),0) FROM ledger l WHERE l.user_id=p.id) AS full_ledger,
       (SELECT COALESCE(SUM(l.amount_idr),0) FROM ledger l
          WHERE l.user_id=p.id AND l.entry_type IN ('opening','settlement')) AS opening_plus_settle
  FROM profiles p WHERE p.status='active'
 ORDER BY stored DESC;
-- All three columns should be equal per row.

COMMIT;   -- change to ROLLBACK to abort without writing
