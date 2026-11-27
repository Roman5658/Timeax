-- Install after the team and worker-join schemas. The dedicated lane stays
-- NOLOGIN until the operator configures a unique password and exact RPC pin.
BEGIN;
CREATE ROLE timeax_web_push_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 4;
GRANT USAGE ON SCHEMA timeax_api TO timeax_web_push_login;
CREATE SCHEMA timeax_push;
REVOKE ALL ON SCHEMA timeax_push FROM PUBLIC,anon,authenticated,service_role,timeax_web_push_login;
CREATE TABLE timeax_push.subscriptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_id uuid NOT NULL REFERENCES timeax_core.identities(id) ON DELETE CASCADE,
 endpoint text UNIQUE NOT NULL CHECK(length(endpoint) BETWEEN 20 AND 1300), keys jsonb NOT NULL,
 session_hash text NOT NULL CHECK(session_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz NOT NULL,
 language text NOT NULL CHECK(language IN ('pl','en','ru','uk'))
);
CREATE INDEX push_subscription_identity ON timeax_push.subscriptions(identity_id);
CREATE INDEX push_subscription_expiry ON timeax_push.subscriptions(expires_at);
CREATE INDEX push_subscription_session ON timeax_push.subscriptions(session_hash);
CREATE TABLE timeax_push.jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid NOT NULL REFERENCES timeax_push.subscriptions(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL REFERENCES timeax_core.organizations(id) ON DELETE CASCADE,
 last_recipient uuid NOT NULL REFERENCES timeax_core.memberships(id) ON DELETE CASCADE,
 queued_at timestamptz NOT NULL DEFAULT clock_timestamp(), claim_started timestamptz,
 next_attempt timestamptz NOT NULL DEFAULT clock_timestamp(), attempts int NOT NULL DEFAULT 0,
 lease uuid, lease_until timestamptz, UNIQUE(subscription_id,organization_id)
);
CREATE INDEX push_jobs_ready ON timeax_push.jobs(next_attempt);
ALTER TABLE timeax_push.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_push.jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA timeax_push FROM PUBLIC,anon,authenticated,service_role,timeax_web_push_login;

CREATE FUNCTION timeax_push.enqueue(p_member uuid) RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO pg_catalog,pg_temp AS $f$
 INSERT INTO timeax_push.jobs(subscription_id,organization_id,last_recipient)
 SELECT s.id,m.organization_id,m.id FROM timeax_core.memberships m JOIN timeax_push.subscriptions s ON s.identity_id=m.identity_id
 WHERE m.id=p_member AND m.state='active' AND s.expires_at>clock_timestamp()
 ON CONFLICT(subscription_id,organization_id) DO UPDATE SET queued_at=clock_timestamp(),last_recipient=excluded.last_recipient
$f$;
CREATE FUNCTION timeax_push.capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,pg_temp AS $f$
DECLARE target uuid;
BEGIN
 IF TG_TABLE_SCHEMA='timeax_team' AND TG_TABLE_NAME='deliveries' THEN
  IF NEW.read_at IS NULL THEN PERFORM timeax_push.enqueue(NEW.recipient); END IF;
 ELSE
  FOR target IN SELECT id FROM timeax_core.memberships WHERE organization_id=NEW.agency_id AND role='agency_admin' AND state='active'
  LOOP PERFORM timeax_push.enqueue(target); END LOOP;
 END IF;
 RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION timeax_push.enqueue(uuid),timeax_push.capture() FROM PUBLIC,anon,authenticated,service_role,timeax_web_push_login;
DO $team_trigger$
DECLARE actor_oid oid:=current_user::regrole; owner_oid oid:='timeax_team_owner'::regrole;
 needs_role boolean:=NOT has_table_privilege(current_user,'timeax_team.deliveries','TRIGGER');
 prior_roles jsonb; membership record;
