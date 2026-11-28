-- Install after admin-test-agency-reset.sql (its private Team helper is reused).
-- The private marker binds exactly one account to its approved factory; it grants no
-- application role. The caller must stage it for the selected account, not bulk insert.
BEGIN;
CREATE TABLE timeax_core.admin_test_factory_resets (
  account_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  factory_id uuid UNIQUE NOT NULL
);
ALTER TABLE timeax_core.admin_test_factory_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.admin_test_factory_resets FROM PUBLIC, anon, authenticated, service_role, timeax_account_admin_login;

CREATE FUNCTION timeax_core.admin_test_factory_reset(a uuid, confirmation jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $reset$
DECLARE
  auth_issuer constant text := 'https://rohgpgogsdtiltbocdao.supabase.co/auth/v1';
  i uuid; o uuid; mail text; label text; created timestamptz;
  m uuid[]; w uuid[]; sh uuid[]; r uuid[]; c uuid[]; e uuid[];
  rule record; snapshot text; rev text; impact jsonb; scoped boolean; blocked_reason text;
  revisions jsonb := '[]'::jsonb;
  -- Predicates below are installation-time constants, not caller-provided SQL.
  rules constant jsonb := $rules$
[["timeax_push.jobs","organization_id=$2 OR subscription_id IN (SELECT id FROM timeax_push.subscriptions WHERE identity_id=$1)"],
["timeax_push.subscriptions","identity_id=$1"],
["timeax_core.inbox_dispositions","membership_id=ANY($3)"],
["timeax_core.earlier_shift_requests","agency_id=$2 AND worksite_id=ANY($4) AND worker_id=ANY($3)"],
["timeax_core.backdated_shift_notice_reads","source='factory' AND shift_id=ANY($5) AND reader_id=ANY($3)"],
["timeax_core.backdated_shift_notices","source='factory' AND shift_id=ANY($5) AND agency_id=$2"],
["timeax_core.factory_timecard_events","worksite_id=ANY($4) AND (shift_id IS NULL OR shift_id=ANY($5))","factory_events_immutable"],
["timeax_core.factory_timecard_shifts","id=ANY($5)"],
["timeax_core.factory_timecard_modes","worksite_id=ANY($4)"],
["timeax_core.factory_roster_links","worksite_id=ANY($4) AND membership_id=ANY($3)"],
["timeax_core.factory_roster_units","worksite_id=ANY($4)"],
["timeax_core.factory_worker_placements","worksite_id=ANY($4) AND agency_id=$2"],
["timeax_core.factory_leader_invitations","factory_id=$2"],
["timeax_core.factory_owned_worker_invitations","factory_id=$2"],
["timeax_core.agency_factory_connection_invitations","(connection_id=ANY($7) OR registration_request_id=ANY($6)) AND (connection_id IS NULL OR connection_id=ANY($7)) AND (registration_request_id IS NULL OR registration_request_id=ANY($6))"],
["timeax_core.factory_connection_requests","id=ANY($7)"],
["timeax_core.factory_registration_requests","id=ANY($6)"],
["timeax_core.worker_membership_endings","membership_id=ANY($3)","membership_ending_immutable"],
["timeax_core.member_display_names","organization_id=$2"],
["timeax_core.member_name_events","actor_id=$1","name_events_immutable"],
["timeax_core.pay_estimate_settings","organization_id=$2"],
["timeax_core.internal_timecards","organization_id=$2","immutable_snapshot"],
["timeax_core.worksite_membership_grants","organization_id=$2 AND worksite_id=ANY($4)"],
["timeax_core.agency_worksite_grant_history","organization_id=$2 AND worksite_id=ANY($4)"],
["timeax_core.agency_worksite_preferences","organization_id=$2 AND worksite_id=ANY($4)"],
["timeax_core.worksite_organization_grants","owner_organization_id=$2 AND worksite_id=ANY($4)"],
["timeax_core.worksite_setup_operations","organization_id=$2 AND worksite_id=ANY($4)"],
["timeax_core.worksites","id=ANY($4)"],
["timeax_core.agency_contact_settings","organization_id=$2"],
["timeax_core.memberships","id=ANY($3)"],
["timeax_core.organizations","id=$2"],
["timeax_core.worker_terms_receipts","user_id=$8"],
["timeax_core.web_sessions","subject=$8"],
["timeax_core.identities","id=$1"],
["auth.flow_state","user_id=$8"],
["auth.refresh_tokens","user_id=$8::text"],
["auth.users","id=$8"]]
$rules$::jsonb;
BEGIN
  IF current_user<>'postgres' OR session_user<>'timeax_account_admin_login' THEN
    RAISE EXCEPTION 'Denied' USING ERRCODE='42501';
  END IF;
  SELECT factory_id INTO o FROM timeax_core.admin_test_factory_resets WHERE account_id=a FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','not-enabled'); END IF;
  IF confirmation IS NOT NULL THEN
    SET LOCAL lock_timeout='3s';
    PERFORM pg_advisory_xact_lock(hashtextextended(auth_issuer||'/'||a::text,0));
    LOCK TABLE timeax_core.internal_timecards, timeax_core.worker_membership_endings,
      timeax_core.member_name_events, timeax_core.factory_timecard_events IN ACCESS EXCLUSIVE MODE;
    FOR rule IN
      SELECT DISTINCT (v->>0) AS tab FROM jsonb_array_elements(rules) v WHERE v->>2 IS NULL
      ORDER BY tab
    LOOP
      EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', rule.tab::regclass);
    END LOOP;
    PERFORM timeax_team.admin_clear_test_agency(o,NULL,false);
  END IF;
  SELECT ci.id, u.email, u.created_at, org.name INTO i,mail,created,label
    FROM auth.users u
    JOIN timeax_core.identities ci ON ci.subject=u.id::text AND ci.issuer=auth_issuer AND ci.active
    JOIN timeax_core.organizations org ON org.id=o AND org.kind='factory'
    WHERE u.id=a AND u.email IS NOT NULL AND u.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM timeax_core.memberships member
        WHERE member.organization_id=o AND member.identity_id=ci.id AND member.role='factory_admin' AND member.state='active')
      AND EXISTS (SELECT 1 FROM timeax_core.factory_registration_requests f
        JOIN timeax_core.worksites site ON site.id=f.worksite_id AND site.owner_organization_id=o
        WHERE f.organization_id=o AND f.identity_id=ci.id AND f.state='approved');
  IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked'); END IF;
  -- An unreviewed cascading or nullifying foreign key must not expand scope.
  -- Managed Auth-to-Auth cascades are the Supabase account provider's cleanup.
  IF EXISTS(
    SELECT 1 FROM pg_constraint con
    JOIN pg_class child ON child.oid=con.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
    WHERE con.contype='f' AND con.confdeltype IN ('c','n','d')
      AND con.confrelid IN (
        SELECT (v->>0)::regclass FROM jsonb_array_elements(rules) v
        UNION SELECT unnest(ARRAY['timeax_team.deliveries','timeax_team.entries','timeax_team.events',
          'timeax_team.templates','timeax_team.accountant_invitations']::regclass[])
      )
      AND NOT (child_ns.nspname='auth' AND con.confrelid='auth.users'::regclass)
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
    ('timeax_core.admin_test_agency_resets','FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('timeax_core.agency_contact_settings','FOREIGN KEY (organization_id) REFERENCES timeax_core.organizations(id) ON DELETE CASCADE'),
    ('timeax_core.agency_worker_join_events','FOREIGN KEY (agency_id, membership_id) REFERENCES timeax_core.memberships(organization_id, id) ON DELETE CASCADE'),
    ('timeax_core.agency_worker_join_reads','FOREIGN KEY (agency_id, reader_id) REFERENCES timeax_core.memberships(organization_id, id) ON DELETE CASCADE'),
    ('timeax_core.agency_worksite_preferences','FOREIGN KEY (organization_id) REFERENCES timeax_core.organizations(id) ON DELETE CASCADE'),
    ('timeax_core.agency_worksite_preferences','FOREIGN KEY (worksite_id) REFERENCES timeax_core.worksites(id) ON DELETE CASCADE'),
    ('timeax_core.backdated_shift_notice_reads','FOREIGN KEY (reader_id) REFERENCES timeax_core.memberships(id) ON DELETE CASCADE'),
    ('timeax_core.backdated_shift_notice_reads','FOREIGN KEY (source, shift_id) REFERENCES timeax_core.backdated_shift_notices(source, shift_id) ON DELETE CASCADE'),
    ('timeax_core.backdated_shift_notices','FOREIGN KEY (agency_id) REFERENCES timeax_core.organizations(id) ON DELETE CASCADE'),
    ('timeax_core.backdated_shift_notices','FOREIGN KEY (membership_id) REFERENCES timeax_core.memberships(id) ON DELETE CASCADE'),
    ('timeax_core.earlier_shift_requests','FOREIGN KEY (agency_id) REFERENCES timeax_core.organizations(id) ON DELETE CASCADE'),
    ('timeax_core.earlier_shift_requests','FOREIGN KEY (reviewed_by) REFERENCES timeax_core.memberships(id) ON DELETE SET NULL'),
    ('timeax_core.earlier_shift_requests','FOREIGN KEY (worker_id) REFERENCES timeax_core.memberships(id) ON DELETE CASCADE'),
    ('timeax_core.earlier_shift_requests','FOREIGN KEY (worksite_id) REFERENCES timeax_core.worksites(id) ON DELETE CASCADE'),
    ('timeax_core.factory_roster_links','FOREIGN KEY (membership_id) REFERENCES timeax_core.memberships(id) ON DELETE CASCADE'),
    ('timeax_core.factory_roster_units','FOREIGN KEY (leader_id) REFERENCES timeax_core.memberships(id) ON DELETE SET NULL'),
    ('timeax_core.inbox_dispositions','FOREIGN KEY (membership_id) REFERENCES timeax_core.memberships(id) ON DELETE CASCADE'),
    ('timeax_core.pay_estimate_settings','FOREIGN KEY (organization_id, worker_id) REFERENCES timeax_core.memberships(organization_id, id) ON DELETE CASCADE'),
    ('timeax_core.payroll_notifications','FOREIGN KEY (organization_id, membership_id) REFERENCES timeax_core.memberships(organization_id, id) ON DELETE CASCADE'),
    ('timeax_core.personal_received_payslips','FOREIGN KEY (worker_identity_id) REFERENCES timeax_core.identities(id) ON DELETE CASCADE'),
    ('timeax_core.web_sessions','FOREIGN KEY (subject) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('timeax_core.worker_discoverable_agencies','FOREIGN KEY (agency_id) REFERENCES timeax_core.organizations(id) ON DELETE CASCADE'),
    ('timeax_core.worker_email_invitations','FOREIGN KEY (agency_id) REFERENCES timeax_core.organizations(id) ON DELETE CASCADE'),
    ('timeax_core.worker_email_invitations','FOREIGN KEY (agency_id, invited_by) REFERENCES timeax_core.memberships(organization_id, id) ON DELETE CASCADE'),
    ('timeax_core.worker_email_invitations','FOREIGN KEY (worksite_id) REFERENCES timeax_core.worksites(id) ON DELETE SET NULL'),
    ('timeax_core.worker_hidden_agencies','FOREIGN KEY (agency_id) REFERENCES timeax_core.organizations(id) ON DELETE CASCADE'),
    ('timeax_core.worker_terms_receipts','FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('timeax_push.jobs','FOREIGN KEY (last_recipient) REFERENCES timeax_core.memberships(id) ON DELETE CASCADE'),
    ('timeax_push.jobs','FOREIGN KEY (organization_id) REFERENCES timeax_core.organizations(id) ON DELETE CASCADE'),
    ('timeax_push.jobs','FOREIGN KEY (subscription_id) REFERENCES timeax_push.subscriptions(id) ON DELETE CASCADE'),
    ('timeax_push.subscriptions','FOREIGN KEY (identity_id) REFERENCES timeax_core.identities(id) ON DELETE CASCADE'),
    ('timeax_core.admin_test_factory_resets','FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
    ('timeax_core.admin_test_worker_resets','FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE')
        ) AS reviewed(child_name,definition)
        WHERE reviewed.child_name=child_ns.nspname||'.'||child.relname
          AND reviewed.definition=pg_get_constraintdef(con.oid)
      )
  ) THEN RETURN jsonb_build_object('state','blocked','reason','unreviewed-cascading-dependency'); END IF;
  SELECT ARRAY(SELECT id FROM timeax_core.memberships WHERE organization_id=o) INTO m;
  SELECT ARRAY(SELECT id FROM timeax_core.worksites WHERE owner_organization_id=o) INTO w;
  SELECT ARRAY(SELECT id FROM timeax_core.factory_timecard_shifts WHERE worksite_id=ANY(w) AND agency_id=o) INTO sh;
  SELECT ARRAY(SELECT id FROM timeax_core.factory_registration_requests WHERE identity_id=i AND (organization_id=o OR organization_id IS NULL)) INTO r;
  SELECT ARRAY(SELECT id FROM timeax_core.factory_connection_requests WHERE factory_id=o AND worksite_id=ANY(w)) INTO c;
  SELECT ARRAY(SELECT id FROM timeax_team.entries WHERE sender=ANY(m)) INTO e;
  -- Refuse to destroy a different employer's operational records. The link
  -- itself may be detached if it has this factory's exact recorded connection.
  -- An NIP-only invitation or standalone grant is ambiguous.
  blocked_reason:=CASE
    WHEN EXISTS(SELECT 1 FROM timeax_core.memberships z WHERE (z.identity_id=i AND z.organization_id<>o) OR (z.organization_id=o AND z.role='factory_admin' AND z.identity_id<>i)) THEN 'factory-ownership'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_registration_requests z WHERE (z.identity_id=i OR z.organization_id=o OR z.worksite_id=ANY(w)) AND NOT (z.id=ANY(r))) THEN 'factory-ownership'
    WHEN EXISTS(SELECT 1 FROM timeax_core.registration_reviewers z WHERE z.identity_id=i) THEN 'protected-account'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_authority_reviewers z WHERE z.identity_id=i) THEN 'protected-account'
    WHEN EXISTS(SELECT 1 FROM timeax_owner_qa.organizations z WHERE z.organization_id=o) THEN 'protected-account'
    WHEN EXISTS(SELECT 1 FROM timeax_owner_qa.audit z WHERE z.actor_identity=i) THEN 'protected-account'
    WHEN EXISTS(SELECT 1 FROM timeax_enrollment_private.intent z WHERE z.before_subject::text=a::text) THEN 'protected-account'
    WHEN EXISTS(SELECT 1 FROM storage.objects z WHERE z.owner=a OR z.owner_id=a::text) THEN 'storage-files'
    WHEN EXISTS(SELECT 1 FROM timeax_core.agency_registration_requests z WHERE z.issuer=auth_issuer AND z.subject=a::text) THEN 'other-agency-role'
    WHEN EXISTS(SELECT 1 FROM timeax_core.agency_worker_applications z WHERE z.issuer=auth_issuer AND z.subject=a::text) THEN 'other-agency-role'
    WHEN EXISTS(SELECT 1 FROM timeax_core.received_factory_timecards z WHERE z.worksite_id=ANY(w) OR z.created_by=i OR z.agency_id=o) THEN 'connected-agency-snapshots'
    WHEN EXISTS(SELECT 1 FROM timeax_core.worksite_organization_grants z
      WHERE z.organization_id=o OR (z.owner_organization_id=o AND NOT EXISTS(
        SELECT 1 FROM timeax_core.factory_connection_requests conn
        WHERE conn.id=ANY(c) AND conn.factory_id=z.owner_organization_id
          AND conn.worksite_id=z.worksite_id AND conn.agency_id=z.organization_id
          AND conn.state=z.state AND conn.state IN ('active','revoked')
      ))) THEN 'external-worksite-access'
    WHEN EXISTS(SELECT 1 FROM timeax_core.worksite_membership_grants z WHERE (z.organization_id=o)<>(z.worksite_id=ANY(w))) THEN 'external-worksite-access'
    WHEN EXISTS(SELECT 1 FROM timeax_core.agency_worksite_grant_history z WHERE (z.organization_id=o)<>(z.worksite_id=ANY(w)) OR (z.membership_id=ANY(m) AND z.organization_id<>o)) THEN 'external-worksite-history'
    WHEN EXISTS(SELECT 1 FROM timeax_core.agency_worksite_preferences z WHERE (z.organization_id=o)<>(z.worksite_id=ANY(w))) THEN 'external-worksite-settings'
    WHEN EXISTS(SELECT 1 FROM timeax_core.worksite_setup_operations z WHERE (z.organization_id=o)<>(z.worksite_id=ANY(w)) OR (z.issuer=auth_issuer AND z.subject=a::text AND z.organization_id<>o)) THEN 'external-worksite-settings'
    WHEN EXISTS(SELECT 1 FROM timeax_core.worker_email_invitations z WHERE z.worksite_id=ANY(w) OR z.agency_id=o) THEN 'external-worksite-invite'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_owned_worker_invitations z WHERE z.claimed_identity=i AND z.factory_id<>o) THEN 'external-factory-invite'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_leader_invitations z WHERE z.claimed_identity=i AND z.factory_id<>o) THEN 'external-factory-invite'
    WHEN EXISTS(SELECT 1 FROM timeax_core.agency_factory_connection_invitations z WHERE (z.connection_id=ANY(c) OR z.registration_request_id=ANY(r) OR z.factory_nip IN (SELECT f.nip FROM timeax_core.factory_registration_requests f WHERE f.id=ANY(r))) AND NOT ((coalesce(z.connection_id=ANY(c),false) OR coalesce(z.registration_request_id=ANY(r),false)) AND (z.connection_id IS NULL OR z.connection_id=ANY(c)) AND (z.registration_request_id IS NULL OR z.registration_request_id=ANY(r)))) THEN 'ambiguous-factory-invite'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_timecard_shifts z WHERE (z.worksite_id=ANY(w))<>(z.agency_id=o)) THEN 'external-shift'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_timecard_events z WHERE (z.worksite_id=ANY(w) AND z.shift_id IS NOT NULL AND NOT (z.shift_id=ANY(sh))) OR (NOT (z.worksite_id=ANY(w)) AND (z.actor_identity=i OR z.shift_id=ANY(sh)))) THEN 'external-shift-history'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_worker_placements z WHERE (z.worksite_id=ANY(w))<>(z.agency_id=o) OR (NOT (z.worksite_id=ANY(w)) AND (z.requested_by=i OR z.decided_by=i))) THEN 'external-placements'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_roster_links z WHERE (z.worksite_id=ANY(w))<>(z.membership_id=ANY(m))) THEN 'external-roster'
    WHEN EXISTS(SELECT 1 FROM timeax_core.factory_roster_units z WHERE z.leader_id IS NOT NULL AND (z.worksite_id=ANY(w))<>(z.leader_id=ANY(m))) THEN 'external-roster'
    WHEN EXISTS(SELECT 1 FROM timeax_core.earlier_shift_requests z WHERE (z.agency_id=o OR z.worksite_id=ANY(w) OR z.worker_id=ANY(m) OR z.reviewed_by=ANY(m)) AND NOT (z.agency_id=o AND z.worksite_id=ANY(w) AND z.worker_id=ANY(m))) THEN 'external-shift-request'
    WHEN EXISTS(SELECT 1 FROM timeax_core.backdated_shift_notices z WHERE (z.agency_id=o OR z.membership_id=ANY(m) OR (z.source='factory' AND z.shift_id=ANY(sh))) AND NOT (z.source='factory' AND z.shift_id=ANY(sh) AND z.agency_id=o AND z.membership_id=ANY(m))) THEN 'external-shift-notice'
    WHEN EXISTS(SELECT 1 FROM timeax_core.backdated_shift_notice_reads z WHERE (z.reader_id=ANY(m))<>(z.source='factory' AND z.shift_id=ANY(sh))) THEN 'external-shift-notice'
    WHEN EXISTS(SELECT 1 FROM timeax_core.personal_received_payslips z WHERE z.worker_identity_id=i) THEN 'personal-payroll'
    WHEN EXISTS(SELECT 1 FROM timeax_core.payroll_events z WHERE z.actor_id=i OR z.agency_id=o) THEN 'external-payroll'
    WHEN EXISTS(SELECT 1 FROM timeax_core.payroll_publications z WHERE z.issued_by=i) THEN 'external-payroll'
    WHEN EXISTS(SELECT 1 FROM timeax_core.payroll_notifications z WHERE z.organization_id=o) THEN 'external-payroll'
    WHEN EXISTS(SELECT 1 FROM timeax_push.jobs z WHERE z.organization_id<>o AND (z.last_recipient=ANY(m) OR z.subscription_id IN (SELECT id FROM timeax_push.subscriptions sub WHERE sub.identity_id=i))) THEN 'external-push'
    WHEN EXISTS(SELECT 1 FROM timeax_core.member_display_names z WHERE z.organization_id<>o AND z.checked_by=ANY(m)) THEN 'external-member-name'
    WHEN EXISTS(SELECT 1 FROM timeax_core.worker_membership_endings z WHERE z.ended_by=i AND NOT z.membership_id=ANY(m)) THEN 'external-membership-ending'
    WHEN EXISTS(SELECT 1 FROM timeax_team.entries z WHERE z.site_id=ANY(w) AND NOT z.id=ANY(e)) THEN 'external-team-message'
    WHEN EXISTS(SELECT 1 FROM timeax_team.deliveries z WHERE (z.entry_id=ANY(e))<>(z.recipient=ANY(m))) THEN 'external-team-message'
    WHEN EXISTS(SELECT 1 FROM timeax_team.events z WHERE z.actor=i AND z.input->>'organizationId' IS DISTINCT FROM o::text) THEN 'external-team-history'
    WHEN EXISTS(SELECT 1 FROM timeax_team.accountant_invitations z WHERE z.organization_id<>o AND (z.issuer_identity=i OR z.accepted_identity=i OR z.membership_id=ANY(m))) THEN 'external-team-invite'
  END;
  IF blocked_reason IS NOT NULL THEN
    RETURN jsonb_build_object('state','blocked','reason',blocked_reason);
  END IF;
  -- Bind the confirmed operation to the previewed factory and its mutable scope.
  -- Do not make password/token/session rotation invalidate an otherwise unchanged preview.
  FOR rule IN SELECT v->>0 AS tab,v->>1 AS predicate FROM jsonb_array_elements(rules) v
    WHERE v->>0 NOT IN ('auth.users','auth.refresh_tokens','auth.flow_state','timeax_core.web_sessions')
  LOOP
    EXECUTE format('SELECT encode(sha256(convert_to(coalesce(string_agg(h,%L ORDER BY h),%L),%L)),%L)
      FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,%L)),%L) AS h FROM %s t WHERE %s) s',
      ',', '', 'UTF8', 'hex', 'UTF8', 'hex', rule.tab::regclass, rule.predicate)
      INTO snapshot USING i,o,m,w,sh,r,c,a;
    revisions:=revisions||jsonb_build_array(rule.tab,snapshot);
  END LOOP;
  FOR rule IN
    SELECT tab,predicate FROM (VALUES
      ('timeax_team.entries','id=ANY($1)'),
      ('timeax_team.deliveries','entry_id=ANY($1)'),
      ('timeax_team.events','input->>''organizationId''=$2::text'),
      ('timeax_team.templates','identity_id=$3'),
      ('timeax_team.accountant_invitations','organization_id=$2')
    ) AS t(tab,predicate)
  LOOP
    EXECUTE format('SELECT encode(sha256(convert_to(coalesce(string_agg(h,%L ORDER BY h),%L),%L)),%L)
      FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,%L)),%L) AS h FROM %s t WHERE %s) s',
      ',', '', 'UTF8', 'hex', 'UTF8', 'hex', rule.tab::regclass,rule.predicate)
      INTO snapshot USING e,o,i;
    revisions:=revisions||jsonb_build_array(rule.tab,snapshot);
  END LOOP;
  rev:=encode(sha256(convert_to(jsonb_build_array(a,o,i,mail,label,created,revisions)::text,'UTF8')),'hex');
  impact:=jsonb_build_object(
    'workerAccountsKept',(SELECT count(DISTINCT identity_id) FROM timeax_core.memberships WHERE id=ANY(m) AND role='worker' AND identity_id<>i),
    'payslipsKept',(SELECT count(*) FROM timeax_core.personal_received_payslips WHERE agency_id=o OR worker_membership_id=ANY(m)),
    'worksitesRemoved',cardinality(w),'shiftsRemoved',cardinality(sh)
  );
  IF confirmation IS NULL THEN
    RETURN jsonb_build_object('state','preview','id',a,'email',mail,'createdAt',created,
      'scope','test-factory','canDelete',true,'reset',jsonb_build_object('organizationId',o,
      'organizationName',label,'revision',rev,'impact',impact));
  END IF;
  IF confirmation IS DISTINCT FROM jsonb_build_object('email',mail,'organizationId',o,'revision',rev) THEN
    RETURN jsonb_build_object('state','changed');
  END IF;
  PERFORM timeax_team.admin_clear_test_agency(o,i,true);
  FOR rule IN SELECT v->>0 AS tab,v->>1 AS predicate,v->>2 AS trigger_name
    FROM jsonb_array_elements(rules) WITH ORDINALITY AS x(v,n) ORDER BY n
  LOOP
    IF rule.trigger_name IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %s)',rule.tab::regclass,rule.predicate)
        INTO scoped USING i,o,m,w,sh,r,c,a;
      IF NOT scoped THEN CONTINUE; END IF;
      EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I',rule.tab::regclass,rule.trigger_name);
    END IF;
    EXECUTE format('DELETE FROM %s WHERE %s',rule.tab::regclass,rule.predicate) USING i,o,m,w,sh,r,c,a;
    IF rule.trigger_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I',rule.tab::regclass,rule.trigger_name);
    END IF;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=a OR lower(email)=lower(mail))
    OR EXISTS(SELECT 1 FROM timeax_core.organizations WHERE id=o) THEN
    RAISE EXCEPTION 'Incomplete factory reset' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('state','deleted','id',a);
EXCEPTION WHEN foreign_key_violation THEN
  -- The exception rolls back this block, including any trigger or row changes.
  RETURN jsonb_build_object('state','blocked','reason','unreviewed-factory-dependency');
END
$reset$;
REVOKE ALL ON FUNCTION timeax_core.admin_test_factory_reset(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role, timeax_account_admin_login;
COMMIT;
