-- Add factory Chat to the already-reviewed, scoped Team RPC.
-- The same role, private tables and notification ledger are reused.
-- Verify resulting pg_get_functiondef fingerprint and re-pin TIMEAX_AGENCY_TEAM_RPC_SHA256.
BEGIN;
DO $factory_chat$
DECLARE
 main constant regprocedure := 'timeax_api.team_workflow(text,text,text,jsonb,jsonb)'::regprocedure;
 contact oid;
 f text := pg_get_functiondef(main);
 c text;
 actor_oid oid := current_user::regrole;
 owner_oid oid := 'timeax_team_owner'::regrole;
 needs_role boolean := NOT pg_has_role(actor_oid,owner_oid,'USAGE');
 prior_roles jsonb;
 membership record;
 old_roles constant text := $$m.role NOT IN ('worker','agency_admin','team_leader','accountant')$$;
 capability_anchor constant text := $$   'messageThreads',true,$$;
 site_scope constant text := $$timeax_team.assigned(m.id,w.id) OR m.role='agency_admin' AND (w.owner_organization_id=org OR EXISTS($$;
 recipients_scope constant text := $$r.role IN ('team_leader','agency_admin') AND timeax_team.can_contact(m.id,r.id,w.id)$$;
 message_anchor constant text := $$   IF entry.kind='message' THEN$$;
 contact_anchor constant text := $$ OR (p_site IS NOT NULL AND ($$;
 main_gate constant text := $gate$
 IF m.role='factory_admin' AND p_action NOT IN ('context','read','message') THEN
  RAISE EXCEPTION 'Factory communication only' USING ERRCODE='42501';
 END IF;
$gate$;
 factory_message_gate constant text := $message_gate$
    -- Factory↔worker is one-to-one and tied to an exact, active worksite.
    -- For agency-employed workers the factory can only reply to a message that worker started.
    IF m.role='factory_admin' OR EXISTS(SELECT 1 FROM timeax_core.memberships a WHERE a.id=ANY(targets) AND a.role='factory_admin') THEN
     IF site IS NULL OR cardinality(targets)<>1 THEN RAISE EXCEPTION 'Private factory contact required' USING ERRCODE='42501'; END IF;
     IF m.role='factory_admin' AND NOT EXISTS(
       SELECT 1 FROM timeax_core.memberships w
        WHERE w.id=targets[1] AND w.role='worker' AND w.organization_id=m.organization_id AND w.organization_kind='factory'
      ) AND NOT EXISTS(
       SELECT 1 FROM timeax_team.entries e
       JOIN timeax_team.deliveries d ON d.entry_id=e.id AND d.recipient=m.id
       WHERE e.id=(p_input->'payload'->>'replyTo')::uuid AND e.kind='message' AND e.state='active'
        AND e.sender=targets[1] AND e.site_id=site
      )
     THEN RAISE EXCEPTION 'Factory reply requires original participant' USING ERRCODE='42501'; END IF;
    END IF;
$message_gate$;
 factory_contact constant text := $contact_scope$
  (a.role='worker' AND b.role='factory_admin' AND bo.kind='factory' AND b.organization_kind='factory'
    AND timeax_team.assigned(a.id,p_site) AND EXISTS(
      SELECT 1 FROM timeax_core.worksites w WHERE w.id=p_site AND w.active AND w.owner_organization_id=b.organization_id))
  OR (a.role='factory_admin' AND ao.kind='factory' AND a.organization_kind='factory' AND b.role='worker'
    AND timeax_team.assigned(b.id,p_site) AND EXISTS(
      SELECT 1 FROM timeax_core.worksites w WHERE w.id=p_site AND w.active AND w.owner_organization_id=a.organization_id))
$contact_scope$;
BEGIN
 -- Catalog lookup avoids requiring private-schema USAGE before the temporary
 -- owner membership is available to an ADMIN-only operator.
 SELECT p.oid INTO STRICT contact FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='timeax_team' AND p.proname='can_contact' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid';
 c:=pg_get_functiondef(contact);
 IF encode(sha256(convert_to(f,'UTF8')),'hex')<>'67029d5ea6d98957f2e08802ced9c3cb371c796e60233fe52fd1c85f50faf814'
 OR encode(sha256(convert_to(c,'UTF8')),'hex')<>'a5b299d990d0ec557ffc91270f01c93f4a8b4da0ce2458e508b4a043e61621a4'
 OR (SELECT proowner FROM pg_proc WHERE oid=main)<>owner_oid OR (SELECT proowner FROM pg_proc WHERE oid=contact)<>owner_oid
 OR strpos(f,old_roles)=0 OR strpos(f,capability_anchor)=0 OR strpos(f,site_scope)=0 OR strpos(f,recipients_scope)=0
 OR strpos(f,message_anchor)=0 OR strpos(c,contact_anchor)=0
 THEN RAISE EXCEPTION 'Unexpected Team definitions. Review before applying factory Chat.'; END IF;

 c:=replace(c,contact_anchor,contact_anchor||factory_contact||' OR ');
 f:=replace(f,old_roles,$$m.role NOT IN ('worker','agency_admin','team_leader','accountant','factory_admin')$$);
 f:=replace(f,$$ IF p_action='context' THEN$$,main_gate||$$ IF p_action='context' THEN$$);
 f:=replace(f,capability_anchor,capability_anchor||chr(10)||$$   'factoryChat',true,$$);
 f:=replace(f,site_scope,$$timeax_team.assigned(m.id,w.id) OR m.role='factory_admin' AND w.owner_organization_id=org OR m.role='agency_admin' AND (w.owner_organization_id=org OR EXISTS($$);
 f:=replace(f,recipients_scope,$$r.role IN ('team_leader','agency_admin','factory_admin') AND timeax_team.can_contact(m.id,r.id,w.id)$$);
 f:=replace(f,message_anchor,message_anchor||factory_message_gate);

 IF needs_role THEN
  SELECT coalesce(jsonb_object_agg(grantor::text,inherit_option),'{}'::jsonb) INTO prior_roles
   FROM pg_auth_members WHERE roleid=owner_oid AND member=actor_oid;
  GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE;
 END IF;
 EXECUTE c;
 EXECUTE f;
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
$factory_chat$;
COMMIT;
