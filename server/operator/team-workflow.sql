-- ADDITIVE LOCAL CANDIDATE. Apply only after reviewed canonical integrated schema.
-- No users, credentials or live messages. Both roles remain NOLOGIN.
BEGIN;
CREATE ROLE timeax_team_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE timeax_team_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 3;
GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
CREATE SCHEMA timeax_team AUTHORIZATION timeax_team_owner;
REVOKE ALL ON SCHEMA timeax_team FROM PUBLIC;
GRANT USAGE ON SCHEMA timeax_core,timeax_api TO timeax_team_owner;
GRANT CREATE ON SCHEMA timeax_api TO timeax_team_owner;
GRANT SELECT ON timeax_core.identities,timeax_core.identity_issuers,timeax_core.organizations,timeax_core.memberships,timeax_core.worksites,timeax_core.worksite_membership_grants,timeax_core.worksite_organization_grants,timeax_core.factory_worker_placements TO timeax_team_owner;
GRANT REFERENCES ON timeax_core.memberships,timeax_core.identities,timeax_core.organizations,timeax_core.worksites TO timeax_team_owner;
GRANT INSERT,UPDATE ON timeax_core.memberships TO timeax_team_owner;
CREATE POLICY team_identity_read ON timeax_core.identities FOR SELECT TO timeax_team_owner USING(true);
CREATE POLICY team_issuer_read ON timeax_core.identity_issuers FOR SELECT TO timeax_team_owner USING(true);
CREATE POLICY team_org_read ON timeax_core.organizations FOR SELECT TO timeax_team_owner USING(true);
CREATE POLICY team_member_read ON timeax_core.memberships FOR SELECT TO timeax_team_owner USING(true);
CREATE POLICY team_member_insert ON timeax_core.memberships FOR INSERT TO timeax_team_owner WITH CHECK(role='accountant' AND organization_kind='agency');
CREATE POLICY team_member_update ON timeax_core.memberships FOR UPDATE TO timeax_team_owner USING(role='accountant') WITH CHECK(role='accountant' AND organization_kind='agency' AND state='revoked');
CREATE POLICY team_site_read ON timeax_core.worksites FOR SELECT TO timeax_team_owner USING(true);
CREATE POLICY team_assignment_read ON timeax_core.worksite_membership_grants FOR SELECT TO timeax_team_owner USING(true);
CREATE POLICY team_placement_read ON timeax_core.factory_worker_placements FOR SELECT TO timeax_team_owner USING(true);
CREATE POLICY team_link_read ON timeax_core.worksite_organization_grants FOR SELECT TO timeax_team_owner USING(true);

SET LOCAL ROLE timeax_team_owner;
CREATE TABLE timeax_team.entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender uuid NOT NULL REFERENCES timeax_core.memberships,
 kind text NOT NULL CHECK(kind IN ('message','absence','schedule')), site_id uuid REFERENCES timeax_core.worksites,
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','cancelled')),
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE timeax_team.deliveries(
 entry_id uuid NOT NULL REFERENCES timeax_team.entries, recipient uuid NOT NULL REFERENCES timeax_core.memberships,
 read_at timestamptz, PRIMARY KEY(entry_id,recipient)
);
CREATE INDEX deliveries_recipient ON timeax_team.deliveries(recipient,read_at);
CREATE TABLE timeax_team.templates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_id uuid NOT NULL REFERENCES timeax_core.identities,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80), data jsonb NOT NULL, revision integer NOT NULL DEFAULT 1
);
CREATE TABLE timeax_team.accountant_invitations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES timeax_core.organizations,
 issuer_identity uuid NOT NULL REFERENCES timeax_core.identities, recipient_email text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 accepted_identity uuid REFERENCES timeax_core.identities, membership_id uuid REFERENCES timeax_core.memberships,
 accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE timeax_team.events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid NOT NULL REFERENCES timeax_core.identities,
 operation_id uuid NOT NULL, action text NOT NULL, input jsonb NOT NULL, result jsonb NOT NULL,
 before_value jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(actor,operation_id)
);
ALTER TABLE timeax_team.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_team.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_team.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_team.accountant_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_team.events ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION timeax_team.assigned(p_member uuid,p_site uuid,p_at timestamptz DEFAULT clock_timestamp(),p_end timestamptz DEFAULT clock_timestamp())
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id
 JOIN timeax_core.identity_issuers ii ON ii.issuer=i.issuer JOIN timeax_core.organizations o ON o.id=m.organization_id
 JOIN timeax_core.worksite_membership_grants g ON g.membership_id=m.id AND g.organization_id=m.organization_id
 JOIN timeax_core.worksites w ON w.id=g.worksite_id JOIN timeax_core.organizations wo ON wo.id=w.owner_organization_id
 WHERE m.id=p_member AND g.worksite_id=p_site AND m.state='active' AND i.active AND ii.active AND o.state='active' AND wo.state='active' AND w.active
 AND g.state='active' AND g.valid_from<=p_at AND (g.valid_until IS NULL OR g.valid_until>=p_end)
 AND (m.role<>'worker' OR w.owner_organization_id=m.organization_id OR EXISTS(SELECT 1 FROM timeax_core.factory_worker_placements fp WHERE fp.membership_id=m.id AND fp.agency_id=m.organization_id AND fp.worksite_id=w.id AND fp.state='approved' AND fp.starts_at<=p_at))
 AND (w.owner_organization_id=m.organization_id OR EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants c
 WHERE c.worksite_id=w.id AND c.organization_id=m.organization_id AND c.state='active')));
