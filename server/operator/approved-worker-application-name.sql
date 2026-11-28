-- Carry the name already visible on a reviewed application into its agency roster.
BEGIN;
CREATE FUNCTION timeax_core.seed_approved_worker_application_name() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $function$
BEGIN
 UPDATE timeax_core.member_display_names AS n
 SET display_name=btrim(left(NEW.applicant_first_name,119-length(NEW.applicant_last_name)))||' '||NEW.applicant_last_name,
     revision=n.revision+1,checked_by=NEW.approved_by_membership_id,checked_at=NEW.approved_at
 WHERE n.organization_id=NEW.agency_id AND n.membership_id=NEW.worker_membership_id AND n.display_name IS NULL;
 RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION timeax_core.seed_approved_worker_application_name() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER timeax_approved_worker_application_name
 AFTER UPDATE OF approved_at ON timeax_core.agency_worker_applications
 FOR EACH ROW WHEN (OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL AND NEW.applicant_first_name IS NOT NULL AND NEW.applicant_last_name IS NOT NULL)
 EXECUTE FUNCTION timeax_core.seed_approved_worker_application_name();
-- Only repair blank names of workers already approved on a named application.
UPDATE timeax_core.member_display_names AS n
SET display_name=btrim(left(a.applicant_first_name,119-length(a.applicant_last_name)))||' '||a.applicant_last_name,
    revision=n.revision+1,checked_by=a.approved_by_membership_id,checked_at=a.approved_at
FROM timeax_core.agency_worker_applications AS a
WHERE n.organization_id=a.agency_id AND n.membership_id=a.worker_membership_id AND n.display_name IS NULL
 AND a.approved_at IS NOT NULL AND a.applicant_first_name IS NOT NULL AND a.applicant_last_name IS NOT NULL;
COMMIT;
