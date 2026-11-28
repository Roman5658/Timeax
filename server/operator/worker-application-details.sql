-- Applicant names belong only to the target application; email stays with verified auth.
BEGIN;
ALTER TABLE timeax_core.agency_worker_applications
 ADD COLUMN applicant_first_name text, ADD COLUMN applicant_last_name text,
 ADD CONSTRAINT agency_application_names_pair CHECK (
 (applicant_first_name IS NULL AND applicant_last_name IS NULL) OR
 (applicant_first_name IS NOT NULL AND applicant_last_name IS NOT NULL AND length(applicant_first_name) BETWEEN 1 AND 80 AND length(applicant_last_name) BETWEEN 1 AND 80));
DO $migration$
DECLARE rpc regprocedure:='timeax_api.worker_connection(text,text,text,jsonb)'::regprocedure;
 def text:=pg_get_functiondef(rpc);
BEGIN
 IF encode(sha256(convert_to(def,'UTF8')),'hex')<>'60e0d2a0cf091e454f8baa60777895c4de14a81d19ea97d837de5e8902f7a878' THEN RAISE EXCEPTION 'Unexpected worker connection definition'; END IF;
 def:=replace(def,$anchor$ v_receipt uuid;$anchor$,$new$ v_receipt uuid;
 v_app_result jsonb;$new$);
 def:=replace(def,$anchor$ IF p_action IN ('provision','create-card','list-cards','reserve-mail','complete-mail','directory-settings','directory-toggle','join-events','read-join-event') THEN$anchor$,$new$ IF p_action IN ('application-submit','application-complete','application-queue') THEN
  IF p_action='application-queue' THEN
   v_agency:=(p_data->>'agencyId')::uuid;
   PERFORM timeax_core.lock_active_agency_admin(p_issuer,p_subject,v_agency);
   RETURN jsonb_build_object('applications',coalesce((
    SELECT jsonb_agg(to_jsonb(q) ORDER BY q.claimed_at DESC,q.application_id) FROM (
     SELECT a.id AS application_id,a.claimed_at,a.applicant_first_name AS "firstName",a.applicant_last_name AS "lastName",
      CASE WHEN a.applicant_first_name IS NOT NULL THEN u.email END AS email
     FROM timeax_core.agency_worker_applications a
     LEFT JOIN auth.users u ON u.id::text=a.subject AND u.email_confirmed_at IS NOT NULL
      AND NOT u.is_anonymous AND u.deleted_at IS NULL
     WHERE a.agency_id=v_agency AND a.issuer=p_issuer AND a.approved_at IS NULL
     ORDER BY a.claimed_at DESC,a.id LIMIT 50
    ) q),'[]'::jsonb));
  END IF;
  IF NOT coalesce(timeax_core.worker_terms_current(p_issuer,p_subject),false) THEN
   RAISE EXCEPTION 'worker terms required' USING ERRCODE='42501';
  END IF;
  v_first:=btrim(p_data->>'firstName');
  v_last:=btrim(p_data->>'lastName');
  IF coalesce(length(v_first),0) NOT BETWEEN 1 AND 80 OR coalesce(length(v_last),0) NOT BETWEEN 1 AND 80
   OR v_first ~ '[[:cntrl:]@]' OR v_last ~ '[[:cntrl:]@]' THEN
   RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM auth.users u WHERE u.id=v_subject AND u.email_confirmed_at IS NOT NULL
   AND u.email IS NOT NULL AND NOT u.is_anonymous AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=v_time) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker session unavailable' USING ERRCODE='42501'; END IF;
  IF p_action='application-submit' THEN
   IF p_data?'code' THEN
    v_app_result:=timeax_api.worker_connection('claim-code',p_issuer,p_subject,jsonb_build_object('code',p_data->>'code'));
   ELSE
    v_app_result:=timeax_api.worker_connection('directory-request',p_issuer,p_subject,jsonb_build_object('agencyId',p_data->>'agencyId','nip',p_data->>'nip'));
   END IF;
   IF v_app_result->'application'->>'status'='approved' THEN RETURN v_app_result; END IF;
   v_receipt:=(v_app_result->'application'->>'application_id')::uuid;
  ELSE
   v_receipt:=(p_data->>'applicationId')::uuid;
  END IF;
  UPDATE timeax_core.agency_worker_applications a SET applicant_first_name=v_first,applicant_last_name=v_last
   WHERE a.id=v_receipt AND (a.issuer,a.subject)=(p_issuer,p_subject) AND a.approved_at IS NULL
     AND EXISTS(SELECT 1 FROM timeax_core.organizations o WHERE o.id=a.agency_id AND o.kind='agency' AND o.state='active');
  IF NOT FOUND THEN RAISE EXCEPTION 'pending application unavailable' USING ERRCODE='42501'; END IF;
  RETURN coalesce(v_app_result,jsonb_build_object('state','saved'));
 END IF;

 IF p_action IN ('provision','create-card','list-cards','reserve-mail','complete-mail','directory-settings','directory-toggle','join-events','read-join-event') THEN$new$);
 EXECUTE def;
 IF encode(sha256(convert_to(pg_get_functiondef(rpc),'UTF8')),'hex')<>'27ecd91ddddf38cebcde7f1bd1ead78a834582f37b43f1275779dc6ec78b0f56' THEN RAISE EXCEPTION 'Unexpected updated worker connection definition'; END IF;
END
$migration$;
COMMIT;