$$;
CREATE FUNCTION timeax_team.can_contact(p_sender uuid,p_target uuid,p_site uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM timeax_core.memberships a JOIN timeax_core.identities ai ON ai.id=a.identity_id
 JOIN timeax_core.identity_issuers ais ON ais.issuer=ai.issuer JOIN timeax_core.organizations ao ON ao.id=a.organization_id,
 timeax_core.memberships b JOIN timeax_core.identities bi ON bi.id=b.identity_id
 JOIN timeax_core.identity_issuers bis ON bis.issuer=bi.issuer JOIN timeax_core.organizations bo ON bo.id=b.organization_id
 WHERE a.id=p_sender AND b.id=p_target AND a.id<>b.id AND a.state='active' AND b.state='active' AND ai.active AND bi.active
 AND ais.active AND bis.active AND ao.state='active' AND bo.state='active' AND (
 (a.organization_id=b.organization_id AND ((a.role='agency_admin' AND b.role='worker') OR (a.role='worker' AND b.role='agency_admin')))
 OR (p_site IS NOT NULL AND (
  (a.role='worker' AND b.role='team_leader' AND timeax_team.assigned(a.id,p_site) AND timeax_team.assigned(b.id,p_site))
  OR (a.role='team_leader' AND b.role='worker' AND timeax_team.assigned(a.id,p_site) AND timeax_team.assigned(b.id,p_site))
  OR (a.role='agency_admin' AND b.role='team_leader' AND timeax_team.assigned(b.id,p_site) AND EXISTS(
    SELECT 1 FROM timeax_core.worksite_organization_grants c WHERE c.worksite_id=p_site AND c.organization_id=a.organization_id AND c.state='active'))
  OR (a.role='team_leader' AND b.role='agency_admin' AND timeax_team.assigned(a.id,p_site) AND EXISTS(
    SELECT 1 FROM timeax_core.worksite_organization_grants c WHERE c.worksite_id=p_site AND c.organization_id=b.organization_id AND c.state='active'))
 ))));
$$;

