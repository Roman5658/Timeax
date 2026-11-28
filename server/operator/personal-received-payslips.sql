-- First half of an admin reset: preserve issued payslips independently of the
-- employer. This migration copies no records until an approved reset invokes
-- the private preservation helper. It does not enable account deletion.
BEGIN;
CREATE TABLE timeax_core.personal_received_payslips (
  id uuid PRIMARY KEY,
  worker_identity_id uuid NOT NULL REFERENCES timeax_core.identities(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL,
  worker_membership_id uuid NOT NULL,
  agency_name text NOT NULL,
  issued_at timestamptz NOT NULL,
  publication jsonb NOT NULL CHECK (jsonb_typeof(publication)='object' AND (publication->>'id') IS NOT DISTINCT FROM id::text)
);
CREATE INDEX personal_received_payslips_worker ON timeax_core.personal_received_payslips(worker_identity_id,issued_at DESC,id);
ALTER TABLE timeax_core.personal_received_payslips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.personal_received_payslips FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON timeax_core.personal_received_payslips TO timeax_account_owner;
CREATE POLICY personal_received_payslips_account_read ON timeax_core.personal_received_payslips
  FOR SELECT TO timeax_account_owner USING (true);

-- The parent reset must hold its organization write lock before invoking this
-- helper and must use the same transaction for deleting employer originals.
CREATE FUNCTION timeax_core.preserve_test_agency_payslips(p_agency uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $archive$
DECLARE expected bigint; archived bigint;
BEGIN
  IF current_user <> 'postgres' OR p_agency IS NULL THEN
    RAISE EXCEPTION 'Owner reset only' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM timeax_core.organizations WHERE id=p_agency AND kind='agency' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agency required' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO expected FROM timeax_core.payroll_publications pub
    JOIN timeax_core.payroll_drafts d ON d.id=pub.id WHERE d.agency_id=p_agency;
  INSERT INTO timeax_core.personal_received_payslips(id,worker_identity_id,agency_id,worker_membership_id,agency_name,issued_at,publication)
     SELECT pub.id,m.identity_id,p_agency,m.id,(SELECT name FROM timeax_core.organizations WHERE id=p_agency),pub.issued_at,to_jsonb(pub)
     FROM timeax_core.payroll_publications pub JOIN timeax_core.payroll_drafts d ON d.id=pub.id
     JOIN timeax_core.memberships m ON m.id=d.member_id AND m.organization_id=d.agency_id AND m.role='worker'
     WHERE d.agency_id=p_agency
  ON CONFLICT (id) DO NOTHING;
  SELECT count(*) INTO archived FROM timeax_core.payroll_publications pub
     JOIN timeax_core.payroll_drafts d ON d.id=pub.id
     JOIN timeax_core.memberships m ON m.id=d.member_id AND m.organization_id=d.agency_id AND m.role='worker'
     JOIN timeax_core.personal_received_payslips saved ON saved.id=pub.id AND saved.worker_identity_id=m.identity_id
         AND saved.agency_id=p_agency AND saved.worker_membership_id=m.id AND saved.issued_at=pub.issued_at AND saved.publication=to_jsonb(pub)
     WHERE d.agency_id=p_agency;
  IF archived<>expected THEN RAISE EXCEPTION 'Not every issued payslip has a verified receipt' USING ERRCODE='23514'; END IF;
  RETURN archived;
END
$archive$;
REVOKE ALL ON FUNCTION timeax_core.preserve_test_agency_payslips(uuid) FROM PUBLIC, anon, authenticated, service_role;

DO $install$
DECLARE
  rpc constant regprocedure := 'timeax_api.account_lifecycle(text,text,text,jsonb)'::regprocedure;
  prior text := pg_get_functiondef(rpc);
  actor_oid oid := current_user::regrole;
  owner_oid oid := 'timeax_account_owner'::regrole;
  grants_before jsonb;
  grant_row record;
BEGIN
  IF encode(sha256(convert_to(prior,'UTF8')),'hex') <> '185ca20355303ae01801381d4e5a41e255991120625bf92debf17050e293326f'
     OR (SELECT proowner FROM pg_proc WHERE oid=rpc)<>owner_oid THEN
    RAISE EXCEPTION 'Personal account definition changed; review before installing archive';
  END IF;
  SELECT coalesce(jsonb_object_agg(grantor::text,to_jsonb(g)),'{}'::jsonb) INTO grants_before
    FROM pg_auth_members g WHERE roleid=owner_oid AND member=actor_oid;
  IF NOT pg_has_role(actor_oid,owner_oid,'USAGE') THEN
    GRANT timeax_account_owner TO CURRENT_USER WITH INHERIT TRUE;
  END IF;
  prior:=replace(prior,$before$  SELECT COALESCE(jsonb_agg(to_jsonb(pub) ORDER BY pub.issued_at DESC),'[]') INTO documents FROM timeax_core.payroll_publications pub JOIN timeax_core.payroll_drafts d ON d.id=pub.id JOIN timeax_core.memberships m ON m.id=d.member_id WHERE m.identity_id=actor AND m.role='worker';$before$,$after$  SELECT coalesce(jsonb_agg(p.publication ORDER BY p.issued_at DESC,p.id),'[]'::jsonb) INTO documents
  FROM (
    SELECT pub.id,pub.issued_at,to_jsonb(pub) AS publication
    FROM timeax_core.payroll_publications pub
    JOIN timeax_core.payroll_drafts d ON d.id=pub.id
    JOIN timeax_core.memberships m ON m.id=d.member_id
    WHERE m.identity_id=actor AND m.role='worker'
    UNION ALL
    SELECT saved.id,saved.issued_at,saved.publication
    FROM timeax_core.personal_received_payslips saved
    WHERE saved.worker_identity_id=actor
      AND NOT EXISTS (SELECT 1 FROM timeax_core.payroll_publications pub WHERE pub.id=saved.id)
  ) p;$after$);
  EXECUTE replace(prior,$old_provenance$  RETURN jsonb_build_object('state','active','identityId',actor,'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('membershipId',m.id,'organizationId',o.id,'name',o.name,'role',m.role,'state',CASE WHEN e.membership_id IS NOT NULL THEN 'ended' ELSE m.state END,'endedAt',e.ended_at) ORDER BY o.id) FROM timeax_core.memberships m JOIN timeax_core.organizations o ON o.id=m.organization_id LEFT JOIN timeax_core.worker_membership_endings e ON e.membership_id=m.id WHERE m.identity_id=actor),'[]'),'timecards',cards,'payslips',documents,'exportVersion',1);$old_provenance$,$new_provenance$  RETURN jsonb_build_object('state','active','identityId',actor,'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('membershipId',m.id,'organizationId',o.id,'name',o.name,'role',m.role,'state',CASE WHEN e.membership_id IS NOT NULL THEN 'ended' ELSE m.state END,'endedAt',e.ended_at) ORDER BY o.id) FROM timeax_core.memberships m JOIN timeax_core.organizations o ON o.id=m.organization_id LEFT JOIN timeax_core.worker_membership_endings e ON e.membership_id=m.id WHERE m.identity_id=actor),'[]') || COALESCE((
   SELECT jsonb_agg(jsonb_build_object('membershipId',x.worker_membership_id,'organizationId',x.agency_id,'name',x.agency_name,'role','worker','state','ended','endedAt',NULL))
   FROM (SELECT DISTINCT worker_membership_id,agency_id,agency_name
         FROM timeax_core.personal_received_payslips p
         WHERE p.worker_identity_id=actor AND NOT EXISTS (SELECT 1 FROM timeax_core.memberships m WHERE m.id=p.worker_membership_id)) x
   ),'[]'::jsonb),'timecards',cards,'payslips',documents,'exportVersion',1);$new_provenance$);
  IF encode(sha256(convert_to(pg_get_functiondef(rpc),'UTF8')),'hex')<>'32b4f1d0453723efc0da00786e95447317e22ee4099b8a0716fad85834d0f065' THEN
    RAISE EXCEPTION 'Archive read integration not installed';
  END IF;
  FOR grant_row IN SELECT grantor,inherit_option FROM pg_auth_members WHERE roleid=owner_oid AND member=actor_oid LOOP
    IF NOT grants_before ? (grant_row.grantor::text) THEN
      EXECUTE format('REVOKE timeax_account_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(grant_row.grantor));
    ELSIF grant_row.inherit_option AND NOT (grants_before->(grant_row.grantor::text)->>'inherit_option')::boolean THEN
      EXECUTE format('REVOKE INHERIT OPTION FOR timeax_account_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(grant_row.grantor));
    END IF;
  END LOOP;
  IF grants_before IS DISTINCT FROM (SELECT coalesce(jsonb_object_agg(grantor::text,to_jsonb(g)),'{}'::jsonb)
    FROM pg_auth_members g WHERE roleid=owner_oid AND member=actor_oid) THEN
    RAISE EXCEPTION 'Unexpected account owner grants';
  END IF;
END
$install$;
COMMIT;
