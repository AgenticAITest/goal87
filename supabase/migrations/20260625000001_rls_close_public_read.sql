-- Close anonymous/public read access to predictions, settlements, and ledger.
-- These tables had RLS disabled (migrations 20260522000008_relax_rls and the
-- ledger rebuild), so the PUBLIC anon key — which is embedded in the frontend
-- bundle — could read them directly without logging in.
--
-- After this migration:
--   * Active, logged-in members keep the exact access the app needs.
--   * The anonymous public can no longer read predictions / settlements / ledger.
--   * The score worker (service key) and DB functions (SECURITY DEFINER) bypass
--     RLS, so they are completely unaffected.
--
-- Run once in the Supabase SQL Editor (the pildun project: wgaoxftcxpoacxeqisxt).

BEGIN;

-- ── predictions ──────────────────────────────────────────────────────────────
-- The app intentionally shows ALL members' predictions (Details/Summary pages),
-- so any active member may read all; the public is blocked. Drop the old
-- "hide before kickoff" policy, which would otherwise break that feature.
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "predictions: read"            ON predictions;
DROP POLICY IF EXISTS "predictions: active read all" ON predictions;
CREATE POLICY "predictions: active read all"
  ON predictions FOR SELECT
  USING (is_active());
-- (the existing insert/update policies — own-row only — reactivate automatically)

-- ── settlements ──────────────────────────────────────────────────────────────
-- Re-enable RLS; the original "self read" + "admin read all" policies (still
-- present, just dormant) reactivate. The frontend only reads its OWN settlements
-- (realtime); cross-player amounts come from the ledger below.
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- ── ledger ───────────────────────────────────────────────────────────────────
-- The summary shows everyone's running totals, so active members read all.
-- Writes come only from SECURITY DEFINER functions / the service key (bypass RLS),
-- so no write policy is needed.
ALTER TABLE ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger: active read all" ON ledger;
CREATE POLICY "ledger: active read all"
  ON ledger FOR SELECT
  USING (is_active());

COMMIT;

-- ── To revert (if the app misbehaves) ────────────────────────────────────────
-- ALTER TABLE predictions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE settlements DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE ledger      DISABLE ROW LEVEL SECURITY;