BEGIN
 IF needs_role THEN
  IF (SELECT relowner FROM pg_class WHERE oid='timeax_team.deliveries'::regclass)<>owner_oid
   THEN RAISE EXCEPTION 'Unexpected Team table owner'; END IF;
  SELECT coalesce(jsonb_object_agg(grantor::text,inherit_option),'{}'::jsonb) INTO prior_roles
   FROM pg_auth_members WHERE roleid=owner_oid AND member=actor_oid;
  GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE;
 END IF;
 CREATE TRIGGER timeax_push_team_delivery AFTER INSERT ON timeax_team.deliveries FOR EACH ROW EXECUTE FUNCTION timeax_push.capture();
 IF needs_role THEN
  FOR membership IN SELECT grantor,inherit_option FROM pg_auth_members WHERE roleid=owner_oid AND member=actor_oid LOOP
   IF NOT prior_roles?(membership.grantor::text) THEN
    EXECUTE format('REVOKE timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(membership.grantor));
   ELSIF membership.inherit_option AND NOT (prior_roles->>(membership.grantor::text))::boolean THEN
    EXECUTE format('REVOKE INHERIT OPTION FOR timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(membership.grantor));
   END IF;
  END LOOP;
 END IF;
END
$team_trigger$;
CREATE TRIGGER timeax_push_agency_join AFTER INSERT ON timeax_core.agency_worker_join_events FOR EACH ROW EXECUTE FUNCTION timeax_push.capture();
DO $optional$
BEGIN
 IF to_regclass('timeax_core.backdated_shift_notices') IS NOT NULL THEN
  CREATE TRIGGER timeax_push_backdated_shift AFTER INSERT ON timeax_core.backdated_shift_notices FOR EACH ROW EXECUTE FUNCTION timeax_push.capture();
 END IF;
 IF to_regclass('timeax_core.earlier_shift_requests') IS NOT NULL THEN
  CREATE TRIGGER timeax_push_earlier_shift AFTER INSERT ON timeax_core.earlier_shift_requests FOR EACH ROW EXECUTE FUNCTION timeax_push.capture();
 END IF;
END
$optional$;

CREATE FUNCTION timeax_push.revoke_on_sign_out() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,pg_temp AS $f$
BEGIN
 -- A browser may receive push after normal login expiry. Explicit early
 -- revocation (sign-out, session rotation) removes that device and its jobs.
 IF OLD.expires_at>clock_timestamp() THEN
  DELETE FROM timeax_push.subscriptions WHERE session_hash=OLD.token_digest;
 END IF;
 RETURN OLD;
END
$f$;
REVOKE ALL ON FUNCTION timeax_push.revoke_on_sign_out() FROM PUBLIC,anon,authenticated,service_role,timeax_web_push_login;
CREATE TRIGGER timeax_push_session_revoked AFTER DELETE ON timeax_core.web_sessions FOR EACH ROW EXECUTE FUNCTION timeax_push.revoke_on_sign_out();

CREATE FUNCTION timeax_api.web_push(p_issuer text,p_subject text,p_action text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,pg_temp AS $f$
DECLARE principal uuid; current_lease uuid; entry timeax_push.jobs%ROWTYPE; sub timeax_push.subscriptions%ROWTYPE;
 claimed jsonb; sess text; endpoint_value text; until_at timestamptz;
BEGIN
 IF session_user<>'timeax_web_push_login' THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF p_action='claim' AND p_issuer IS NULL AND p_subject IS NULL THEN
  current_lease:=(p_input->>'lease')::uuid;
  IF current_lease IS NULL THEN RAISE EXCEPTION 'Invalid lease' USING ERRCODE='22023'; END IF;
  DELETE FROM timeax_push.subscriptions WHERE expires_at<=clock_timestamp();
  DELETE FROM timeax_push.jobs WHERE queued_at<clock_timestamp()-interval '1 hour';
  WITH batch AS (
   SELECT j.id FROM timeax_push.jobs j JOIN timeax_push.subscriptions s ON s.id=j.subscription_id
   JOIN timeax_core.memberships m ON m.id=j.last_recipient AND m.identity_id=s.identity_id AND m.organization_id=j.organization_id
   JOIN timeax_core.organizations o ON o.id=j.organization_id
   JOIN timeax_core.identities i ON i.id=s.identity_id
   JOIN timeax_core.identity_issuers u ON u.issuer=i.issuer
   WHERE j.next_attempt<=clock_timestamp() AND (j.lease_until IS NULL OR j.lease_until<=clock_timestamp())
    AND m.state='active' AND o.state='active' AND i.active AND u.active AND s.expires_at>clock_timestamp()
   ORDER BY j.next_attempt,j.id LIMIT 12 FOR UPDATE OF j SKIP LOCKED
  ), leased AS (
   UPDATE timeax_push.jobs j SET lease=current_lease,lease_until=clock_timestamp()+interval '60 seconds',
    claim_started=clock_timestamp(),attempts=j.attempts+1 FROM batch b WHERE j.id=b.id RETURNING j.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',j.id,'organizationId',j.organization_id,'language',s.language,
   'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',s.keys))),'[]'::jsonb)
  INTO claimed FROM leased j JOIN timeax_push.subscriptions s ON s.id=j.subscription_id;
  RETURN claimed;
 END IF;
 IF p_action='finish' AND p_issuer IS NULL AND p_subject IS NULL THEN
  SELECT * INTO entry FROM timeax_push.jobs WHERE id=(p_input->>'id')::uuid AND lease=(p_input->>'lease')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',true); END IF;
  IF p_input->>'outcome'='expired' THEN
   DELETE FROM timeax_push.subscriptions WHERE id=entry.subscription_id;
  ELSIF p_input->>'outcome'='retry' AND entry.attempts<5 THEN
   UPDATE timeax_push.jobs SET next_attempt=clock_timestamp()+make_interval(secs=>15*(2^entry.attempts)::int),lease=NULL,lease_until=NULL WHERE id=entry.id;
  ELSIF entry.queued_at>entry.claim_started THEN
   UPDATE timeax_push.jobs SET attempts=0,next_attempt=clock_timestamp(),lease=NULL,lease_until=NULL WHERE id=entry.id;
  ELSE DELETE FROM timeax_push.jobs WHERE id=entry.id; END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 SELECT i.id INTO principal FROM timeax_core.identities i JOIN timeax_core.identity_issuers u ON u.issuer=i.issuer
 WHERE i.issuer=p_issuer AND i.subject=p_subject AND i.active AND u.active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 sess:=p_input->>'session'; endpoint_value:=p_input->>'endpoint';
 IF sess IS NULL OR sess !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid session' USING ERRCODE='22023'; END IF;
 IF p_action='logout' THEN
  DELETE FROM timeax_push.subscriptions WHERE identity_id=principal AND session_hash=sess;
  RETURN jsonb_build_object('enabled',false);
 END IF;
 IF p_action IN ('enable','status') THEN
  PERFORM 1 FROM timeax_core.web_sessions w WHERE w.token_digest=sess AND w.subject::text=p_subject AND w.expires_at>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_action='disable' THEN
  DELETE FROM timeax_push.subscriptions WHERE identity_id=principal AND endpoint=endpoint_value;
  RETURN jsonb_build_object('enabled',false);
 END IF;
 IF p_action='status' THEN
  UPDATE timeax_push.subscriptions SET session_hash=sess,expires_at=clock_timestamp()+interval '90 days'
  WHERE identity_id=principal AND endpoint=endpoint_value AND expires_at>clock_timestamp();
  RETURN jsonb_build_object('enabled',FOUND);
 END IF;
 IF p_action='enable' THEN
  until_at:=clock_timestamp()+interval '90 days';
  IF until_at IS NULL OR until_at<=clock_timestamp() OR endpoint_value IS NULL OR p_input->'keys' IS NULL OR NOT EXISTS(
   SELECT 1 FROM timeax_core.memberships m JOIN timeax_core.organizations o ON o.id=m.organization_id
   WHERE m.identity_id=principal AND m.state='active' AND o.state='active')
  THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('push-subscriptions/'||principal,0));
  SELECT * INTO sub FROM timeax_push.subscriptions WHERE endpoint=endpoint_value FOR UPDATE;
  IF sub.id IS NOT NULL AND sub.identity_id=principal AND sub.session_hash=sess AND sub.keys=p_input->'keys' THEN
   UPDATE timeax_push.subscriptions SET expires_at=until_at,language=p_input->>'language' WHERE id=sub.id;
  ELSE
   DELETE FROM timeax_push.subscriptions WHERE id=sub.id;
   DELETE FROM timeax_push.subscriptions WHERE identity_id=principal AND expires_at<=clock_timestamp();
   IF (SELECT count(*) FROM timeax_push.subscriptions WHERE identity_id=principal)>=8 THEN RAISE EXCEPTION 'Device limit' USING ERRCODE='22023'; END IF;
   INSERT INTO timeax_push.subscriptions(identity_id,endpoint,keys,session_hash,expires_at,language)
    VALUES(principal,endpoint_value,p_input->'keys',sess,until_at,p_input->>'language');
  END IF;
  RETURN jsonb_build_object('enabled',true);
 END IF;
 RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';
END
$f$;
REVOKE ALL ON FUNCTION timeax_api.web_push(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION timeax_api.web_push(text,text,text,jsonb) TO timeax_web_push_login;
SELECT encode(sha256(convert_to(pg_get_functiondef('timeax_api.web_push(text,text,text,jsonb)'::regprocedure),'UTF8')),'hex') AS web_push_sha256;
COMMIT;
