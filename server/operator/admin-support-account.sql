-- Private owner support helper. Only the guarded owner-support RPC may call
-- this as postgres. Apply after web-sessions.sql; the wrapper supplies audit table.
BEGIN;
CREATE OR REPLACE FUNCTION timeax_core.owner_support_account(p_action text,p_account uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $fn$
DECLARE
 v_account jsonb;
 v_reason text;
 v_now timestamptz;
 v_web_count bigint;
 v_provider_count bigint;
 v_legacy_token_count bigint;
 v_issuer constant text:='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1';
BEGIN
 IF current_user IS DISTINCT FROM 'postgres'::name OR p_account IS NULL
  OR p_action IS NULL OR p_action NOT IN ('account','revoke-sessions')
 THEN RAISE EXCEPTION 'owner support denied' USING ERRCODE='42501'; END IF;

 IF p_action='account' THEN
  IF COALESCE(p_input,'{}'::jsonb)<>'{}'::jsonb THEN
   RAISE EXCEPTION 'invalid account support request' USING ERRCODE='22023';
  END IF;
  v_now:=statement_timestamp();
  SELECT jsonb_build_object(
   'id',u.id,'email',u.email,'createdAt',u.created_at,'verified',u.email_confirmed_at IS NOT NULL,
   'lastSignInAt',u.last_sign_in_at,'bannedUntil',u.banned_until,
   'hasPassword',COALESCE(length(u.encrypted_password)>0,false),
   'activeSessions',(SELECT count(*) FROM timeax_core.web_sessions w WHERE w.subject=u.id AND w.expires_at>v_now),
   'memberships',COALESCE((
    SELECT jsonb_agg(
     jsonb_build_object('id',m.id,'organizationId',o.id,'organizationName',o.name,'kind',o.kind,'role',m.role,'state',m.state)
     ORDER BY o.name,o.id,m.id)
    FROM timeax_core.identities i
    JOIN timeax_core.memberships m ON m.identity_id=i.id
    JOIN timeax_core.organizations o ON o.id=m.organization_id
    WHERE i.issuer=v_issuer AND i.subject=u.id::text
   ),'[]'::jsonb))
  INTO v_account FROM auth.users u WHERE u.id=p_account AND u.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','missing'); END IF;
  RETURN jsonb_build_object('state','ready','account',v_account);
 END IF;

 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR NOT (p_input ? 'reason')
    OR p_input-'reason'<>'{}'::jsonb OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
 THEN RAISE EXCEPTION 'invalid session support request' USING ERRCODE='22023'; END IF;
 v_reason:=btrim(p_input->>'reason');
 IF length(v_reason) NOT BETWEEN 3 AND 200 OR v_reason ~ '[[:cntrl:]]' THEN
  RAISE EXCEPTION 'invalid session support reason' USING ERRCODE='22023';
 END IF;
 -- Use the same subject lock as timeax_api.web_session('issue',...).
 PERFORM pg_advisory_xact_lock(hashtextextended('timeax-web-session/'||p_account::text,0));
 PERFORM 1 FROM auth.users u WHERE u.id=p_account AND u.deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','missing'); END IF;
 DELETE FROM timeax_core.web_sessions w WHERE w.subject=p_account;
 GET DIAGNOSTICS v_web_count=ROW_COUNT;
 DELETE FROM auth.sessions s WHERE s.user_id=p_account;
 GET DIAGNOSTICS v_provider_count=ROW_COUNT;
 -- Current provider tokens cascade with their session; remove only surviving
 -- legacy tokens for the same user. No token values are read or returned.
 DELETE FROM auth.refresh_tokens r WHERE r.user_id=p_account::text;
 GET DIAGNOSTICS v_legacy_token_count=ROW_COUNT;
 INSERT INTO timeax_core.owner_support_audit(account_id,action,object_id,reason,before_data,after_data)
 VALUES(p_account,'revoke-sessions',NULL,v_reason,
  jsonb_build_object('webSessions',v_web_count,'authSessions',v_provider_count,'legacyRefreshTokens',v_legacy_token_count),
  jsonb_build_object('webSessions',0,'authSessions',0,'legacyRefreshTokens',0));
 RETURN jsonb_build_object('state','revoked','id',p_account);
END
$fn$;
ALTER FUNCTION timeax_core.owner_support_account(text,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_core.owner_support_account(text,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role,timeax_account_admin_login;
COMMIT;
