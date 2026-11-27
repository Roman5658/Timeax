-- Read-only views for verified administrators of an active factory worksite.
-- Must be applied to this exact audited RPC version; no table grants or writes.
BEGIN;
DO $migration$
DECLARE
 fn regprocedure:='timeax_api.factory_timecards(text,text,text,jsonb)'::regprocedure;
 ddl text:=pg_get_functiondef(fn);
 owner_name constant text:='timeax_factory_timecards_owner';
 expected constant text:='b1e9eb8cd243873633a0a999adc3f35dee6ef06f1d4731e4b0536799a71af53b';
 actor_name text:=current_user;
 had_usage boolean:=pg_has_role(current_user,owner_name,'USAGE');
 had_set boolean:=pg_has_role(current_user,owner_name,'SET');
 projection constant text:=$match$RETURN jsonb_build_object('organizationId',org,'membershipId',mem.id,'role',mem.role,$match$;
 shift_role constant text:=$match$'shifts',CASE WHEN mem.role IN ('team_leader','worker') THEN$match$;
 shift_row constant text:=$match$AND (mem.role='team_leader' OR s.membership_id=mem.id))$match$;
 archived_scope constant text:=$match$WHERE mem.role='agency_admin' AND c.agency_id=org OR mem.role='team_leader'$match$;
 archive_read constant text:=$match$IF NOT FOUND OR NOT (mem.role='agency_admin' AND sheet.agency_id=org OR mem.role='team_leader'$match$;
 admin_site constant text:=$scope$
    EXISTS(SELECT 1 FROM timeax_core.worksites own
     JOIN timeax_core.worksite_organization_grants grant_row ON grant_row.worksite_id=own.id
     JOIN timeax_core.organizations recipient ON recipient.id=grant_row.organization_id
     WHERE own.id=@SITE@ AND own.owner_organization_id=org AND own.active
      AND grant_row.organization_id=@AGENCY@ AND grant_row.state='active'
      AND recipient.kind='agency' AND recipient.state='active')
 $scope$;
 admin_archive constant text:=$scope$
    @SCOPE@ AND @SNAPSHOT@->>'factoryId'=org::text
     AND @SNAPSHOT@->>'worksiteId'=@SITE@::text
     AND @SNAPSHOT@->>'organizationId'=@AGENCY@::text
 $scope$;
 mark text;
 scope_shifts text;
 scope_list text;
 scope_read text;
BEGIN
 IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=fn))<>owner_name
  OR encode(sha256(convert_to(ddl,'UTF8')),'hex')<>expected THEN
  RAISE EXCEPTION 'Unexpected factory timecards definition. No change applied';
 END IF;
 FOREACH mark IN ARRAY ARRAY[projection,shift_role,shift_row,archived_scope,archive_read] LOOP
  IF array_length(string_to_array(ddl,mark),1) IS DISTINCT FROM 2 THEN
   RAISE EXCEPTION 'Unexpected number of factory timecards patch markers. No change applied';
  END IF;
 END LOOP;
 scope_shifts:=replace(replace(admin_site,'@SITE@','s.worksite_id'),'@AGENCY@','s.agency_id');
 scope_list:=replace(replace(replace(replace(admin_archive,'@SCOPE@',admin_site),'@SNAPSHOT@','c.snapshot'),'@SITE@','c.worksite_id'),'@AGENCY@','c.agency_id');
 scope_read:=replace(replace(replace(replace(admin_archive,'@SCOPE@',admin_site),'@SNAPSHOT@','sheet.snapshot'),'@SITE@','sheet.worksite_id'),'@AGENCY@','sheet.agency_id');
 ddl:=replace(ddl,projection,projection||' ''factoryAdminRead'',mem.role=''factory_admin'',');
 ddl:=replace(ddl,shift_role,$change$'shifts',CASE WHEN mem.role IN ('team_leader','worker','factory_admin') THEN$change$);
 ddl:=replace(ddl,shift_row,$change$AND (mem.role='team_leader' OR mem.role='worker' AND s.membership_id=mem.id OR mem.role='factory_admin' AND ($change$||scope_shifts||')))');
 ddl:=replace(ddl,archived_scope,$change$WHERE mem.role='factory_admin' AND ($change$||scope_list||$change$) OR mem.role='agency_admin' AND c.agency_id=org OR mem.role='team_leader'$change$);
 ddl:=replace(ddl,archive_read,$change$IF NOT FOUND OR NOT (mem.role='factory_admin' AND ($change$||scope_read||$change$) OR mem.role='agency_admin' AND sheet.agency_id=org OR mem.role='team_leader'$change$);
 IF NOT had_usage THEN
  EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE',owner_name,actor_name);
 END IF;
 EXECUTE ddl;
 IF NOT had_usage THEN
  EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET %s',owner_name,actor_name,CASE WHEN had_set THEN 'TRUE' ELSE 'FALSE' END);
 END IF;
END
$migration$;
SELECT encode(sha256(convert_to(pg_get_functiondef('timeax_api.factory_timecards(text,text,text,jsonb)'::regprocedure),'UTF8')),'hex') AS factory_timecards_sha256;
COMMIT;
