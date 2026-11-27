-- Preserve existing profile RPC signature and dedicated lane ACL; repin the definition after migration.
BEGIN;
CREATE TABLE IF NOT EXISTS timeax_core.agency_contact_settings (
 organization_id uuid PRIMARY KEY REFERENCES timeax_core.organizations(id) ON DELETE CASCADE,
 address text NOT NULL DEFAULT '' CHECK (length(address)<=240),
 contact_email text NOT NULL DEFAULT '' CHECK (length(contact_email)<=254)
);
CREATE TABLE IF NOT EXISTS timeax_core.agency_worksite_preferences (
 organization_id uuid NOT NULL REFERENCES timeax_core.organizations(id) ON DELETE CASCADE,
 worksite_id uuid NOT NULL REFERENCES timeax_core.worksites(id) ON DELETE CASCADE,
 alias text NOT NULL DEFAULT '' CHECK (length(alias)<=120),
 address text NOT NULL DEFAULT '' CHECK (length(address)<=240),
 description text NOT NULL DEFAULT '' CHECK (length(description)<=1500),
 PRIMARY KEY(organization_id, worksite_id)
);
-- This stores the agency's proposed mode only. It is not read by timekeeping
-- to allow or deny a write. Existing permissions are unchanged.
ALTER TABLE timeax_core.agency_worksite_preferences ADD COLUMN IF NOT EXISTS planned_time_mode text
 CHECK (planned_time_mode IN ('nfc_terminal','nfc_stationary','leader','manual'));
