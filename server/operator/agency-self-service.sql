-- This migration is intentionally not applied by the app. The scoped login is
-- provisioned independently with a secret. Revoke before rolling back code.
BEGIN;
CREATE TABLE IF NOT EXISTS timeax_core.self_service_agencies (
  identity_id uuid PRIMARY KEY REFERENCES timeax_core.identities(id),
  organization_id uuid NOT NULL UNIQUE REFERENCES timeax_core.organizations(id),
  nip_claim text CHECK (nip_claim ~ '^[0-9]{10}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE timeax_core.self_service_agencies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE timeax_core.self_service_agencies FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION timeax_api.self_service_agency(
 p_issuer text, p_subject text, p_name text, p_nip text
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path = pg_catalog, pg_temp
 AS $fn$
DECLARE
  v_identity uuid;
  v_active boolean;
  v_org uuid;
  v_existing integer;
  v_nip_weights integer[] := ARRAY[6,5,7,2,3,4,5,6,7];
  v_check integer := 0;
  v_name text := btrim(p_name);
BEGIN
  IF session_user <> 'timeax_agency_onboarding_login'
     OR p_issuer IS DISTINCT FROM 'https://rohgpgogsdtiltbocdao.supabase.co/auth/v1'
     OR p_subject IS NULL OR p_subject !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
     OR p_subject = '00000000-0000-0000-0000-000000000000'
  THEN RAISE EXCEPTION 'onboarding denied' USING ERRCODE = '42501'; END IF;

  PERFORM 1 FROM timeax_core.identity_issuers
   WHERE issuer=p_issuer AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'onboarding denied' USING ERRCODE = '42501'; END IF;

  -- Serialize provisioning by provider identity. Serialize existing membership
  -- checks with any other path that acquires the same identity row lock.
  IF p_name IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_issuer || '/' || p_subject, 0));
  END IF;
  SELECT i.id, i.active INTO v_identity, v_active FROM timeax_core.identities i
   WHERE issuer=p_issuer AND subject=p_subject FOR UPDATE;
  IF v_identity IS NOT NULL AND NOT v_active THEN
   RAISE EXCEPTION 'onboarding denied' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), min(m.organization_id::text)::uuid INTO v_existing, v_org
  FROM timeax_core.memberships m JOIN timeax_core.organizations o ON o.id=m.organization_id
  WHERE m.identity_id=v_identity AND m.role='agency_admin' AND m.state='active'
    AND o.kind='agency' AND o.state='active';
  IF v_existing=1 THEN RETURN v_org; END IF;
  IF v_existing>1 THEN
   RAISE EXCEPTION 'workspace selection required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM timeax_core.self_service_agencies WHERE identity_id=v_identity) THEN
   RAISE EXCEPTION 'workspace unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL THEN
   IF p_nip IS NOT NULL THEN RAISE EXCEPTION 'invalid agency details' USING ERRCODE = '22023'; END IF;
   RETURN NULL;
  END IF;
  IF length(v_name) NOT BETWEEN 2 AND 120 OR v_name ~ '[[:cntrl:]]' THEN
   RAISE EXCEPTION 'invalid agency details' USING ERRCODE = '22023';
  END IF;
  IF p_nip IS NOT NULL THEN
   IF p_nip !~ '^[0-9]{10}$' OR p_nip=repeat(substr(p_nip,1,1),10) THEN
    RAISE EXCEPTION 'invalid agency details' USING ERRCODE = '22023';
   END IF;
   FOR i IN 1..9 LOOP
    v_check := v_check + v_nip_weights[i] * substr(p_nip,i,1)::integer;
   END LOOP;
   IF v_check % 11 <> substr(p_nip,10,1)::integer THEN
    RAISE EXCEPTION 'invalid agency details' USING ERRCODE = '22023';
   END IF;
  END IF;

  IF v_identity IS NULL THEN
   INSERT INTO timeax_core.identities(issuer,subject) VALUES(p_issuer,p_subject)
    ON CONFLICT(issuer,subject) DO NOTHING;
   SELECT id,active INTO v_identity,v_active FROM timeax_core.identities
    WHERE issuer=p_issuer AND subject=p_subject FOR UPDATE;
   IF NOT FOUND OR NOT v_active THEN RAISE EXCEPTION 'onboarding denied' USING ERRCODE = '42501'; END IF;
  END IF;
  -- A submitted NIP is not verified. It is recorded separately and never used
  -- to link to an existing organization or activate discoverability/billing.
  INSERT INTO timeax_core.organizations(kind,name) VALUES('agency',v_name) RETURNING id INTO v_org;
  INSERT INTO timeax_core.memberships(organization_id,organization_kind,identity_id,role)
   VALUES(v_org,'agency',v_identity,'agency_admin');
  INSERT INTO timeax_core.self_service_agencies(identity_id,organization_id,nip_claim)
   VALUES(v_identity,v_org,p_nip);
  RETURN v_org;
END;
$fn$;
ALTER FUNCTION timeax_api.self_service_agency(text,text,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION timeax_api.self_service_agency(text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
-- Grant EXECUTE and schema USAGE only to the dedicated server login, then
-- pin the observed function definition hash and enable the matching runtime.
COMMIT;
