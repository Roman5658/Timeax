-- Private per-membership inbox state. Does not delete shared records or timecards.
BEGIN;
CREATE ROLE timeax_inbox_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 6;
GRANT USAGE ON SCHEMA timeax_api TO timeax_inbox_login;
CREATE TABLE timeax_core.inbox_dispositions (
 membership_id uuid NOT NULL REFERENCES timeax_core.memberships(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('team-message','team-notice','agency-join','backdated-internal','backdated-factory')),
 entry_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('archived','deleted')),
 PRIMARY KEY(membership_id,kind,entry_id)
);
ALTER TABLE timeax_core.inbox_dispositions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.inbox_dispositions FROM PUBLIC,anon,authenticated,service_role,timeax_inbox_login;
CREATE FUNCTION timeax_api.inbox(text,text,text,jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog, pg_temp AS $body$
DECLARE m timeax_core.memberships; org uuid; k text; entry uuid; status text;
BEGIN
 IF session_user <> 'timeax_inbox_login' THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 org:=($4->>'organizationId')::uuid;
 SELECT x.* INTO m FROM timeax_core.memberships x JOIN timeax_core.organizations o ON o.id=x.organization_id
 JOIN timeax_core.identities i ON i.id=x.identity_id JOIN timeax_core.identity_issuers s ON s.issuer=i.issuer
 WHERE x.organization_id=org AND x.state='active' AND o.state='active' AND i.active AND s.active AND i.issuer=$1 AND i.subject=$2;
 IF NOT FOUND OR m.role NOT IN ('agency_admin','factory_admin','team_leader','worker','accountant')
 THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF $3='context' THEN
  RETURN jsonb_build_object('membershipId',m.id,
   'states',COALESCE((SELECT jsonb_object_agg(d.kind||'-'||d.entry_id,d.state) FROM timeax_core.inbox_dispositions d WHERE d.membership_id=m.id),'{}'),
   'joins',CASE WHEN m.role='agency_admin' AND m.organization_kind='agency' THEN COALESCE((
     SELECT jsonb_agg(jsonb_build_object('id',e.membership_id,'joinedAt',e.joined_at,'name',p.display_name,'reference',p.reference_no::text,'read',r.reader_id IS NOT NULL))
      FROM timeax_core.agency_worker_join_events e
      LEFT JOIN timeax_core.member_display_names p ON p.organization_id=e.agency_id AND p.membership_id=e.membership_id
      LEFT JOIN timeax_core.agency_worker_join_reads r ON r.agency_id=e.agency_id AND r.membership_id=e.membership_id AND r.reader_id=m.identity_id
      WHERE e.agency_id=org AND e.joined_at>=statement_timestamp()-interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM timeax_core.inbox_dispositions d WHERE d.membership_id=m.id AND d.kind='agency-join' AND d.entry_id=e.membership_id AND d.state='deleted')
     ),'[]') ELSE '[]' END,
   'requests',CASE WHEN m.role='agency_admin' AND m.organization_kind='agency' THEN COALESCE((
     SELECT jsonb_agg(jsonb_build_object('id',q.id,'workerId',q.worker_id,'day',q.input->'data'->>'localDate',
     'startTime',q.input->'data'->>'startTime','endTime',q.input->'data'->>'endTime','submittedAt',q.submitted_at,
     'site',w.name,'state',q.state) ORDER BY (q.state='pending') DESC,q.submitted_at DESC,q.id)
     FROM (SELECT r.* FROM timeax_core.earlier_shift_requests r WHERE r.agency_id=org AND r.state='pending'
      UNION ALL
      (SELECT r.* FROM timeax_core.earlier_shift_requests r WHERE r.agency_id=org AND r.state<>'pending' ORDER BY r.submitted_at DESC,r.id LIMIT 50)) q
     JOIN timeax_core.worksites w ON w.id=q.worksite_id AND w.owner_organization_id=org
     ),'[]') ELSE '[]' END,
   'backdated',CASE WHEN m.role='agency_admin' AND m.organization_kind='agency' THEN COALESCE((
     SELECT jsonb_agg(jsonb_build_object('id',e.shift_id,'source',e.source,'workerId',e.membership_id,'day',e.local_date,'submittedAt',e.submitted_at,'read',r.reader_id IS NOT NULL))
      FROM timeax_core.backdated_shift_notices e LEFT JOIN timeax_core.backdated_shift_notice_reads r
       ON r.source=e.source AND r.shift_id=e.shift_id AND r.reader_id=m.id
      WHERE e.agency_id=org AND NOT EXISTS (SELECT 1 FROM timeax_core.inbox_dispositions d WHERE d.membership_id=m.id AND d.kind='backdated-'||e.source AND d.entry_id=e.shift_id AND d.state='deleted')
     ),'[]') ELSE '[]' END);
 END IF;
 k:=$4->>'kind'; entry:=($4->>'id')::uuid; status:=$4->>'state';
 IF $3<>'set' OR status IS NULL OR status NOT IN ('archived','active','deleted') OR entry IS NULL OR k IS NULL
 THEN RAISE EXCEPTION 'Invalid inbox update' USING ERRCODE='22023'; END IF;
 IF NOT (CASE
  WHEN k IN ('team-message','team-notice') THEN EXISTS(
   SELECT 1 FROM timeax_team.entries e WHERE e.id=entry AND ((e.kind='message')=(k='team-message'))
    AND (e.sender=m.id OR EXISTS(SELECT 1 FROM timeax_team.deliveries d WHERE d.entry_id=e.id AND d.recipient=m.id)))
  WHEN m.role='agency_admin' AND m.organization_kind='agency' AND k='agency-join' THEN EXISTS(
   SELECT 1 FROM timeax_core.agency_worker_join_events e WHERE e.agency_id=org AND e.membership_id=entry AND e.joined_at>=statement_timestamp()-interval '30 days')
  WHEN m.role='agency_admin' AND m.organization_kind='agency' AND k IN ('backdated-internal','backdated-factory') THEN EXISTS(
   SELECT 1 FROM timeax_core.backdated_shift_notices e WHERE e.agency_id=org AND e.shift_id=entry AND 'backdated-'||e.source=k)
  ELSE false END)
 THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 IF status='active' THEN
  DELETE FROM timeax_core.inbox_dispositions d WHERE d.membership_id=m.id AND d.kind=k AND d.entry_id=entry AND d.state='archived';
 ELSE
  INSERT INTO timeax_core.inbox_dispositions AS d VALUES(m.id,k,entry,status)
   ON CONFLICT(membership_id,kind,entry_id) DO UPDATE SET state=EXCLUDED.state WHERE d.state<>'deleted';
 END IF;
 RETURN jsonb_build_object('state',COALESCE((SELECT d.state FROM timeax_core.inbox_dispositions d WHERE d.membership_id=m.id AND d.kind=k AND d.entry_id=entry),'active'));
END;
$body$;
REVOKE ALL ON FUNCTION timeax_api.inbox(text,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION timeax_api.inbox(text,text,text,jsonb) TO timeax_inbox_login;
COMMIT;
