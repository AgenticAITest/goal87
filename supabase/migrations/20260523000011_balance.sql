-- ── Member balance ──────────────────────────────────────────────────────────

-- Running balance stored on the profile. Admin sets this manually
-- after offline cash settlements are confirmed.
ALTER TABLE profiles ADD COLUMN balance_idr BIGINT NOT NULL DEFAULT 0;

-- ── Balance ledger (audit trail) ─────────────────────────────────────────────

CREATE TABLE balance_ledger (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  adjusted_by          UUID        NOT NULL REFERENCES profiles(id),
  previous_balance_idr BIGINT      NOT NULL,
  new_balance_idr      BIGINT      NOT NULL,
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE balance_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "balance_ledger: admin read all"
  ON balance_ledger FOR SELECT
  USING (is_admin());

CREATE POLICY "balance_ledger: self read"
  ON balance_ledger FOR SELECT
  USING (user_id = auth.uid() AND is_active());

CREATE INDEX idx_balance_ledger_user_id ON balance_ledger(user_id, created_at DESC);

-- ── RPC: admin_set_balance ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_set_balance(
  p_target_id UUID,
  p_new_balance BIGINT,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_balance BIGINT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT balance_idr INTO v_prev_balance
  FROM profiles
  WHERE id = p_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  UPDATE profiles
  SET balance_idr = p_new_balance
  WHERE id = p_target_id;

  INSERT INTO balance_ledger (user_id, adjusted_by, previous_balance_idr, new_balance_idr, note)
  VALUES (p_target_id, auth.uid(), v_prev_balance, p_new_balance, p_note);
END;
$$;
