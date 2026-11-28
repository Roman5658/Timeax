-- Run only against a disposable DB with the synthetic account-admin fixture
-- and the agency, worker, factory and routing migrations installed. All rows roll back.
BEGIN;
CREATE TRIGGER factory_events_immutable BEFORE UPDATE OR DELETE ON timeax_core.factory_timecard_events
  FOR EACH ROW EXECUTE FUNCTION timeax_core.fixture_immutable();
INSERT INTO auth.users(id,email,created_at) VALUES
  ('00000000-0000-4000-8000-000000000051','factory@example.test',now()),
  ('00000000-0000-4000-8000-000000000052','factoryworker@example.test',now()),
  ('00000000-0000-4000-8000-000000000053','outsider@example.test',now());
INSERT INTO timeax_core.identity_issuers VALUES ('https://rohgpgogsdtiltbocdao.supabase.co/auth/v1',true) ON CONFLICT DO NOTHING;
INSERT INTO timeax_core.identities(id,issuer,subject,active) VALUES
  ('00000000-0000-4000-8000-000000000054','https://rohgpgogsdtiltbocdao.supabase.co/auth/v1','00000000-0000-4000-8000-000000000051',true),
  ('00000000-0000-4000-8000-000000000055','https://rohgpgogsdtiltbocdao.supabase.co/auth/v1','00000000-0000-4000-8000-000000000052',true),
  ('00000000-0000-4000-8000-000000000056','https://rohgpgogsdtiltbocdao.supabase.co/auth/v1','00000000-0000-4000-8000-000000000053',true);
INSERT INTO timeax_core.organizations(id,name,kind,state) VALUES
  ('00000000-0000-4000-8000-000000000057','Fixture Factory','factory','active'),
  ('00000000-0000-4000-8000-000000000058','Fixture Agency','agency','active');
INSERT INTO timeax_core.memberships(id,organization_id,organization_kind,identity_id,role,state) VALUES
  ('00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000057','factory','00000000-0000-4000-8000-000000000054','factory_admin','active'),
  ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000057','factory','00000000-0000-4000-8000-000000000055','worker','active'),
  ('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000058','agency','00000000-0000-4000-8000-000000000056','agency_admin','active');
INSERT INTO timeax_core.factory_authority_reviewers VALUES ('00000000-0000-4000-8000-000000000056',true);
INSERT INTO timeax_core.worksites(id,owner_organization_id,name,active) VALUES
  ('00000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000057','Workshop',true),
  ('00000000-0000-4000-8000-000000000067','00000000-0000-4000-8000-000000000058','Agency Independent Site',true);
INSERT INTO timeax_core.factory_registration_requests(id,identity_id,name,nip,site_name,state,reviewed_by,review_reference,reviewed_at,organization_id,worksite_id) VALUES
  ('00000000-0000-4000-8000-000000000064','00000000-0000-4000-8000-000000000054','Fixture Factory','1234563218','Workshop','approved','00000000-0000-4000-8000-000000000056','fixture',now(),'00000000-0000-4000-8000-000000000057','00000000-0000-4000-8000-000000000063');
INSERT INTO timeax_core.factory_timecard_shifts(id,worksite_id,agency_id,membership_id,local_date,start_at,end_at,source,state,revision) VALUES
  ('00000000-0000-4000-8000-000000000065','00000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000057','00000000-0000-4000-8000-000000000061',current_date,now(),now()+interval '8 h','attendance','ready',1);
INSERT INTO timeax_core.factory_timecard_events(id,worksite_id,shift_id,actor_identity) VALUES
  ('00000000-0000-4000-8000-000000000066','00000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000065','00000000-0000-4000-8000-000000000054');
