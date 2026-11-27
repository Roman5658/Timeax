-- Adds a notice inbox and a reviewed request for hours preceding an internal assignment.
BEGIN;
CREATE TABLE timeax_core.backdated_shift_notices(
 source text NOT NULL CHECK(source IN ('internal','factory')),
 shift_id uuid NOT NULL,
 agency_id uuid NOT NULL REFERENCES timeax_core.organizations(id) ON DELETE CASCADE,
 membership_id uuid NOT NULL REFERENCES timeax_core.memberships(id) ON DELETE CASCADE,
 local_date date NOT NULL,
 submitted_at timestamptz NOT NULL,
 PRIMARY KEY(source,shift_id)
);
CREATE INDEX backdated_shift_notices_agency ON timeax_core.backdated_shift_notices(agency_id,submitted_at DESC,shift_id);
CREATE TABLE timeax_core.backdated_shift_notice_reads(
 source text NOT NULL,
 shift_id uuid NOT NULL,
 reader_id uuid NOT NULL REFERENCES timeax_core.memberships(id) ON DELETE CASCADE,
 PRIMARY KEY(reader_id,source,shift_id),
 FOREIGN KEY(source,shift_id) REFERENCES timeax_core.backdated_shift_notices(source,shift_id) ON DELETE CASCADE
);
CREATE INDEX backdated_shift_notice_reads_notice ON timeax_core.backdated_shift_notice_reads(source,shift_id);
ALTER TABLE timeax_core.backdated_shift_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_core.backdated_shift_notice_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.backdated_shift_notices,timeax_core.backdated_shift_notice_reads FROM PUBLIC,anon,authenticated,service_role,timeax_timecards_login,timeax_factory_timecards_login;

CREATE FUNCTION timeax_core.capture_backdated_shift_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,pg_temp AS $capture$
BEGIN
 IF TG_TABLE_NAME='timecard_revisions' AND NEW.revision=1 THEN
  INSERT INTO timeax_core.backdated_shift_notices
  SELECT 'internal',s.id,s.organization_id,s.membership_id,s.local_date,s.created_at
  FROM timeax_core.timecard_shifts s JOIN timeax_core.memberships m ON m.id=s.membership_id
  WHERE s.id=NEW.shift_id AND m.identity_id=NEW.actor_identity AND m.role='worker'
  AND s.local_date < (s.created_at AT TIME ZONE 'Europe/Warsaw')::date
  ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='factory_timecard_shifts' THEN
  IF NEW.source='self' AND NEW.local_date < (NEW.created_at AT TIME ZONE 'Europe/Warsaw')::date THEN
   INSERT INTO timeax_core.backdated_shift_notices
   SELECT 'factory',NEW.id,NEW.agency_id,NEW.membership_id,NEW.local_date,NEW.created_at
   FROM timeax_core.memberships m WHERE m.id=NEW.membership_id AND m.role='worker' AND m.organization_id=NEW.agency_id
   AND EXISTS (SELECT 1 FROM timeax_core.organizations o WHERE o.id=NEW.agency_id AND o.kind='agency')
   ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END
$capture$;
REVOKE ALL ON FUNCTION timeax_core.capture_backdated_shift_notice() FROM PUBLIC,anon,authenticated,service_role,timeax_timecards_login,timeax_factory_timecards_login;
CREATE TRIGGER capture_backdated_internal_shift AFTER INSERT ON timeax_core.timecard_revisions FOR EACH ROW EXECUTE FUNCTION timeax_core.capture_backdated_shift_notice();
CREATE TRIGGER capture_backdated_factory_shift AFTER INSERT ON timeax_core.factory_timecard_shifts FOR EACH ROW EXECUTE FUNCTION timeax_core.capture_backdated_shift_notice();

CREATE FUNCTION timeax_core.backdated_shift_notices(p_org uuid,reader uuid,p_action text,p_source text,p_shift uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,pg_temp AS $feed$
BEGIN
 IF p_action='read' THEN
  INSERT INTO timeax_core.backdated_shift_notice_reads
  SELECT n.source,n.shift_id,reader FROM timeax_core.backdated_shift_notices n
  WHERE n.agency_id=p_org AND n.source=p_source AND n.shift_id=p_shift ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM timeax_core.backdated_shift_notices n WHERE n.agency_id=p_org AND n.source=p_source AND n.shift_id=p_shift)
  THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('read',true);
 ELSIF p_action='list' THEN
  RETURN (SELECT jsonb_build_object('unread',(SELECT count(*) FROM timeax_core.backdated_shift_notices n
    WHERE n.agency_id=p_org AND NOT EXISTS(SELECT 1 FROM timeax_core.backdated_shift_notice_reads r
     WHERE r.source=n.source AND r.shift_id=n.shift_id AND r.reader_id=reader)),
   'entries',COALESCE(jsonb_agg(jsonb_build_object('id',n.shift_id,'source',n.source,'workerId',n.membership_id,'day',n.local_date,
    'submittedAt',n.submitted_at,'read',EXISTS(SELECT 1 FROM timeax_core.backdated_shift_notice_reads r
     WHERE r.source=n.source AND r.shift_id=n.shift_id AND r.reader_id=reader)) ORDER BY n.submitted_at DESC,n.shift_id),'[]'::jsonb))
   FROM (SELECT b.* FROM timeax_core.backdated_shift_notices b WHERE b.agency_id=p_org
    ORDER BY EXISTS(SELECT 1 FROM timeax_core.backdated_shift_notice_reads r WHERE r.reader_id=reader AND r.source=b.source AND r.shift_id=b.shift_id),b.submitted_at DESC,b.shift_id LIMIT 50) n);
 END IF;
 RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501';
