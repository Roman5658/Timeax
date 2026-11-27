-- Additive metadata + read-only schedule views for active owned factory worksites.
-- Apply only after canonical factory-setup and Team SQL. Re-pin factory_setup after review.
BEGIN;
CREATE TABLE timeax_core.factory_roster_units(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 worksite_id uuid NOT NULL REFERENCES timeax_core.worksites(id),
 kind text NOT NULL CHECK(kind IN ('department','group')),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80 AND name !~ '[[:cntrl:]]'),
 department_id uuid, leader_id uuid REFERENCES timeax_core.memberships(id) ON DELETE SET NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 archived_at timestamptz,
 UNIQUE (id,worksite_id),
 CONSTRAINT factory_roster_parent FOREIGN KEY(department_id,worksite_id) REFERENCES timeax_core.factory_roster_units(id,worksite_id),
 CHECK(kind='group' OR department_id IS NULL AND leader_id IS NULL)
);
CREATE UNIQUE INDEX factory_roster_active_name ON timeax_core.factory_roster_units(worksite_id,kind,lower(name)) WHERE archived_at IS NULL;
CREATE TABLE timeax_core.factory_roster_links(
 unit_id uuid NOT NULL, worksite_id uuid NOT NULL, membership_id uuid NOT NULL REFERENCES timeax_core.memberships(id) ON DELETE CASCADE,
 PRIMARY KEY(unit_id,membership_id),
 FOREIGN KEY(unit_id,worksite_id) REFERENCES timeax_core.factory_roster_units(id,worksite_id)
);
CREATE INDEX factory_roster_links_site ON timeax_core.factory_roster_links(worksite_id,membership_id);
ALTER TABLE timeax_core.factory_roster_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_core.factory_roster_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.factory_roster_units,timeax_core.factory_roster_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON timeax_core.factory_roster_units TO timeax_factory_setup_owner;
GRANT SELECT,INSERT,DELETE ON timeax_core.factory_roster_links TO timeax_factory_setup_owner;
CREATE POLICY factory_roster_units_rpc ON timeax_core.factory_roster_units FOR ALL TO timeax_factory_setup_owner USING(true) WITH CHECK(true);
CREATE POLICY factory_roster_links_rpc ON timeax_core.factory_roster_links FOR ALL TO timeax_factory_setup_owner USING(true) WITH CHECK(true);
GRANT SELECT ON timeax_core.factory_worker_placements TO timeax_factory_setup_owner;
CREATE POLICY factory_roster_placement_read ON timeax_core.factory_worker_placements FOR SELECT TO timeax_factory_setup_owner USING(true);
GRANT USAGE ON SCHEMA timeax_team TO timeax_factory_setup_owner;
GRANT SELECT(id,sender,kind,site_id,payload,state) ON timeax_team.entries TO timeax_factory_setup_owner;
GRANT SELECT(entry_id,recipient) ON timeax_team.deliveries TO timeax_factory_setup_owner;
CREATE POLICY factory_schedule_rows ON timeax_team.entries FOR SELECT TO timeax_factory_setup_owner USING(kind='schedule');
CREATE POLICY factory_schedule_deliveries ON timeax_team.deliveries FOR SELECT TO timeax_factory_setup_owner
 USING(EXISTS (SELECT 1 FROM timeax_team.entries e WHERE e.id=entry_id AND e.kind='schedule'));
GRANT EXECUTE ON FUNCTION timeax_team.assigned(uuid,uuid,timestamptz,timestamptz) TO timeax_factory_setup_owner;

