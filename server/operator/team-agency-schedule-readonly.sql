-- Apply once after team-workflow.sql for the reviewed Team RPC.
-- The signature, owner, grants and search_path do not change. Re-pin the
-- resulting pg_get_functiondef SHA-256 in TIMEAX_AGENCY_TEAM_RPC_SHA256.
BEGIN;
DO $migration$
DECLARE
 f constant regprocedure := 'timeax_api.team_workflow(text,text,text,jsonb,jsonb)'::regprocedure;
 original text := pg_get_functiondef(f);
 ddl text;
 needs_role boolean := NOT pg_has_role(current_user, 'timeax_team_owner', 'USAGE');
 old_plan_scope constant text := $$m.role='agency_admin' AND w.owner_organization_id=org OR m.role='team_leader' AND timeax_team.assigned(m.id,w.id)$$;
 context_anchor constant text := $$   'templates',CASE WHEN m.role='worker'$$;
 write_anchor constant text := $$ op=(p_input->>'operationId')::uuid;$$;
 agency_schedule constant text := $schedule$
   'agencySchedule',CASE WHEN m.role='agency_admin' THEN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',p.id,'siteId',p.site_id,'localDate',p.payload->>'localDate',
      'startTime',p.payload->>'startTime','endTime',p.payload->>'endTime',
      'state',p.state,'recipients',p.recipients
    ) ORDER BY p.payload->>'localDate',p.payload->>'startTime',p.id)
    FROM (
     SELECT e.id,e.site_id,e.payload,e.state,jsonb_agg(d.recipient ORDER BY d.recipient) AS recipients
     FROM timeax_core.memberships r
     JOIN timeax_team.deliveries d ON d.recipient=r.id
     JOIN timeax_team.entries e ON e.id=d.entry_id AND e.kind='schedule'
     JOIN timeax_core.worksites w ON w.id=e.site_id AND w.active
     JOIN timeax_core.memberships s ON s.id=e.sender
     WHERE r.organization_id=org AND r.role='worker' AND r.state='active'
       AND timeax_team.assigned(r.id,w.id,(e.payload->>'startAt')::timestamptz,(e.payload->>'endAt')::timestamptz)
       AND (s.organization_id=org AND w.owner_organization_id=org
         OR s.role='team_leader' AND timeax_team.can_contact(e.sender,m.id,e.site_id))
     GROUP BY e.id,e.site_id,e.payload,e.state
    ) p
   ),'[]'::jsonb) ELSE '[]'::jsonb END,
$schedule$;
BEGIN
 IF encode(sha256(convert_to(original,'UTF8')),'hex') <> '4953228d3b7b1ee68c52f3ebc7fc1bab283f2bc62030597b200f96740579b582'
  OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=f)) <> 'timeax_team_owner'
  OR strpos(original,old_plan_scope)=0 OR strpos(original,context_anchor)=0 OR strpos(original,write_anchor)=0
 THEN RAISE EXCEPTION 'Unexpected Team RPC definition. Do not modify an unreviewed function.'; END IF;

 ddl := replace(original, old_plan_scope, $$m.role='team_leader' AND timeax_team.assigned(m.id,w.id)$$);
 ddl := replace(ddl, context_anchor, agency_schedule || context_anchor);
 ddl := replace(ddl, write_anchor,
   $$ IF m.role='agency_admin' AND p_action IN ('schedule','update-plan','cancel') THEN$$ || chr(10) ||
   $$  RAISE EXCEPTION 'Agency schedule is view only' USING ERRCODE='42501';$$ || chr(10) ||
   $$ END IF;$$ || chr(10) || write_anchor);
 IF needs_role THEN GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE; END IF;
 EXECUTE ddl;
 IF needs_role THEN REVOKE timeax_team_owner FROM CURRENT_USER; END IF;
END;
$migration$;
COMMIT;
