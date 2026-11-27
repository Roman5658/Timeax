-- Provision timeax_web_session_login independently as NOINHERIT LOGIN with a
-- dedicated password. No grant to an existing runtime role.
BEGIN;
CREATE TABLE IF NOT EXISTS timeax_core.web_sessions (
 token_digest text PRIMARY KEY CHECK (token_digest ~ '^[a-f0-9]{64}$'),
 subject uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
ALTER TABLE timeax_core.web_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS web_sessions_expiry_idx ON timeax_core.web_sessions(expires_at);
CREATE INDEX IF NOT EXISTS web_sessions_subject_idx ON timeax_core.web_sessions(subject);
REVOKE ALL ON TABLE timeax_core.web_sessions FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION timeax_api.web_session(p_action text, p_digest text, p_subject uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
 v_session jsonb;
 v_now timestamptz := clock_timestamp();
BEGIN
 IF session_user <> 'timeax_web_session_login' OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
    OR p_action IS NULL OR p_action NOT IN ('read','issue','revoke')
    OR (p_action='issue') <> (p_subject IS NOT NULL)
 THEN RAISE EXCEPTION 'web session denied' USING ERRCODE='42501'; END IF;

 IF p_action='revoke' THEN
  DELETE FROM timeax_core.web_sessions WHERE token_digest=p_digest;
  RETURN 'true'::jsonb;
 END IF;

 IF p_action='issue' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('timeax-web-session/' || p_subject::text,0));
  IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_subject AND u.email_confirmed_at IS NOT NULL
                  AND u.deleted_at IS NULL AND COALESCE(u.is_anonymous,false)=false
                  AND (u.banned_until IS NULL OR u.banned_until<=v_now) AND u.email IS NOT NULL)
    OR EXISTS(SELECT 1 FROM timeax_core.identities i WHERE i.issuer='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1'
                  AND i.subject=p_subject::text AND NOT i.active)
  THEN RETURN 'false'::jsonb; END IF;
  DELETE FROM timeax_core.web_sessions s WHERE s.token_digest IN(
   SELECT old.token_digest FROM timeax_core.web_sessions old WHERE old.expires_at<=v_now
   ORDER BY old.expires_at LIMIT 200 FOR UPDATE SKIP LOCKED);
  DELETE FROM timeax_core.web_sessions s WHERE s.token_digest IN(
   SELECT old.token_digest FROM timeax_core.web_sessions old WHERE old.subject=p_subject
   ORDER BY old.expires_at DESC,old.token_digest OFFSET 9);
  INSERT INTO timeax_core.web_sessions(token_digest,subject,expires_at) VALUES(p_digest,p_subject,v_now+interval '12 hours');
  RETURN 'true'::jsonb;
 END IF;

 SELECT jsonb_build_object('subject',s.subject,'email',lower(u.email),'expiresAt',s.expires_at)
 INTO v_session FROM timeax_core.web_sessions s JOIN auth.users u ON u.id=s.subject
 WHERE s.token_digest=p_digest AND s.expires_at>v_now AND u.email_confirmed_at IS NOT NULL
  AND u.deleted_at IS NULL AND COALESCE(u.is_anonymous,false)=false
  AND (u.banned_until IS NULL OR u.banned_until<=v_now) AND u.email IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM timeax_core.identities i
   WHERE i.issuer='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1' AND i.subject=s.subject::text AND NOT i.active);
 RETURN v_session;
END
$fn$;
ALTER FUNCTION timeax_api.web_session(text,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_api.web_session(text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA timeax_api TO timeax_web_session_login;
GRANT EXECUTE ON FUNCTION timeax_api.web_session(text,text,uuid) TO timeax_web_session_login;
COMMIT;

-- Use the following result as TIMEAX_WEB_SESSION_RPC_SHA256:
SELECT encode(sha256(convert_to(pg_get_functiondef('timeax_api.web_session(text,text,uuid)'::regprocedure),'UTF8')),'hex');
