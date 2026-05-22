-- ── Profile auto-create on first Google login ─────────────────────────────
-- Fires after INSERT on auth.users. Creates a pending profile using the name
-- from Google OAuth metadata. ON CONFLICT DO NOTHING makes it safe to re-run.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, status, is_admin)
  VALUES (
    NEW.id,
    coalesce(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    coalesce(NEW.email, ''),
    'pending',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── Admin: update member status (approve / suspend) ────────────────────────
-- Called via Supabase RPC from the admin UI. Writes to audit_log atomically.
-- Actor ID is derived from the JWT (auth.uid()), not a parameter.

CREATE OR REPLACE FUNCTION admin_update_member_status(
  p_target_id UUID,
  p_new_status member_status
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_status member_status;
  v_action     audit_action;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'P0003';
  END IF;

  IF p_new_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Invalid target status: %', p_new_status;
  END IF;

  SELECT status INTO v_old_status FROM profiles WHERE id = p_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  v_action := CASE p_new_status
    WHEN 'active'    THEN 'member_approve'::audit_action
    WHEN 'suspended' THEN 'member_suspend'::audit_action
  END;

  UPDATE profiles SET status = p_new_status WHERE id = p_target_id;

  INSERT INTO audit_log (actor_id, action, target_type, target_id, before_data, after_data)
  VALUES (
    auth.uid(),
    v_action,
    'member',
    p_target_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_new_status)
  );
END;
$$;

-- ── Admin: hard-delete a member ────────────────────────────────────────────
-- Deletes from auth.users; the profiles FK CASCADE handles the rest.

CREATE OR REPLACE FUNCTION admin_delete_member(p_target_id UUID)
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

  SELECT to_jsonb(p) INTO v_before FROM public.profiles p WHERE id = p_target_id;

  -- Write audit record before delete (FK will be SET NULL after)
  INSERT INTO audit_log (actor_id, action, target_type, target_id, before_data)
  VALUES (auth.uid(), 'member_delete', 'member', p_target_id, v_before);

  DELETE FROM auth.users WHERE id = p_target_id;
END;
$$;
