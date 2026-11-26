import { agencyDraft, createWorkingRegistrationClient, isCanonicalEmailOrigin, isLoopbackEmailOrigin, type PendingRegistration, type RegistrationOutcome } from "./contract/registration-client.ts";

export const reviewOrigin = "https://127.0.0.1:43817";
export type RegistrationState = RegistrationOutcome | { state: "uncertain" | "busy" };
export type AgencyDraft = { agencyName: string; nip?: string };
export type RegistrationTransport = {
  check: (signal: AbortSignal) => Promise<RegistrationOutcome>;
  submit: (draft: AgencyDraft, signal: AbortSignal) => Promise<RegistrationState>;
};
export function validateAgencyDraft(name: string, nip: string) {
  const errors: { name?: true; nip?: true } = {};
  if (!agencyDraft(name, "")) errors.name = true;
  if (!agencyDraft("Agency", nip)) errors.nip = true;
  return { errors, draft: agencyDraft(name, nip) };
}
export function isRegistrationReview(mode: string, origin: string) {
  return mode === "registration-review" && origin === reviewOrigin;
}
export function createRegistrationReviewTransport(mode: string, origin: string, transport: typeof fetch): RegistrationTransport | undefined {
  if (!isRegistrationReview(mode, origin)) return;
  return createRegistrationTransport(mode, origin, transport);
}
export function isLocalSessionResume(mode: string, origin: string) {
  try { const url = new URL(origin); return (mode === "pending-resume-local" || mode === "unified-local" || mode === "membership-local") && url.origin === origin
    && url.protocol === "https:" && url.hostname === "127.0.0.1" && !url.username && !url.password; } catch { return false; }
}
export function isStagingRegistration(mode: string, origin: string) {
  try { const url = new URL(origin); return (mode === "enrollment-staging" || isLocalSessionResume(mode, origin)) && url.origin === origin && url.protocol === "https:"
    && !url.username && !url.password && !["timeax.pl", "www.timeax.pl"].includes(url.hostname); } catch { return false; }
}
export function createRegistrationTransport(mode: string, origin: string, transport: typeof fetch): RegistrationTransport | undefined {
  // UI build mode enables only same-origin requests. Server capabilities remain authoritative.
  if (!isRegistrationReview(mode, origin) && !isStagingRegistration(mode, origin) && !(mode === "enrollment-staging" && isLoopbackEmailOrigin(origin)) && !(mode === "public-registration" && isCanonicalEmailOrigin(origin))) return;
  const client = createWorkingRegistrationClient(origin, transport);
  let submitting = false;
  return {
    check: (signal) => client.registration(signal),
    async submit(draft, signal) {
      if (submitting) return { state: "busy" };
      if (signal.aborted || !agencyDraft(draft.agencyName, draft.nip ?? "")) return { state: "unavailable" };
      submitting = true;
      try {
        const previous = await client.registration(signal);
        if (previous.state !== "none" || signal.aborted) return previous;
        const sent = await client.registration(signal, draft);
        // Never automatically retry a POST whose outcome is unknown.
        if (sent.state !== "pending") return { state: "uncertain" };
        const confirmed = await client.registration(signal);
        return confirmed.state === "pending" && sameReceipt(confirmed.registration, sent.registration)
          ? confirmed : { state: "uncertain" };
      } finally { submitting = false; }
    },
  };
}
function sameReceipt(a: PendingRegistration, b: PendingRegistration) {
  return a.requestId === b.requestId && a.requestedAt === b.requestedAt;
}

export function isUnifiedLocal(mode: string, origin: string) { return (mode === "unified-local" || mode === "membership-local") && isLocalSessionResume(mode, origin); }

export function isMembershipLocal(mode: string, origin: string) { return mode === "membership-local" && isLocalSessionResume(mode, origin); }
