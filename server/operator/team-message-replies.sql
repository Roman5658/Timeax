-- Optional follow-up. Apply after the reviewed public read-only agency schedule migration.
-- Keeps legacy text-only messages, the current role owner, and the existing browser-free grants.
-- After separate review, re-pin resulting pg_get_functiondef SHA-256 in TIMEAX_AGENCY_TEAM_RPC_SHA256.
BEGIN;
DO $migration$
DECLARE
 f constant regprocedure := 'timeax_api.team_workflow(text,text,text,jsonb,jsonb)'::regprocedure;
 original text := pg_get_functiondef(f);
 ddl text;
 needs_role boolean := NOT pg_has_role(current_user,'timeax_team_owner','USAGE');
 actor_oid oid := current_user::regrole;
 owner_oid oid := 'timeax_team_owner'::regrole;
 prior_roles jsonb;
 membership record;
 capability_anchor constant text := $$   'sites',COALESCE($$;
 old_recipient_sites constant text := $$WHERE r.role='worker' AND timeax_team.assigned(r.id,w.id) AND (w.owner_organization_id=org OR timeax_team.assigned(m.id,w.id) OR m.role='agency_admin' AND EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants g WHERE g.worksite_id=w.id AND g.organization_id=org AND g.state='active'))$$;
 recipient_sites constant text := $$WHERE (r.role='worker' AND timeax_team.assigned(r.id,w.id) AND (w.owner_organization_id=org OR timeax_team.assigned(m.id,w.id) OR m.role='agency_admin' AND EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants g WHERE g.worksite_id=w.id AND g.organization_id=org AND g.state='active'))) OR (r.role IN ('team_leader','agency_admin') AND timeax_team.can_contact(m.id,r.id,w.id) AND (m.role='agency_admin' OR timeax_team.assigned(m.id,w.id)))$$;
 old_validation constant text := $$    IF length(btrim(payload->>'text')) NOT BETWEEN 1 AND 2000 OR (SELECT count(*) FROM jsonb_object_keys(payload))<>1 THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023';END IF;$$;
 validation constant text := $validation$
    IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR jsonb_typeof(payload->'text') IS DISTINCT FROM 'string' OR
      length(btrim(payload->>'text')) NOT BETWEEN 1 AND 2000 OR
      EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('text','subject','replyTo')) OR
      (payload?'subject' AND (jsonb_typeof(payload->'subject') IS DISTINCT FROM 'string' OR length(btrim(payload->>'subject')) NOT BETWEEN 1 AND 120 OR (payload->>'subject') ~ '[[:cntrl:]]'))
    THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023';END IF;
    IF payload?'replyTo' THEN
     IF jsonb_typeof(payload->'replyTo') IS DISTINCT FROM 'string' OR (payload->>'replyTo') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
      OR cardinality(targets)<>1 THEN RAISE EXCEPTION 'Invalid reply' USING ERRCODE='22023';END IF;
     SELECT e.* INTO reply_entry FROM timeax_team.entries e
      WHERE e.id=(p_input->'payload'->>'replyTo')::uuid AND e.kind='message' AND e.state='active' FOR SHARE;
     IF NOT FOUND OR reply_entry.site_id IS DISTINCT FROM site OR
      NOT ((reply_entry.sender=m.id AND EXISTS(SELECT 1 FROM timeax_team.deliveries d WHERE d.entry_id=reply_entry.id AND d.recipient=targets[1]))
       OR (reply_entry.sender=targets[1] AND EXISTS(SELECT 1 FROM timeax_team.deliveries d WHERE d.entry_id=reply_entry.id AND d.recipient=m.id))) OR
      NOT timeax_team.can_contact(m.id,targets[1],site) OR NOT timeax_team.can_contact(targets[1],m.id,site)
     THEN RAISE EXCEPTION 'Reply unavailable' USING ERRCODE='42501';END IF;
    END IF;
$validation$;
BEGIN
 IF encode(sha256(convert_to(original,'UTF8')),'hex') <> '38edb5823d3792814f9161ee7133cd787b07d6d5f6d9f0fb1bed4ecf7f9015f2'
  OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=f)) <> 'timeax_team_owner'
  OR strpos(original,old_recipient_sites)=0 OR strpos(original,capability_anchor)=0 OR strpos(original,old_validation)=0
  OR strpos(original,'entry timeax_team.entries;')=0
 THEN RAISE EXCEPTION 'Unexpected Team RPC definition. Review it before migration.'; END IF;
 ddl:=replace(original,'entry timeax_team.entries;','entry timeax_team.entries; reply_entry timeax_team.entries;');
 ddl:=replace(ddl,capability_anchor,$$   'messageThreads',true,$$||chr(10)||capability_anchor);
 ddl:=replace(ddl,old_recipient_sites,recipient_sites);
 ddl:=replace(ddl,old_validation,validation);
 IF needs_role THEN
  SELECT coalesce(jsonb_object_agg(grantor::text,inherit_option),'{}'::jsonb) INTO prior_roles
   FROM pg_auth_members WHERE roleid=owner_oid AND member=actor_oid;
  -- INHERIT alone is sufficient for ownership; do not modify ADMIN or SET.
  GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE;
 END IF;
 EXECUTE ddl;
 IF needs_role THEN
  FOR membership IN SELECT grantor,inherit_option FROM pg_auth_members WHERE roleid=owner_oid AND member=actor_oid LOOP
   IF NOT prior_roles?(membership.grantor::text) THEN
    EXECUTE format('REVOKE timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(membership.grantor));
   ELSIF membership.inherit_option AND NOT (prior_roles->>(membership.grantor::text))::boolean THEN
    EXECUTE format('REVOKE INHERIT OPTION FOR timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(membership.grantor));
   END IF;
  END LOOP;
 END IF;
END;
$migration$;
COMMIT;
