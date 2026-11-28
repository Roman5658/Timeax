-- Install after web-push.sql. Only new requests awaiting approval trigger
-- the existing generic push to subscribed admins of the receiving agency.
-- No backfill: previously submitted requests remain visible in the bell.
BEGIN;
CREATE TRIGGER timeax_push_worker_application
 AFTER INSERT ON timeax_core.agency_worker_applications
 FOR EACH ROW WHEN (NEW.approved_at IS NULL)
 EXECUTE FUNCTION timeax_push.capture();
COMMIT;
