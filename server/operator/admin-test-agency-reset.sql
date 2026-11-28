-- Apply only with the personal received-payslip archive migration and reviewed
-- account/admin RPC fingerprints. No test accounts are opted in by this migration.
BEGIN;
CREATE TABLE timeax_core.admin_test_agency_resets (
  account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id uuid UNIQUE NOT NULL
);
ALTER TABLE timeax_core.admin_test_agency_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.admin_test_agency_resets FROM PUBLIC, anon, authenticated, service_role, timeax_account_admin_login;

-- Chat data is owned by a different role. Grant no table writes or owner role
-- to the web database account. The coordinator is the only permitted caller.
DO $team_install$
DECLARE actor oid:=current_user::regrole; team_owner oid:='timeax_team_owner'::regrole;
 before_grants jsonb; item record;
BEGIN
 SELECT coalesce(jsonb_object_agg(grantor::text,to_jsonb(g)),'{}') INTO before_grants
 FROM pg_auth_members g WHERE member=actor AND roleid=team_owner;
 IF NOT pg_has_role(actor,team_owner,'USAGE') THEN GRANT timeax_team_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE; END IF;
 CREATE FUNCTION timeax_team.admin_clear_test_agency(p_org uuid,p_identity uuid,p_apply boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $team_reset$
 DECLARE o alias for p_org; i alias for p_identity; m uuid[]; e uuid[];
 BEGIN
  IF session_user<>'timeax_account_admin_login' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  LOCK TABLE timeax_team.deliveries, timeax_team.entries, timeax_team.events, timeax_team.templates, timeax_team.accountant_invitations IN SHARE ROW EXCLUSIVE MODE;
  IF NOT p_apply THEN RETURN; END IF;
  SELECT ARRAY(SELECT id FROM timeax_core.memberships WHERE organization_id=o) INTO m;
  SELECT ARRAY(SELECT id FROM timeax_team.entries WHERE sender=any(m)) INTO e;
  IF EXISTS(SELECT 1 FROM timeax_team.deliveries WHERE (entry_id=any(e))<>(recipient=any(m))) THEN
    RAISE EXCEPTION 'External delivery' USING ERRCODE='23514';
  END IF;
  DELETE FROM timeax_team.deliveries WHERE entry_id=any(e);
  DELETE FROM timeax_team.entries WHERE id=any(e);
  DELETE FROM timeax_team.events WHERE input->>'organizationId'=o::text;
  DELETE FROM timeax_team.templates WHERE identity_id=i;
  DELETE FROM timeax_team.accountant_invitations WHERE organization_id=o;
 END
 $team_reset$;
 GRANT EXECUTE ON FUNCTION timeax_team.admin_clear_test_agency(uuid,uuid,boolean) TO postgres;
 REVOKE ALL ON FUNCTION timeax_team.admin_clear_test_agency(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role, timeax_account_admin_login;
 ALTER FUNCTION timeax_team.admin_clear_test_agency(uuid,uuid,boolean) OWNER TO timeax_team_owner;
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

CREATE FUNCTION timeax_core.admin_test_agency_reset(a uuid, confirmation jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $reset$
DECLARE i uuid; o uuid; mail text; label text; created timestamptz;
        m uuid[]; sh uuid[]; e uuid[]; w uuid[]; rev text; impact jsonb;
BEGIN
  IF current_user<>'postgres' OR session_user<>'timeax_account_admin_login' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  SELECT agency_id INTO o FROM timeax_core.admin_test_agency_resets WHERE account_id=a FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','not-enabled'); END IF;
  IF confirmation IS NOT NULL THEN
    SET LOCAL lock_timeout='3s';
    PERFORM pg_advisory_xact_lock(hashtextextended('https://rohgpgogsdtiltbocdao.supabase.co/auth/v1/'||a::text,0));
    LOCK TABLE timeax_core.timecard_revisions, timeax_core.payroll_publications, timeax_core.payroll_rates, timeax_core.payroll_events, timeax_core.internal_timecards, timeax_core.worker_membership_endings, timeax_core.member_name_events, timeax_core.payroll_group_assignments, timeax_core.received_factory_timecards, timeax_core.agency_trial_clock, timeax_core.agency_trials IN ACCESS EXCLUSIVE MODE;
    LOCK TABLE timeax_push.jobs, timeax_push.subscriptions, timeax_core.inbox_dispositions, timeax_core.earlier_shift_requests, timeax_core.backdated_shift_notice_reads, timeax_core.backdated_shift_notices, timeax_core.timecard_shifts, timeax_core.payroll_notifications, timeax_core.payroll_drafts, timeax_core.payroll_groups, timeax_core.payroll_settings, timeax_core.pay_estimate_settings, timeax_core.agency_worker_join_reads, timeax_core.agency_worker_join_events, timeax_core.worker_duplicate_code_receipts, timeax_core.agency_worker_applications, timeax_core.agency_worker_invitations, timeax_core.worker_email_invitations, timeax_core.member_display_names, timeax_core.worksite_membership_grants, timeax_core.agency_worksite_grant_history, timeax_core.agency_worksite_preferences, timeax_core.worksite_organization_grants, timeax_core.worksite_setup_operations, timeax_core.worksites, timeax_core.agency_contact_settings, timeax_core.worker_discoverable_agencies, timeax_core.worker_hidden_agencies, timeax_core.agency_factory_connection_invitations, timeax_core.agency_verified_nips, timeax_core.self_service_agencies, timeax_core.memberships, timeax_core.organizations, timeax_core.agency_registration_requests, timeax_core.web_sessions, timeax_core.identities, auth.users, auth.refresh_tokens, auth.flow_state IN SHARE ROW EXCLUSIVE MODE;
    PERFORM timeax_team.admin_clear_test_agency(o,NULL,false);
  END IF;
  SELECT ci.id, u.email, u.created_at, org.name INTO i,mail,created,label
    FROM auth.users u JOIN timeax_core.identities ci ON ci.subject=u.id::text
    JOIN timeax_core.self_service_agencies sa ON sa.identity_id=ci.id
    JOIN timeax_core.organizations org ON org.id=sa.organization_id
    JOIN timeax_core.memberships mm ON mm.organization_id=org.id AND mm.identity_id=ci.id
    WHERE u.id=a AND u.email IS NOT NULL AND u.deleted_at IS NULL
      AND ci.issuer='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1' AND ci.active
      AND org.id=o AND org.kind='agency' AND org.state='active' AND mm.role='agency_admin' AND mm.state='active';
  IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked'); END IF;
  SELECT ARRAY(SELECT id FROM timeax_core.memberships WHERE organization_id=o) INTO m;
  SELECT ARRAY(SELECT id FROM timeax_core.timecard_shifts WHERE organization_id=o) INTO sh;
  SELECT ARRAY(SELECT id FROM timeax_team.entries WHERE sender=any(m)) INTO e;
  SELECT ARRAY(SELECT id FROM timeax_core.worksites WHERE owner_organization_id=o) INTO w;
  IF EXISTS(SELECT 1 FROM timeax_core.memberships WHERE id=any(m) AND role='agency_admin' AND identity_id<>i) THEN
    RETURN jsonb_build_object('state','blocked');
  END IF;
  IF (select count(*) from timeax_team.deliveries where (entry_id=any(e)) <> (recipient=any(m)))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- externalDelivery
  IF (select count(*) from timeax_team.entries where site_id in (select id from timeax_core.worksites where owner_organization_id=o) and not (id=any(e)))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- externalTeamEntry
  IF (select count(*) from timeax_core.memberships where identity_id=i and organization_id<>o)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherOwnerRoles
  IF (select count(*) from timeax_core.worksite_organization_grants where (organization_id=o and owner_organization_id<>o) or (owner_organization_id=o and organization_id<>o))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- externalGrants
  IF (select count(*) from timeax_core.factory_connection_requests where agency_id=o)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- externalFactoryConnection
  IF (select count(*) from timeax_core.registration_reviewers where identity_id=i)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- protectedOwner
  IF (select count(*) from storage.objects where owner=a or owner_id=a::text)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- storageFiles
  IF (select count(*) from timeax_core.factory_timecard_shifts where agency_id=o or worksite_id=any(w))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherFactoryShifts
  IF (select count(*) from timeax_core.agency_worksite_preferences where worksite_id=any(w) and organization_id<>o)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherSiteSettings
  IF (select count(*) from timeax_core.worker_email_invitations where worksite_id=any(w) and agency_id<>o)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherSiteInvites
  IF (select count(*) from timeax_core.earlier_shift_requests where agency_id<>o and (worksite_id=any(w) or worker_id=any(m) or reviewed_by=any(m)))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherEarlierRequests
  IF (select count(*) from timeax_core.factory_roster_links where membership_id=any(m))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherRoster
  IF (select count(*) from timeax_core.factory_roster_units where leader_id=any(m))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherRosterLeader
  IF (select count(*) from timeax_push.jobs where organization_id<>o and (last_recipient=any(m) or subscription_id in (select id from timeax_push.subscriptions where identity_id=i)))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherPush
  IF (select count(*) from timeax_core.backdated_shift_notices where agency_id<>o and membership_id=any(m))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherShiftNotice
  IF (select count(*) from timeax_core.backdated_shift_notice_reads r join timeax_core.backdated_shift_notices n using(source,shift_id) where r.reader_id=any(m) and n.agency_id<>o)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherShiftNoticeRead
  IF (select count(*) from timeax_core.payroll_notifications n join timeax_core.payroll_drafts d on d.id=n.publication_id where (n.organization_id=o) <> (d.agency_id=o))<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- otherPayrollNotice
  IF (select count(*) from timeax_owner_qa.organizations where organization_id=o)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- ownerQAMark
  IF (select count(*) from timeax_enrollment_private.intent where before_subject::text=a::text)<>0 THEN RETURN jsonb_build_object('state','blocked'); END IF; -- ownerEnrollmentIntent
  rev:=encode(sha256(convert_to(jsonb_build_array(a,o,i,mail,label,
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_push.jobs z WHERE organization_id=o OR subscription_id IN (SELECT id FROM timeax_push.subscriptions WHERE identity_id=i)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_push.subscriptions z WHERE identity_id=i) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_team.deliveries z WHERE entry_id=any(e)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.inbox_dispositions z WHERE membership_id=any(m)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_team.entries z WHERE id=any(e)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_team.events z WHERE input->>'organizationId'=o::text) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_team.templates z WHERE identity_id=i) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_team.accountant_invitations z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.earlier_shift_requests z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.backdated_shift_notice_reads z WHERE reader_id=any(m) OR (source='internal' AND shift_id=any(sh))) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.backdated_shift_notices z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.timecard_revisions z WHERE shift_id=any(sh)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.timecard_shifts z WHERE id=any(sh)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.payroll_notifications z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.payroll_publications z WHERE id IN (SELECT id FROM timeax_core.payroll_drafts WHERE agency_id=o)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.payroll_drafts z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.payroll_rates z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.payroll_group_assignments z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.payroll_groups z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.payroll_events z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.payroll_settings z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.pay_estimate_settings z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.internal_timecards z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.received_factory_timecards z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_worker_join_reads z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_worker_join_events z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worker_duplicate_code_receipts z WHERE application_id IN (SELECT id FROM timeax_core.agency_worker_applications WHERE agency_id=o)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_worker_applications z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_worker_invitations z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worker_email_invitations z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worker_membership_endings z WHERE membership_id=any(m)) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.member_display_names z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.member_name_events z WHERE actor_id=i) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worksite_membership_grants z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_worksite_grant_history z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_worksite_preferences z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worksite_organization_grants z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worksite_setup_operations z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worksites z WHERE owner_organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_contact_settings z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worker_discoverable_agencies z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.worker_hidden_agencies z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_factory_connection_invitations z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_verified_nips z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_trial_clock z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_trials z WHERE agency_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.self_service_agencies z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.memberships z WHERE organization_id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.organizations z WHERE id=o) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.agency_registration_requests z WHERE issuer='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1' and subject=a::text) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.web_sessions z WHERE subject=a) hashes),
    (SELECT coalesce(array_agg(h ORDER BY h),ARRAY[]::text[]) FROM (SELECT md5(to_jsonb(z)::text) h FROM timeax_core.identities z WHERE id=i) hashes)
  )::text,'UTF8')),'hex');
  impact:=jsonb_build_object(
    'workerAccountsKept',(SELECT count(DISTINCT identity_id) FROM timeax_core.memberships WHERE id=any(m) AND role='worker'),
    'payslipsKept',(SELECT count(*) FROM timeax_core.payroll_publications pub JOIN timeax_core.payroll_drafts d ON d.id=pub.id WHERE d.agency_id=o),
    'worksitesRemoved',cardinality(w),'shiftsRemoved',cardinality(sh)
  );
  IF confirmation IS NULL THEN RETURN jsonb_build_object('state','preview','id',a,'email',mail,'createdAt',created,'scope','test-agency','canDelete',true,
    'reset',jsonb_build_object('organizationId',o,'organizationName',label,'revision',rev,'impact',impact)); END IF;
  IF confirmation IS DISTINCT FROM jsonb_build_object('email',mail,'organizationId',o,'revision',rev) THEN RETURN jsonb_build_object('state','changed'); END IF;
  IF timeax_core.preserve_test_agency_payslips(o)<>(impact->>'payslipsKept')::bigint THEN
    RAISE EXCEPTION 'Archive mismatch' USING ERRCODE='23514';
  END IF;
  PERFORM timeax_team.admin_clear_test_agency(o,i,true);
  DELETE FROM timeax_push.jobs WHERE organization_id=o OR subscription_id IN (SELECT id FROM timeax_push.subscriptions WHERE identity_id=i);
  DELETE FROM timeax_push.subscriptions WHERE identity_id=i;
  DELETE FROM timeax_core.inbox_dispositions WHERE membership_id=any(m);
  DELETE FROM timeax_core.earlier_shift_requests WHERE agency_id=o;
  DELETE FROM timeax_core.backdated_shift_notice_reads WHERE reader_id=any(m) OR (source='internal' AND shift_id=any(sh));
  DELETE FROM timeax_core.backdated_shift_notices WHERE agency_id=o;
  IF EXISTS(SELECT 1 FROM timeax_core.timecard_revisions WHERE shift_id=any(sh)) THEN
    ALTER TABLE timeax_core.timecard_revisions DISABLE TRIGGER immutable_revision;
    DELETE FROM timeax_core.timecard_revisions WHERE shift_id=any(sh);
    ALTER TABLE timeax_core.timecard_revisions ENABLE TRIGGER immutable_revision;
  END IF;
  DELETE FROM timeax_core.timecard_shifts WHERE id=any(sh);
  DELETE FROM timeax_core.payroll_notifications WHERE organization_id=o;
  IF EXISTS(SELECT 1 FROM timeax_core.payroll_publications WHERE id IN (SELECT id FROM timeax_core.payroll_drafts WHERE agency_id=o)) THEN
    ALTER TABLE timeax_core.payroll_publications DISABLE TRIGGER payroll_publication_immutable;
    DELETE FROM timeax_core.payroll_publications WHERE id IN (SELECT id FROM timeax_core.payroll_drafts WHERE agency_id=o);
    ALTER TABLE timeax_core.payroll_publications ENABLE TRIGGER payroll_publication_immutable;
  END IF;
  DELETE FROM timeax_core.payroll_drafts WHERE agency_id=o;
  IF EXISTS(SELECT 1 FROM timeax_core.payroll_rates WHERE agency_id=o) THEN
    ALTER TABLE timeax_core.payroll_rates DISABLE TRIGGER payroll_rate_immutable;
    DELETE FROM timeax_core.payroll_rates WHERE agency_id=o;
    ALTER TABLE timeax_core.payroll_rates ENABLE TRIGGER payroll_rate_immutable;
  END IF;
  IF EXISTS(SELECT 1 FROM timeax_core.payroll_group_assignments WHERE agency_id=o) THEN
    ALTER TABLE timeax_core.payroll_group_assignments DISABLE TRIGGER payroll_group_assignment_immutable;
    DELETE FROM timeax_core.payroll_group_assignments WHERE agency_id=o;
    ALTER TABLE timeax_core.payroll_group_assignments ENABLE TRIGGER payroll_group_assignment_immutable;
  END IF;
  DELETE FROM timeax_core.payroll_groups WHERE agency_id=o;
  IF EXISTS(SELECT 1 FROM timeax_core.payroll_events WHERE agency_id=o) THEN
    ALTER TABLE timeax_core.payroll_events DISABLE TRIGGER payroll_event_immutable;
    DELETE FROM timeax_core.payroll_events WHERE agency_id=o;
    ALTER TABLE timeax_core.payroll_events ENABLE TRIGGER payroll_event_immutable;
  END IF;
  DELETE FROM timeax_core.payroll_settings WHERE agency_id=o;
  DELETE FROM timeax_core.pay_estimate_settings WHERE organization_id=o;
  IF EXISTS(SELECT 1 FROM timeax_core.internal_timecards WHERE organization_id=o) THEN
    ALTER TABLE timeax_core.internal_timecards DISABLE TRIGGER immutable_snapshot;
    DELETE FROM timeax_core.internal_timecards WHERE organization_id=o;
    ALTER TABLE timeax_core.internal_timecards ENABLE TRIGGER immutable_snapshot;
  END IF;
  IF EXISTS(SELECT 1 FROM timeax_core.received_factory_timecards WHERE agency_id=o) THEN
    ALTER TABLE timeax_core.received_factory_timecards DISABLE TRIGGER factory_receipt_immutable;
    DELETE FROM timeax_core.received_factory_timecards WHERE agency_id=o;
    ALTER TABLE timeax_core.received_factory_timecards ENABLE TRIGGER factory_receipt_immutable;
  END IF;
  DELETE FROM timeax_core.agency_worker_join_reads WHERE agency_id=o;
  DELETE FROM timeax_core.agency_worker_join_events WHERE agency_id=o;
  DELETE FROM timeax_core.worker_duplicate_code_receipts WHERE application_id IN (SELECT id FROM timeax_core.agency_worker_applications WHERE agency_id=o);
  DELETE FROM timeax_core.agency_worker_applications WHERE agency_id=o;
  DELETE FROM timeax_core.agency_worker_invitations WHERE agency_id=o;
  DELETE FROM timeax_core.worker_email_invitations WHERE agency_id=o;
  IF EXISTS(SELECT 1 FROM timeax_core.worker_membership_endings WHERE membership_id=any(m)) THEN
    ALTER TABLE timeax_core.worker_membership_endings DISABLE TRIGGER membership_ending_immutable;
    DELETE FROM timeax_core.worker_membership_endings WHERE membership_id=any(m);
    ALTER TABLE timeax_core.worker_membership_endings ENABLE TRIGGER membership_ending_immutable;
  END IF;
  DELETE FROM timeax_core.member_display_names WHERE organization_id=o;
  IF EXISTS(SELECT 1 FROM timeax_core.member_name_events WHERE actor_id=i) THEN
    ALTER TABLE timeax_core.member_name_events DISABLE TRIGGER name_events_immutable;
    DELETE FROM timeax_core.member_name_events WHERE actor_id=i;
    ALTER TABLE timeax_core.member_name_events ENABLE TRIGGER name_events_immutable;
  END IF;
  DELETE FROM timeax_core.worksite_membership_grants WHERE organization_id=o;
  DELETE FROM timeax_core.agency_worksite_grant_history WHERE organization_id=o;
  DELETE FROM timeax_core.agency_worksite_preferences WHERE organization_id=o;
  DELETE FROM timeax_core.worksite_organization_grants WHERE organization_id=o;
  DELETE FROM timeax_core.worksite_setup_operations WHERE organization_id=o;
  DELETE FROM timeax_core.worksites WHERE owner_organization_id=o;
  DELETE FROM timeax_core.agency_contact_settings WHERE organization_id=o;
  DELETE FROM timeax_core.worker_discoverable_agencies WHERE agency_id=o;
  DELETE FROM timeax_core.worker_hidden_agencies WHERE agency_id=o;
  DELETE FROM timeax_core.agency_factory_connection_invitations WHERE agency_id=o;
  DELETE FROM timeax_core.agency_verified_nips WHERE agency_id=o;
  IF EXISTS(SELECT 1 FROM timeax_core.agency_trial_clock WHERE agency_id=o) THEN
    ALTER TABLE timeax_core.agency_trial_clock DISABLE TRIGGER agency_trial_clock_monotonic;
    DELETE FROM timeax_core.agency_trial_clock WHERE agency_id=o;
    ALTER TABLE timeax_core.agency_trial_clock ENABLE TRIGGER agency_trial_clock_monotonic;
  END IF;
  IF EXISTS(SELECT 1 FROM timeax_core.agency_trials WHERE agency_id=o) THEN
    ALTER TABLE timeax_core.agency_trials DISABLE TRIGGER agency_trial_immutable;
    DELETE FROM timeax_core.agency_trials WHERE agency_id=o;
    ALTER TABLE timeax_core.agency_trials ENABLE TRIGGER agency_trial_immutable;
  END IF;
  DELETE FROM timeax_core.self_service_agencies WHERE organization_id=o;
  DELETE FROM timeax_core.memberships WHERE organization_id=o;
  DELETE FROM timeax_core.organizations WHERE id=o;
  DELETE FROM timeax_core.agency_registration_requests WHERE issuer='https://rohgpgogsdtiltbocdao.supabase.co/auth/v1' and subject=a::text;
  DELETE FROM timeax_core.web_sessions WHERE subject=a;
  DELETE FROM timeax_core.identities WHERE id=i;
  DELETE FROM auth.flow_state WHERE user_id=a;
  DELETE FROM auth.refresh_tokens WHERE user_id=a::text;
  DELETE FROM auth.users WHERE id=a;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=a OR lower(email)=lower(mail))
      OR EXISTS(SELECT 1 FROM timeax_core.organizations WHERE id=o)
    THEN RAISE EXCEPTION 'Incomplete test reset'; END IF;
  RETURN jsonb_build_object('state','deleted','id',a);