END
$feed$;
REVOKE ALL ON FUNCTION timeax_core.backdated_shift_notices(uuid,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION timeax_core.backdated_shift_notices(uuid,uuid,text,text,uuid) TO timeax_timecards_owner;

CREATE TABLE timeax_core.earlier_shift_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agency_id uuid NOT NULL REFERENCES timeax_core.organizations(id) ON DELETE CASCADE,
 worksite_id uuid NOT NULL REFERENCES timeax_core.worksites(id) ON DELETE CASCADE,
 worker_id uuid NOT NULL REFERENCES timeax_core.memberships(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 input jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewed_by uuid REFERENCES timeax_core.memberships(id) ON DELETE SET NULL,
 reviewed_at timestamptz,
 shift_id uuid,
 UNIQUE(worker_id,operation_id)
);
CREATE INDEX earlier_shift_requests_agency ON timeax_core.earlier_shift_requests(agency_id,submitted_at DESC,id);
CREATE UNIQUE INDEX earlier_shift_requests_pending_span ON timeax_core.earlier_shift_requests(worker_id,worksite_id,((input->'data'->>'startAt')),((input->'data'->>'endAt'))) WHERE state='pending';
ALTER TABLE timeax_core.earlier_shift_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.earlier_shift_requests FROM PUBLIC,anon,authenticated,service_role,timeax_timecards_login;
GRANT SELECT,INSERT,UPDATE ON timeax_core.earlier_shift_requests TO timeax_timecards_owner;
CREATE POLICY earlier_shift_requests_rpc ON timeax_core.earlier_shift_requests TO timeax_timecards_owner USING(true) WITH CHECK(true);

DO $patch$
DECLARE f regprocedure:='timeax_api.timecards(text,text,text,jsonb)'::regprocedure;
 ddl text:=pg_get_functiondef(f); owner_role constant text:='timeax_timecards_owner'; acting_role text:=current_user;
 had_usage boolean:=pg_has_role(current_user,owner_role,'USAGE'); had_set boolean:=pg_has_role(current_user,owner_role,'SET');
 membership_anchor constant text:=$m$ IF p_action='context' THEN$m$;
 assignment_anchor constant text:=$a$  IF NOT FOUND THEN RAISE EXCEPTION 'Active assignment required' USING ERRCODE='42501';END IF;$a$;
 saved_anchor constant text:=$s$  RETURN jsonb_build_object('id',entry.id,'revision',entry.revision,'saved',true);$s$;
BEGIN
 IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=f))<>owner_role
 OR encode(sha256(convert_to(ddl,'UTF8')),'hex')<>'23a5f9dd3eb56455917318a77bc4c3d8a0bf9133b88145d5616cf14e497bd25e'
 OR strpos(ddl,membership_anchor)=0 OR strpos(ddl,assignment_anchor)=0 OR strpos(ddl,saved_anchor)=0
 THEN RAISE EXCEPTION 'Unexpected timecards definition'; END IF;
 ddl:=replace(ddl,'DECLARE principal uuid;', 'DECLARE earlier timeax_core.earlier_shift_requests%ROWTYPE; reviewer uuid; reviewing boolean:=false; principal uuid;');
 ddl:=replace(ddl,membership_anchor,$dispatch$
 IF p_action IN ('backdated-list','backdated-read','earlier-list','earlier-approve','earlier-reject') THEN
  IF mem.role<>'agency_admin' THEN RAISE EXCEPTION 'Agency administrator required' USING ERRCODE='42501'; END IF;
  IF p_action IN ('backdated-list','backdated-read') THEN
   RETURN timeax_core.backdated_shift_notices(org,mem.id,CASE p_action WHEN 'backdated-list' THEN 'list' ELSE 'read' END,p_input->>'source',(p_input->>'id')::uuid);
  END IF;
  IF p_action='earlier-list' THEN
   RETURN (SELECT jsonb_build_object('pending',(SELECT count(*) FROM timeax_core.earlier_shift_requests r WHERE r.agency_id=org AND r.state='pending'),
    'entries',COALESCE(jsonb_agg(jsonb_build_object('id',q.id,'workerId',q.worker_id,'day',q.input->'data'->>'localDate',
    'startTime',q.input->'data'->>'startTime','endTime',q.input->'data'->>'endTime','submittedAt',q.submitted_at,
    'site',w.name,'state',q.state) ORDER BY (q.state='pending') DESC,q.submitted_at DESC,q.id),'[]'::jsonb))
    FROM (SELECT r.* FROM timeax_core.earlier_shift_requests r WHERE r.agency_id=org ORDER BY (r.state='pending') DESC,r.submitted_at DESC,r.id LIMIT 50) q
    JOIN timeax_core.worksites w ON w.id=q.worksite_id AND w.owner_organization_id=org);
  END IF;
  reviewer:=mem.id;
  SELECT * INTO earlier FROM timeax_core.earlier_shift_requests q WHERE q.agency_id=org AND q.id=(p_input->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
  IF earlier.state<>'pending' THEN
   IF (earlier.state='approved' AND p_action='earlier-approve') OR (earlier.state='rejected' AND p_action='earlier-reject') THEN
    RETURN jsonb_build_object('state',earlier.state,'id',earlier.id);
   END IF;
   RAISE EXCEPTION 'Request already decided' USING ERRCODE='23505';
  END IF;
  IF p_action='earlier-reject' THEN
   UPDATE timeax_core.earlier_shift_requests SET state='rejected',reviewed_at=clock_timestamp(),reviewed_by=reviewer WHERE id=earlier.id;
   RETURN jsonb_build_object('state','rejected','id',earlier.id);
  END IF;
  SELECT m.* INTO mem FROM timeax_core.memberships m WHERE m.id=earlier.worker_id AND m.organization_id=org AND m.role='worker' AND m.state='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active worker required' USING ERRCODE='42501'; END IF;
  p_action:='create';
  p_input:=jsonb_set(earlier.input,'{operationId}',to_jsonb(earlier.id));
  reviewing:=true;
 END IF;
$dispatch$||membership_anchor);
 ddl:=replace(ddl,assignment_anchor,$assignment$
  IF NOT FOUND AND reviewing THEN
   PERFORM 1 FROM timeax_core.worksite_membership_grants g WHERE g.organization_id=org AND g.worksite_id=site_id
    AND g.membership_id=mem.id AND g.state='active' AND g.valid_from<=clock_timestamp()
    AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp() AND ends<=g.valid_until) FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active assignment required' USING ERRCODE='42501'; END IF;
  ELSIF NOT FOUND THEN
   IF p_action<>'create' THEN RAISE EXCEPTION 'Active assignment required' USING ERRCODE='42501'; END IF;
   PERFORM 1 FROM timeax_core.worksite_membership_grants g
   WHERE g.organization_id=org AND g.worksite_id=site_id AND g.membership_id=mem.id AND g.state='active'
    AND g.valid_from<=clock_timestamp() AND g.valid_from>starts AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp() AND ends<=g.valid_until) FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active assignment required' USING ERRCODE='42501'; END IF;
   IF NOT timeax_core.internal_worker_manual_entry(org,site_id,true) THEN RAISE EXCEPTION 'Internal manual entry is not enabled' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM timeax_core.internal_timecards c WHERE c.worksite_id=site_id AND day BETWEEN c.date_from AND c.date_to)
    THEN RAISE EXCEPTION 'Period already archived' USING ERRCODE='P0001'; END IF;
   SELECT * INTO earlier FROM timeax_core.earlier_shift_requests q WHERE q.worker_id=mem.id AND q.operation_id=op;
   IF FOUND AND earlier.input IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
   IF FOUND AND earlier.state='approved' THEN RETURN jsonb_build_object('id',earlier.shift_id,'revision',1,'saved',true); END IF;
   IF FOUND AND earlier.state='rejected' THEN RAISE EXCEPTION 'Request already decided' USING ERRCODE='23505'; END IF;
   IF NOT FOUND THEN
    INSERT INTO timeax_core.earlier_shift_requests(agency_id,worksite_id,worker_id,operation_id,input)
    VALUES(org,site_id,mem.id,op,p_input) RETURNING * INTO earlier;
   END IF;
   RETURN jsonb_build_object('id',earlier.id,'state','pending');
  END IF;
$assignment$);
 ddl:=replace(ddl,saved_anchor,$reviewed$
  IF reviewing THEN
   UPDATE timeax_core.earlier_shift_requests SET state='approved',reviewed_at=clock_timestamp(),reviewed_by=reviewer,shift_id=entry.id WHERE id=earlier.id;
   RETURN jsonb_build_object('state','approved','id',earlier.id);
  END IF;
$reviewed$||saved_anchor);
 -- Mark the canonical audit revision explicitly; the approver is the recorded actor.
 ddl:=replace(ddl,'ELSE reason=''created'';END IF;','ELSE reason=CASE WHEN reviewing THEN ''earlier shift approved'' ELSE ''created'' END;END IF;');
 IF NOT had_usage THEN EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE',owner_role,acting_role); END IF;
 EXECUTE ddl;
 IF NOT had_usage THEN EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET %s',owner_role,acting_role,CASE WHEN had_set THEN 'TRUE' ELSE 'FALSE' END); END IF;
END
$patch$;
SELECT encode(sha256(convert_to(pg_get_functiondef('timeax_api.timecards(text,text,text,jsonb)'::regprocedure),'UTF8')),'hex') AS timecards_sha256;
COMMIT;