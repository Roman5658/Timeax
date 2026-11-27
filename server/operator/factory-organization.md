# Factory roster and schedule rollout

- Apply `factory-organization.sql` only after the canonical Team and factory setup migrations. It checks the existing factory setup function owner and body fingerprint; if it refuses, stop rather than changing the expected value.
- Review the resulting definition, then update the existing `TIMEAX_AGENCY_PRODUCTIONS_RPC_SHA256` to `d1388d82d981d090ecc87cae8540ffe096d6e6ff2c767b620dbc13826da944bd` and deploy the corresponding app. The old fingerprint will intentionally fail factory setup preflight after the schema change. Do not replace the DB login credential.
- Confirm that a factory administrator can see the schedule for an owned active worksite, use the date and worker filters, create a department, create a group, and archive a test group. Only a verified leader's published plans are read. There are no factory-admin schedule writes.
- Check that another factory, an agency account and a leader cannot load or modify factory-administrator roster metadata. The database returns only workers with a valid current assignment to that site; agency workers additionally require an approved placement and an active agency connection. A group's displayed leader is metadata and never changes permissions.
- New tables are private and RLS-guarded. The existing SQL login still cannot directly access tables and has only the previously scoped function. No database credential, signup logic, timesheet, actual-hours row, or worker membership is changed.

Verify the updated fingerprint without printing credentials:

```sql
SELECT encode(sha256(convert_to(pg_get_functiondef(
  'timeax_api.factory_setup(text,text,text,jsonb)'::regprocedure
),'UTF8')),'hex') AS factory_setup_sha256;
```
