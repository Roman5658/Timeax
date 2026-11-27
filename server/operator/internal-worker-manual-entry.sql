-- Enables only the agency's explicit manual policy. Nothing is enabled by default.
BEGIN;
CREATE OR REPLACE FUNCTION timeax_core.internal_worker_manual_entry(p_agency uuid,p_site uuid,p_lock boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','pg_temp' AS $policy$
BEGIN
 IF session_user IS DISTINCT FROM 'timeax_timecards_login' THEN
  RAISE EXCEPTION 'Timecard policy unavailable' USING ERRCODE='42501';
 END IF;
 IF p_lock THEN
  PERFORM 1 FROM timeax_core.agency_worksite_preferences
  WHERE organization_id=p_agency AND worksite_id=p_site AND planned_time_mode='manual' FOR SHARE;
  RETURN FOUND;
 END IF;
 RETURN EXISTS(SELECT 1 FROM timeax_core.agency_worksite_preferences
   WHERE organization_id=p_agency AND worksite_id=p_site AND planned_time_mode='manual');
END
$policy$;
REVOKE ALL ON FUNCTION timeax_core.internal_worker_manual_entry(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION timeax_core.internal_worker_manual_entry(uuid,uuid,boolean) TO timeax_timecards_owner;
DO $migration$
DECLARE f regprocedure:='timeax_api.timecards(text,text,text,jsonb)'::regprocedure;
 ddl text:=pg_get_functiondef(f);
 owner_role constant text:='timeax_timecards_owner';
 restore_usage boolean:=pg_has_role(current_user,owner_role,'USAGE');
 restore_set boolean:=pg_has_role(current_user,owner_role,'SET');
 acting_role text:=current_user;
 projection constant text:=$match$jsonb_build_object('id',w.id,'name',w.name)$match$;
 gate constant text:=$match$  SELECT * INTO prior FROM timeax_core.timecard_revisions WHERE actor_identity=principal AND operation_id=op;$match$;
BEGIN
 IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=f))<>owner_role
  OR encode(sha256(convert_to(ddl,'UTF8')),'hex')<>'5450dc789edeab91822fe771ab2f37da8f11b743458768ed5ca2b634314f0dab'
  OR strpos(ddl,projection)=0 OR strpos(ddl,gate)=0 THEN RAISE EXCEPTION 'Unexpected timecards definition'; END IF;
 ddl:=replace(ddl,projection,$project$jsonb_build_object('id',w.id,'name',w.name,'manualEntry',CASE WHEN mem.role='worker' THEN timeax_core.internal_worker_manual_entry(org,w.id,false) ELSE false END)$project$);
 ddl:=replace(ddl,gate,
 $check$  IF NOT timeax_core.internal_worker_manual_entry(org,site_id,true) THEN RAISE EXCEPTION 'Internal manual entry is not enabled' USING ERRCODE='42501';END IF;$check$||chr(10)||gate);
 IF NOT restore_usage THEN
  EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE',owner_role,acting_role);
 END IF;
 EXECUTE ddl;
 IF NOT restore_usage THEN
  EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET %s',owner_role,acting_role,CASE WHEN restore_set THEN 'TRUE' ELSE 'FALSE' END);
 END IF;
END
$migration$;
COMMIT;