CREATE FUNCTION timeax_api.team_workflow(p_issuer text,p_subject text,p_action text,p_input jsonb,p_verified jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE v_actor uuid; m timeax_core.memberships; target timeax_core.memberships; entry timeax_team.entries;
 inv timeax_team.accountant_invitations; templ timeax_team.templates; previous timeax_team.events;
 org uuid; site uuid; op uuid; targets uuid[]; tid uuid; result jsonb; before_value jsonb; payload jsonb;
 firstday date; lastday date; starts timestamptz; ends timestamptz; normalized text;
BEGIN
 IF session_user<>'timeax_team_login' THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 SELECT i.id INTO v_actor FROM timeax_core.identities i JOIN timeax_core.identity_issuers s ON s.issuer=i.issuer
 WHERE i.issuer=p_issuer AND i.subject=p_subject AND i.active AND s.active;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501';END IF;
 IF p_action='accept-accountant' THEN
  normalized=lower(btrim(p_verified->>'email'));
  IF p_verified->'emailConfirmed' IS DISTINCT FROM 'true'::jsonb OR normalized IS NULL THEN RAISE EXCEPTION 'Verified email required' USING ERRCODE='42501';END IF;
  SELECT * INTO inv FROM timeax_team.accountant_invitations WHERE token_hash=p_input->>'tokenHash' FOR UPDATE;
  IF NOT FOUND OR inv.revoked_at IS NOT NULL OR inv.recipient_email<>normalized OR
    NOT EXISTS(SELECT 1 FROM timeax_core.organizations WHERE id=inv.organization_id AND state='active' AND kind='agency')
    OR NOT EXISTS(SELECT 1 FROM timeax_core.memberships x JOIN timeax_core.identities i ON i.id=x.identity_id
    WHERE x.identity_id=inv.issuer_identity AND x.organization_id=inv.organization_id AND x.role='agency_admin' AND x.state='active' AND i.active)
  THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';END IF;
  IF inv.accepted_identity IS NOT NULL THEN
   IF inv.accepted_identity<>v_actor OR NOT EXISTS(SELECT 1 FROM timeax_core.memberships WHERE id=inv.membership_id AND state='active')
   THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';END IF;
   RETURN jsonb_build_object('state','accepted','organizationId',inv.organization_id,'membershipId',inv.membership_id);
  END IF;
  IF inv.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM timeax_core.memberships WHERE organization_id=inv.organization_id AND identity_id=v_actor)
  THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='42501';END IF;
  INSERT INTO timeax_core.memberships(organization_id,organization_kind,identity_id,role)
   VALUES(inv.organization_id,'agency',v_actor,'accountant') RETURNING id INTO tid;
  UPDATE timeax_team.accountant_invitations SET accepted_identity=v_actor,membership_id=tid,accepted_at=clock_timestamp() WHERE id=inv.id;
  result=jsonb_build_object('state','accepted','organizationId',inv.organization_id,'membershipId',tid);
  INSERT INTO timeax_team.events(actor,operation_id,action,input,result) VALUES(v_actor,(p_input->>'operationId')::uuid,p_action,jsonb_build_object('invitationId',inv.id),result);
  RETURN result;
 END IF;
 org=(p_input->>'organizationId')::uuid;
 SELECT x.* INTO m FROM timeax_core.memberships x JOIN timeax_core.organizations o ON o.id=x.organization_id
 WHERE x.organization_id=org AND x.identity_id=v_actor AND x.state='active' AND o.state='active';
 IF NOT FOUND OR m.role NOT IN ('worker','agency_admin','team_leader','accountant') THEN RAISE EXCEPTION 'Own membership required' USING ERRCODE='42501'; END IF;
 IF p_action='context' THEN
  RETURN jsonb_build_object('organizationId',org,'membershipId',m.id,'role',m.role,
   'sites',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'canPlan',(m.role='agency_admin' AND w.owner_organization_id=org OR m.role='team_leader' AND timeax_team.assigned(m.id,w.id)))) FROM timeax_core.worksites w JOIN timeax_core.organizations o ON o.id=w.owner_organization_id
    WHERE w.active AND o.state='active' AND (timeax_team.assigned(m.id,w.id) OR m.role='agency_admin' AND (w.owner_organization_id=org OR EXISTS(
      SELECT 1 FROM timeax_core.worksite_organization_grants c WHERE c.organization_id=org AND c.worksite_id=w.id AND c.state='active')))),'[]'),
   'recipients',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'role',r.role,'organizationName',o.name,'organizationId',o.id,'worksiteIds',COALESCE((SELECT jsonb_agg(w.id) FROM timeax_core.worksites w WHERE r.role='worker' AND timeax_team.assigned(r.id,w.id) AND (w.owner_organization_id=org OR timeax_team.assigned(m.id,w.id) OR m.role='agency_admin' AND EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants g WHERE g.worksite_id=w.id AND g.organization_id=org AND g.state='active'))),'[]'))) FROM timeax_core.memberships r JOIN timeax_core.organizations o ON o.id=r.organization_id
    WHERE timeax_team.can_contact(m.id,r.id,NULL) OR EXISTS(SELECT 1 FROM timeax_core.worksites w WHERE timeax_team.can_contact(m.id,r.id,w.id))),'[]'),
   'unread',(SELECT count(*) FROM timeax_team.deliveries d JOIN timeax_team.entries e ON e.id=d.entry_id
     WHERE d.recipient=m.id AND d.read_at IS NULL AND timeax_team.can_contact(e.sender,m.id,e.site_id)),
   'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'siteId',e.site_id,'payload',e.payload,'state',e.state,
     'revision',e.revision,'createdAt',e.created_at,'sender',e.sender,'outgoing',e.sender=m.id,
     'read',d.read_at IS NOT NULL,'recipients',CASE WHEN e.sender=m.id THEN (SELECT COALESCE(jsonb_agg(z.recipient),'[]') FROM timeax_team.deliveries z WHERE z.entry_id=e.id) ELSE '[]'::jsonb END,'recipientCount',CASE WHEN e.sender=m.id THEN (SELECT count(*) FROM timeax_team.deliveries z WHERE z.entry_id=e.id) ELSE NULL END)
      ORDER BY e.created_at DESC) FROM timeax_team.entries e LEFT JOIN timeax_team.deliveries d ON d.entry_id=e.id AND d.recipient=m.id
     WHERE e.sender=m.id OR d.recipient=m.id AND timeax_team.can_contact(e.sender,m.id,e.site_id)),'[]'),
   'templates',CASE WHEN m.role='worker' THEN COALESCE((SELECT jsonb_agg(to_jsonb(t)-'identity_id' ORDER BY name,id) FROM timeax_team.templates t WHERE identity_id=v_actor),'[]') ELSE '[]' END,
   'invitations',CASE WHEN m.role='agency_admin' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'email',v.recipient_email,'expiresAt',v.expires_at,
    'state',CASE WHEN v.revoked_at IS NOT NULL THEN 'revoked' WHEN v.accepted_at IS NOT NULL THEN 'accepted' WHEN v.expires_at<=clock_timestamp() THEN 'expired' ELSE 'pending' END))
    FROM timeax_team.accountant_invitations v WHERE v.organization_id=org),'[]') ELSE '[]' END);
 END IF;
 IF p_action='read' THEN
  UPDATE timeax_team.deliveries d SET read_at=COALESCE(read_at,clock_timestamp()) FROM timeax_team.entries e
   WHERE d.entry_id=e.id AND e.id=(p_input->>'id')::uuid AND d.recipient=m.id AND timeax_team.can_contact(e.sender,m.id,e.site_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Own delivery required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('read',true);
 END IF;
 op=(p_input->>'operationId')::uuid;
 IF op IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team/'||v_actor,0));
 SELECT * INTO previous FROM timeax_team.events WHERE timeax_team.events.actor=v_actor AND operation_id=op;
 IF FOUND THEN
  IF previous.action<>p_action OR previous.input<>p_input THEN RAISE EXCEPTION 'Operation differs' USING ERRCODE='23505';END IF;
  RETURN previous.result;
 END IF;
 site=(p_input->>'siteId')::uuid;
 IF p_action IN ('message','absence','schedule','update-plan','cancel') THEN
  IF p_action IN ('update-plan','cancel') THEN
   SELECT * INTO entry FROM timeax_team.entries WHERE id=(p_input->>'id')::uuid AND sender=m.id FOR UPDATE;
   IF NOT FOUND OR entry.kind NOT IN ('absence','schedule') OR entry.state<>'active' THEN RAISE EXCEPTION 'Own open plan required' USING ERRCODE='42501';END IF;
   IF entry.revision<>(p_input->>'revision')::int THEN RAISE EXCEPTION 'Revision differs' USING ERRCODE='23505';END IF;
   before_value=to_jsonb(entry);site=entry.site_id;
   SELECT array_agg(recipient) INTO targets FROM timeax_team.deliveries WHERE entry_id=entry.id;
   IF EXISTS(SELECT 1 FROM unnest(targets) r WHERE NOT timeax_team.can_contact(m.id,r,site)) THEN RAISE EXCEPTION 'Current scope required' USING ERRCODE='42501';END IF;
   IF p_action='cancel' THEN
    UPDATE timeax_team.entries SET state='cancelled',revision=revision+1,updated_at=clock_timestamp() WHERE id=entry.id RETURNING * INTO entry;
   END IF;
  ELSE
   entry.kind=p_action;entry.sender=m.id;
   IF p_action='absence' THEN
    IF m.role<>'worker' OR m.organization_kind<>'agency' OR site IS NULL OR NOT timeax_team.assigned(m.id,site)
    THEN RAISE EXCEPTION 'Own assignment required' USING ERRCODE='42501';END IF;
    SELECT array_agg(r.id) INTO targets FROM timeax_core.memberships r WHERE (r.role='agency_admin' AND r.organization_id=org OR r.role='team_leader')
      AND timeax_team.can_contact(m.id,r.id,site);
   ELSE
    SELECT array_agg(DISTINCT value::uuid) INTO targets FROM jsonb_array_elements_text(p_input->'recipients');
   END IF;
  END IF;
  IF p_action<>'cancel' THEN
   IF cardinality(targets) IS NULL OR cardinality(targets) NOT BETWEEN 1 AND 100
    OR EXISTS(SELECT 1 FROM unnest(targets) r WHERE NOT timeax_team.can_contact(m.id,r,site))
   THEN RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='42501';END IF;
   payload=p_input->'payload';
   IF entry.kind='message' THEN
    IF length(btrim(payload->>'text')) NOT BETWEEN 1 AND 2000 OR (SELECT count(*) FROM jsonb_object_keys(payload))<>1 THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023';END IF;
   ELSIF entry.kind='absence' THEN
    IF NOT timeax_team.assigned(m.id,site) THEN RAISE EXCEPTION 'Current assignment required' USING ERRCODE='42501';END IF;
    firstday=(payload->>'dateFrom')::date;lastday=(payload->>'dateTo')::date;
    IF firstday IS NULL OR lastday IS NULL OR lastday<firstday OR lastday-firstday>90 OR (SELECT count(*) FROM jsonb_object_keys(payload))<>2
    THEN RAISE EXCEPTION 'Date range required' USING ERRCODE='22023';END IF;
   ELSE
    starts=(payload->>'startAt')::timestamptz;ends=(payload->>'endAt')::timestamptz;
    IF site IS NULL OR m.role NOT IN ('agency_admin','team_leader') OR starts IS NULL OR ends<=starts OR ends-starts>interval '24 hours'
     OR NOT EXISTS(SELECT 1 FROM timeax_core.worksites w WHERE w.id=site AND w.active AND (
       m.role='agency_admin' AND w.owner_organization_id=org OR m.role='team_leader' AND timeax_team.assigned(m.id,site)))
     OR EXISTS(SELECT 1 FROM unnest(targets) r JOIN timeax_core.memberships z ON z.id=r WHERE z.role<>'worker' OR NOT timeax_team.assigned(r,site,starts,ends))
    THEN RAISE EXCEPTION 'Planning scope required' USING ERRCODE='42501';END IF;
   END IF;
   IF p_action='update-plan' THEN
    UPDATE timeax_team.entries SET payload=p_input->'payload',revision=revision+1,updated_at=clock_timestamp() WHERE id=entry.id RETURNING * INTO entry;
   ELSE
    INSERT INTO timeax_team.entries(sender,kind,site_id,payload) VALUES(m.id,entry.kind,site,payload) RETURNING * INTO entry;
    INSERT INTO timeax_team.deliveries(entry_id,recipient) SELECT entry.id,r FROM unnest(targets) r;
   END IF;
  END IF;
  UPDATE timeax_team.deliveries SET read_at=NULL WHERE entry_id=entry.id;
  result=jsonb_build_object('id',entry.id,'revision',entry.revision,'state',entry.state);
 ELSIF p_action IN ('save-template','delete-template') THEN
  IF m.role<>'worker' THEN RAISE EXCEPTION 'Worker required' USING ERRCODE='42501';END IF;
  IF p_input->>'id' IS NOT NULL THEN
   SELECT * INTO templ FROM timeax_team.templates WHERE id=(p_input->>'id')::uuid AND identity_id=v_actor FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Own template required' USING ERRCODE='42501';END IF;
   IF templ.revision<>(p_input->>'revision')::int THEN RAISE EXCEPTION 'Revision differs' USING ERRCODE='23505';END IF;
   before_value=to_jsonb(templ);
  END IF;
  IF p_action='delete-template' THEN
   IF templ.id IS NULL THEN RAISE EXCEPTION 'Template required' USING ERRCODE='22023';END IF;
   DELETE FROM timeax_team.templates WHERE id=templ.id;result=jsonb_build_object('deleted',true);
  ELSE
   IF length(btrim(p_input->>'name')) NOT BETWEEN 1 AND 80 OR p_input->'data' IS NULL THEN RAISE EXCEPTION 'Template required' USING ERRCODE='22023';END IF;
   IF templ.id IS NULL THEN
    INSERT INTO timeax_team.templates(identity_id,name,data) VALUES(v_actor,btrim(p_input->>'name'),p_input->'data') RETURNING * INTO templ;
   ELSE
    UPDATE timeax_team.templates SET name=btrim(p_input->>'name'),data=p_input->'data',revision=revision+1 WHERE id=templ.id RETURNING * INTO templ;
   END IF;
   result=jsonb_build_object('id',templ.id,'revision',templ.revision);
  END IF;
 ELSIF p_action='invite-accountant' THEN
  IF m.role<>'agency_admin' OR m.organization_kind<>'agency' THEN RAISE EXCEPTION 'Agency required' USING ERRCODE='42501';END IF;
  normalized=lower(btrim(p_input->>'email'));
  IF normalized IS NULL OR length(normalized)>254 OR normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_input->>'tokenHash' !~ '^[a-f0-9]{64}$'
  THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM timeax_team.accountant_invitations WHERE organization_id=org AND recipient_email=normalized AND revoked_at IS NULL
    AND (accepted_at IS NOT NULL OR expires_at>clock_timestamp())) THEN RAISE EXCEPTION 'Invitation exists' USING ERRCODE='23505';END IF;
  INSERT INTO timeax_team.accountant_invitations(organization_id,issuer_identity,recipient_email,token_hash)
   VALUES(org,v_actor,normalized,p_input->>'tokenHash') RETURNING * INTO inv;
  result=jsonb_build_object('id',inv.id,'expiresAt',inv.expires_at,'state','pending');
 ELSIF p_action='revoke-accountant' THEN
  IF m.role<>'agency_admin' THEN RAISE EXCEPTION 'Agency required' USING ERRCODE='42501';END IF;
  SELECT * INTO inv FROM timeax_team.accountant_invitations WHERE id=(p_input->>'id')::uuid AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Own invitation required' USING ERRCODE='42501';END IF;
  UPDATE timeax_team.accountant_invitations SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=inv.id;
  IF inv.membership_id IS NOT NULL THEN UPDATE timeax_core.memberships SET state='revoked' WHERE id=inv.membership_id AND role='accountant' AND organization_id=org;END IF;
  result=jsonb_build_object('state','revoked');
 ELSE RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
 END IF;
 INSERT INTO timeax_team.events(actor,operation_id,action,input,result,before_value) VALUES(v_actor,op,p_action,p_input,result,before_value);
 RETURN result;
END $body$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA timeax_team FROM PUBLIC;
REVOKE ALL ON FUNCTION timeax_api.team_workflow(text,text,text,jsonb,jsonb) FROM PUBLIC;
RESET ROLE;
GRANT USAGE ON SCHEMA timeax_api TO timeax_team_login;
GRANT EXECUTE ON FUNCTION timeax_api.team_workflow(text,text,text,jsonb,jsonb) TO timeax_team_login;
REVOKE CREATE ON SCHEMA timeax_api FROM timeax_team_owner;
REVOKE timeax_team_owner FROM CURRENT_USER;
COMMIT;
