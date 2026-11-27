-- Run before worker-connection.sql and before pinning the worker terms lane.
-- This additive migration does not infer acceptance for existing accounts.
BEGIN;
DO $role$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='timeax_worker_terms_login') THEN
  CREATE ROLE timeax_worker_terms_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
END
$role$;
GRANT USAGE ON SCHEMA timeax_api TO timeax_worker_terms_login;

CREATE TABLE IF NOT EXISTS timeax_core.worker_terms_receipts (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 document_version text NOT NULL CHECK (document_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 document_sha256 text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 accepted_via text NOT NULL DEFAULT 'worker-terms-checkbox' CHECK (accepted_via='worker-terms-checkbox'),
 PRIMARY KEY (user_id,document_version)
);
ALTER TABLE timeax_core.worker_terms_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.worker_terms_receipts FROM PUBLIC, anon, authenticated, service_role, timeax_worker_terms_login;

-- Private DB gate for worker membership writes. No access from any web role.
CREATE OR REPLACE FUNCTION timeax_core.worker_terms_current(p_issuer text,p_subject text)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog','pg_temp'
AS $gate$
 SELECT p_issuer IS NOT DISTINCT FROM 'https://rohgpgogsdtiltbocdao.supabase.co/auth/v1'
  AND EXISTS(SELECT FROM timeax_core.worker_terms_receipts r WHERE r.user_id::text=p_subject
   AND r.document_version='2026-11-27'
   AND r.document_sha256='fb3399d1d8a5a9334310091bc247b810e189bbd92a7b2b682be890c099f2559e');
$gate$;
ALTER FUNCTION timeax_core.worker_terms_current(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_core.worker_terms_current(text,text) FROM PUBLIC, anon, authenticated, service_role, timeax_worker_terms_login;

CREATE OR REPLACE FUNCTION timeax_api.worker_terms(p_action text,p_issuer text,p_subject text,p_version text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog','pg_temp'
AS $receipt$
DECLARE
 v_document_version constant text := '2026-11-27';
 v_hash constant text := 'fb3399d1d8a5a9334310091bc247b810e189bbd92a7b2b682be890c099f2559e';
 v_user uuid;
 v_accepted_at timestamptz;
BEGIN
 IF session_user IS DISTINCT FROM 'timeax_worker_terms_login'
  OR p_issuer IS DISTINCT FROM 'https://rohgpgogsdtiltbocdao.supabase.co/auth/v1'
  OR p_subject IS NULL OR p_subject !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'worker session unavailable' USING ERRCODE='42501';
 END IF;
 IF p_action IS NULL OR p_action NOT IN ('status','accept') OR
   (p_action='status' AND p_version IS NOT NULL) OR
   (p_action='accept' AND p_version IS DISTINCT FROM v_document_version) THEN
  RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
 END IF;
 SELECT u.id INTO v_user FROM auth.users u WHERE u.id=p_subject::uuid AND u.email_confirmed_at IS NOT NULL
  AND u.email IS NOT NULL AND NOT u.is_anonymous AND u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'worker session unavailable' USING ERRCODE='42501'; END IF;
 PERFORM timeax_core.check_worker_principal(p_issuer,p_subject);
 IF p_action='accept' THEN
  INSERT INTO timeax_core.worker_terms_receipts(user_id,document_version,document_sha256)
    VALUES(v_user,v_document_version,v_hash) ON CONFLICT(user_id,document_version) DO NOTHING;
 END IF;
 SELECT r.accepted_at INTO v_accepted_at FROM timeax_core.worker_terms_receipts r
  WHERE r.user_id=v_user AND r.document_version=v_document_version AND r.document_sha256=v_hash;
 RETURN jsonb_build_object('version',v_document_version,'documentSha256',v_hash,'accepted',v_accepted_at IS NOT NULL,'acceptedAt',v_accepted_at);
END
$receipt$;
ALTER FUNCTION timeax_api.worker_terms(text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_api.worker_terms(text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION timeax_api.worker_terms(text,text,text,text) TO timeax_worker_terms_login;
COMMIT;
