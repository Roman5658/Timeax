-- Record only newly accepted versions passed explicitly by the verified signup server.
-- Older records are not backfilled. No change to the existing pinned onboarding RPC.
BEGIN;
ALTER TABLE timeax_core.self_service_agencies
 ADD COLUMN IF NOT EXISTS terms_version text,
 ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
CREATE FUNCTION timeax_core.capture_self_service_terms()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE accepted text := current_setting('timeax.registration_terms_version',true);
BEGIN
 IF session_user='timeax_agency_onboarding_login' AND accepted ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  NEW.terms_version:=accepted;
  NEW.terms_accepted_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION timeax_core.capture_self_service_terms() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER capture_self_service_terms
 BEFORE INSERT ON timeax_core.self_service_agencies
 FOR EACH ROW EXECUTE FUNCTION timeax_core.capture_self_service_terms();
COMMIT;