END
$reset$;
REVOKE ALL ON FUNCTION timeax_core.admin_test_agency_reset(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role, timeax_account_admin_login;

DO $install$
DECLARE rpc constant regprocedure:='timeax_api.admin_accounts(text,uuid,text)'::regprocedure;
 f text := pg_get_functiondef(rpc);
BEGIN
 IF encode(sha256(convert_to(f,'UTF8')),'hex')<>'cf35ca8dbd41a359faf6a21e6213561f2db5034da95fdc6a549858c1fcaf687d'
   OR (SELECT proowner FROM pg_proc WHERE oid=rpc)<>'postgres'::regrole THEN
   RAISE EXCEPTION 'Admin account function changed; review before installing test reset';
 END IF;
 f:=replace(f,$a$'organizations','preview','delete')$a$,$b$'organizations','preview','delete','delete-test-agency')$b$);
 f:=replace(f,$a$  v_blocked boolean;$a$,$b$  v_blocked boolean;
  v_reset jsonb;$b$);
 f:=replace(f,$a$  IF p_id IS NULL OR (p_action='preview' AND p_email IS NOT NULL) THEN$a$,$b$  IF p_action='delete-test-agency' THEN
    IF p_id IS NULL OR p_email IS NULL OR length(p_email)>1024 THEN RETURN jsonb_build_object('state','changed'); END IF;
    RETURN timeax_core.admin_test_agency_reset(p_id,p_email::jsonb);
  END IF;
  IF p_id IS NULL OR (p_action='preview' AND p_email IS NOT NULL) THEN$b$);
 f:=replace(f,$a$  v_blocked := EXISTS$a$,$b$  IF p_action='preview' THEN
    v_reset:=timeax_core.admin_test_agency_reset(p_id,NULL);
    IF v_reset->>'state'='preview' THEN RETURN v_reset; END IF;
    IF v_reset->>'state'='blocked' THEN
      RETURN jsonb_build_object('state','preview','id',v_user.id,'email',v_user.email,
        'scope','linked','createdAt',v_user.created_at,'canDelete',false);
    END IF;
  ELSIF EXISTS(SELECT 1 FROM timeax_core.admin_test_agency_resets WHERE account_id=p_id) THEN
    RETURN jsonb_build_object('state','blocked');
  END IF;
  v_blocked := EXISTS$b$);
 IF position('RETURN timeax_core.admin_test_agency_reset(p_id,p_email::jsonb)' in f)=0
    OR position('v_reset:=timeax_core.admin_test_agency_reset(p_id,NULL)' in f)=0 THEN RAISE EXCEPTION 'Reset integration did not match'; END IF;
 EXECUTE f;
 IF encode(sha256(convert_to(pg_get_functiondef(rpc),'UTF8')),'hex')<>'a7e7dbc7082807254586c8d2d12d1db31a685b00fd769e3c127be937ec18e203' THEN
    RAISE EXCEPTION 'Unexpected installed reset definition';
 END IF;
END
$install$;
COMMIT;
