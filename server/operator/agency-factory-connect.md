# Connect a factory

The agency's authenticated **Produkcje → Podłącz zakład** flow looks up the exact NIP in verified Timeax factory registrations. It does not query a public tax registry. It generates a shareable link; it does not send mail. A new factory starts as a registration draft and still requires independent verification of its representative. For an existing factory, only an authorized factory administrator can continue to the workspace. The link never grants a membership or activates an agency connection by itself.

## Operator rollout

1. Apply `agency-factory-connect.sql` after the existing factory registration SQL. It patches only the existing registration RPC and adds nullable fields for invitation details and the address proposed for verification. Stop if its ownership/definition checks fail.
2. Read the new function fingerprint using the query below. Set `TIMEAX_FACTORY_REGISTRATION_RPC_SHA256` in the runtime that uses `TIMEAX_AGENCY_OPERATIONS`, or update the registration lane's existing hash in its configuration. Retain the current database login. Coordinate the SQL and restart so the old fingerprint does not leave registration unavailable. Never repin a definition that differs from the reviewed SQL.
3. Verify with an agency administrator and two factory identities: unknown NIP → draft/link → review → cabinet; registered NIP → no duplicate cabinet; a second agency can connect separately. The invitation alone must not expose any workers or time records. Verify that expired unused and revoked links are rejected and existing direct factory registrations still work.

```sql
SELECT encode(sha256(convert_to(pg_get_functiondef(
  'timeax_api.factory_registration(text,text,text,jsonb)'::regprocedure
), 'UTF8')), 'hex') AS factory_registration_sha256;
```
