-- Worker deletion is private to the account-admin database lane. No account is
-- enabled by installing this migration; the exact auth account must be selected.
BEGIN;
CREATE TABLE IF NOT EXISTS timeax_core.admin_test_worker_resets (
  account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE timeax_core.admin_test_worker_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.admin_test_worker_resets FROM PUBLIC, anon, authenticated, service_role, timeax_account_admin_login;

DO $team_install$
DECLARE actor oid:=current_user::regrole; team_owner oid:='timeax_team_owner'::regrole;
 before_grants jsonb; item record;
BEGIN
 SELECT coalesce(jsonb_object_agg(grantor::text,to_jsonb(g)),'{}') INTO before_grants
 FROM pg_auth_members g WHERE member=actor AND roleid=team_owner;
 IF NOT pg_has_role(actor,team_owner,'USAGE') THEN GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE; END IF;
 CREATE FUNCTION timeax_team.admin_clear_test_worker(p_identity uuid,p_members uuid[],p_lock boolean,p_apply boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $team_reset$
 DECLARE i alias for p_identity; m alias for p_members; e uuid[]; v_mark text; h text;
 BEGIN
  IF session_user<>'timeax_account_admin_login' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  IF p_lock THEN
    LOCK TABLE timeax_team.deliveries,timeax_team.entries,timeax_team.events,timeax_team.templates,timeax_team.accountant_invitations IN SHARE ROW EXCLUSIVE MODE;
  END IF;
  IF EXISTS(SELECT 1 FROM timeax_team.accountant_invitations WHERE accepted_identity=i OR issuer_identity=i OR membership_id=any(m)) THEN
    RETURN jsonb_build_object('state','blocked'); -- additional organizational role
  END IF;
  SELECT ARRAY(SELECT z.id FROM timeax_team.entries z WHERE z.sender=any(m)
   OR (EXISTS(SELECT 1 FROM timeax_team.deliveries d WHERE d.entry_id=z.id AND d.recipient=any(m))
       AND NOT EXISTS(SELECT 1 FROM timeax_team.deliveries d WHERE d.entry_id=z.id AND NOT(d.recipient=any(m)))) ORDER BY z.id) INTO e;
  v_mark:='('||array_to_string(array_append(m,i)||e,'|')||')';
  IF NOT p_apply THEN
    SELECT encode(sha256(convert_to(coalesce(string_agg(v,':' ORDER BY v),''),'UTF8')),'hex') INTO h FROM (
      SELECT to_jsonb(z)::text v FROM timeax_team.entries z WHERE id=any(e) OR payload->>'replyTo'=any(ARRAY(SELECT unnest(e)::text))
      UNION ALL SELECT to_jsonb(z)::text FROM timeax_team.deliveries z WHERE recipient=any(m) OR entry_id=any(e)
      UNION ALL SELECT to_jsonb(z)::text FROM timeax_team.templates z WHERE identity_id=i
      UNION ALL SELECT to_jsonb(z)::text FROM timeax_team.events z WHERE actor=i OR (to_jsonb(z)::text ~ v_mark)
    ) x;
    RETURN jsonb_build_object('entries',to_jsonb(e),'revision',h);
  END IF;
  DELETE FROM timeax_team.events WHERE actor=i OR COALESCE(result->>'id',input->>'id')=any(ARRAY(SELECT unnest(e)::text));
  -- Preserve group entries and remove just this recipient from their event history.
  UPDATE timeax_team.events ev SET input=jsonb_set(input,'{recipients}',(
      SELECT coalesce(jsonb_agg(x.value ORDER BY x.n),'[]'::jsonb)
      FROM jsonb_array_elements(ev.input->'recipients') WITH ORDINALITY x(value,n)
      WHERE NOT (x.value#>>'{}'=any(ARRAY(SELECT unnest(m)::text)))))
    WHERE jsonb_typeof(input->'recipients')='array' AND (input->'recipients') ?| ARRAY(SELECT unnest(m)::text);
  UPDATE timeax_team.entries SET payload=payload-'replyTo' WHERE payload->>'replyTo'=any(ARRAY(SELECT unnest(e)::text));
  IF EXISTS(SELECT 1 FROM timeax_team.events z WHERE to_jsonb(z)::text ~ v_mark) THEN
    RAISE EXCEPTION 'Unmapped team history' USING ERRCODE='23514';
  END IF;
  DELETE FROM timeax_team.deliveries WHERE recipient=any(m) OR entry_id=any(e);
  DELETE FROM timeax_team.entries WHERE id=any(e);
  DELETE FROM timeax_team.templates WHERE identity_id=i;
  RETURN jsonb_build_object('state','deleted');
 END
 $team_reset$;
 GRANT EXECUTE ON FUNCTION timeax_team.admin_clear_test_worker(uuid,uuid[],boolean,boolean) TO postgres;
 REVOKE ALL ON FUNCTION timeax_team.admin_clear_test_worker(uuid,uuid[],boolean,boolean) FROM PUBLIC, anon, authenticated, service_role, timeax_account_admin_login;
 ALTER FUNCTION timeax_team.admin_clear_test_worker(uuid,uuid[],boolean,boolean) OWNER TO timeax_team_owner;
 FOR item IN SELECT grantor,inherit_option,set_option FROM pg_auth_members WHERE member=actor AND roleid=team_owner LOOP
  IF NOT before_grants ? item.grantor::text THEN
   EXECUTE format('REVOKE timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(item.grantor));
  ELSE
   IF item.inherit_option AND NOT (before_grants->item.grantor::text->>'inherit_option')::boolean THEN
    EXECUTE format('REVOKE INHERIT OPTION FOR timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(item.grantor));
   END IF;
   IF item.set_option AND NOT (before_grants->item.grantor::text->>'set_option')::boolean THEN
    EXECUTE format('REVOKE SET OPTION FOR timeax_team_owner FROM %I GRANTED BY %I RESTRICT',current_user,pg_get_userbyid(item.grantor));
   END IF;
  END IF;
 END LOOP;
 IF before_grants IS DISTINCT FROM (SELECT coalesce(jsonb_object_agg(grantor::text,to_jsonb(g)),'{}') FROM pg_auth_members g WHERE member=actor AND roleid=team_owner) THEN RAISE EXCEPTION 'Team permissions changed'; END IF;
END
$team_install$;

-- Match UUID-valued fields, not substrings or a supplied SQL fragment.
CREATE FUNCTION timeax_core.worker_reset_contains_ref(v jsonb, ids uuid[])
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $match$
 SELECT cardinality(ids)>0 AND v::text ~ ('"('||array_to_string(ids,'|')||')"')
$match$;
REVOKE ALL ON FUNCTION timeax_core.worker_reset_contains_ref(jsonb,uuid[]) FROM PUBLIC,anon,authenticated,service_role,timeax_account_admin_login;

CREATE FUNCTION timeax_core.admin_test_worker_reset(a uuid, confirmation jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $reset$
DECLARE i uuid; mail text; created timestamptz;
 m uuid[]; internal_ids uuid[]; factory_ids uuid[]; apps uuid[]; drafts uuid[]; pay_events uuid[]; name_events uuid[]; team_ids uuid[];
 ehash bytea; pepper text; normalized text; h text; pieces text[]; rev text; impact jsonb; team jsonb;
 owned_ids uuid[]; t record; snap record; remaining jsonb; gross bigint; paid bigint;
 changes jsonb:='[]'::jsonb; meta record; baseline_gross bigint; baseline_paid bigint;
 v_issuer constant text:='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1';
BEGIN
 IF current_user<>'postgres' OR session_user<>'timeax_account_admin_login' THEN
   RAISE EXCEPTION 'Denied' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM timeax_core.admin_test_worker_resets WHERE account_id=a FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not-enabled'); END IF;
 IF confirmation IS NOT NULL THEN
   SET LOCAL lock_timeout='3s';
   PERFORM pg_advisory_xact_lock(hashtextextended(v_issuer||'/'||a::text,0));
   LOCK TABLE timeax_core.timecard_revisions,timeax_core.factory_timecard_events,timeax_core.payroll_publications,timeax_core.payroll_events,
    timeax_core.payroll_rates,timeax_core.payroll_group_assignments,timeax_core.worker_membership_endings,timeax_core.member_name_events,
    timeax_core.internal_timecards,timeax_core.received_factory_timecards,timeax_core.account_closures IN ACCESS EXCLUSIVE MODE;
   LOCK TABLE timeax_push.jobs,timeax_push.subscriptions,timeax_core.inbox_dispositions,timeax_core.earlier_shift_requests,
    timeax_core.backdated_shift_notice_reads,timeax_core.backdated_shift_notices,timeax_core.timecard_shifts,timeax_core.factory_timecard_shifts,
    timeax_core.payroll_notifications,timeax_core.payroll_drafts,timeax_core.personal_received_payslips,timeax_core.pay_estimate_settings,
    timeax_core.agency_worker_join_reads,timeax_core.agency_worker_join_events,timeax_core.worker_duplicate_code_receipts,
    timeax_core.agency_worker_applications,timeax_core.worker_email_invitations,timeax_core.member_display_names,
    timeax_core.agency_worksite_grant_history,timeax_core.worksite_membership_grants,timeax_core.factory_owned_worker_invitations,
    timeax_core.factory_roster_links,timeax_core.factory_worker_placements,timeax_core.account_deletion_intents,
    timeax_core.account_provider_cleanup,timeax_core.account_recovery_requests,timeax_core.worker_terms_receipts,timeax_core.web_sessions,
    timeax_core.memberships,timeax_core.identities,auth.users,auth.flow_state,auth.refresh_tokens IN SHARE ROW EXCLUSIVE MODE;
 END IF;
 SELECT email,created_at INTO mail,created FROM auth.users WHERE id=a AND deleted_at IS NULL AND email IS NOT NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked'); END IF;
 normalized:=lower(btrim(mail));
 SELECT id INTO i FROM timeax_core.identities WHERE timeax_core.identities.issuer=v_issuer AND subject=a::text;
 IF i IS NULL OR EXISTS(SELECT FROM timeax_core.memberships WHERE identity_id=i AND role<>'worker') THEN
   RETURN jsonb_build_object('state','blocked');
 END IF;
 SELECT ARRAY(SELECT id FROM timeax_core.memberships WHERE identity_id=i ORDER BY id) INTO m;
 SELECT ARRAY(SELECT id FROM timeax_core.agency_worker_applications x WHERE x.issuer=v_issuer AND x.subject=a::text ORDER BY id) INTO apps;
 IF cardinality(m)=0 AND cardinality(apps)=0 AND NOT EXISTS(SELECT FROM timeax_core.worker_terms_receipts WHERE user_id=a)
    AND NOT EXISTS(SELECT FROM timeax_core.personal_received_payslips WHERE worker_identity_id=i) THEN
   RETURN jsonb_build_object('state','blocked');
 END IF;
 IF EXISTS(SELECT FROM timeax_core.admin_test_agency_resets WHERE account_id=a)
   OR EXISTS(SELECT FROM timeax_core.registration_reviewers WHERE identity_id=i)
   OR EXISTS(SELECT FROM timeax_core.factory_authority_reviewers WHERE identity_id=i)
   OR EXISTS(SELECT FROM timeax_core.employer_archive_reviews WHERE identity_id=i)
   OR EXISTS(SELECT FROM timeax_core.agency_registration_requests x WHERE x.issuer=v_issuer AND x.subject=a::text)
   OR EXISTS(SELECT FROM timeax_core.factory_registration_requests WHERE identity_id=i OR reviewed_by=i)
   OR EXISTS(SELECT FROM timeax_core.worksite_setup_operations x WHERE x.issuer=v_issuer AND x.subject=a::text)
   OR EXISTS(SELECT FROM storage.objects WHERE owner=a OR owner_id=a::text)
   OR EXISTS(SELECT FROM auth.scim_users WHERE user_id=a)
   OR EXISTS(SELECT FROM timeax_owner_qa.audit WHERE actor_identity=i OR membership_id=any(m))
   OR EXISTS(SELECT FROM timeax_owner_qa.memberships WHERE membership_id=any(m))
   OR EXISTS(SELECT FROM timeax_owner_qa.grants x WHERE x.issuer=v_issuer AND x.subject=a::text)
   OR EXISTS(SELECT FROM timeax_enrollment_private.intent WHERE before_subject=a)
   OR EXISTS(SELECT FROM timeax_core.factory_roster_units WHERE leader_id=any(m))
   OR EXISTS(SELECT FROM timeax_core.payroll_drafts WHERE assignee_id=any(m) AND NOT member_id=any(m))
   OR EXISTS(SELECT FROM timeax_core.agency_worker_applications WHERE approved_by_membership_id=any(m) OR (worker_membership_id=any(m) AND NOT id=any(apps)))
   OR EXISTS(SELECT FROM timeax_core.earlier_shift_requests WHERE reviewed_by=any(m) AND NOT worker_id=any(m))
   OR EXISTS(SELECT FROM timeax_core.member_display_names WHERE checked_by=any(m) AND NOT membership_id=any(m)) THEN
   RETURN jsonb_build_object('state','blocked');
 END IF;
 SELECT secret INTO STRICT pepper FROM timeax_core.worker_email_invitation_pepper WHERE singleton;
 ehash:=sha256(convert_to(pepper||':'||normalized,'UTF8'));
 SELECT ARRAY(SELECT id FROM timeax_core.timecard_shifts WHERE membership_id=any(m) ORDER BY id),
        ARRAY(SELECT id FROM timeax_core.factory_timecard_shifts WHERE membership_id=any(m) ORDER BY id),
        ARRAY(SELECT id FROM timeax_core.payroll_drafts WHERE member_id=any(m) ORDER BY id)
  INTO internal_ids,factory_ids,drafts;
 IF EXISTS(SELECT FROM timeax_core.timecard_revisions WHERE actor_identity=i AND NOT shift_id=any(internal_ids))
    OR EXISTS(SELECT FROM timeax_core.factory_timecard_events WHERE actor_identity=i AND NOT shift_id=any(factory_ids)) THEN
   RETURN jsonb_build_object('state','blocked');
 END IF;
 owned_ids:=array_append(array_append(m||internal_ids||factory_ids||apps||drafts,i),a);
 SELECT ARRAY(SELECT id FROM timeax_core.payroll_events x WHERE actor_id=i OR timeax_core.worker_reset_contains_ref(to_jsonb(x),owned_ids) ORDER BY id),
        ARRAY(SELECT id FROM timeax_core.member_name_events x WHERE actor_id=i OR timeax_core.worker_reset_contains_ref(to_jsonb(x),owned_ids) ORDER BY id)
 INTO pay_events,name_events;
 IF EXISTS(SELECT FROM timeax_core.payroll_events x WHERE x.id=any(pay_events) AND (
    EXISTS(SELECT FROM timeax_core.memberships z WHERE z.role='worker' AND NOT z.id=any(m) AND timeax_core.worker_reset_contains_ref(x.input||x.result,ARRAY[z.id]))
    OR EXISTS(SELECT FROM timeax_core.payroll_drafts z WHERE NOT z.id=any(drafts) AND timeax_core.worker_reset_contains_ref(x.input||x.result,ARRAY[z.id]))))
 THEN RETURN jsonb_build_object('state','blocked'); END IF;

 team:=timeax_team.admin_clear_test_worker(i,m,confirmation IS NOT NULL,false);
 IF team->>'state'='blocked' THEN RETURN team; END IF;
 SELECT ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(team->'entries')) INTO team_ids;
 pieces:=ARRAY[mail,team->>'revision'];
 -- Snapshots are shared: remove only attributed rows, preserve order and recompute
 -- the actual totals. Unknown versions or unexplained references block the reset.
 FOR snap IN
   SELECT 'internal_timecards' tbl,'immutable_snapshot' trigger_name,id,snapshot,created_by FROM timeax_core.internal_timecards
   WHERE timeax_core.worker_reset_contains_ref(snapshot,owned_ids) OR created_by=i
   UNION ALL SELECT 'received_factory_timecards','factory_receipt_immutable',id,snapshot,created_by FROM timeax_core.received_factory_timecards
   WHERE timeax_core.worker_reset_contains_ref(snapshot,owned_ids) OR created_by=i
 LOOP
   IF jsonb_typeof(snap.snapshot->'rows') IS DISTINCT FROM 'array' OR snap.created_by=i OR
      (snap.snapshot->>'grossMinutes') IS NULL OR (snap.snapshot->>'grossMinutes') !~ '^[0-9]+$'
      OR (snap.snapshot->>'paidMinutes') IS NULL OR (snap.snapshot->>'paidMinutes') !~ '^[0-9]+$'
      OR EXISTS(SELECT FROM jsonb_array_elements(snap.snapshot->'rows') r
          WHERE jsonb_typeof(r) IS DISTINCT FROM 'object' OR r->>'membershipId' IS NULL
            OR NOT coalesce((r->'data'->>'grossMinutes') ~ '^[0-9]+$',false)
            OR NOT coalesce((r->'data'->>'paidMinutes') ~ '^[0-9]+$',false)) THEN
     RETURN jsonb_build_object('state','blocked');
   END IF;
   SELECT coalesce(sum((r->'data'->>'grossMinutes')::bigint),0),coalesce(sum((r->'data'->>'paidMinutes')::bigint),0)
    INTO baseline_gross,baseline_paid FROM jsonb_array_elements(snap.snapshot->'rows') r;
   IF baseline_gross<>(snap.snapshot->>'grossMinutes')::bigint OR baseline_paid<>(snap.snapshot->>'paidMinutes')::bigint THEN
     RETURN jsonb_build_object('state','blocked');
   END IF;
   SELECT coalesce(jsonb_agg(r ORDER BY n),'[]'::jsonb),coalesce(sum((r->'data'->>'grossMinutes')::bigint),0),coalesce(sum((r->'data'->>'paidMinutes')::bigint),0)
    INTO remaining,gross,paid FROM jsonb_array_elements(snap.snapshot->'rows') WITH ORDINALITY z(r,n)
    WHERE NOT (r->>'membershipId'=any(ARRAY(SELECT unnest(m)::text)));
   remaining:=snap.snapshot||jsonb_build_object('rows',remaining,'grossMinutes',gross,'paidMinutes',paid);
   IF timeax_core.worker_reset_contains_ref(remaining,owned_ids) OR remaining=snap.snapshot THEN
     RETURN jsonb_build_object('state','blocked');
   END IF;
   changes:=changes||jsonb_build_array(jsonb_build_object('table',snap.tbl,'trigger',snap.trigger_name,'id',snap.id,'snapshot',remaining));
   pieces:=array_append(pieces,encode(sha256(convert_to(to_jsonb(snap)::text,'UTF8')),'hex'));
 END LOOP;

 -- Hash the complete affected records before touching any row. All candidate
 -- predicates below are migration constants; arguments are separately bound.
 FOR t IN SELECT * FROM (VALUES
    (1,'timeax_push.jobs',$p$last_recipient=any($2) OR subscription_id IN(SELECT id FROM timeax_push.subscriptions WHERE identity_id=$1)$p$,null::text),
    (2,'timeax_push.subscriptions',$p$identity_id=$1$p$,null::text),
    (3,'timeax_core.inbox_dispositions',$p$membership_id=any($2) OR (kind IN ('team-message','team-notice') AND entry_id=any($11)) OR (kind='agency-join' AND entry_id=any($2)) OR (kind='backdated-internal' AND entry_id=any($3)) OR (kind='backdated-factory' AND entry_id=any($4))$p$,null::text),
    (4,'timeax_core.earlier_shift_requests',$p$worker_id=any($2)$p$,null::text),
    (5,'timeax_core.backdated_shift_notice_reads',$p$reader_id=any($2) OR (source='internal' AND shift_id=any($3)) OR (source='factory' AND shift_id=any($4))$p$,null::text),
    (6,'timeax_core.backdated_shift_notices',$p$membership_id=any($2)$p$,null::text),
    (7,'timeax_core.timecard_revisions',$p$shift_id=any($3)$p$,'immutable_revision'),
    (8,'timeax_core.timecard_shifts',$p$id=any($3)$p$,null::text),
    (9,'timeax_core.factory_timecard_events',$p$shift_id=any($4)$p$,'factory_events_immutable'),
    (10,'timeax_core.factory_timecard_shifts',$p$id=any($4)$p$,null::text),
    (11,'timeax_core.payroll_notifications',$p$publication_id=any($6) OR membership_id=any($2)$p$,null::text),
    (12,'timeax_core.payroll_events',$p$id=any($10)$p$,'payroll_event_immutable'),
    (13,'timeax_core.payroll_publications',$p$id=any($6)$p$,'payroll_publication_immutable'),
    (14,'timeax_core.payroll_drafts',$p$id=any($6)$p$,null::text),
    (15,'timeax_core.personal_received_payslips',$p$worker_identity_id=$1$p$,null::text),
    (16,'timeax_core.payroll_group_assignments',$p$member_id=any($2)$p$,'payroll_group_assignment_immutable'),
    (17,'timeax_core.payroll_rates',$p$member_id=any($2)$p$,'payroll_rate_immutable'),
    (18,'timeax_core.pay_estimate_settings',$p$worker_id=any($2)$p$,null::text),
    (19,'timeax_core.agency_worker_join_reads',$p$membership_id=any($2) OR reader_id=any($2)$p$,null::text),
    (20,'timeax_core.agency_worker_join_events',$p$membership_id=any($2)$p$,null::text),
    (21,'timeax_core.worker_duplicate_code_receipts',$p$application_id=any($5)$p$,null::text),
    (22,'timeax_core.agency_worker_applications',$p$id=any($5)$p$,null::text),
    (23,'timeax_core.worker_email_invitations',$p$email_digest=$7$p$,null::text),
    (24,'timeax_core.worker_membership_endings',$p$membership_id=any($2)$p$,'membership_ending_immutable'),
    (25,'timeax_core.member_name_events',$p$id=any($12)$p$,'name_events_immutable'),
    (26,'timeax_core.member_display_names',$p$membership_id=any($2)$p$,null::text),
    (27,'timeax_core.agency_worksite_grant_history',$p$membership_id=any($2)$p$,null::text),
    (28,'timeax_core.worksite_membership_grants',$p$membership_id=any($2)$p$,null::text),
    (29,'timeax_core.factory_owned_worker_invitations',$p$claimed_identity=$1 OR membership_id=any($2)$p$,null::text),
    (30,'timeax_core.factory_roster_links',$p$membership_id=any($2)$p$,null::text),
    (31,'timeax_core.factory_worker_placements',$p$membership_id=any($2)$p$,null::text),
    (32,'timeax_core.account_deletion_intents',$p$identity_id=$1$p$,null::text),
    (33,'timeax_core.account_provider_cleanup',$p$identity_id=$1$p$,null::text),
    (34,'timeax_core.account_closures',$p$identity_id=$1$p$,'account_closure_immutable'),
    (35,'timeax_core.account_recovery_requests',$p$lower(btrim(contact_email))=$9$p$,null::text),
    (36,'timeax_core.worker_terms_receipts',$p$user_id=$8$p$,null::text),
    (37,'timeax_core.web_sessions',$p$subject=$8$p$,null::text),
    (38,'timeax_core.memberships',$p$id=any($2)$p$,null::text),
    (39,'timeax_core.identities',$p$id=$1$p$,null::text),
    (40,'auth.flow_state',$p$user_id=$8$p$,null::text),
    (41,'auth.refresh_tokens',$p$user_id=$8::text$p$,null::text),
    (42,'auth.users',$p$id=$8$p$,null::text)
 ) v(seq,relation,qualification,immutable_trigger) ORDER BY seq LOOP
     EXECUTE format($f$SELECT encode(sha256(convert_to(coalesce(string_agg(h,':' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT md5(to_jsonb(x)::text) h FROM %s x WHERE %s) z$f$,t.relation,t.qualification)
       INTO h USING i,m,internal_ids,factory_ids,apps,drafts,ehash,a,normalized,pay_events,team_ids,name_events;
     pieces:=array_append(pieces,h);
 END LOOP;
 rev:=encode(sha256(convert_to(array_to_string(ARRAY(SELECT x FROM unnest(pieces) x ORDER BY x),':'),'UTF8')),'hex');
 SELECT jsonb_build_object('membershipsRemoved',cardinality(m),'shiftsRemoved',cardinality(internal_ids)+cardinality(factory_ids),
    'payslipsRemoved',(SELECT count(DISTINCT x.id) FROM (
      SELECT id FROM timeax_core.payroll_publications WHERE id=any(drafts)
      UNION ALL SELECT id FROM timeax_core.personal_received_payslips WHERE worker_identity_id=i) x))
 INTO impact;
 IF confirmation IS NULL THEN
   RETURN jsonb_build_object('state','preview','id',a,'email',mail,'createdAt',created,'scope','test-worker','canDelete',true,
      'reset',jsonb_build_object('revision',rev,'impact',impact));
 END IF;
 IF confirmation IS DISTINCT FROM jsonb_build_object('email',mail,'revision',rev) THEN
   RETURN jsonb_build_object('state','changed');
 END IF;

 PERFORM timeax_team.admin_clear_test_worker(i,m,true,true);
 FOR snap IN SELECT * FROM jsonb_to_recordset(changes) AS z("table" text,"trigger" text,id uuid,snapshot jsonb) LOOP
   EXECUTE format('ALTER TABLE timeax_core.%I DISABLE TRIGGER %I',snap."table",snap."trigger");
   IF jsonb_array_length(snap.snapshot->'rows')=0 THEN
     EXECUTE format('DELETE FROM timeax_core.%I WHERE id=$1',snap."table") USING snap.id;
   ELSE
     EXECUTE format('UPDATE timeax_core.%I SET snapshot=$2 WHERE id=$1',snap."table") USING snap.id,snap.snapshot;
   END IF;
   EXECUTE format('ALTER TABLE timeax_core.%I ENABLE TRIGGER %I',snap."table",snap."trigger");
 END LOOP;
 FOR t IN SELECT * FROM (VALUES
    (1,'timeax_push.jobs',$p$last_recipient=any($2) OR subscription_id IN(SELECT id FROM timeax_push.subscriptions WHERE identity_id=$1)$p$,null::text),
    (2,'timeax_push.subscriptions',$p$identity_id=$1$p$,null::text),
    (3,'timeax_core.inbox_dispositions',$p$membership_id=any($2) OR (kind IN ('team-message','team-notice') AND entry_id=any($11)) OR (kind='agency-join' AND entry_id=any($2)) OR (kind='backdated-internal' AND entry_id=any($3)) OR (kind='backdated-factory' AND entry_id=any($4))$p$,null::text),
    (4,'timeax_core.earlier_shift_requests',$p$worker_id=any($2)$p$,null::text),
    (5,'timeax_core.backdated_shift_notice_reads',$p$reader_id=any($2) OR (source='internal' AND shift_id=any($3)) OR (source='factory' AND shift_id=any($4))$p$,null::text),
    (6,'timeax_core.backdated_shift_notices',$p$membership_id=any($2)$p$,null::text),
    (7,'timeax_core.timecard_revisions',$p$shift_id=any($3)$p$,'immutable_revision'),
    (8,'timeax_core.timecard_shifts',$p$id=any($3)$p$,null::text),
    (9,'timeax_core.factory_timecard_events',$p$shift_id=any($4)$p$,'factory_events_immutable'),
    (10,'timeax_core.factory_timecard_shifts',$p$id=any($4)$p$,null::text),
    (11,'timeax_core.payroll_notifications',$p$publication_id=any($6) OR membership_id=any($2)$p$,null::text),
    (12,'timeax_core.payroll_events',$p$id=any($10)$p$,'payroll_event_immutable'),
    (13,'timeax_core.payroll_publications',$p$id=any($6)$p$,'payroll_publication_immutable'),
    (14,'timeax_core.payroll_drafts',$p$id=any($6)$p$,null::text),
    (15,'timeax_core.personal_received_payslips',$p$worker_identity_id=$1$p$,null::text),
    (16,'timeax_core.payroll_group_assignments',$p$member_id=any($2)$p$,'payroll_group_assignment_immutable'),
    (17,'timeax_core.payroll_rates',$p$member_id=any($2)$p$,'payroll_rate_immutable'),
    (18,'timeax_core.pay_estimate_settings',$p$worker_id=any($2)$p$,null::text),
    (19,'timeax_core.agency_worker_join_reads',$p$membership_id=any($2) OR reader_id=any($2)$p$,null::text),
    (20,'timeax_core.agency_worker_join_events',$p$membership_id=any($2)$p$,null::text),
    (21,'timeax_core.worker_duplicate_code_receipts',$p$application_id=any($5)$p$,null::text),
    (22,'timeax_core.agency_worker_applications',$p$id=any($5)$p$,null::text),
    (23,'timeax_core.worker_email_invitations',$p$email_digest=$7$p$,null::text),
    (24,'timeax_core.worker_membership_endings',$p$membership_id=any($2)$p$,'membership_ending_immutable'),
    (25,'timeax_core.member_name_events',$p$id=any($12)$p$,'name_events_immutable'),
    (26,'timeax_core.member_display_names',$p$membership_id=any($2)$p$,null::text),
    (27,'timeax_core.agency_worksite_grant_history',$p$membership_id=any($2)$p$,null::text),
    (28,'timeax_core.worksite_membership_grants',$p$membership_id=any($2)$p$,null::text),
    (29,'timeax_core.factory_owned_worker_invitations',$p$claimed_identity=$1 OR membership_id=any($2)$p$,null::text),
    (30,'timeax_core.factory_roster_links',$p$membership_id=any($2)$p$,null::text),
    (31,'timeax_core.factory_worker_placements',$p$membership_id=any($2)$p$,null::text),
    (32,'timeax_core.account_deletion_intents',$p$identity_id=$1$p$,null::text),
    (33,'timeax_core.account_provider_cleanup',$p$identity_id=$1$p$,null::text),
    (34,'timeax_core.account_closures',$p$identity_id=$1$p$,'account_closure_immutable'),
    (35,'timeax_core.account_recovery_requests',$p$lower(btrim(contact_email))=$9$p$,null::text),
    (36,'timeax_core.worker_terms_receipts',$p$user_id=$8$p$,null::text),
    (37,'timeax_core.web_sessions',$p$subject=$8$p$,null::text),
    (38,'timeax_core.memberships',$p$id=any($2)$p$,null::text),
    (39,'timeax_core.identities',$p$id=$1$p$,null::text),
    (40,'auth.flow_state',$p$user_id=$8$p$,null::text),
    (41,'auth.refresh_tokens',$p$user_id=$8::text$p$,null::text),
    (42,'auth.users',$p$id=$8$p$,null::text)
 ) v(seq,relation,qualification,immutable_trigger) ORDER BY seq LOOP
   IF t.immutable_trigger IS NOT NULL THEN
     EXECUTE format('SELECT EXISTS(SELECT FROM %s WHERE %s)',t.relation,t.qualification)
       INTO meta USING i,m,internal_ids,factory_ids,apps,drafts,ehash,a,normalized,pay_events,team_ids,name_events;
     IF NOT meta.exists THEN CONTINUE; END IF;
     EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I',t.relation,t.immutable_trigger);
   END IF;
   EXECUTE format('DELETE FROM %s WHERE %s',t.relation,t.qualification)
      USING i,m,internal_ids,factory_ids,apps,drafts,ehash,a,normalized,pay_events,team_ids,name_events;
   IF t.immutable_trigger IS NOT NULL THEN EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I',t.relation,t.immutable_trigger); END IF;
 END LOOP;
 RETURN jsonb_build_object('state','deleted','id',a);
EXCEPTION WHEN foreign_key_violation OR check_violation OR lock_not_available OR feature_not_supported THEN
 -- PL/pgSQL exception blocks roll back the whole operation, including trigger state.
 RETURN jsonb_build_object('state','blocked');
END
$reset$;
REVOKE ALL ON FUNCTION timeax_core.admin_test_worker_reset(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role,timeax_account_admin_login;
COMMIT;
