-- Private worker notifications for newly issued payslips. Existing documents remain unchanged.
BEGIN;
CREATE ROLE timeax_pay_notice_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 4;
GRANT USAGE ON SCHEMA timeax_api TO timeax_pay_notice_login;
CREATE TABLE timeax_core.payroll_notifications (
 publication_id uuid PRIMARY KEY REFERENCES timeax_core.payroll_publications(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL,
 membership_id uuid NOT NULL,
 issued_at timestamptz NOT NULL,
 read_at timestamptz,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived','deleted')),
 FOREIGN KEY(organization_id,membership_id) REFERENCES timeax_core.memberships(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX payroll_notifications_worker_recent ON timeax_core.payroll_notifications(organization_id,membership_id,issued_at DESC);
ALTER TABLE timeax_core.payroll_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.payroll_notifications FROM PUBLIC,anon,authenticated,service_role,timeax_pay_notice_login;

CREATE FUNCTION timeax_core.capture_payroll_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, pg_temp AS $body$
DECLARE receiver uuid;
BEGIN
 IF NEW.delivery IS DISTINCT FROM 'cabinet' OR NEW.document #>> '{source,workerKey}' IS NULL OR NEW.document #>> '{source,agencyId}' IS NULL THEN RETURN NEW; END IF;
 INSERT INTO timeax_core.payroll_notifications(publication_id,organization_id,membership_id,issued_at)
 SELECT NEW.id,m.organization_id,m.id,NEW.issued_at FROM timeax_core.memberships m
 JOIN timeax_core.organizations o ON o.id=m.organization_id AND o.kind='agency' AND o.state='active'
 JOIN timeax_core.identities i ON i.id=m.identity_id AND i.active
 JOIN timeax_core.identity_issuers e ON e.issuer=i.issuer AND e.active
 WHERE m.id=(NEW.document #>> '{source,workerKey}')::uuid AND m.organization_id=(NEW.document #>> '{source,agencyId}')::uuid
 AND m.role='worker' AND m.organization_kind='agency' AND m.state='active'
 ON CONFLICT DO NOTHING RETURNING membership_id INTO receiver;
 IF receiver IS NOT NULL THEN
  -- Optional phone push remains generic. A disabled or failed push must not block durable inbox delivery.
  BEGIN
   IF to_regprocedure('timeax_push.enqueue(uuid)') IS NOT NULL THEN PERFORM timeax_push.enqueue(receiver); END IF;
  EXCEPTION WHEN OTHERS THEN
   RAISE LOG 'Timeax payroll push unavailable (SQLSTATE %)',SQLSTATE;
  END;
 END IF;
 RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION timeax_core.capture_payroll_notice() FROM PUBLIC,anon,authenticated,service_role,timeax_pay_notice_login;
CREATE TRIGGER timeax_capture_payroll_notice AFTER INSERT ON timeax_core.payroll_publications
 FOR EACH ROW EXECUTE FUNCTION timeax_core.capture_payroll_notice();

CREATE FUNCTION timeax_api.pay_notices(text,text,text,jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, pg_temp AS $body$
DECLARE org uuid; actor uuid; pub uuid; next_state text; stored text;
BEGIN
 IF session_user<>'timeax_pay_notice_login' THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
 org:=($4->>'organizationId')::uuid;
 SELECT m.id INTO actor FROM timeax_core.memberships m JOIN timeax_core.organizations o ON o.id=m.organization_id
 JOIN timeax_core.identities i ON i.id=m.identity_id JOIN timeax_core.identity_issuers s ON s.issuer=i.issuer
 WHERE m.organization_id=org AND m.organization_kind='agency' AND m.role='worker' AND m.state='active'
 AND o.kind='agency' AND o.state='active' AND i.active AND s.active AND i.issuer=$1 AND i.subject=$2;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
 IF $3='context' THEN
  RETURN jsonb_build_object('organizationId',org,'membershipId',actor,'items',COALESCE((
   SELECT jsonb_agg(jsonb_build_object('id',n.publication_id,'at',n.issued_at,'read',n.read_at IS NOT NULL,'state',n.state) ORDER BY n.issued_at DESC,n.publication_id)
   FROM (SELECT x.* FROM timeax_core.payroll_notifications x WHERE x.organization_id=org AND x.membership_id=actor AND x.state<>'deleted'
    ORDER BY (x.state='active' AND x.read_at IS NULL) DESC,x.issued_at DESC,x.publication_id LIMIT 100) n),'[]'));
 END IF;
 pub:=($4->>'id')::uuid;
 IF $3='read' AND pub IS NOT NULL THEN
  -- A historical published document need not have a notice. Unknown IDs are not disclosed.
  UPDATE timeax_core.payroll_notifications n SET read_at=COALESCE(n.read_at,clock_timestamp())
   WHERE n.organization_id=org AND n.membership_id=actor AND n.publication_id=pub;
  RETURN jsonb_build_object('read',true);
 END IF;
 next_state:=$4->>'state';
 IF $3='state' AND pub IS NOT NULL AND next_state IN ('active','archived','deleted') THEN
  UPDATE timeax_core.payroll_notifications n SET state=next_state
   WHERE n.organization_id=org AND n.membership_id=actor AND n.publication_id=pub AND n.state<>'deleted'
   RETURNING state INTO stored;
  IF NOT FOUND THEN
   SELECT n.state INTO stored FROM timeax_core.payroll_notifications n WHERE n.organization_id=org AND n.membership_id=actor AND n.publication_id=pub;
   IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';END IF;
  END IF;
  RETURN jsonb_build_object('state',stored);
 END IF;
 RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023';
END;
$body$;
REVOKE ALL ON FUNCTION timeax_api.pay_notices(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION timeax_api.pay_notices(text,text,text,jsonb) TO timeax_pay_notice_login;
COMMIT;
