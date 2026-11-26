# Authentication

Timeax uses Supabase email and password authentication. The portal role comes from
the server-managed `app_metadata.timeax_role` on the verified Supabase user.

## Run locally

- Install the pinned dependencies with `npm ci`.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`
  using the project URL and publishable key from the Supabase dashboard.
- Start Vite with `npm run dev`. The default local address is
  `http://127.0.0.1:5173`.

## Provision an account

Create an email/password user with Supabase Authentication. Assign its initial
role from a trusted admin environment with the Supabase Admin API. Use
`updateUserById(userId, { app_metadata: { timeax_role: "agency" } })` with the
user's actual ID and intended role. Keep the admin API key on the server.

| Role | Portal |
| --- | --- |
| `worker` | `/worker` |
| `agency` | `/agency` |
| `leader` | `/leader` |
| `factory-admin` | `/factory` |
| `admin` | `/super-admin` |

All provisioned roles can open `/settings`. Configure the public app URL in
Supabase Auth URL Configuration and allow the exact password recovery URLs,
such as `http://127.0.0.1:5173/reset-password` and the corresponding deployed
URL. Recovery uses PKCE, so open the email link in the browser where you
requested it. Deployment hosts must serve the SPA entry point for direct
visits to its routes.

Set `VITE_TIMEAX_DEMO=true` to run the browser-local prototype in Vite dev
mode without Supabase. Production builds always require Supabase. In a signed-in
preview, workspace changes stay in account-scoped browser storage. Any future
Supabase data backed by real records needs its own row-level security policies.
