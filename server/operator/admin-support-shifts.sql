-- Private scoped shift foundation for the owner support lane. Apply before the
-- guarded timeax_api.admin_support wrapper. This function cannot be invoked
-- directly by the HTTP login, Data API roles or any application login.
--
-- Factory shifts stay read-only. Writes require a separately configured,
-- verified operator identity and an open internal/manual worker record.

BEGIN;
CREATE TABLE IF NOT EXISTS timeax_core.owner_support_shift_config(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 actor_identity uuid NOT NULL REFERENCES timeax_core.identities(id) ON DELETE RESTRICT
);
ALTER TABLE timeax_core.owner_support_shift_config OWNER TO postgres;
ALTER TABLE timeax_core.owner_support_shift_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE timeax_core.owner_support_shift_config FROM PUBLIC;

CREATE OR REPLACE FUNCTION timeax_core.owner_support_shifts(p_action text,p_account uuid,p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog,pg_temp
AS $owner_support_shifts$
DECLARE
 v_identity uuid;
 v_actor uuid;
 v_member uuid;
 v_org uuid;
 v_site uuid;
 v_before timeax_core.timecard_shifts%ROWTYPE;
 v_after timeax_core.timecard_shifts%ROWTYPE;
 v_wall_start timestamp;
 v_wall_end timestamp;
 v_start timestamptz;
 v_end timestamptz;
 v_gross integer;
 v_paid integer;
 v_break integer;
 v_break_status text;
 v_break_treatment text;
 v_data jsonb;
 v_op uuid;
 v_from date;
 v_to date;
 v_id uuid;
 v_revision integer;
 v_actual integer;
 v_source text;
 v_reason text;
 v_limit constant integer:=200;
 v_issuer constant text:='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1';
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Owner support unavailable' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('shifts','correct-shift') OR p_account IS NULL
   OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid support shift request' USING ERRCODE='22023';
 END IF;

 IF p_action='shifts' THEN
  IF NOT (p_input ?& ARRAY['from','to']) OR (p_input-ARRAY['from','to'])<>'{}'::jsonb
   OR jsonb_typeof(p_input->'from') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_input->'to') IS DISTINCT FROM 'string'
   OR p_input->>'from' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$'
   OR p_input->>'to' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION 'Invalid support date range' USING ERRCODE='22023';
  END IF;
  BEGIN
   v_from:=make_date(substr(p_input->>'from',1,4)::int,substr(p_input->>'from',6,2)::int,substr(p_input->>'from',9,2)::int);
   v_to:=make_date(substr(p_input->>'to',1,4)::int,substr(p_input->>'to',6,2)::int,substr(p_input->>'to',9,2)::int);
  EXCEPTION WHEN datetime_field_overflow THEN
   RAISE EXCEPTION 'Invalid support date range' USING ERRCODE='22023';
  END;
  IF v_to-v_from NOT BETWEEN 0 AND 30 THEN RAISE EXCEPTION 'Invalid support date range' USING ERRCODE='22023'; END IF;
 ELSE
  IF NOT (p_input ?& ARRAY['id','source','revision','start','end','reason'])
   OR (p_input-ARRAY['id','source','revision','start','end','reason'])<>'{}'::jsonb
   OR jsonb_typeof(p_input->'id') IS DISTINCT FROM 'string'
   OR p_input->>'id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   OR jsonb_typeof(p_input->'source') IS DISTINCT FROM 'string'
   OR p_input->>'source' NOT IN ('agency','factory')
   OR jsonb_typeof(p_input->'revision') IS DISTINCT FROM 'number'
   OR p_input->>'revision' !~ '^[1-9][0-9]{0,8}$'
   OR jsonb_typeof(p_input->'start') IS DISTINCT FROM 'string'
   OR jsonb_typeof(p_input->'end') IS DISTINCT FROM 'string'
   OR p_input->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR p_input->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   OR p_input->>'start'=p_input->>'end'
   OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'Invalid support correction request' USING ERRCODE='22023';
  END IF;
  v_reason:=btrim(p_input->>'reason');
  IF length(v_reason) NOT BETWEEN 2 AND 500 OR v_reason ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'Invalid support correction reason' USING ERRCODE='22023';
  END IF;
  v_id:=(p_input->>'id')::uuid;
  v_revision:=(p_input->>'revision')::integer;
  v_source:=p_input->>'source';
 END IF;

 -- Match exactly the Auth account selected by the existing admin surface.
 -- Keep historical membership records available, but never scope by email,
 -- site alone, an organization supplied by a caller, or a deleted account.
 SELECT i.id INTO v_identity
 FROM auth.users a JOIN timeax_core.identities i ON i.issuer=v_issuer AND i.subject=a.id::text
 WHERE a.id=p_account AND a.deleted_at IS NULL;
 IF v_identity IS NULL THEN
  RETURN CASE p_action WHEN 'shifts' THEN jsonb_build_object('state','ready','shifts','[]'::jsonb,'truncated',false)
   ELSE jsonb_build_object('state','missing') END;
 END IF;

 SELECT i.id INTO v_actor FROM timeax_core.owner_support_shift_config c
 JOIN timeax_core.identities i ON i.id=c.actor_identity AND i.issuer=v_issuer
 JOIN timeax_core.identity_issuers iss ON iss.issuer=i.issuer
 JOIN auth.users a ON a.id::text=i.subject
 WHERE c.singleton AND i.id<>v_identity AND i.active AND iss.active AND a.email_confirmed_at IS NOT NULL AND a.is_anonymous IS NOT TRUE AND a.deleted_at IS NULL;

 IF p_action='shifts' THEN
  RETURN (
   WITH memberships AS MATERIALIZED (
    SELECT m.id,m.organization_id
    FROM timeax_core.memberships m WHERE m.identity_id=v_identity AND m.role='worker'
   ), candidates AS MATERIALIZED (
    SELECT q.* FROM (
     SELECT s.id,'agency'::text AS source,s.organization_id,s.membership_id,s.worksite_id,s.local_date,s.start_at,s.end_at,s.revision,'recorded'::text AS state
     FROM memberships m JOIN timeax_core.timecard_shifts s ON s.membership_id=m.id AND s.organization_id=m.organization_id
     WHERE s.local_date BETWEEN v_from AND v_to
     UNION ALL
     SELECT s.id,'factory'::text,s.agency_id,s.membership_id,s.worksite_id,s.local_date,s.start_at,s.end_at,s.revision,s.state::text
     FROM memberships m JOIN timeax_core.factory_timecard_shifts s ON s.membership_id=m.id AND s.agency_id=m.organization_id
     WHERE s.local_date BETWEEN v_from AND v_to
    ) q ORDER BY q.local_date DESC,q.start_at DESC,q.id,q.source LIMIT v_limit+1
   ), bounded AS (
    SELECT * FROM candidates ORDER BY local_date DESC,start_at DESC,id,source LIMIT v_limit
   )
   SELECT jsonb_build_object('state','ready','truncated',(SELECT count(*)>v_limit FROM candidates),
    'shifts',COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'source',b.source,'organizationName',o.name,'worksiteName',w.name,
     'day',to_char(b.local_date,'YYYY-MM-DD'),'start',to_char(b.start_at AT TIME ZONE 'Europe/Warsaw','HH24:MI'),
     'end',to_char(b.end_at AT TIME ZONE 'Europe/Warsaw','HH24:MI'),'revision',b.revision,'editable',v_actor IS NOT NULL AND b.source='agency'
      AND o.kind='agency' AND o.state='active' AND w.active AND w.owner_organization_id=b.organization_id
      AND b.local_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' AND b.revision<999999999
      AND NOT EXISTS(SELECT 1 FROM timeax_core.internal_timecards a WHERE a.worksite_id=b.worksite_id AND b.local_date BETWEEN a.date_from AND a.date_to)
      AND NOT EXISTS(SELECT 1 FROM timeax_core.payroll_sources p WHERE p.member_id=b.membership_id AND p.agency_id=b.organization_id
       AND p.payload->'rows' @> jsonb_build_array(jsonb_build_object('id',b.id)))
      AND EXISTS(SELECT 1 FROM timeax_core.agency_worksite_preferences pref
       WHERE pref.organization_id=b.organization_id AND pref.worksite_id=b.worksite_id AND pref.planned_time_mode='manual')
      AND EXISTS(SELECT 1 FROM timeax_core.worksite_membership_grants g JOIN timeax_core.memberships m ON m.id=g.membership_id
       JOIN timeax_core.identities i ON i.id=m.identity_id
       WHERE m.id=b.membership_id AND m.state='active' AND i.active AND g.organization_id=b.organization_id AND g.worksite_id=b.worksite_id
       AND g.state='active' AND g.valid_from<=least(clock_timestamp(),b.start_at)
       AND (g.valid_until IS NULL OR (clock_timestamp()<g.valid_until AND b.end_at<=g.valid_until))),
     'state',CASE
      WHEN b.source='agency' AND EXISTS(SELECT 1 FROM timeax_core.internal_timecards a
        WHERE a.organization_id=b.organization_id AND a.worksite_id=b.worksite_id AND b.local_date BETWEEN a.date_from AND a.date_to) THEN 'archived'
      WHEN b.source='factory' AND EXISTS(SELECT 1 FROM timeax_core.received_factory_timecards a
        WHERE a.agency_id=b.organization_id AND a.worksite_id=b.worksite_id AND b.local_date BETWEEN a.date_from AND a.date_to) THEN 'sent'
      ELSE b.state END) ORDER BY b.local_date DESC,b.start_at DESC,b.id,b.source),'[]'::jsonb))
   FROM bounded b
   JOIN timeax_core.organizations o ON o.id=b.organization_id
   JOIN timeax_core.worksites w ON w.id=b.worksite_id
  );
 END IF;

 IF v_source='agency' THEN
  SELECT s.revision INTO v_actual FROM timeax_core.timecard_shifts s
  JOIN timeax_core.memberships m ON m.id=s.membership_id AND m.organization_id=s.organization_id
  WHERE s.id=v_id AND m.identity_id=v_identity AND m.role='worker';
 ELSE
  SELECT s.revision INTO v_actual FROM timeax_core.factory_timecard_shifts s
  JOIN timeax_core.memberships m ON m.id=s.membership_id AND m.organization_id=s.agency_id
  WHERE s.id=v_id AND m.identity_id=v_identity AND m.role='worker';
 END IF;
 IF v_actual IS NULL THEN RETURN jsonb_build_object('state','missing'); END IF;
 IF v_actual<>v_revision THEN RETURN jsonb_build_object('state','changed'); END IF;
 IF v_source<>'agency' OR v_actor IS NULL THEN RETURN jsonb_build_object('state','blocked'); END IF;
 SELECT s.membership_id,s.organization_id,s.worksite_id INTO v_member,v_org,v_site
 FROM timeax_core.timecard_shifts s WHERE s.id=v_id;
 PERFORM 1 FROM timeax_core.owner_support_shift_config c
 JOIN timeax_core.identities i ON i.id=c.actor_identity AND i.issuer=v_issuer
 JOIN timeax_core.identity_issuers iss ON iss.issuer=i.issuer
 JOIN auth.users a ON a.id::text=i.subject
 WHERE c.singleton AND i.id=v_actor AND i.id<>v_identity AND i.active AND iss.active
 AND a.email_confirmed_at IS NOT NULL AND a.is_anonymous IS NOT TRUE AND a.deleted_at IS NULL FOR SHARE OF c,i,iss,a;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked'); END IF;
 PERFORM 1 FROM timeax_core.identities i JOIN timeax_core.identity_issuers iss ON iss.issuer=i.issuer
 JOIN auth.users a ON a.id=p_account AND a.id::text=i.subject
 WHERE i.id=v_identity AND i.issuer=v_issuer AND i.active AND iss.active
 AND a.deleted_at IS NULL FOR SHARE OF i,iss,a;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked'); END IF;
 PERFORM 1 FROM timeax_core.memberships m JOIN timeax_core.organizations o ON o.id=m.organization_id
 WHERE m.id=v_member AND m.identity_id=v_identity AND m.organization_id=v_org
 AND m.role='worker' AND m.state='active' AND o.kind='agency' AND o.state='active' FOR SHARE OF m,o;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked'); END IF;
 PERFORM 1 FROM timeax_core.worksites w WHERE w.id=v_site AND w.owner_organization_id=v_org AND w.active FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked'); END IF;
 -- Same site then worker serialization as canonical timecard writes.
 PERFORM pg_advisory_xact_lock(hashtextextended('timecards-site/'||v_site,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('timecards-worker/'||v_member,0));
 SELECT s.* INTO v_before FROM timeax_core.timecard_shifts s
 WHERE s.id=v_id AND s.membership_id=v_member AND s.organization_id=v_org AND s.worksite_id=v_site FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','missing'); END IF;
 IF v_before.revision<>v_revision THEN RETURN jsonb_build_object('state','changed'); END IF;
 IF v_before.revision>=999999999 OR v_before.local_date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'
 OR EXISTS(SELECT 1 FROM timeax_core.internal_timecards c WHERE c.worksite_id=v_site AND v_before.local_date BETWEEN c.date_from AND c.date_to)
 OR EXISTS(SELECT 1 FROM timeax_core.payroll_sources p WHERE p.member_id=v_member AND p.agency_id=v_org
  AND p.payload->'rows' @> jsonb_build_array(jsonb_build_object('id',v_id))) THEN
  RETURN jsonb_build_object('state','blocked');
 END IF;
 PERFORM 1 FROM timeax_core.agency_worksite_preferences pref
 WHERE pref.organization_id=v_org AND pref.worksite_id=v_site AND pref.planned_time_mode='manual' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked'); END IF;
 -- Reject missing and repeated local minutes on Warsaw clock change days.
 -- The preserved date is the date of shift start; an earlier wall-clock
 -- end belongs to the next date.
 v_wall_start:=v_before.local_date+(p_input->>'start')::time;
 v_wall_end:=(v_before.local_date+CASE WHEN p_input->>'end'<p_input->>'start' THEN 1 ELSE 0 END)+(p_input->>'end')::time;
 v_start:=v_wall_start AT TIME ZONE 'Europe/Warsaw';
 v_end:=v_wall_end AT TIME ZONE 'Europe/Warsaw';
 IF v_start AT TIME ZONE 'Europe/Warsaw'<>v_wall_start OR v_end AT TIME ZONE 'Europe/Warsaw'<>v_wall_end
 OR (v_start-interval '1 hour') AT TIME ZONE 'Europe/Warsaw'=v_wall_start
 OR (v_start+interval '1 hour') AT TIME ZONE 'Europe/Warsaw'=v_wall_start
 OR (v_end-interval '1 hour') AT TIME ZONE 'Europe/Warsaw'=v_wall_end
 OR (v_end+interval '1 hour') AT TIME ZONE 'Europe/Warsaw'=v_wall_end
 OR v_end<=v_start OR v_end-v_start>interval '24 hours' OR v_end>clock_timestamp()+interval '5 minutes'
 OR (v_start=v_before.start_at AND v_end=v_before.end_at) THEN
  RETURN jsonb_build_object('state','blocked');
 END IF;
 v_gross:=(extract(epoch FROM v_end-v_start)/60)::integer;
 v_break_status:=v_before.data->>'breakStatus';
 v_break_treatment:=v_before.data->>'breakTreatment';
 IF COALESCE(v_before.data->>'breakMinutes','') !~ '^(0|[1-9][0-9]{0,3})$'
 OR COALESCE(v_break_status,'') NOT IN ('taken','not-taken','not-reported')
 OR COALESCE(v_break_treatment,'') NOT IN ('paid','unpaid') THEN
  RETURN jsonb_build_object('state','blocked');
 END IF;
 v_break:=(v_before.data->>'breakMinutes')::integer;
 IF v_break>=v_gross OR (v_break_status<>'taken' AND v_break<>0)
 OR (v_break_status='not-reported' AND v_break_treatment<>'unpaid')
 OR (v_break_status='taken' AND v_break_treatment='unpaid' AND v_break=0) THEN
  RETURN jsonb_build_object('state','blocked');
 END IF;
 v_paid:=v_gross-CASE WHEN v_break_treatment='unpaid' THEN v_break ELSE 0 END;
 PERFORM 1 FROM timeax_core.worksite_membership_grants g
 WHERE g.organization_id=v_org AND g.worksite_id=v_site AND g.membership_id=v_member AND g.state='active'
 AND g.valid_from<=clock_timestamp() AND (g.valid_until IS NULL OR g.valid_until>clock_timestamp())
 AND g.valid_from<=least(v_start,v_before.start_at) AND (g.valid_until IS NULL OR greatest(v_end,v_before.end_at)<=g.valid_until)
 FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM timeax_core.timecard_shifts s WHERE s.membership_id=v_member AND s.id<>v_id AND s.start_at<v_end AND s.end_at>v_start)
 OR EXISTS(SELECT 1 FROM timeax_core.factory_timecard_shifts s WHERE s.membership_id=v_member AND s.start_at<v_end AND s.end_at>v_start) THEN
  RETURN jsonb_build_object('state','blocked');
 END IF;
 v_data:=v_before.data||jsonb_build_object(
  'startTime',p_input->>'start','endTime',p_input->>'end',
  'startAt',to_char(v_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'endAt',to_char(v_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'grossMinutes',v_gross,'paidMinutes',v_paid);
 v_op:=gen_random_uuid();
 UPDATE timeax_core.timecard_shifts
 SET start_at=v_start,end_at=v_end,data=v_data,revision=revision+1,updated_at=clock_timestamp()
 WHERE id=v_id RETURNING * INTO v_after;
 INSERT INTO timeax_core.timecard_revisions(shift_id,revision,actor_identity,operation_id,input,data,reason)
 VALUES(v_after.id,v_after.revision,v_actor,v_op,jsonb_build_object('id',v_id,'organizationId',v_org,'worksiteId',v_site,
  'revision',v_revision,'operationId',v_op,'data',v_data,'reason',v_reason,'ownerSupport',true),v_data,v_reason);
 INSERT INTO timeax_core.owner_support_audit(account_id,action,object_id,reason,before_data,after_data)
 VALUES(p_account,'correct-shift',v_id,v_reason,
  jsonb_build_object('revision',v_before.revision,'startAt',v_before.start_at,'endAt',v_before.end_at,
   'startTime',to_char(v_before.start_at AT TIME ZONE 'Europe/Warsaw','HH24:MI'),
   'endTime',to_char(v_before.end_at AT TIME ZONE 'Europe/Warsaw','HH24:MI'),
   'grossMinutes',v_before.data->'grossMinutes','paidMinutes',v_before.data->'paidMinutes'),
  jsonb_build_object('revision',v_after.revision,'startAt',v_after.start_at,'endAt',v_after.end_at,
   'startTime',p_input->>'start','endTime',p_input->>'end',
   'grossMinutes',v_after.data->'grossMinutes','paidMinutes',v_after.data->'paidMinutes','actorIdentity',v_actor,'operationId',v_op));
 RETURN jsonb_build_object('state','corrected','id',v_id);
END;
$owner_support_shifts$;

ALTER FUNCTION timeax_core.owner_support_shifts(text,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_core.owner_support_shifts(text,uuid,jsonb) FROM PUBLIC;
DO $owner_support_shifts_acl$
DECLARE grantee_name text;
BEGIN
 FOR grantee_name IN
  SELECT DISTINCT r.rolname FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
  JOIN pg_catalog.pg_roles r ON r.oid=acl.grantee
  WHERE p.oid='timeax_core.owner_support_shifts(text,uuid,jsonb)'::regprocedure AND acl.grantee<>p.proowner
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION timeax_core.owner_support_shifts(text,uuid,jsonb) FROM %I',grantee_name);
 END LOOP;
END;
$owner_support_shifts_acl$;
DO $owner_support_config_acl$
DECLARE grantee_name text;
BEGIN
 FOR grantee_name IN
  SELECT DISTINCT r.rolname FROM pg_catalog.pg_class p
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.relacl,pg_catalog.acldefault('r',p.relowner))) acl
  JOIN pg_catalog.pg_roles r ON r.oid=acl.grantee
  WHERE p.oid='timeax_core.owner_support_shift_config'::regclass AND acl.grantee<>p.relowner
 LOOP
  EXECUTE format('REVOKE ALL ON TABLE timeax_core.owner_support_shift_config FROM %I',grantee_name);
 END LOOP;
END;
$owner_support_config_acl$;
COMMIT;
