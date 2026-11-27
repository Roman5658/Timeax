# Stationary NFC shift surface

Detached integration for the planned browser route `/nfc/shift`. This change
does not register the page in the public router, expose links in any cabinet or
serve HTTP endpoints. It adds no manual entry path and makes no device claims.

## Wiring contract

- Supply `createStationaryNfcHttpHandler` with the canonical HTTPS origin and a
  closed-by-default server rollout switch. Before enabling, plug in the existing
  active worker session resolver, a scoped assignment resolver, and the actual
  `createNfcShiftGate` configured with an authenticated hardware verifier and an
  atomic durable store. Fixtures must not be used as runtime dependencies.
- The session adapter returns the established verified non-anonymous identity
  with an active check, server expiry, and a 64 lowercase hex, server-derived
  session key. Reuse the actual trusted session-key derivation when it is already
  available, or add an HMAC bound to the live HttpOnly web session in the host
  adapter. Never add raw session IDs in the front end, URLs, or NFC request
  payload. The existing `local-identity-runtime` worker session interface does
  not yet project that key.
- `scopeForWorker({issuer,subject})` is server-only. It returns exactly
  `{mode:'nfc_stationary',agencyId,worksiteId,readerId,membershipId}` for one
  currently effective assignment with a registered candidate reader. Missing
  or ambiguous assignments give no access. A future multi-site selector must
  resolve only among registrations the server has already independently
  authorized; this route intentionally does not accept scope selectors.
- Durable transactions must re-check session revocation, assignment, mode,
  reader/card identity and revocation, TTL, challenge/receipt/offer consumption
  and shift revision with server time. The handler's last pre-call check alone
  does not arbitrate concurrent revocation. Redact sensitive request and
  response bodies in tracing/logging infrastructure. Don't put proof or tokens
  in URL, storage, analytics, logs, a cache, or an observability breadcrumb.
- Native host injects the scoped `StationaryNfcReader` that acquires an
  authenticated live proof bound to the current server challenge and honors
  cancellation. The component does not consume NDEF, tag UID, QR, URL query or
  fragments. Plain Safari opening this URL has no trusted proof adapter.
- Only after those pieces pass the physical acceptance checklist should router
  composition expose the feature to enrolled pilot users. No existing route or
  picker setting should implicitly turn on live attendance.

## Request/response sequence

All operations: JSON POST, same origin only, no search/hash, session authenticated
on every step; response is no-store. The UI never accepts timestamps.

1. `/api/nfc/shift/prepare`, body `{}`: `{challenge,expiresAt}`.
2. `/api/nfc/shift/proof`, body `{challenge,deviceProof}`: opaque base64url
   native evidence and `{token,action,expiresAt}`; action is selected by the
   server, never by browser state. The verifier must independently check the
   card/challenge, not merely proof syntax or the application that forwarded it.
3. `/api/nfc/shift/record`, body `{token,action}`: `{state:'started'|'ended'}`
   only upon committed transition. Start and end require distinct fresh taps.
   An uncertain record response directs the worker to check status; do not send
   another record automatically. The UI discards an offer on expiry, background
   or navigation and stores it only in volatile memory.

Run node --test server/tests/nfc-shift-http.test.mjs server/tests/nfc-shift-gate.test.mjs server/tests/nfc-provisioning-gate.test.mjs and npm run typecheck.
The server tests inject a fixture store and hardware verifier: this checks the
HTTP/transition contract, not NFC hardware, durability, or actual world time.
See `nfc-attendance-pilot.md` and `tools/nfc-hardware-probe/README.md` for the
remaining on-device checks.
