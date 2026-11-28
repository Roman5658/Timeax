-- Add optional absence comments without changing recipients or stored records.
BEGIN;
DO $absence_comment$
DECLARE
 rpc constant regprocedure := 'timeax_api.team_workflow(text,text,text,jsonb,jsonb)'::regprocedure;
 f text := pg_get_functiondef(rpc);
 actor_oid oid := current_user::regrole;
 owner_oid oid := 'timeax_team_owner'::regrole;
 needs_role boolean := NOT pg_has_role(actor_oid,owner_oid,'USAGE');
 prior_roles jsonb;
 membership record;
BEGIN
 IF encode(sha256(convert_to(f,'UTF8')),'hex')<>'bc946a1d445103b82b39512e08afaf73545fe3d29b7b30ad671bc418a54f9fa2'
 OR (SELECT proowner FROM pg_proc WHERE oid=rpc)<>owner_oid THEN
  RAISE EXCEPTION 'Unexpected Team definition; do not apply comment upgrade';
 END IF;
 f:=replace(replace(f,$a$OR (SELECT count(*) FROM jsonb_object_keys(payload))<>2$a$,$b$OR (payload - ARRAY['dateFrom','dateTo','comment']) <> '{}'::jsonb OR (payload ? 'comment' AND (jsonb_typeof(payload->'comment') IS DISTINCT FROM 'string' OR length(btrim(payload->>'comment')) NOT BETWEEN 1 AND 500 OR replace(payload->>'comment', chr(10), '') ~ '[[:cntrl:]]'))$b$),$c$'factoryChat',true,$c$,$d$'factoryChat',true,'absenceComments',true,$d$);
 IF encode(sha256(convert_to(f,'UTF8')),'hex')<>'c8d09a03067adccecffc7bfd1ff41eb10d1a80553ec2a637ca831664b053d721' THEN
  RAISE EXCEPTION 'Unexpected resulting Team definition';
 END IF;
 IF needs_role THEN
  SELECT coalesce(jsonb_object_agg(grantor::text,inherit_option),'{}'::jsonb) INTO prior_roles FROM pg_auth_members WHERE roleid=owner_oid AND member=actor_oid;
  GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE;
 END IF;
 EXECUTE f;
 IF encode(sha256(convert_to(pg_get_functiondef(rpc),'UTF8')),'hex')<>'c8d09a03067adccecffc7bfd1ff41eb10d1a80553ec2a637ca831664b053d721' THEN
  RAISE EXCEPTION 'Unexpected installed Team definition';
 END IF;
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
$absence_comment$;
COMMIT;
