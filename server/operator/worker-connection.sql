-- Configure the new scope separately; do not grant these APIs to the browser.
BEGIN;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='timeax_worker_connection_login') THEN
  CREATE ROLE timeax_worker_connection_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA timeax_api TO timeax_worker_connection_login;

CREATE TABLE IF NOT EXISTS timeax_core.worker_email_invitations (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 agency_id uuid NOT NULL REFERENCES timeax_core.organizations(id) ON DELETE CASCADE,
 invited_by uuid NOT NULL,
 email_digest bytea NOT NULL CHECK (pg_catalog.octet_length(email_digest)=32),
 expires_at timestamptz NOT NULL,
 UNIQUE (agency_id,email_digest),
 FOREIGN KEY (agency_id,invited_by) REFERENCES timeax_core.memberships(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS worker_email_invitations_discovery ON timeax_core.worker_email_invitations(email_digest,expires_at);
ALTER TABLE timeax_core.worker_email_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.worker_email_invitations FROM PUBLIC, anon, authenticated, service_role, timeax_worker_connection_login;
ALTER TABLE timeax_core.worker_email_invitations
 ADD COLUMN IF NOT EXISTS pending_email text,
 ADD COLUMN IF NOT EXISTS first_name text,
 ADD COLUMN IF NOT EXISTS last_name text,
 ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES timeax_core.worksites(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS delivery_id uuid,
 ADD COLUMN IF NOT EXISTS delivery_language text,
 ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz,
 ADD COLUMN IF NOT EXISTS delivery_attempted_at timestamptz,
 ADD COLUMN IF NOT EXISTS delivery_submitted_at timestamptz;
CREATE TABLE IF NOT EXISTS timeax_core.worker_discoverable_agencies (
 agency_id uuid PRIMARY KEY REFERENCES timeax_core.organizations(id) ON DELETE CASCADE
);
ALTER TABLE timeax_core.worker_discoverable_agencies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.worker_discoverable_agencies FROM PUBLIC, anon, authenticated, service_role, timeax_worker_connection_login;
CREATE TABLE IF NOT EXISTS timeax_core.worker_hidden_agencies (
 agency_id uuid PRIMARY KEY REFERENCES timeax_core.organizations(id) ON DELETE CASCADE
);
ALTER TABLE timeax_core.worker_hidden_agencies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.worker_hidden_agencies FROM PUBLIC, anon, authenticated, service_role, timeax_worker_connection_login;

CREATE TABLE IF NOT EXISTS timeax_core.worker_duplicate_code_receipts(
 invitation_id uuid PRIMARY KEY REFERENCES timeax_core.agency_worker_invitations(id) ON DELETE CASCADE,
 application_id uuid NOT NULL REFERENCES timeax_core.agency_worker_applications(id) ON DELETE CASCADE
);
ALTER TABLE timeax_core.worker_duplicate_code_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.worker_duplicate_code_receipts FROM PUBLIC, anon, authenticated, service_role, timeax_worker_connection_login;

CREATE TABLE IF NOT EXISTS timeax_core.worker_email_invitation_pepper(
 singleton boolean PRIMARY KEY CHECK (singleton),
 secret text NOT NULL
);
ALTER TABLE timeax_core.worker_email_invitation_pepper ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.worker_email_invitation_pepper FROM PUBLIC, anon, authenticated, service_role, timeax_worker_connection_login;
INSERT INTO timeax_core.worker_email_invitation_pepper(singleton,secret) VALUES(true,
 pg_catalog.gen_random_uuid()::text||pg_catalog.gen_random_uuid()::text) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION timeax_api.worker_connection(p_action text,p_issuer text,p_subject text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog','pg_temp'
AS $worker_connection$
DECLARE
 v_email text;
 v_digest bytea;
 v_pepper text;
 v_agency uuid;
 v_invite uuid;
 v_actor uuid;
 v_subject uuid;
 v_nip text;
 v_enabled boolean;
 v_available boolean;
 v_verified boolean;
 v_name text;
 v_identity uuid;
 v_membership timeax_core.memberships%ROWTYPE;
 v_row timeax_core.worker_email_invitations%ROWTYPE;
 v_bearer timeax_core.agency_worker_invitations%ROWTYPE;
 v_receipt uuid;
 v_application timeax_core.agency_worker_applications%ROWTYPE;
 v_first text;
 v_last text;
 v_site uuid;
 v_first_membership boolean;
 v_time timestamptz := pg_catalog.clock_timestamp();
BEGIN
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN
  RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
 END IF;

 IF p_action IN ('admit','provision','create-card') THEN
  v_email:=p_data->>'email';
  IF v_email IS NULL OR length(v_email)>254 OR v_email<>lower(btrim(v_email))
   OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
   RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  SELECT secret INTO STRICT v_pepper FROM timeax_core.worker_email_invitation_pepper WHERE singleton;
  v_digest:=pg_catalog.sha256(pg_catalog.convert_to(v_pepper||':'||v_email,'UTF8'));
 END IF;
 IF p_action='admit' THEN
  IF p_issuer IS NOT NULL OR p_subject IS NOT NULL THEN
   RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('pending',EXISTS (
   SELECT 1 FROM timeax_core.worker_email_invitations w
   JOIN timeax_core.organizations o ON o.id=w.agency_id
   JOIN timeax_core.memberships m ON m.id=w.invited_by AND m.organization_id=o.id
   JOIN timeax_core.identities i ON i.id=m.identity_id
   JOIN timeax_core.identity_issuers iss ON iss.issuer=i.issuer
   WHERE w.email_digest=v_digest AND w.expires_at>v_time AND o.kind='agency' AND o.state='active'
    AND m.role='agency_admin' AND m.state='active' AND i.active AND iss.active
  ));
 END IF;

 IF p_issuer IS DISTINCT FROM 'https://rohgpgogsdtiltbocdao.supabase.co/auth/v1'
  OR p_subject IS NULL OR p_subject !~ '^[0-9a-f-]{36}$' THEN
  RAISE EXCEPTION 'worker session unavailable' USING ERRCODE='42501';
 END IF;
 v_subject:=p_subject::uuid;
 -- The managed postgres role cannot execute private helpers owned by the
 -- legacy NIP role. Keep the same active-principal check in this definer.
 PERFORM 1 FROM timeax_core.identity_issuers WHERE issuer=p_issuer AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'worker session unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM timeax_core.identities WHERE issuer=p_issuer AND subject=p_subject FOR SHARE;
 IF EXISTS(SELECT 1 FROM timeax_core.identities WHERE issuer=p_issuer AND subject=p_subject AND NOT active) THEN
  RAISE EXCEPTION 'worker session unavailable' USING ERRCODE='42501';
 END IF;
 IF p_action IN ('directory-request','claim-code','accept')
  AND NOT coalesce(timeax_core.worker_terms_current(p_issuer,p_subject),false) THEN
  RAISE EXCEPTION 'worker terms required' USING ERRCODE='42501';
 END IF;

 IF p_action IN ('provision','create-card','list-cards','reserve-mail','complete-mail','directory-settings','directory-toggle') THEN
  v_agency:=(p_data->>'agencyId')::uuid;
  IF p_action IN ('provision','create-card') THEN
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('timeax-worker-provision:'||v_agency::text,0));
  END IF;
  v_actor:=timeax_core.lock_active_agency_admin(p_issuer,p_subject,v_agency);
  IF p_action='list-cards' THEN
   RETURN jsonb_build_object('cards',coalesce((SELECT jsonb_agg(jsonb_build_object('id',w.id,'email',w.pending_email,
    'firstName',w.first_name,'lastName',w.last_name,'worksiteId',w.worksite_id,'worksiteName',s.name,
    'submittedAt',w.delivery_submitted_at,'expiresAt',w.expires_at) ORDER BY w.first_name,w.last_name,w.id)
    FROM timeax_core.worker_email_invitations w LEFT JOIN timeax_core.worksites s ON s.id=w.worksite_id AND s.owner_organization_id=w.agency_id
    WHERE w.agency_id=v_agency AND w.pending_email IS NOT NULL AND w.expires_at>v_time),'[]'::jsonb));
  END IF;
  IF p_action IN ('reserve-mail','complete-mail') THEN
   SELECT * INTO v_row FROM timeax_core.worker_email_invitations WHERE id=(p_data->>'cardId')::uuid AND agency_id=v_agency
    AND pending_email IS NOT NULL AND expires_at>v_time FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'card unavailable' USING ERRCODE='42501'; END IF;
   IF p_action='complete-mail' THEN
    IF v_row.delivery_id IS DISTINCT FROM (p_data->>'deliveryId')::uuid THEN RAISE EXCEPTION 'card unavailable' USING ERRCODE='42501'; END IF;
    UPDATE timeax_core.worker_email_invitations SET delivery_submitted_at=coalesce(delivery_submitted_at,v_time) WHERE id=v_row.id;
    RETURN jsonb_build_object('state','submitted');
   END IF;
   IF v_row.delivery_submitted_at IS NOT NULL THEN RETURN jsonb_build_object('state','submitted'); END IF;
   IF v_row.delivery_started_at<v_time-interval '20 hours' THEN RETURN jsonb_build_object('state','uncertain'); END IF;
   IF v_row.delivery_attempted_at>v_time-interval '2 minutes' THEN RETURN jsonb_build_object('state','cooldown'); END IF;
   UPDATE timeax_core.worker_email_invitations SET delivery_id=coalesce(delivery_id,pg_catalog.gen_random_uuid()),
    delivery_started_at=coalesce(delivery_started_at,v_time),delivery_attempted_at=v_time,
    delivery_language=coalesce(delivery_language,CASE WHEN p_data->>'language' IN ('pl','uk','ru','en') THEN p_data->>'language' ELSE 'pl' END)
    WHERE id=v_row.id RETURNING * INTO v_row;
   RETURN jsonb_build_object('state','reserved','email',v_row.pending_email,'deliveryId',v_row.delivery_id,'language',v_row.delivery_language);
  END IF;
  IF p_action IN ('provision','create-card') THEN
   -- No lookup of auth.users: the same response for existing and new personal accounts.
   -- Agency lock serializes budget checks. Expired address digests are not reused.
   DELETE FROM timeax_core.worker_email_invitations WHERE agency_id=v_agency AND expires_at<=v_time;
   IF (SELECT count(*) FROM timeax_core.worker_email_invitations WHERE agency_id=v_agency)>=250
    AND NOT EXISTS(SELECT 1 FROM timeax_core.worker_email_invitations WHERE agency_id=v_agency AND email_digest=v_digest) THEN
    RAISE EXCEPTION 'invitation capacity reached' USING ERRCODE='22023';
   END IF;
   IF p_action='create-card' THEN
    v_first:=btrim(p_data->>'firstName'); v_last:=btrim(p_data->>'lastName'); v_site:=(p_data->>'worksiteId')::uuid;
    IF v_first IS NULL OR v_last IS NULL OR length(v_first) NOT BETWEEN 1 AND 59 OR length(v_last) NOT BETWEEN 1 AND 60
     OR v_first ~ '[[:cntrl:]@]' OR v_last ~ '[[:cntrl:]@]' OR (v_first||v_last) ~ '[‪-‮⁦-⁩]' THEN RAISE EXCEPTION 'invalid name' USING ERRCODE='22023'; END IF;
    IF v_site IS NOT NULL THEN
     PERFORM 1 FROM timeax_core.worksites WHERE id=v_site AND owner_organization_id=v_agency AND active FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'worksite unavailable' USING ERRCODE='42501'; END IF;
    END IF;
    INSERT INTO timeax_core.worker_email_invitations(agency_id,invited_by,email_digest,expires_at,pending_email,first_name,last_name,worksite_id)
     VALUES(v_agency,v_actor,v_digest,v_time+interval '30 days',v_email,v_first,v_last,v_site)
     ON CONFLICT(agency_id,email_digest) DO UPDATE SET pending_email=excluded.pending_email,first_name=excluded.first_name,
      last_name=excluded.last_name,worksite_id=excluded.worksite_id,invited_by=excluded.invited_by,expires_at=excluded.expires_at
      WHERE worker_email_invitations.pending_email IS NULL RETURNING * INTO v_row;
    IF NOT FOUND THEN SELECT * INTO STRICT v_row FROM timeax_core.worker_email_invitations WHERE agency_id=v_agency AND email_digest=v_digest; END IF;
    RETURN jsonb_build_object('state','prepared','cardId',v_row.id);
   END IF;
   INSERT INTO timeax_core.worker_email_invitations(agency_id,invited_by,email_digest,expires_at)
    VALUES(v_agency,v_actor,v_digest,v_time+interval '7 days')
    ON CONFLICT(agency_id,email_digest) DO UPDATE
      SET expires_at=greatest(worker_email_invitations.expires_at,excluded.expires_at),invited_by=excluded.invited_by
      WHERE worker_email_invitations.pending_email IS NULL;
   RETURN jsonb_build_object('state','prepared');
  END IF;
  SELECT nip_claim INTO v_nip FROM timeax_core.self_service_agencies WHERE organization_id=v_agency;
  SELECT EXISTS(SELECT 1 FROM timeax_core.agency_verified_nips n WHERE n.agency_id=v_agency AND n.active) INTO v_verified;
  IF v_verified THEN SELECT nip INTO v_nip FROM timeax_core.agency_verified_nips WHERE agency_id=v_agency AND active ORDER BY nip LIMIT 1; END IF;
  v_available:=v_nip IS NOT NULL;
  IF p_action='directory-toggle' THEN
   IF jsonb_typeof(p_data->'enabled') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
   END IF;
   IF NOT v_available THEN RAISE EXCEPTION 'directory not applicable' USING ERRCODE='22023'; END IF;
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('timeax-worker-nip:'||v_nip,0));
   IF (p_data->>'enabled')::boolean THEN
    DELETE FROM timeax_core.worker_hidden_agencies WHERE agency_id=v_agency;
   ELSE
    INSERT INTO timeax_core.worker_hidden_agencies(agency_id) VALUES(v_agency) ON CONFLICT DO NOTHING;
   END IF;
  END IF;
  SELECT NOT EXISTS(SELECT 1 FROM timeax_core.worker_hidden_agencies WHERE agency_id=v_agency) INTO v_enabled;
  RETURN jsonb_build_object('enabled',v_enabled,'available',v_available,'verified',v_verified);
 END IF;

 IF p_action IN ('directory-lookup','directory-request') THEN
  v_nip:=p_data->>'nip';
  IF v_nip IS NULL OR v_nip !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('timeax-worker-nip:'||v_nip,0));
  SELECT n.agency_id,o.name INTO v_agency,v_name
  FROM timeax_core.agency_verified_nips n JOIN timeax_core.organizations o ON o.id=n.agency_id
  WHERE n.nip=v_nip AND n.active AND o.kind='agency' AND o.state='active' FOR SHARE OF n,o;
  v_verified:=FOUND;
  IF NOT v_verified THEN
   SELECT case when count(*)=1 then (array_agg(o.id))[1] end,case when count(*)=1 then max(o.name) end
   INTO v_agency,v_name FROM timeax_core.self_service_agencies s
   JOIN timeax_core.organizations o ON o.id=s.organization_id AND o.kind='agency' AND o.state='active'
   WHERE s.nip_claim=v_nip;
  END IF;
  IF EXISTS(SELECT 1 FROM timeax_core.worker_hidden_agencies WHERE agency_id=v_agency) THEN v_agency:=NULL; END IF;
  IF p_action='directory-lookup' THEN
   RETURN jsonb_build_object('agency',CASE WHEN v_agency IS NOT NULL THEN jsonb_build_object(
     'agency_id',v_agency,'name',v_name,'nip',v_nip,'verified',v_verified) END);
  END IF;
  IF v_agency IS NULL OR v_agency IS DISTINCT FROM (p_data->>'agencyId')::uuid THEN
   RAISE EXCEPTION 'agency unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM id FROM timeax_core.organizations WHERE id=v_agency AND kind='agency' AND state='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agency unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_application FROM timeax_core.agency_worker_applications WHERE agency_id=v_agency AND issuer=p_issuer AND subject=p_subject;
  IF v_application.id IS NULL AND EXISTS(
   SELECT 1 FROM timeax_core.memberships m JOIN timeax_core.identities i ON i.id=m.identity_id
   WHERE m.organization_id=v_agency AND (i.issuer,i.subject)=(p_issuer,p_subject)
  ) THEN RAISE EXCEPTION 'agency unavailable' USING ERRCODE='42501'; END IF;
  IF v_application.id IS NULL THEN
   INSERT INTO timeax_core.agency_worker_applications(agency_id,issuer,subject,claimed_at,source_kind)
    VALUES(v_agency,p_issuer,p_subject,v_time,'nip') ON CONFLICT(agency_id,issuer,subject) DO NOTHING;
   SELECT * INTO v_application FROM timeax_core.agency_worker_applications WHERE agency_id=v_agency AND issuer=p_issuer AND subject=p_subject;
  END IF;
  RETURN jsonb_build_object('application',jsonb_build_object('application_id',v_application.id,
    'status',CASE WHEN v_application.approved_at IS NULL THEN 'pending' ELSE 'approved' END,'claimed_at',v_application.claimed_at));
 END IF;

 IF p_action='claim-code' THEN
  IF (p_data->>'code') IS NULL OR (p_data->>'code') !~ '^[0-9a-f]{64}$' THEN
   RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  SELECT b.* INTO v_bearer FROM timeax_core.agency_worker_invitations b
   WHERE b.code_digest=pg_catalog.sha256(pg_catalog.convert_to(p_data->>'code','UTF8')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501'; END IF;
  SELECT application_id INTO v_receipt FROM timeax_core.worker_duplicate_code_receipts WHERE invitation_id=v_bearer.id;
  IF v_receipt IS NOT NULL THEN
   SELECT * INTO v_application FROM timeax_core.agency_worker_applications
   WHERE id=v_receipt AND agency_id=v_bearer.agency_id AND (issuer,subject)=(p_issuer,p_subject);
   IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501'; END IF;
  ELSIF v_time>=v_bearer.issued_at AND v_time<v_bearer.expires_at
   AND NOT EXISTS(SELECT 1 FROM timeax_core.agency_worker_applications WHERE invitation_id=v_bearer.id) THEN
   PERFORM 1 FROM timeax_core.organizations o JOIN timeax_core.memberships m ON m.organization_id=o.id AND m.id=v_bearer.issued_by_membership_id
    JOIN timeax_core.identities i ON i.id=m.identity_id JOIN timeax_core.identity_issuers iss ON iss.issuer=i.issuer
    WHERE o.id=v_bearer.agency_id AND o.kind='agency' AND o.state='active' AND m.role='agency_admin' AND m.state='active'
     AND i.active AND iss.active FOR SHARE OF o,m,i,iss;
   IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501'; END IF;
   SELECT * INTO v_application FROM timeax_core.agency_worker_applications
   WHERE agency_id=v_bearer.agency_id AND (issuer,subject)=(p_issuer,p_subject) FOR SHARE;
   IF FOUND THEN
    INSERT INTO timeax_core.worker_duplicate_code_receipts(invitation_id,application_id) VALUES(v_bearer.id,v_application.id);
   END IF;
  END IF;
  IF v_application.id IS NULL THEN
   RETURN jsonb_build_object('application',(SELECT to_jsonb(c) FROM timeax_api.claim_agency_worker_invite(p_issuer,p_subject,p_data->>'code') c));
  END IF;
  RETURN jsonb_build_object('application',jsonb_build_object('application_id',v_application.id,
    'status',CASE WHEN v_application.approved_at IS NULL THEN 'pending' ELSE 'approved' END));
 END IF;

 IF p_action NOT IN ('list','accept') THEN RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
 -- Caller cannot propose an email or attach another identity. Read the current verified provider address.
 SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u
 WHERE u.id=v_subject AND u.email_confirmed_at IS NOT NULL AND NOT u.is_anonymous AND u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until<=v_time) FOR SHARE;
 IF v_email IS NULL THEN RAISE EXCEPTION 'worker session unavailable' USING ERRCODE='42501'; END IF;
 SELECT secret INTO STRICT v_pepper FROM timeax_core.worker_email_invitation_pepper WHERE singleton;
 v_digest:=pg_catalog.sha256(pg_catalog.convert_to(v_pepper||':'||v_email,'UTF8'));
 IF p_action='list' THEN
  RETURN jsonb_build_object('invitations',coalesce((
   SELECT jsonb_agg(i ORDER BY expires_at,id) FROM (
    SELECT w.id,o.id AS "organizationId",o.name AS name,w.expires_at
    FROM timeax_core.worker_email_invitations w JOIN timeax_core.organizations o ON o.id=w.agency_id
    JOIN timeax_core.memberships m ON m.id=w.invited_by AND m.organization_id=o.id
    JOIN timeax_core.identities issuer ON issuer.id=m.identity_id
    JOIN timeax_core.identity_issuers iss ON iss.issuer=issuer.issuer
    WHERE w.email_digest=v_digest AND w.expires_at>v_time AND o.kind='agency' AND o.state='active'
     AND m.role='agency_admin' AND m.state='active' AND issuer.active AND iss.active
     AND NOT EXISTS(SELECT 1 FROM timeax_core.memberships x JOIN timeax_core.identities xi ON xi.id=x.identity_id
      WHERE x.organization_id=o.id AND (xi.issuer,xi.subject)=(p_issuer,p_subject)
       AND (x.role<>'worker' OR x.state<>'active'))
    ORDER BY w.expires_at,w.id LIMIT 100
   ) i
  ),'[]'::jsonb));
 END IF;
 v_invite:=(p_data->>'invitationId')::uuid;
 SELECT w.* INTO v_row FROM timeax_core.worker_email_invitations w
 WHERE w.id=v_invite AND w.email_digest=v_digest AND w.expires_at>v_time FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM timeax_core.organizations o JOIN timeax_core.memberships m ON m.id=v_row.invited_by AND m.organization_id=o.id
   JOIN timeax_core.identities i ON i.id=m.identity_id JOIN timeax_core.identity_issuers iss ON iss.issuer=i.issuer
   WHERE o.id=v_row.agency_id AND o.kind='agency' AND o.state='active' AND m.role='agency_admin' AND m.state='active'
    AND i.active AND iss.active FOR SHARE OF o,m,i,iss;
 IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO timeax_core.identities(issuer,subject) VALUES(p_issuer,p_subject) ON CONFLICT(issuer,subject) DO NOTHING;
 SELECT id INTO v_identity FROM timeax_core.identities WHERE issuer=p_issuer AND subject=p_subject AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO timeax_core.memberships(organization_id,organization_kind,identity_id,role)
 VALUES(v_row.agency_id,'agency',v_identity,'worker') ON CONFLICT(organization_id,identity_id) DO NOTHING RETURNING * INTO v_membership;
 v_first_membership:=FOUND;
 SELECT * INTO v_membership FROM timeax_core.memberships WHERE organization_id=v_row.agency_id AND identity_id=v_identity FOR SHARE;
 IF v_membership.role IS DISTINCT FROM 'worker' OR v_membership.state IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION 'invitation unavailable' USING ERRCODE='42501';
 END IF;
 IF v_first_membership AND v_row.first_name IS NOT NULL THEN
  UPDATE timeax_core.member_display_names SET display_name=v_row.first_name||' '||v_row.last_name,
   revision=revision+1,checked_by=v_row.invited_by,checked_at=v_time
   WHERE organization_id=v_row.agency_id AND membership_id=v_membership.id AND display_name IS NULL;
  IF v_row.worksite_id IS NOT NULL THEN
   PERFORM 1 FROM timeax_core.worksites WHERE id=v_row.worksite_id AND owner_organization_id=v_row.agency_id AND active FOR SHARE;
   IF FOUND THEN
    INSERT INTO timeax_core.worksite_membership_grants(organization_id,worksite_id,membership_id,valid_from,state)
     VALUES(v_row.agency_id,v_row.worksite_id,v_membership.id,v_time,'active') ON CONFLICT DO NOTHING;
   END IF;
  END IF;
 END IF;
 UPDATE timeax_core.agency_worker_applications a SET approved_at=v_time,
   approved_by_membership_id=v_row.invited_by,worker_membership_id=v_membership.id
 WHERE a.agency_id=v_row.agency_id AND (a.issuer,a.subject)=(p_issuer,p_subject) AND a.approved_at IS NULL;
 DELETE FROM timeax_core.worker_email_invitations WHERE id=v_invite;
 RETURN jsonb_build_object('state','connected','organizationId',v_row.agency_id);
END
$worker_connection$;
ALTER FUNCTION timeax_api.worker_connection(text,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_api.worker_connection(text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role, timeax_worker_enrollment_login;
GRANT EXECUTE ON FUNCTION timeax_api.worker_connection(text,text,text,jsonb) TO timeax_worker_connection_login;
COMMIT;
