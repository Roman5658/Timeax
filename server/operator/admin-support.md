# Owner support

This is a case-by-case support tool, not a database console. The existing owner access key authorizes it. It does not expose passwords, hashes, provider tokens, OTPs, or private messages, and cannot sign in as a customer.

## What it does

- Accounts: email confirmation, whether a password was set, last sign-in, account block status, Timeax session count, and organization memberships.
- End sessions: reauthentication is required. The account, password, shifts, and memberships are not removed. Timeax clears transient proof/session state after the database action; externally issued access tokens may still last until their expiry outside Timeax.
- Hours: scoped by customer account and date. Factory-hours edits and edits to closed/archived/payroll-linked shifts are disabled. An eligible agency correction, if configured, creates a canonical revision and requires a reason; use standard organization workflows for records that are protected.
- Audit: the targeted account's latest changes, timestamps, reasons, and limited before/after details. Keep reasons free of passwords, personal documents, or other unnecessary personal data.

## Rollout

1. Confirm that the target database has the canonical timecard schemas, durable web sessions, and the intended permissions for the operator to expire provider sessions. Apply `admin-support-account.sql`, `admin-support-shifts.sql`, then `admin-support.sql` in that order. Postgres defers execution of the private helpers until the audit table exists. The existing admin lane and key do not change.
2. Provision a separate randomly generated base64url password of at least 32 bytes for `timeax_owner_support_login`. Only grant LOGIN with that password; do not grant table access, role memberships, or another RPC. Keep the password out of Git/chat/logs.
3. Set `TIMEAX_OWNER_SUPPORT_DB` and `TIMEAX_OWNER_SUPPORT_RPC_SHA256` on the production runtime. For the SHA, use the definition of the installed function:
   ```sql
   SELECT encode(sha256(convert_to(pg_get_functiondef(
     'timeax_api.admin_support(text,uuid,jsonb)'::regprocedure
   ), 'UTF8')), 'hex') AS owner_support_sha256;
   ```
4. Leave `timeax_core.owner_support_shift_config` empty until the owner identifies their verified Timeax account. Then pair the singleton `actor_identity` with its active identity ID, not the authentication user's ID; the writer checks the current provider and confirmed, non-anonymous account. This is attribution to the owner, not an agency or worksite role.
5. Open the owner admin panel, then Accounts → Support. Verify with dedicated test accounts before using write actions on a real support case. Confirm expired/revoked sessions sign in normally again and that payment records remain unchanged. A missing or nonconforming support lane does not disable the old admin or regular sign-in.

Do not set a support shift actor to another customer or to the account whose hours are being edited.