ALTER TABLE timeax_core.agency_contact_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_core.agency_worksite_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE timeax_core.agency_contact_settings,timeax_core.agency_worksite_preferences FROM PUBLIC,anon,authenticated,service_role,timeax_agency_profile_login;
CREATE OR REPLACE FUNCTION timeax_api.agency_profile(p_issuer text,p_subject text,p_org uuid,p_name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE result jsonb; cmd jsonb; action text; name_value text; address_value text; contact_value text;
 description_value text; site_id uuid; site_owner uuid; site_name text; connected boolean; planned_mode text;
BEGIN
 IF session_user<>'timeax_agency_profile_login'
   OR p_issuer IS DISTINCT FROM 'https://rohgpgogsdtiltbocdao.supabase.co/auth/v1'
 THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;
 IF p_name IS NOT NULL THEN
  IF octet_length(p_name)>8192 THEN RAISE EXCEPTION 'invalid settings request' USING ERRCODE='22023'; END IF;
  cmd:=p_name::jsonb;
  action:=cmd->>'action';
  IF jsonb_typeof(cmd)<>'object' OR action IS NULL OR action NOT IN ('save-profile','save-name','get-site','save-site','save-site-time-plan')
  THEN RAISE EXCEPTION 'invalid settings request' USING ERRCODE='22023'; END IF;
 END IF;
 IF action IN ('save-name','save-profile') THEN
  PERFORM 1 FROM timeax_core.organizations WHERE id=p_org AND kind='agency' AND state='active' FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM 1 FROM timeax_core.identities i JOIN timeax_core.identity_issuers u ON u.issuer=i.issuer AND u.active
  JOIN timeax_core.memberships m ON m.identity_id=i.id
  JOIN timeax_core.organizations o ON o.id=m.organization_id
 WHERE i.issuer=p_issuer AND i.subject=p_subject AND i.active AND o.id=p_org AND o.kind='agency'
   AND o.state='active' AND m.role='agency_admin' AND m.state='active'
 FOR SHARE OF i,u,m,o;
 IF NOT FOUND THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;

 IF action IN ('get-site','save-site','save-site-time-plan') THEN
  site_id:=(cmd->>'worksiteId')::uuid;
  IF action='save-site' THEN
   SELECT w.owner_organization_id,w.name INTO site_owner,site_name FROM timeax_core.worksites w
    JOIN timeax_core.organizations o ON o.id=w.owner_organization_id
    WHERE w.id=site_id AND w.active AND o.state='active' AND (w.owner_organization_id=p_org OR o.kind='factory')
    FOR NO KEY UPDATE OF w;
  ELSE
   SELECT w.owner_organization_id,w.name INTO site_owner,site_name FROM timeax_core.worksites w
    JOIN timeax_core.organizations o ON o.id=w.owner_organization_id
    WHERE w.id=site_id AND w.active AND o.state='active' AND (w.owner_organization_id=p_org OR o.kind='factory');
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'worksite denied' USING ERRCODE='42501'; END IF;
  connected:=site_owner<>p_org;
  IF connected THEN
   -- Both records are per (worksite, agency). Never accept an agency's grant
   -- based on another agency's connection or similarly named factory/folder.
   PERFORM 1 FROM timeax_core.factory_connection_requests c
    JOIN timeax_core.worksite_organization_grants g ON g.worksite_id=c.worksite_id AND g.organization_id=c.agency_id
   WHERE c.worksite_id=site_id AND c.factory_id=site_owner AND c.agency_id=p_org AND c.state='active'
     AND g.owner_organization_id=site_owner AND g.state='active'
   FOR SHARE OF c,g;
   IF NOT FOUND THEN RAISE EXCEPTION 'worksite denied' USING ERRCODE='42501'; END IF;
  END IF;
  IF action='save-site' THEN
   name_value:=btrim(cmd->>'name');address_value:=btrim(cmd->>'address');description_value:=btrim(cmd->>'description');
   IF name_value IS NULL OR length(name_value)>120 OR (NOT connected AND name_value='')
    OR address_value IS NULL OR length(address_value)>240 OR description_value IS NULL OR length(description_value)>1500
    OR (name_value||address_value||replace(description_value,chr(10),'')) ~ '[[:cntrl:]]'
   THEN RAISE EXCEPTION 'invalid worksite details' USING ERRCODE='22023'; END IF;
   IF NOT connected THEN
    UPDATE timeax_core.worksites SET name=name_value WHERE id=site_id AND owner_organization_id=p_org AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'worksite denied' USING ERRCODE='42501'; END IF;
    site_name:=name_value;
   END IF;
   INSERT INTO timeax_core.agency_worksite_preferences(organization_id,worksite_id,alias,address,description)
    VALUES(p_org,site_id,CASE WHEN connected THEN name_value ELSE '' END,address_value,description_value)
    ON CONFLICT(organization_id,worksite_id) DO UPDATE SET alias=excluded.alias,address=excluded.address,description=excluded.description;
  ELSIF action='save-site-time-plan' THEN
   planned_mode:=cmd->>'plannedTimeMode';
   IF NOT (cmd ? 'plannedTimeMode') OR jsonb_typeof(cmd->'plannedTimeMode') NOT IN ('null','string')
     OR (planned_mode IS NOT NULL AND planned_mode NOT IN ('nfc_terminal','nfc_stationary','leader','manual'))
   THEN RAISE EXCEPTION 'invalid time entry plan' USING ERRCODE='22023'; END IF;
   INSERT INTO timeax_core.agency_worksite_preferences(organization_id,worksite_id,planned_time_mode)
    VALUES(p_org,site_id,planned_mode)
    ON CONFLICT(organization_id,worksite_id) DO UPDATE SET planned_time_mode=excluded.planned_time_mode;
  END IF;
  RETURN jsonb_build_object('organizationId',p_org,'worksiteId',site_id,'connected',connected,'name',
   CASE WHEN connected THEN COALESCE((SELECT alias FROM timeax_core.agency_worksite_preferences WHERE organization_id=p_org AND worksite_id=site_id),'') ELSE site_name END,
   'address',COALESCE((SELECT address FROM timeax_core.agency_worksite_preferences WHERE organization_id=p_org AND worksite_id=site_id),''),
   'description',COALESCE((SELECT description FROM timeax_core.agency_worksite_preferences WHERE organization_id=p_org AND worksite_id=site_id),''),
   'plannedTimeMode',(SELECT planned_time_mode FROM timeax_core.agency_worksite_preferences WHERE organization_id=p_org AND worksite_id=site_id));
 END IF;

 IF action IN ('save-name','save-profile') THEN
  name_value:=btrim(cmd->>'name');
  IF name_value IS NULL OR length(name_value) NOT BETWEEN 2 AND 120 OR name_value ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'invalid agency name' USING ERRCODE='22023'; END IF;
  IF action='save-profile' THEN
   address_value:=btrim(cmd->>'address');contact_value:=btrim(cmd->>'contactEmail');
   IF address_value IS NULL OR length(address_value)>240 OR contact_value IS NULL OR length(contact_value)>254
    OR (address_value||contact_value) ~ '[[:cntrl:]]'
    OR (contact_value<>'' AND contact_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
   THEN RAISE EXCEPTION 'invalid agency contacts' USING ERRCODE='22023'; END IF;
   INSERT INTO timeax_core.agency_contact_settings(organization_id,address,contact_email) VALUES(p_org,address_value,contact_value)
   ON CONFLICT(organization_id) DO UPDATE SET address=excluded.address,contact_email=excluded.contact_email;
  END IF;
  UPDATE timeax_core.organizations SET name=name_value WHERE id=p_org AND state='active' AND kind='agency';
  IF NOT FOUND THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT jsonb_build_object('organizationId',o.id,'name',o.name,'nip',COALESCE(v.nip,s.nip_claim),'nipVerified',v.nip IS NOT NULL,
  'address',COALESCE(d.address,''),'contactEmail',COALESCE(d.contact_email,''))
 INTO result
 FROM timeax_core.organizations o
 LEFT JOIN LATERAL (SELECT nip FROM timeax_core.agency_verified_nips WHERE agency_id=o.id AND active ORDER BY verified_at DESC LIMIT 1) v ON true
 LEFT JOIN timeax_core.self_service_agencies s ON s.organization_id=o.id
 LEFT JOIN timeax_core.agency_contact_settings d ON d.organization_id=o.id
 WHERE o.id=p_org AND o.kind='agency' AND o.state='active';
 IF result IS NULL THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION timeax_api.agency_profile(text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
