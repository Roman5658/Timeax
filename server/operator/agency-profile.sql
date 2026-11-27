BEGIN;
CREATE ROLE timeax_agency_profile_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 6;
GRANT USAGE ON SCHEMA timeax_api TO timeax_agency_profile_login;
CREATE FUNCTION timeax_api.agency_profile(p_issuer text,p_subject text,p_org uuid,p_name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE result jsonb;
BEGIN
 IF session_user<>'timeax_agency_profile_login'
   OR p_issuer IS DISTINCT FROM 'https://rohgpgogsdtiltbocdao.supabase.co/auth/v1'
 THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM timeax_core.identities i JOIN timeax_core.identity_issuers u ON u.issuer=i.issuer AND u.active
  JOIN timeax_core.memberships m ON m.identity_id=i.id
  JOIN timeax_core.organizations o ON o.id=m.organization_id
 WHERE i.issuer=p_issuer AND i.subject=p_subject AND i.active AND o.id=p_org AND o.kind='agency'
   AND o.state='active' AND m.role='agency_admin' AND m.state='active'
 FOR SHARE OF i,u,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;
 IF p_name IS NOT NULL THEN
  IF length(btrim(p_name)) NOT BETWEEN 2 AND 120 OR p_name ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'invalid agency name' USING ERRCODE='22023'; END IF;
  UPDATE timeax_core.organizations SET name=btrim(p_name) WHERE id=p_org AND state='active' AND kind='agency';
  IF NOT FOUND THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT jsonb_build_object('organizationId',o.id,'name',o.name,'nip',COALESCE(v.nip,s.nip_claim),'nipVerified',v.nip IS NOT NULL)
 INTO result
 FROM timeax_core.organizations o
 LEFT JOIN LATERAL (SELECT nip FROM timeax_core.agency_verified_nips WHERE agency_id=o.id AND active ORDER BY verified_at DESC LIMIT 1) v ON true
 LEFT JOIN timeax_core.self_service_agencies s ON s.organization_id=o.id
 WHERE o.id=p_org AND o.kind='agency' AND o.state='active';
 IF result IS NULL THEN RAISE EXCEPTION 'agency profile denied' USING ERRCODE='42501'; END IF;
 RETURN result;
END;
$body$;
REVOKE ALL ON FUNCTION timeax_api.agency_profile(text,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION timeax_api.agency_profile(text,text,uuid,text) TO timeax_agency_profile_login;
COMMIT;
