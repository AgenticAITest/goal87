-- ── Enable RLS ─────────────────────────────────────────────────────────────

ALTER TABLE profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log   ENABLE ROW LEVEL SECURITY;

-- ── Helper functions (stable, security definer) ────────────────────────────

-- Returns true when the calling user is an active admin.
-- SECURITY DEFINER + fixed search_path prevents privilege escalation via search_path injection.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND is_admin = true AND status = 'active'
  );
$$;

-- Returns true when the calling user has an active profile.
CREATE OR REPLACE FUNCTION is_active()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND status = 'active'
  );
$$;

-- ── profiles ───────────────────────────────────────────────────────────────

-- Users can read their own profile (including pending — needed for the /pending page).
CREATE POLICY "profiles: self read"
  ON profiles FOR SELECT
  USING (id = auth.uid());

-- Admins can read every profile.
CREATE POLICY "profiles: admin read all"
  ON profiles FOR SELECT
  USING (is_admin());

-- Users can update their own non-sensitive columns.
-- The prevent_profile_self_elevation trigger (migration 003) enforces
-- that status and is_admin cannot be changed by non-admins.
CREATE POLICY "profiles: self update"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

-- Admins can update any profile (e.g. approve, suspend, promote).
CREATE POLICY "profiles: admin update all"
  ON profiles FOR UPDATE
  USING (is_admin());

-- ── tournaments ────────────────────────────────────────────────────────────

-- Active players can read open tournaments.
CREATE POLICY "tournaments: active read open"
  ON tournaments FOR SELECT
  USING (is_active() AND status = 'open');

CREATE POLICY "tournaments: admin read all"
  ON tournaments FOR SELECT
  USING (is_admin());

CREATE POLICY "tournaments: admin insert"
  ON tournaments FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "tournaments: admin update"
  ON tournaments FOR UPDATE
  USING (is_admin());

CREATE POLICY "tournaments: admin delete"
  ON tournaments FOR DELETE
  USING (is_admin());

-- ── matches ────────────────────────────────────────────────────────────────

-- Any active member can read all matches (needed to show fixtures and live scores).
CREATE POLICY "matches: active read all"
  ON matches FOR SELECT
  USING (is_active());

-- Only admins write matches via the UI; the score worker uses service-role (bypasses RLS).
CREATE POLICY "matches: admin write"
  ON matches FOR ALL
  USING (is_admin());

-- ── predictions ────────────────────────────────────────────────────────────

-- Before kickoff: a user can only see their own prediction.
-- After kickoff: all active users can see all predictions for that match.
CREATE POLICY "predictions: read"
  ON predictions FOR SELECT
  USING (
    is_active() AND (
      user_id = auth.uid()
      OR is_admin()
      OR (SELECT kickoff_at FROM matches WHERE id = match_id) <= now()
    )
  );

-- A user can submit their own prediction; admins can submit on behalf of any user.
CREATE POLICY "predictions: insert"
  ON predictions FOR INSERT
  WITH CHECK (
    (user_id = auth.uid() AND is_active())
    OR is_admin()
  );

CREATE POLICY "predictions: update"
  ON predictions FOR UPDATE
  USING (
    (user_id = auth.uid() AND is_active())
    OR is_admin()
  );

-- ── settlements ────────────────────────────────────────────────────────────

-- Players read their own settlements; admins read all.
-- Writes come only from DB functions (service-role) — no direct-write policy needed.
CREATE POLICY "settlements: self read"
  ON settlements FOR SELECT
  USING (user_id = auth.uid() AND is_active());

CREATE POLICY "settlements: admin read all"
  ON settlements FOR SELECT
  USING (is_admin());

-- ── audit_log ──────────────────────────────────────────────────────────────

-- Admins read all; writes come only from DB functions (service-role).
CREATE POLICY "audit_log: admin read all"
  ON audit_log FOR SELECT
  USING (is_admin());
