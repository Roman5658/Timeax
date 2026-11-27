-- Agency-owned production details: rename and transactional internal worker transfer.
BEGIN;
DO $review$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('timeax_api.factory_setup(text,text,text,jsonb)'::regprocedure),'UTF8')),'hex')
 <> 'ecddd7d813f42e36d219c0b1944ff205c51581a68397086c1732eaa5f6c03a89'
 THEN RAISE EXCEPTION 'unexpected factory setup definition'; END IF;
END $review$;
CREATE TEMP TABLE timeax_factory_setup_owner_lease(remove_after boolean NOT NULL) ON COMMIT DROP;
INSERT INTO timeax_factory_setup_owner_lease VALUES(NOT pg_has_role(current_user,'timeax_factory_setup_owner','USAGE'));
DO $lease$ BEGIN
 IF (SELECT remove_after FROM timeax_factory_setup_owner_lease) THEN
  EXECUTE format('GRANT timeax_factory_setup_owner TO %I WITH INHERIT TRUE, SET TRUE',current_user);
 END IF;
END $lease$;
CREATE TABLE timeax_core.agency_worksite_grant_history(
  organization_id uuid NOT NULL, worksite_id uuid NOT NULL, membership_id uuid NOT NULL,
  valid_from timestamptz NOT NULL, valid_until timestamptz, previous_state text NOT NULL, archived_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE timeax_core.agency_worksite_grant_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.agency_worksite_grant_history FROM PUBLIC,anon,authenticated,service_role;
GRANT INSERT ON timeax_core.agency_worksite_grant_history TO timeax_factory_setup_owner;
CREATE POLICY agency_grant_history_insert ON timeax_core.agency_worksite_grant_history FOR INSERT TO timeax_factory_setup_owner WITH CHECK (true);

GRANT UPDATE(name) ON timeax_core.worksites TO timeax_factory_setup_owner;
CREATE POLICY factory_setup_rename_internal ON timeax_core.worksites FOR UPDATE TO timeax_factory_setup_owner
 USING (active AND EXISTS(SELECT 1 FROM timeax_core.organizations o WHERE o.id=owner_organization_id AND o.kind='agency' AND o.state='active'))
 WITH CHECK (active AND EXISTS(SELECT 1 FROM timeax_core.organizations o WHERE o.id=owner_organization_id AND o.kind='agency' AND o.state='active'));

CREATE OR REPLACE FUNCTION timeax_api.factory_setup(p_issuer text, p_subject text, p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$

DECLARE org timeax_core.organizations%ROWTYPE;site timeax_core.worksites%ROWTYPE;member timeax_core.memberships%ROWTYPE;

 conn timeax_core.factory_connection_requests%ROWTYPE;inv timeax_core.factory_leader_invitations%ROWTYPE;op timeax_core.worksite_setup_operations%ROWTYPE;

 actor uuid;target uuid;principal_id uuid;agency uuid;code text;start_time timestamptz;result jsonb;
 prior timeax_core.worksite_membership_grants%ROWTYPE; from_site uuid;

BEGIN

 IF session_user<>'timeax_factory_setup_login' THEN RAISE EXCEPTION 'runtime unavailable' USING ERRCODE='42501'; END IF;

 PERFORM timeax_core.check_worker_principal(p_issuer,p_subject);

 IF p_action='context' THEN

 RETURN jsonb_build_object(

 'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'organizationId',o.id,'name',o.name,'kind',o.kind,'role',m.role))

 FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id JOIN timeax_core.organizations o ON o.id=m.organization_id

 WHERE i.issuer=p_issuer AND i.subject=p_subject AND i.active AND m.state='active' AND o.state='active'),'[]'),

 'worksites',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'ownerId',w.owner_organization_id,'ownerKind',o.kind,'organizationId',m.organization_id,'role',m.role))

 FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id

 CROSS JOIN LATERAL timeax_api.my_worksites(p_issuer,p_subject,m.organization_id) a

 JOIN timeax_core.worksites w ON w.id=a.worksite_id JOIN timeax_core.organizations o ON o.id=w.owner_organization_id

 WHERE i.issuer=p_issuer AND i.subject=p_subject AND m.state='active'),'[]'),

 'connections',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'factoryId',c.factory_id,'factoryName',fo.name,'agencyId',c.agency_id,'agencyName',ao.name,'worksiteId',w.id,'worksiteName',w.name,'state',c.state))

 FROM timeax_core.factory_connection_requests c JOIN timeax_core.worksites w ON w.id=c.worksite_id

 JOIN timeax_core.organizations fo ON fo.id=c.factory_id JOIN timeax_core.organizations ao ON ao.id=c.agency_id

 WHERE fo.state='active' AND ao.state='active' AND EXISTS(SELECT 1 FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id

 WHERE i.issuer=p_issuer AND i.subject=p_subject AND i.active AND m.state='active' AND ((m.organization_id=c.agency_id AND m.role='agency_admin') OR (m.organization_id=c.factory_id AND m.role='factory_admin')))),'[]'),

 'workers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'organizationId',m.organization_id))

 FROM timeax_core.memberships m JOIN timeax_core.identities wi ON wi.id=m.identity_id

 WHERE m.role='worker' AND m.state='active' AND wi.active AND EXISTS(SELECT 1 FROM timeax_api.my_membership(p_issuer,p_subject,m.organization_id) a WHERE a.role='agency_admin')),'[]'),

 'invitations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'factoryId',v.factory_id,'worksiteId',v.worksite_id,'expiresAt',v.expires_at,'state',CASE WHEN v.claimed_at IS NOT NULL THEN 'claimed' WHEN v.revoked THEN 'revoked' WHEN v.expires_at<=statement_timestamp() THEN 'expired' ELSE 'pending' END))

 FROM timeax_core.factory_leader_invitations v WHERE EXISTS(SELECT 1 FROM timeax_api.my_membership(p_issuer,p_subject,v.factory_id) m WHERE m.role='factory_admin')),'[]'),

 'assignments',COALESCE((SELECT jsonb_agg(jsonb_build_object('membershipId',g.membership_id,'worksiteId',g.worksite_id,'organizationId',g.organization_id,'startsAt',g.valid_from,'endsAt',g.valid_until,'state',g.state,'role',m.role))

 FROM timeax_core.worksite_membership_grants g JOIN timeax_core.memberships m ON m.id=g.membership_id JOIN timeax_core.identities i ON i.id=m.identity_id

 WHERE EXISTS(SELECT 1 FROM timeax_api.my_membership(p_issuer,p_subject,g.organization_id) a WHERE a.role IN ('agency_admin','factory_admin')) OR (i.issuer=p_issuer AND i.subject=p_subject AND m.state='active')),'[]'));

 END IF;

 IF p_action='create-site' THEN

  SELECT * INTO org FROM timeax_core.organizations WHERE id=(p_input->>'organizationId')::uuid AND state='active';

  IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='42501'; END IF;

  actor:=timeax_core.setup_admin(p_issuer,p_subject,org.id,org.kind);

  IF length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'invalid name' USING ERRCODE='22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('site/'||(p_input->>'operationId'),0));

  SELECT * INTO op FROM timeax_core.worksite_setup_operations WHERE id=(p_input->>'operationId')::uuid;

  IF FOUND THEN

   IF (op.issuer,op.subject,op.organization_id,op.name) IS DISTINCT FROM (p_issuer,p_subject,org.id,btrim(p_input->>'name')) THEN RAISE EXCEPTION 'operation differs' USING ERRCODE='22023';END IF;

   RETURN jsonb_build_object('worksiteId',op.worksite_id);

  END IF;

  INSERT INTO timeax_core.worksites(owner_organization_id,name) VALUES(org.id,btrim(p_input->>'name')) RETURNING * INTO site;

  INSERT INTO timeax_core.worksite_setup_operations VALUES((p_input->>'operationId')::uuid,p_issuer,p_subject,org.id,btrim(p_input->>'name'),site.id);

  RETURN jsonb_build_object('worksiteId',site.id);

 END IF;

 IF p_action IN ('assign-internal','transfer-internal','rename-site','request-connection','invite-leader','revoke-assignment') THEN

  SELECT * INTO site FROM timeax_core.worksites WHERE id=(p_input->>'worksiteId')::uuid AND active FOR SHARE;

  IF NOT FOUND THEN RAISE EXCEPTION 'site unavailable' USING ERRCODE='42501';END IF;

  SELECT * INTO org FROM timeax_core.organizations WHERE id=site.owner_organization_id AND state='active';

  IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='42501';END IF;

  actor:=timeax_core.setup_admin(p_issuer,p_subject,org.id,org.kind);

 END IF;

 IF p_action='rename-site' THEN
  IF org.kind<>'agency' THEN RAISE EXCEPTION 'internal agency site required' USING ERRCODE='42501';END IF;
  IF length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 120 OR (p_input->>'name') ~ '[[:cntrl:]]'
   THEN RAISE EXCEPTION 'invalid name' USING ERRCODE='22023';END IF;
  UPDATE timeax_core.worksites SET name=btrim(p_input->>'name') WHERE id=site.id AND owner_organization_id=org.id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'site unavailable' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('worksiteId',site.id,'name',btrim(p_input->>'name'));
 END IF;

 IF p_action IN ('assign-internal','transfer-internal') THEN

  IF org.kind<>'agency' THEN RAISE EXCEPTION 'internal agency site required' USING ERRCODE='42501';END IF;

  SELECT m.* INTO member FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id

  WHERE m.id=(p_input->>'membershipId')::uuid AND m.organization_id=org.id AND m.role='worker' AND m.state='active' AND i.active FOR SHARE OF m,i;

  IF NOT FOUND THEN RAISE EXCEPTION 'worker unavailable' USING ERRCODE='42501';END IF;

  start_time:=(p_input->>'startsAt')::timestamptz;

  IF start_time IS NULL THEN RAISE EXCEPTION 'start required' USING ERRCODE='22023';END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('internal-assignment/'||org.id::text||'/'||member.id::text,0));
  SELECT * INTO prior FROM timeax_core.worksite_membership_grants WHERE organization_id=org.id AND worksite_id=site.id AND membership_id=member.id FOR UPDATE;
  IF p_action='transfer-internal' THEN
   from_site:=(p_input->>'fromWorksiteId')::uuid;
   IF from_site IS NULL OR from_site=site.id OR NOT EXISTS(SELECT 1 FROM timeax_core.worksites WHERE id=from_site AND owner_organization_id=org.id AND active)
    THEN RAISE EXCEPTION 'source site unavailable' USING ERRCODE='42501';END IF;
   IF start_time<clock_timestamp()-INTERVAL '2 minutes' THEN
    RAISE EXCEPTION 'transfer cannot be backdated' USING ERRCODE='22023';END IF;
   IF prior.membership_id IS NOT NULL AND prior.state='active' AND prior.valid_from=start_time AND prior.valid_until IS NULL AND EXISTS(
     SELECT 1 FROM timeax_core.worksite_membership_grants WHERE organization_id=org.id AND worksite_id=from_site AND membership_id=member.id AND valid_until=start_time)
    THEN RETURN jsonb_build_object('membershipId',member.id,'worksiteId',site.id,'startsAt',start_time);END IF;
   UPDATE timeax_core.worksite_membership_grants SET valid_until=start_time
    WHERE organization_id=org.id AND worksite_id=from_site AND membership_id=member.id AND state='active' AND valid_until IS NULL
      AND valid_from<start_time AND valid_from<=clock_timestamp();
   IF NOT FOUND THEN RAISE EXCEPTION 'source assignment changed' USING ERRCODE='22023';END IF;
  END IF;
  IF prior.membership_id IS NULL THEN
   INSERT INTO timeax_core.worksite_membership_grants(organization_id,worksite_id,membership_id,valid_from) VALUES(org.id,site.id,member.id,start_time) ON CONFLICT DO NOTHING;
  ELSIF (prior.state='revoked' AND prior.valid_from<start_time)
      OR (prior.valid_until IS NOT NULL AND prior.valid_until<=start_time) THEN
   INSERT INTO timeax_core.agency_worksite_grant_history(organization_id,worksite_id,membership_id,valid_from,valid_until,previous_state)
    VALUES(org.id,site.id,member.id,prior.valid_from,prior.valid_until,prior.state);
   UPDATE timeax_core.worksite_membership_grants SET valid_from=start_time,valid_until=NULL,state='active'
    WHERE organization_id=org.id AND worksite_id=site.id AND membership_id=member.id;
  ELSIF p_action='transfer-internal' THEN
   RAISE EXCEPTION 'destination already assigned' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM timeax_core.worksite_membership_grants WHERE organization_id=org.id AND worksite_id=site.id AND membership_id=member.id AND state='active' AND valid_from=start_time AND valid_until IS NULL) THEN RAISE EXCEPTION 'assignment differs' USING ERRCODE='22023';END IF;

  RETURN jsonb_build_object('membershipId',member.id,'worksiteId',site.id,'startsAt',start_time);

 END IF;

 IF p_action='request-connection' THEN

  IF org.kind<>'factory' THEN RAISE EXCEPTION 'factory site required' USING ERRCODE='42501';END IF;

  SELECT n.agency_id INTO agency FROM timeax_core.agency_verified_nips n JOIN timeax_core.organizations o ON o.id=n.agency_id WHERE n.nip=p_input->>'agencyNip' AND n.active AND o.state='active' AND o.kind='agency';

  IF NOT FOUND THEN RAISE EXCEPTION 'agency unavailable' USING ERRCODE='42501';END IF;

  INSERT INTO timeax_core.factory_connection_requests(factory_id,worksite_id,agency_id,requested_by) VALUES(org.id,site.id,agency,actor) ON CONFLICT(worksite_id,agency_id) DO NOTHING;

  SELECT * INTO conn FROM timeax_core.factory_connection_requests WHERE worksite_id=site.id AND agency_id=agency;

  RETURN jsonb_build_object('id',conn.id,'state',conn.state);

 END IF;

 IF p_action IN ('approve-connection','decline-connection','revoke-connection') THEN

  SELECT * INTO conn FROM timeax_core.factory_connection_requests WHERE id=(p_input->>'id')::uuid FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'connection unavailable' USING ERRCODE='42501';END IF;

  actor:=timeax_core.setup_admin(p_issuer,p_subject,conn.agency_id,'agency');

  IF p_action='approve-connection' THEN

   IF conn.state='active' THEN RETURN jsonb_build_object('id',conn.id,'state',conn.state);END IF;

   IF conn.state<>'pending' OR p_input->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'confirmation required' USING ERRCODE='22023';END IF;

   PERFORM 1 FROM timeax_core.worksites w JOIN timeax_core.organizations o ON o.id=w.owner_organization_id JOIN timeax_core.memberships m ON m.id=conn.requested_by JOIN timeax_core.identities i ON i.id=m.identity_id

   WHERE w.id=conn.worksite_id AND w.active AND o.state='active' AND m.state='active' AND m.role='factory_admin' AND i.active FOR SHARE OF w,o,m,i;

   IF NOT FOUND THEN RAISE EXCEPTION 'factory consent unavailable' USING ERRCODE='42501';END IF;

   INSERT INTO timeax_core.worksite_organization_grants(worksite_id,owner_organization_id,organization_id) VALUES(conn.worksite_id,conn.factory_id,conn.agency_id) ON CONFLICT DO NOTHING;

   IF NOT EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants WHERE worksite_id=conn.worksite_id AND organization_id=conn.agency_id AND state='active') THEN RAISE EXCEPTION 'grant unavailable' USING ERRCODE='42501';END IF;

   UPDATE timeax_core.factory_connection_requests SET state='active',decided_by=actor,decided_at=clock_timestamp() WHERE id=conn.id;

   RETURN jsonb_build_object('id',conn.id,'state','active');

  END IF;

  IF p_action='decline-connection' THEN

   IF conn.state NOT IN ('pending','rejected') THEN RAISE EXCEPTION 'decision unavailable' USING ERRCODE='22023';END IF;

   UPDATE timeax_core.factory_connection_requests SET state='rejected',decided_by=actor,decided_at=COALESCE(decided_at,clock_timestamp()) WHERE id=conn.id;

   RETURN jsonb_build_object('id',conn.id,'state','rejected');

  END IF;

  IF conn.state NOT IN ('active','revoked') THEN RAISE EXCEPTION 'active connection required' USING ERRCODE='22023';END IF;

  UPDATE timeax_core.factory_connection_requests SET state='revoked' WHERE id=conn.id;

  UPDATE timeax_core.worksite_organization_grants SET state='revoked' WHERE worksite_id=conn.worksite_id AND organization_id=conn.agency_id;

  IF NOT EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants WHERE worksite_id=conn.worksite_id AND state='active') THEN

   UPDATE timeax_core.factory_leader_invitations SET revoked=true WHERE worksite_id=conn.worksite_id AND claimed_at IS NULL;

   UPDATE timeax_core.worksite_membership_grants g SET state='revoked' WHERE g.worksite_id=conn.worksite_id AND g.organization_id=conn.factory_id AND NOT EXISTS(SELECT 1 FROM timeax_core.factory_owned_worker_invitations v WHERE v.factory_id=g.organization_id AND v.worksite_id=g.worksite_id AND v.membership_id=g.membership_id AND v.claimed_at IS NOT NULL AND NOT v.revoked);

  END IF;

  RETURN jsonb_build_object('id',conn.id,'state','revoked');

 END IF;

 IF p_action='invite-leader' THEN

  IF org.kind<>'factory' OR NOT EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants g JOIN timeax_core.organizations a ON a.id=g.organization_id WHERE g.worksite_id=site.id AND g.state='active' AND a.state='active') THEN RAISE EXCEPTION 'confirmed factory connection required' USING ERRCODE='42501';END IF;

  start_time:=(p_input->>'startsAt')::timestamptz;

  IF start_time IS NULL THEN RAISE EXCEPTION 'start required' USING ERRCODE='22023';END IF;

  code:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');

  INSERT INTO timeax_core.factory_leader_invitations(factory_id,worksite_id,issued_by,code_digest,expires_at,starts_at)

   VALUES(org.id,site.id,actor,sha256(convert_to(code,'UTF8')),clock_timestamp()+interval '1 hour',start_time) RETURNING * INTO inv;

  RETURN jsonb_build_object('id',inv.id,'code',code,'expiresAt',inv.expires_at,'startsAt',start_time);

 END IF;

 IF p_action='revoke-invitation' THEN

  SELECT * INTO inv FROM timeax_core.factory_leader_invitations WHERE id=(p_input->>'id')::uuid FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';END IF;

  actor:=timeax_core.setup_admin(p_issuer,p_subject,inv.factory_id,'factory');

  IF inv.claimed_at IS NOT NULL THEN RAISE EXCEPTION 'revoke assignment instead' USING ERRCODE='22023';END IF;

  UPDATE timeax_core.factory_leader_invitations SET revoked=true WHERE id=inv.id;

  RETURN jsonb_build_object('id',inv.id,'state','revoked');

 END IF;

 IF p_action='claim-leader' THEN

  IF NOT COALESCE(p_input->>'code' ~ '^[0-9a-f]{64}$',false) THEN RAISE EXCEPTION 'invalid code' USING ERRCODE='22023';END IF;

  SELECT * INTO inv FROM timeax_core.factory_leader_invitations WHERE code_digest=sha256(convert_to(p_input->>'code','UTF8')) FOR UPDATE;

  IF NOT FOUND OR inv.revoked THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';END IF;

  SELECT id INTO principal_id FROM timeax_core.identities WHERE issuer=p_issuer AND subject=p_subject AND active;

  IF inv.claimed_at IS NOT NULL THEN

   IF inv.claimed_identity IS DISTINCT FROM principal_id THEN RAISE EXCEPTION 'invitation already used' USING ERRCODE='42501';END IF;

   RETURN jsonb_build_object('membershipId',inv.membership_id,'worksiteId',inv.worksite_id);

  END IF;

  IF inv.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'invitation expired' USING ERRCODE='42501';END IF;

  PERFORM 1 FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id JOIN timeax_core.organizations o ON o.id=m.organization_id

  JOIN timeax_core.worksites w ON w.id=inv.worksite_id

  WHERE m.id=inv.issued_by AND m.organization_id=inv.factory_id AND m.role='factory_admin' AND m.state='active' AND i.active AND o.state='active' AND w.active

   AND EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants g JOIN timeax_core.organizations a ON a.id=g.organization_id WHERE g.worksite_id=w.id AND g.state='active' AND a.state='active')

  FOR SHARE OF m,i,o,w;

  IF NOT FOUND THEN RAISE EXCEPTION 'factory authority unavailable' USING ERRCODE='42501';END IF;

  INSERT INTO timeax_core.identities(issuer,subject) VALUES(p_issuer,p_subject) ON CONFLICT(issuer,subject) DO NOTHING;

  SELECT id INTO principal_id FROM timeax_core.identities WHERE issuer=p_issuer AND subject=p_subject AND active FOR SHARE;

  IF NOT FOUND THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='42501';END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('leader/'||principal_id::text||inv.factory_id::text,0));

  SELECT * INTO member FROM timeax_core.memberships WHERE organization_id=inv.factory_id AND timeax_core.memberships.identity_id=principal_id;

  IF NOT FOUND THEN

   INSERT INTO timeax_core.memberships(organization_id,organization_kind,identity_id,role) VALUES(inv.factory_id,'factory',principal_id,'team_leader') RETURNING * INTO member;

  ELSIF member.role<>'team_leader' OR member.state<>'active' THEN RAISE EXCEPTION 'existing membership requires review' USING ERRCODE='42501';END IF;

  INSERT INTO timeax_core.worksite_membership_grants(organization_id,worksite_id,membership_id,valid_from) VALUES(inv.factory_id,inv.worksite_id,member.id,inv.starts_at) ON CONFLICT DO NOTHING;

  IF NOT EXISTS(SELECT 1 FROM timeax_core.worksite_membership_grants WHERE organization_id=inv.factory_id AND worksite_id=inv.worksite_id AND membership_id=member.id AND state='active' AND valid_from=inv.starts_at) THEN RAISE EXCEPTION 'assignment requires review' USING ERRCODE='42501';END IF;

  UPDATE timeax_core.factory_leader_invitations SET claimed_identity=principal_id,claimed_at=clock_timestamp(),membership_id=member.id WHERE id=inv.id;

  RETURN jsonb_build_object('membershipId',member.id,'worksiteId',inv.worksite_id);

 END IF;

 IF p_action='revoke-assignment' THEN
  IF org.kind='agency' THEN PERFORM pg_advisory_xact_lock(hashtextextended('internal-assignment/'||org.id::text||'/'||(p_input->>'membershipId'),0));END IF;

  IF NOT EXISTS(SELECT 1 FROM timeax_core.memberships WHERE id=(p_input->>'membershipId')::uuid AND organization_id=org.id AND role=CASE org.kind WHEN 'agency' THEN 'worker' ELSE 'team_leader' END) THEN RAISE EXCEPTION 'assignment unavailable' USING ERRCODE='42501';END IF;

  UPDATE timeax_core.worksite_membership_grants SET state='revoked' WHERE organization_id=org.id AND worksite_id=site.id AND membership_id=(p_input->>'membershipId')::uuid;

  IF NOT FOUND THEN RAISE EXCEPTION 'assignment unavailable' USING ERRCODE='42501';END IF;

  RETURN jsonb_build_object('state','revoked');

 END IF;

 RAISE EXCEPTION 'action unavailable' USING ERRCODE='22023';

END $function$;
DO $lease$ BEGIN
 IF (SELECT remove_after FROM timeax_factory_setup_owner_lease) THEN
  EXECUTE format('REVOKE timeax_factory_setup_owner FROM %I',current_user);
 END IF;
END $lease$;
COMMIT;
