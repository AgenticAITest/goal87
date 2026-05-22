-- Relax read restrictions — closed, admin-approved group; frontend manages access.

-- Disable RLS on the two tables that need cross-player reads.
ALTER TABLE predictions DISABLE ROW LEVEL SECURITY;
ALTER TABLE settlements DISABLE ROW LEVEL SECURITY;

-- Allow any active member to read all active members' display names.
-- Required for the cross-player summary page column headers.
CREATE POLICY "profiles: active read active members"
  ON profiles FOR SELECT
  USING (is_active() AND status = 'active');