DO $migration$
DECLARE
 f regprocedure:='timeax_api.factory_setup(text,text,text,jsonb)'::regprocedure;
 ddl text:=pg_get_functiondef(f);
 owner_role constant text:='timeax_factory_setup_owner';
 restore_usage boolean:=pg_has_role(current_user,owner_role,'USAGE');
 restore_set boolean:=pg_has_role(current_user,owner_role,'SET');
 acting_role text:=current_user;
 anchor constant text:=$anchor$ IF p_action='context' THEN$anchor$;
 prefix constant text:=$body$
 IF p_action IN ('factory-roster','factory-schedule','factory-unit-save','factory-unit-archive') THEN
  DECLARE
   roster_ids uuid[]; leader_ids uuid[]; unit timeax_core.factory_roster_units%ROWTYPE;
   from_day date; to_day date; cleaned_name text; unit_kind text; parent_id uuid; lead_id uuid; requested uuid[];
  BEGIN
   SELECT * INTO site FROM timeax_core.worksites w
   WHERE w.id=(p_input->>'worksiteId')::uuid AND w.active AND w.owner_organization_id=(p_input->>'organizationId')::uuid FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Worksite unavailable' USING ERRCODE='42501';END IF;
   actor:=timeax_core.setup_admin(p_issuer,p_subject,site.owner_organization_id,'factory');
   IF p_action='factory-schedule' THEN
    from_day:=(p_input->>'dateFrom')::date; to_day:=(p_input->>'dateTo')::date;
    IF from_day IS NULL OR to_day IS NULL OR to_day<from_day OR to_day-from_day>31 THEN
     RAISE EXCEPTION 'Invalid schedule period' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('organizationId',site.owner_organization_id,'membershipId',actor,'worksiteId',site.id,
     'plans',COALESCE((SELECT jsonb_agg(q.row ORDER BY q.local_date,q.start_time,q.plan_id,q.worker_id) FROM (
      SELECT e.id plan_id,d.recipient worker_id,e.payload->>'localDate' local_date,e.payload->>'startTime' start_time,
       jsonb_build_object('id',e.id,'membershipId',d.recipient,'localDate',e.payload->>'localDate',
          'startTime',e.payload->>'startTime','endTime',e.payload->>'endTime','state',e.state) AS row
      FROM timeax_team.entries e JOIN timeax_team.deliveries d ON d.entry_id=e.id
      JOIN timeax_core.memberships sender ON sender.id=e.sender AND sender.organization_id=site.owner_organization_id AND sender.role='team_leader'
      JOIN timeax_core.memberships worker ON worker.id=d.recipient AND worker.role='worker'
      WHERE e.site_id=site.id AND e.kind='schedule' AND e.payload->>'localDate' BETWEEN from_day::text AND to_day::text
       AND timeax_team.assigned(sender.id,site.id)
       AND timeax_team.assigned(worker.id,site.id)
       AND timeax_team.assigned(worker.id,site.id,(e.payload->>'startAt')::timestamptz,(e.payload->>'endAt')::timestamptz)
      ORDER BY local_date,start_time,plan_id,worker_id LIMIT 1001
     ) q),'[]'::jsonb));
   END IF;
   IF p_action<>'factory-roster' THEN PERFORM pg_advisory_xact_lock(hashtextextended('factory-roster/'||site.id::text,0));END IF;
   SELECT COALESCE(array_agg(DISTINCT g.membership_id),'{}') INTO roster_ids
   FROM timeax_core.worksite_membership_grants g JOIN timeax_core.memberships m ON m.id=g.membership_id AND m.role='worker' AND m.state='active'
   WHERE g.worksite_id=site.id AND g.state='active' AND timeax_team.assigned(m.id,site.id);
   SELECT COALESCE(array_agg(DISTINCT g.membership_id),'{}') INTO leader_ids
   FROM timeax_core.worksite_membership_grants g JOIN timeax_core.memberships m ON m.id=g.membership_id AND m.role='team_leader'
   WHERE g.worksite_id=site.id AND g.organization_id=site.owner_organization_id AND timeax_team.assigned(m.id,site.id);
   IF p_action='factory-roster' THEN
    RETURN jsonb_build_object('organizationId',site.owner_organization_id,'membershipId',actor,'worksiteId',site.id,
     'members',to_jsonb(roster_ids),'leaders',to_jsonb(leader_ids),
     'units',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'kind',u.kind,'revision',u.revision,
      'departmentId',u.department_id,'leaderId',CASE WHEN u.leader_id=ANY(leader_ids) THEN u.leader_id END,
      'workers',COALESCE((SELECT jsonb_agg(l.membership_id ORDER BY l.membership_id) FROM timeax_core.factory_roster_links l
       WHERE l.unit_id=u.id AND l.worksite_id=site.id AND l.membership_id=ANY(roster_ids)),'[]'::jsonb)) ORDER BY u.kind,u.name,u.id)
     FROM timeax_core.factory_roster_units u WHERE u.worksite_id=site.id AND u.archived_at IS NULL),'[]'::jsonb));
   END IF;
   IF p_input->>'id' IS NOT NULL THEN
    SELECT * INTO unit FROM timeax_core.factory_roster_units
    WHERE id=(p_input->>'id')::uuid AND worksite_id=site.id AND archived_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Roster item unavailable' USING ERRCODE='42501';END IF;
    IF unit.revision IS DISTINCT FROM (p_input->>'revision')::integer THEN
     RAISE EXCEPTION 'Roster item has changed' USING ERRCODE='23505';
    END IF;
   END IF;
   IF p_action='factory-unit-archive' THEN
    IF unit.id IS NULL THEN RAISE EXCEPTION 'Roster item required' USING ERRCODE='22023';END IF;
    UPDATE timeax_core.factory_roster_units SET department_id=NULL,revision=revision+1
     WHERE worksite_id=site.id AND department_id=unit.id AND archived_at IS NULL;
    UPDATE timeax_core.factory_roster_units SET archived_at=clock_timestamp(),revision=revision+1 WHERE id=unit.id AND worksite_id=site.id;
    DELETE FROM timeax_core.factory_roster_links WHERE unit_id=unit.id AND worksite_id=site.id;
    RETURN jsonb_build_object('id',unit.id,'state','archived');
   END IF;
   unit_kind:=p_input->>'kind'; cleaned_name:=btrim(p_input->>'name'); parent_id:=(p_input->>'departmentId')::uuid; lead_id:=(p_input->>'leaderId')::uuid;
   IF unit_kind IS NULL OR unit_kind NOT IN ('department','group') OR cleaned_name IS NULL OR length(cleaned_name) NOT BETWEEN 1 AND 80
     OR unit.id IS NOT NULL AND unit.kind<>unit_kind OR unit_kind='department' AND (parent_id IS NOT NULL OR lead_id IS NOT NULL)
     OR jsonb_typeof(p_input->'workers') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'workers')>200 THEN
    RAISE EXCEPTION 'Invalid roster item' USING ERRCODE='22023';
   END IF;
   IF parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM timeax_core.factory_roster_units
    WHERE id=parent_id AND worksite_id=site.id AND kind='department' AND archived_at IS NULL)
    OR lead_id IS NOT NULL AND NOT (lead_id=ANY(leader_ids)) THEN
    RAISE EXCEPTION 'Department or team leader unavailable' USING ERRCODE='42501';
   END IF;
   SELECT COALESCE(array_agg(DISTINCT w::uuid),'{}') INTO requested FROM jsonb_array_elements_text(p_input->'workers') w;
   IF NOT (requested<@roster_ids) OR array_position(requested,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Worker not assigned to this worksite' USING ERRCODE='42501';
   END IF;
   IF unit.id IS NULL THEN
    IF (SELECT count(*) FROM timeax_core.factory_roster_units WHERE worksite_id=site.id AND archived_at IS NULL)>=200
     THEN RAISE EXCEPTION 'Roster item limit' USING ERRCODE='22023';END IF;
    INSERT INTO timeax_core.factory_roster_units(worksite_id,kind,name,department_id,leader_id)
    VALUES(site.id,unit_kind,cleaned_name,parent_id,lead_id) RETURNING * INTO unit;
   ELSE
    UPDATE timeax_core.factory_roster_units SET name=cleaned_name,department_id=parent_id,leader_id=lead_id,revision=revision+1
     WHERE id=unit.id AND worksite_id=site.id RETURNING * INTO unit;
   END IF;
   DELETE FROM timeax_core.factory_roster_links WHERE unit_id=unit.id AND worksite_id=site.id;
   INSERT INTO timeax_core.factory_roster_links(unit_id,worksite_id,membership_id)
    SELECT unit.id,site.id,w FROM unnest(requested) AS w;
   RETURN jsonb_build_object('id',unit.id,'revision',unit.revision);
  END;
 END IF;
$body$;
BEGIN
 IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=f))<>owner_role
  OR encode(sha256(convert_to(ddl,'UTF8')),'hex')<>'9ec6bb313b6c819c50a1a51dd488667ecc7af9244fe9a3942cdab9eb82291224'
  OR strpos(ddl,anchor)=0 THEN RAISE EXCEPTION 'Unreviewed factory setup definition';END IF;
 IF NOT restore_usage THEN EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE',owner_role,acting_role);END IF;
 EXECUTE replace(ddl,anchor,prefix||chr(10)||anchor);
 IF NOT restore_usage THEN EXECUTE format('GRANT %I TO %I WITH INHERIT FALSE, SET %s',owner_role,acting_role,CASE WHEN restore_set THEN 'TRUE' ELSE 'FALSE' END);END IF;
END
$migration$;
COMMIT;
