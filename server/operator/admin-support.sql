-- Apply after admin-support-account.sql and admin-support-shifts.sql.
-- This dedicated login has no password until an operator separately provisions one.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE ROLE timeax_owner_support_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;

CREATE TABLE timeax_core.owner_support_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL,
 action text NOT NULL CHECK(length(action) BETWEEN 1 AND 80),
 object_id uuid,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 200),
 before_data jsonb NOT NULL,
 after_data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX owner_support_audit_tail ON timeax_core.owner_support_audit(account_id,created_at DESC,id DESC);
ALTER TABLE timeax_core.owner_support_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.owner_support_audit FROM PUBLIC,anon,authenticated,service_role,timeax_owner_support_login;

CREATE FUNCTION timeax_api.admin_support(p_action text,p_account uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $support$
BEGIN
 IF session_user<>'timeax_owner_support_login' THEN
  RAISE EXCEPTION 'Owner support only' USING ERRCODE='42501';
 END IF;
 IF p_account IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid support request' USING ERRCODE='22023';
 END IF;
 IF p_action IN ('account','revoke-sessions') THEN
  RETURN timeax_core.owner_support_account(p_action,p_account,p_input);
 ELSIF p_action IN ('shifts','correct-shift') THEN
  RETURN timeax_core.owner_support_shifts(p_action,p_account,p_input);
 ELSIF p_action='audit' AND p_input='{}'::jsonb THEN
  RETURN jsonb_build_object('state','ready','events',COALESCE((
   SELECT jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'objectId',a.object_id,
   'reason',a.reason,'at',a.created_at,'before',a.before_data,'after',a.after_data)
   ORDER BY a.created_at DESC,a.id DESC)
   FROM (SELECT * FROM timeax_core.owner_support_audit WHERE account_id=p_account ORDER BY created_at DESC,id DESC LIMIT 50) a
  ),'[]'::jsonb));
 END IF;
 RAISE EXCEPTION 'Invalid support operation' USING ERRCODE='22023';
END
$support$;
ALTER FUNCTION timeax_api.admin_support(text,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_api.admin_support(text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA timeax_api TO timeax_owner_support_login;
GRANT EXECUTE ON FUNCTION timeax_api.admin_support(text,uuid,jsonb) TO timeax_owner_support_login;
COMMIT;
