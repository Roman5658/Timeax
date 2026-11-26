import { agencyDraft, parseAccessContext } from "./contract/registration-client.ts";
export type WorkerRequest = { requestId: string; state: "awaiting-approval" | "approved"; agencyNip: string; submittedAt: string };
export type WorkerLoad = { state: "ready"; requests: WorkerRequest[] } | { state: "session" | "unavailable" };
export type WorkerSubmit = WorkerLoad | { state: "target-unavailable" | "uncertain" | "invalid" };
const endpoint = "/api/worker-agency-request";
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function isLocalWorkerJoin(mode: string, origin: string) {
  try { const u = new URL(origin); return (mode === "worker-join-local" || mode === "unified-local" || mode === "membership-local") && u.origin === origin && u.protocol === "https:" && u.hostname === "127.0.0.1"; } catch { return false; }
}
export function workerDraft(name: string, nip: string) {
  const draft = agencyDraft(name, nip);
  return draft?.nip ? { name: draft.agencyName, agencyNip: draft.nip } : undefined;
}
function receipt(raw: unknown): WorkerRequest | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const r = raw as Record<string, unknown>;
  if (typeof r.requestId !== "string" || !uuid.test(r.requestId) || ! ["awaiting-approval", "approved"].includes(r.state as string)
    || typeof r.agencyNip !== "string" || !/^\d{10}$/.test(r.agencyNip)
    || typeof r.submittedAt !== "string" || !Number.isFinite(Date.parse(r.submittedAt))) return;
  return { requestId: r.requestId, state: r.state as WorkerRequest["state"], agencyNip: r.agencyNip, submittedAt: r.submittedAt };
}
export function createWorkerAgencyClient(mode: string, origin: string, transport: typeof fetch) {
  if (!isLocalWorkerJoin(mode, origin)) return;
  async function request(path: string, signal: AbortSignal, body?: object) {
    const url = origin + path;
    const response = await transport(url, { method: body ? "POST" : "GET", credentials: "same-origin", redirect: "error",
      cache: "no-store", referrerPolicy: "no-referrer", signal, headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.redirected || response.url !== url || !response.headers.get("cache-control")?.split(",").some(v => v.trim() === "no-store")
      || response.headers.get("content-type")?.split(";")[0] !== "application/json") throw Error("Response unavailable");
    return { status: response.status, body: await response.json() };
  }
  async function access(signal: AbortSignal): Promise<"allowed" | "session" | "unavailable"> {
    const r = await request("/v1/session/context", signal);
    const scope = r.status === 200 ? parseAccessContext(r.body) : undefined;
    if (!scope) return "unavailable";
    if (scope.state !== "verified") return "session";
    return r.body.capabilities.workerAgencyRequest === true ? "allowed" : "unavailable";
  }
  async function load(signal: AbortSignal): Promise<WorkerLoad> {
    try {
      const state = await access(signal); if (state !== "allowed") return { state };
      const r = await request(endpoint, signal);
      if (r.status === 401) return { state: "session" };
      if (r.status !== 200 || !Array.isArray(r.body?.requests)) return { state: "unavailable" };
      const requests = r.body.requests.map(receipt) as (WorkerRequest | undefined)[];
      if (requests.some(v => !v) || new Set(requests.map(v => v?.requestId)).size !== requests.length) return { state: "unavailable" };
      return { state: "ready", requests: requests as WorkerRequest[] };
    } catch { return { state: "unavailable" }; }
  }
  async function submit(name: string, nip: string, signal: AbortSignal): Promise<WorkerSubmit> {
    const draft = workerDraft(name, nip); if (!draft) return { state: "invalid" };
    try {
      const state = await access(signal); if (state !== "allowed") return { state };
      const r = await request(endpoint, signal, draft);
      if (r.status === 404 && r.body?.error === "agency-unavailable") return { state: "target-unavailable" };
      if (r.status === 401) return { state: "session" };
      const saved = r.status === 202 ? receipt(r.body?.request) : undefined;
      if (!saved) return { state: "uncertain" };
      const checked = await load(signal);
      return checked.state === "ready" && checked.requests.some(v => v.requestId === saved.requestId && v.submittedAt === saved.submittedAt)
        ? checked : { state: "uncertain" };
    } catch { return { state: "uncertain" }; }
  }
  return { load, submit };
}
