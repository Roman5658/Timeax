BEGIN;
DO $access_fix$
DECLARE me oid:=current_user::regrole; team oid:='timeax_team_owner'::regrole;
 f regprocedure; prior jsonb; item record;
BEGIN
 FOREACH f IN ARRAY ARRAY['timeax_team.admin_clear_test_agency(uuid,uuid,boolean)'::regprocedure,'timeax_team.admin_clear_test_worker(uuid,uuid[],boolean,boolean)'::regprocedure] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=f AND proowner=team AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
    OR encode(sha256(convert_to(pg_get_functiondef(f),'UTF8')),'hex') <> (CASE WHEN f='timeax_team.admin_clear_test_agency(uuid,uuid,boolean)'::regprocedure THEN '6e8293678f17dc19faac1c7ed9ed14c91b974c34c6de6c16c08dec5dd8caf746' ELSE '2c4a69332c6349311dbdeed4865c236e01a06d25988617d4f2ab32af87c6a032' END)
  THEN RAISE EXCEPTION 'Unexpected Team cleanup definition'; END IF;
 END LOOP;
 SELECT coalesce(jsonb_object_agg(grantor::text,to_jsonb(g)),'{}') INTO prior FROM pg_auth_members g WHERE member=me AND roleid=team;
 GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
 SET LOCAL ROLE timeax_team_owner;
 GRANT EXECUTE ON FUNCTION timeax_team.admin_clear_test_agency(uuid,uuid,boolean), timeax_team.admin_clear_test_worker(uuid,uuid[],boolean,boolean) TO postgres;
 RESET ROLE;
 FOR item IN SELECT grantor,inherit_option,set_option FROM pg_auth_members WHERE member=me AND roleid=team LOOP
  IF NOT prior ? item.grantor::text THEN
   EXECUTE format('REVOKE timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(item.grantor));
  ELSE
   IF item.inherit_option AND NOT (prior->item.grantor::text->>'inherit_option')::boolean THEN
    EXECUTE format('REVOKE INHERIT OPTION FOR timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(item.grantor));
   END IF;
   IF item.set_option AND NOT (prior->item.grantor::text->>'set_option')::boolean THEN
    EXECUTE format('REVOKE SET OPTION FOR timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(item.grantor));
   END IF;
  END IF;
 END LOOP;
 IF prior IS DISTINCT FROM (SELECT coalesce(jsonb_object_agg(grantor::text,to_jsonb(g)),'{}') FROM pg_auth_members g WHERE member=me AND roleid=team) THEN
  RAISE EXCEPTION 'Unexpected Team role memberships';
 END IF;
 FOREACH f IN ARRAY ARRAY['timeax_team.admin_clear_test_agency(uuid,uuid,boolean)'::regprocedure,'timeax_team.admin_clear_test_worker(uuid,uuid[],boolean,boolean)'::regprocedure] LOOP
  IF NOT has_function_privilege('postgres',f,'EXECUTE') OR has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
    OR has_function_privilege('timeax_account_admin_login',f,'EXECUTE') OR has_function_privilege('service_role',f,'EXECUTE')
  THEN RAISE EXCEPTION 'Unexpected Team helper access'; END IF;
 END LOOP;
END
$access_fix$;
COMMIT;
