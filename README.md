# Timeax: local development

Run these from the Timeax project folder:

```powershell
npm.cmd ci
npm.cmd --prefix server ci --omit=dev
npm.cmd run dev
```

The combined frontend and HTTP backend listen on http://127.0.0.1:5173/ by default.
If the port is already in use, stop the previous Timeax process or start with
`npm.cmd run dev -- --port 5177`. Keep the terminal open. This command makes a fresh
build, then serves the actual built frontend, so it avoids Vite's Windows dev
dependency optimization. Restart the command to see source changes.

The local launcher does not read production configuration, send email, or enable
registration. `/healthz` reports the HTTP server state; `/readyz` is intentionally
unavailable in closed mode. `npm.cmd run build` produces the hosted frontend in
`dist-hosted/`; `npm.cmd test` runs the local frontend/domain regressions.
For the older browser workspace, `npm.cmd run dev:legacy` remains available as a
reference. Do not use it as the hosted Timeax entry.

Live hosting is separate from the local launcher: keep server preflight, the
approved configuration and production TLS in place. Never publish local keys,
test datasets or `.tmp`.
