-- Notification evidence comes from a new active membership, not from a draft card.
-- Install before loading the new worker_connection function.
BEGIN;
CREATE TABLE IF NOT EXISTS timeax_core.agency_worker_join_events (
 membership_id uuid PRIMARY KEY,
 agency_id uuid NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(agency_id,membership_id),
 FOREIGN KEY(agency_id,membership_id) REFERENCES timeax_core.memberships(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agency_worker_join_events_time ON timeax_core.agency_worker_join_events(agency_id,joined_at DESC);
CREATE TABLE IF NOT EXISTS timeax_core.agency_worker_join_reads (
 agency_id uuid NOT NULL,
 membership_id uuid NOT NULL,
 reader_id uuid NOT NULL,
 PRIMARY KEY(membership_id,reader_id),
 FOREIGN KEY(agency_id,membership_id) REFERENCES timeax_core.agency_worker_join_events(agency_id,membership_id) ON DELETE CASCADE,
 FOREIGN KEY(agency_id,reader_id) REFERENCES timeax_core.memberships(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE timeax_core.agency_worker_join_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeax_core.agency_worker_join_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON timeax_core.agency_worker_join_events,timeax_core.agency_worker_join_reads FROM PUBLIC, anon, authenticated, service_role, timeax_worker_connection_login;
CREATE OR REPLACE FUNCTION timeax_core.record_agency_worker_join()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','pg_temp' AS $join$
BEGIN
 IF NEW.role='worker' AND NEW.state='active' AND NEW.organization_kind='agency' THEN
  INSERT INTO timeax_core.agency_worker_join_events(agency_id,membership_id)
  VALUES(NEW.organization_id,NEW.id) ON CONFLICT(membership_id) DO NOTHING;
 END IF;
 RETURN NEW;
END
$join$;
REVOKE ALL ON FUNCTION timeax_core.record_agency_worker_join() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS timeax_agency_worker_join ON timeax_core.memberships;
CREATE TRIGGER timeax_agency_worker_join AFTER INSERT ON timeax_core.memberships FOR EACH ROW EXECUTE FUNCTION timeax_core.record_agency_worker_join();
-- Backfill only a verified approval receipt; don't invent a join time for unlogged history.
INSERT INTO timeax_core.agency_worker_join_events(agency_id,membership_id,joined_at)
SELECT a.agency_id,a.worker_membership_id,min(a.approved_at)
FROM timeax_core.agency_worker_applications a JOIN timeax_core.memberships m
 ON m.id=a.worker_membership_id AND m.organization_id=a.agency_id AND m.role='worker' AND m.organization_kind='agency' AND m.state='active'
WHERE a.approved_at>=pg_catalog.now()-interval '30 days'
GROUP BY a.agency_id,a.worker_membership_id ON CONFLICT(membership_id) DO NOTHING;
COMMIT;