CREATE FUNCTION timeax_api.fixture_factory_has_marker(a uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER
  SET search_path=pg_catalog,pg_temp AS $$
    SELECT EXISTS(SELECT 1 FROM timeax_core.admin_test_factory_resets WHERE account_id=a)
$$;
CREATE FUNCTION timeax_api.fixture_change_factory(shared text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  UPDATE timeax_core.worksites SET name='Workshop Changed' WHERE id='00000000-0000-4000-8000-000000000063';
  IF shared IN ('unreviewed','connected') THEN
    INSERT INTO timeax_core.worksite_organization_grants VALUES
      ('00000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000057','00000000-0000-4000-8000-000000000058','agency','active');
    IF shared='connected' THEN
      INSERT INTO timeax_core.factory_connection_requests(id,factory_id,factory_kind,worksite_id,agency_id,agency_kind,requested_by,state,decided_by) VALUES
        ('00000000-0000-4000-8000-000000000068','00000000-0000-4000-8000-000000000057','factory','00000000-0000-4000-8000-000000000063',
         '00000000-0000-4000-8000-000000000058','agency','00000000-0000-4000-8000-000000000060','active','00000000-0000-4000-8000-000000000062');
    END IF;
  ELSE
    DELETE FROM timeax_core.worksite_organization_grants WHERE worksite_id='00000000-0000-4000-8000-000000000063';
  END IF;
END
$$;
SET SESSION AUTHORIZATION timeax_account_admin_login;
DO $$
DECLARE p jsonb; c jsonb; result jsonb; a constant uuid:='00000000-0000-4000-8000-000000000051';
BEGIN
  p:=timeax_api.admin_accounts('preview',a,NULL);
  IF p->>'state'<>'preview' OR p->>'scope'<>'test-factory' OR
    p#>>'{reset,impact,workerAccountsKept}'<>'1' OR p#>>'{reset,impact,shiftsRemoved}'<>'1'
    THEN RAISE EXCEPTION 'Invalid preview: %',p; END IF;
  IF timeax_api.fixture_factory_has_marker(a) THEN RAISE EXCEPTION 'Preview left a marker'; END IF;
  c:=jsonb_build_object('email',p->>'email','organizationId',p#>>'{reset,organizationId}','revision',p#>>'{reset,revision}');
  PERFORM timeax_api.fixture_change_factory('unreviewed');
  result:=timeax_api.admin_accounts('delete-test-factory',a,c::text);
  IF result->>'state'<>'blocked' OR result->>'reason'<>'external-worksite-access' THEN RAISE EXCEPTION 'Mixed ownership not blocked: %',result; END IF;
  PERFORM timeax_api.fixture_change_factory('disconnected');
  result:=timeax_api.admin_accounts('delete-test-factory',a,c::text);
  IF result->>'state'<>'changed' THEN RAISE EXCEPTION 'Stale preview accepted: %',result; END IF;
  PERFORM timeax_api.fixture_change_factory('connected');
  p:=timeax_api.admin_accounts('preview',a,NULL);
  c:=jsonb_build_object('email',p->>'email','organizationId',p#>>'{reset,organizationId}','revision',p#>>'{reset,revision}');
  result:=timeax_api.admin_accounts('delete-test-factory',a,c::text);
  IF result->>'state'<>'deleted' THEN RAISE EXCEPTION 'Reset not completed: %',result; END IF;
END
$$;
RESET SESSION AUTHORIZATION;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE email='factory@example.test')
    OR EXISTS (SELECT 1 FROM timeax_core.organizations WHERE id='00000000-0000-4000-8000-000000000057')
    OR EXISTS (SELECT 1 FROM timeax_core.factory_registration_requests WHERE id='00000000-0000-4000-8000-000000000064')
    OR EXISTS (SELECT 1 FROM timeax_core.factory_timecard_events WHERE id='00000000-0000-4000-8000-000000000066')
    OR EXISTS (SELECT 1 FROM timeax_core.factory_connection_requests WHERE id='00000000-0000-4000-8000-000000000068')
    OR EXISTS (SELECT 1 FROM timeax_core.worksite_organization_grants WHERE worksite_id='00000000-0000-4000-8000-000000000063')
    OR (SELECT count(*) FROM auth.users WHERE email IN ('factoryworker@example.test','outsider@example.test'))<>2
    OR NOT EXISTS (SELECT 1 FROM timeax_core.organizations WHERE id='00000000-0000-4000-8000-000000000058')
    OR NOT EXISTS (SELECT 1 FROM timeax_core.worksites WHERE id='00000000-0000-4000-8000-000000000067')
    THEN RAISE EXCEPTION 'Cleanup incomplete or unrelated data was changed'; END IF;
END
$$;
INSERT INTO auth.users(id,email) VALUES ('00000000-0000-4000-8000-000000000099','factory@example.test');
ROLLBACK;
