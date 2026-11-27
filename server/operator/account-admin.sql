-- Provision timeax_account_admin_login separately; grant just USAGE and this RPC.
-- Run against a disposable database before applying. Never grant to Data API roles.
BEGIN;
CREATE OR REPLACE FUNCTION timeax_api.admin_accounts(p_action text, p_id uuid, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user record;
  v_identity uuid;
  v_org uuid;
  v_member uuid;
  v_blocked boolean;
  v_scope text;
  v_issuer constant text := 'https://rohgpgogsdtiltbocdao.supabase.co/auth/v1';
BEGIN
  IF session_user <> 'timeax_account_admin_login'
     OR p_action IS NULL OR p_action NOT IN ('list','preview','delete')
  THEN RAISE EXCEPTION 'admin denied' USING ERRCODE='42501'; END IF;
  IF p_action='list' THEN
    IF p_email IS NOT NULL THEN RAISE EXCEPTION 'invalid admin request' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('accounts',coalesce((
      SELECT jsonb_agg(to_jsonb(u) ORDER BY u.id) FROM (
        SELECT a.id,a.email,a.created_at AS "createdAt",a.email_confirmed_at IS NOT NULL AS verified
        FROM auth.users a
        WHERE a.deleted_at IS NULL AND (p_id IS NULL OR a.id>p_id)
        ORDER BY a.id LIMIT 51
      ) u
    ),'[]'::jsonb));
  END IF;
  IF p_id IS NULL OR (p_action='preview' AND p_email IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid admin request' USING ERRCODE='22023';
  END IF;
  IF p_action='delete' THEN
    -- Same lock as agency creation; never delete based on a stale browser row.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_issuer || '/' || p_id::text,0));
  END IF;
  SELECT a.id,a.email,a.created_at INTO v_user
    FROM auth.users a WHERE a.id=p_id AND a.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','missing'); END IF;
  SELECT id INTO v_identity FROM timeax_core.identities WHERE issuer=v_issuer AND subject=p_id::text FOR UPDATE;
  SELECT organization_id INTO v_org FROM timeax_core.self_service_agencies WHERE identity_id=v_identity;
  IF v_org IS NOT NULL THEN
    PERFORM 1 FROM timeax_core.organizations WHERE id=v_org FOR UPDATE;
    SELECT id INTO v_member FROM timeax_core.memberships
      WHERE organization_id=v_org AND identity_id=v_identity AND role='agency_admin';
  END IF;
  v_blocked := EXISTS (SELECT 1 FROM storage.objects WHERE owner_id=p_id::text OR owner=p_id)
    OR (v_identity IS NOT NULL AND EXISTS (
      SELECT 1 FROM timeax_core.memberships
      WHERE (identity_id=v_identity OR organization_id=v_org) AND id IS DISTINCT FROM v_member
    ))
    OR (v_org IS NOT NULL AND v_member IS NULL);
  v_scope := CASE WHEN v_blocked THEN 'linked' WHEN v_org IS NOT NULL THEN 'isolated-agency'
                  WHEN v_identity IS NOT NULL THEN 'identity-only' ELSE 'signup-only' END;
  IF p_action='preview' THEN
    RETURN jsonb_build_object('state','preview','id',v_user.id,'email',v_user.email,
       'scope',v_scope,'createdAt',v_user.created_at,'canDelete',NOT v_blocked AND v_user.email IS NOT NULL);
  END IF;
  IF v_blocked OR v_user.email IS NULL OR p_email IS DISTINCT FROM v_user.email THEN
    RETURN jsonb_build_object('state','blocked');
  END IF;
  -- Any unexpected relation blocks the entire transaction; never blanket-cascade business data.
  BEGIN
    DELETE FROM timeax_core.agency_registration_requests WHERE issuer=v_issuer AND subject=p_id::text;
    IF v_org IS NOT NULL THEN
      DELETE FROM timeax_core.self_service_agencies WHERE identity_id=v_identity;
      DELETE FROM timeax_core.memberships WHERE id=v_member;
      DELETE FROM timeax_core.organizations WHERE id=v_org;
    END IF;
    IF v_identity IS NOT NULL THEN DELETE FROM timeax_core.identities WHERE id=v_identity; END IF;
    DELETE FROM auth.users WHERE id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'account changed' USING ERRCODE='55000'; END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('state','blocked');
  END;
  RETURN jsonb_build_object('state','deleted','id',p_id);
END;
$fn$;
ALTER FUNCTION timeax_api.admin_accounts(text,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_api.admin_accounts(text,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
