-- ── Types ──────────────────────────────────────────────────────────────────

CREATE TYPE match_status AS ENUM (
  'SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'FINISHED', 'POSTPONED', 'CANCELLED'
);

CREATE TYPE tournament_status AS ENUM ('draft', 'open', 'closed');

CREATE TYPE member_status AS ENUM ('pending', 'active', 'suspended');

CREATE TYPE audit_action AS ENUM (
  'member_approve',
  'member_suspend',
  'member_delete',
  'tournament_create',
  'tournament_edit',
  'tournament_close',
  'match_status_override',
  'match_score_override',
  'match_void',
  'match_force_settle',
  'match_recalculate',
  'prediction_admin_entry',
  'settlement_void'
);

-- ── Tables ─────────────────────────────────────────────────────────────────

-- Extends auth.users. Created automatically on first Google login (Phase 2 trigger).
CREATE TABLE profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT        NOT NULL DEFAULT '',
  email        TEXT        NOT NULL DEFAULT '',
  status       member_status NOT NULL DEFAULT 'pending',
  is_admin     BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tournaments (
  id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT           NOT NULL,
  api_competition_id TEXT           NOT NULL,  -- e.g. 'WC', 'PL', 'BL1'
  api_season         INT            NOT NULL,  -- e.g. 2025
  stake_idr          INT            NOT NULL DEFAULT 100000,
  start_at           TIMESTAMPTZ,
  end_at             TIMESTAMPTZ,
  status             tournament_status NOT NULL DEFAULT 'draft',
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID         NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  api_match_id   INT          NOT NULL UNIQUE,
  home_team      TEXT         NOT NULL,
  away_team      TEXT         NOT NULL,
  kickoff_at     TIMESTAMPTZ  NOT NULL,
  status         match_status NOT NULL DEFAULT 'SCHEDULED',
  ft_home        INT,
  ft_away        INT,
  last_polled_at TIMESTAMPTZ,
  settled_at     TIMESTAMPTZ,
  settled_by     TEXT,  -- 'auto' or admin profile id
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE predictions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  match_id        UUID        NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  predicted_home  INT         NOT NULL CHECK (predicted_home >= 0),
  predicted_away  INT         NOT NULL CHECK (predicted_away >= 0),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by    UUID        NOT NULL REFERENCES profiles(id),  -- self or admin
  UNIQUE (user_id, match_id)
);

CREATE TABLE settlements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    UUID        NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount_idr  INT         NOT NULL DEFAULT 0,
  is_winner   BOOLEAN     NOT NULL DEFAULT false,
  is_void     BOOLEAN     NOT NULL DEFAULT false,
  voided_at   TIMESTAMPTZ,
  voided_by   UUID        REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  action      audit_action NOT NULL,
  target_type TEXT         NOT NULL,  -- 'match' | 'tournament' | 'member' | 'prediction' | 'settlement'
  target_id   UUID         NOT NULL,
  before_data JSONB,
  after_data  JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX idx_predictions_match_id      ON predictions(match_id);
CREATE INDEX idx_predictions_user_id       ON predictions(user_id);
CREATE INDEX idx_settlements_user_id       ON settlements(user_id);
CREATE INDEX idx_settlements_match_id      ON settlements(match_id) WHERE is_void = false;
CREATE INDEX idx_matches_tournament_kickoff ON matches(tournament_id, kickoff_at);
CREATE INDEX idx_matches_status_kickoff    ON matches(status, kickoff_at);
