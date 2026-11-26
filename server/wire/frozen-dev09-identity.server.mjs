import { Buffer } from 'node:buffer';

/** @typedef {{issuer: string, subject: string, emailConfirmed: true}} VerifiedIdentity */
/** @typedef {'invalid-session' | 'email-unconfirmed' | 'provider-unavailable'} FailureCode */
/** @typedef {{ok: true, identity: Readonly<VerifiedIdentity>} | {ok: false, reason: FailureCode}} Verification */

const PROJECT_REF = /^[a-z0-9]{20}$/;
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,160}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const MAX_AUTHORIZATION = 8192;
const MAX_PROVIDER_RESPONSE = 64 * 1024;
const CLOCK_SKEW_SECONDS = 30;

const badSession = () => Object.freeze({ ok: false, reason: 'invalid-session' });
const unavailable = () => Object.freeze({ ok: false, reason: 'provider-unavailable' });
const unconfirmed = () => Object.freeze({ ok: false, reason: 'email-unconfirmed' });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;

function parseTokenClaims(accessToken) {
  try {
    const part = accessToken.split('.')[1];
    const bytes = Buffer.from(part, 'base64url');
    if (bytes.toString('base64url') !== part) return null;
    const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return record(claims) ? claims : null;
  } catch {
    return null;
  }
}

function claimsMatch(claims, issuer, now) {
  if (!record(claims) || !Number.isFinite(now)) return false;
  const sub = own(claims, 'sub');
  const sessionId = own(claims, 'session_id');
  const aal = own(claims, 'aal');
  const exp = own(claims, 'exp');
  const iat = own(claims, 'iat');
  const nbf = own(claims, 'nbf');
  return own(claims, 'iss') === issuer && own(claims, 'aud') === 'authenticated'
    && own(claims, 'role') === 'authenticated' && own(claims, 'is_anonymous') === false
    && !Object.hasOwn(claims, 'client_id') && (aal === 'aal1' || aal === 'aal2')
    && typeof sub === 'string' && UUID.test(sub) && sub !== NIL_UUID
    && typeof sessionId === 'string' && UUID.test(sessionId) && sessionId !== NIL_UUID
    && Number.isSafeInteger(iat) && iat > 0 && iat <= now + CLOCK_SKEW_SECONDS
    && Number.isSafeInteger(exp) && exp > iat && exp > now
    && (nbf === undefined || Number.isSafeInteger(nbf) && nbf > 0 && nbf < exp && nbf <= now + CLOCK_SKEW_SECONDS);
}

async function readBoundedUser(response) {
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json' || !response.body) throw new Error('unexpected response');
  const size = response.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_PROVIDER_RESPONSE)) {
    throw new Error('unexpected response');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let body = '';
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PROVIDER_RESPONSE) throw new Error('unexpected response');
      body += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    // Do not wait for an untrusted response stream to acknowledge cancellation.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function hasConfirmedEmail(user, now) {
  const email = own(user, 'email');
  const timestamp = own(user, 'email_confirmed_at');
  return typeof email === 'string' && email.length <= 254 && /^[^@\s\x00-\x1f\x7f]+@[^@\s\x00-\x1f\x7f]+$/.test(email)
    && typeof timestamp === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    && Date.parse(timestamp) > 0 && Date.parse(timestamp) <= (now + CLOCK_SKEW_SECONDS) * 1000;
}

function accountEligible(user, now) {
  if (own(user, 'is_anonymous') !== false || own(user, 'deleted_at') != null) return false;
  const banned = own(user, 'banned_until');
  if (banned != null && (typeof banned !== 'string' || !Number.isFinite(Date.parse(banned)) || Date.parse(banned) > now * 1000)) return false;
  return true;
}

/**
 * Construct once with trusted server configuration, never a request body or
 * unverified token claim. Hosted Supabase project domains only, no custom hosts.
 * Transport and clock injection are server-owned hooks for synthetic tests only.
 * @param {{projectRef: string, publishableKey: string, timeoutMs?: number}} config
 * @param {{transport?: typeof fetch, now?: () => number}} [hooks]
 */
export function createIdentityVerifier(config, { transport = globalThis.fetch, now = Date.now } = {}) {
  if (typeof process === 'undefined' || !process.versions?.node || typeof document !== 'undefined') {
    throw new Error('Timeax identity verifier is server-only');
  }
  const { projectRef, publishableKey, timeoutMs = 2500 } = config ?? {};
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef) ||
      typeof publishableKey !== 'string' || !PUBLISHABLE_KEY.test(publishableKey) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10_000 ||
      typeof transport !== 'function' || typeof now !== 'function') {
    throw new Error('Invalid Timeax identity provider configuration');
  }
  const issuer = `https://${projectRef}.supabase.co/auth/v1`;
  const endpoint = `${issuer}/user`;

  /**
   * Use the normalized Fetch Request from the server framework and no other
   * request values from the caller. Returns identity only, never membership.
   * @param {Pick<Request, 'headers'>} request
   * @returns {Promise<Verification>}
   */
  async function verify(request) {
    let header;
    try { header = Headers.prototype.get.call(request?.headers, 'authorization'); }
    catch { return badSession(); }
    if (typeof header !== 'string' || header.length > MAX_AUTHORIZATION) return badSession();
    const match = BEARER.exec(header);
    if (!match) return badSession();
    const accessToken = match[1];
    const claims = parseTokenClaims(accessToken);
    const checkedAt = Math.floor(now() / 1000);

    // Unverified claims can only reject. Success always requires Auth to
    // verify precisely this token and return a matching user over HTTPS.
    if (!claimsMatch(claims, issuer, checkedAt)) return badSession();

    let timer;
    const controller = new AbortController();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('verification timed out'));
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([deadline, (async () => {
        const response = await transport(endpoint, {
          method: 'GET',
          headers: { accept: 'application/json', apikey: publishableKey, authorization: `Bearer ${accessToken}` },
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal,
        });
        if (response.redirected || (response.url && response.url !== endpoint)) return unavailable();
        if (response.status === 401 || response.status === 403) return badSession();
        if (response.status !== 200) return unavailable();
        const user = await readBoundedUser(response);
        const observedAt = Math.floor(now() / 1000);
        if (!claimsMatch(claims, issuer, observedAt)) return badSession();
        if (!record(user) || own(user, 'id') !== claims.sub || own(user, 'aud') !== 'authenticated'
          || own(user, 'role') !== 'authenticated' || !accountEligible(user, observedAt)) return badSession();
        if (!hasConfirmedEmail(user, observedAt)) return unconfirmed();
        return Object.freeze({
          ok: true,
          identity: Object.freeze({ issuer, subject: user.id, emailConfirmed: true }),
        });
      })()]);
      return result;
    } catch {
      // No provider body, token, key, address, or raw error escapes.
      return unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  return Object.freeze({ verify });
}
