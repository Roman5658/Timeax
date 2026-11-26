import { Link } from "react-router-dom";
import { isUnifiedLocal, isMembershipLocal } from "../registration/agency-registration";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { createWorkerAgencyClient, workerDraft, type WorkerRequest, type WorkerSubmit } from "../registration/worker-agency-request";
import { StagingSessionPanel } from "./StagingSessionPanel";
export function WorkerAgencyRequestPanel() {
  const { t, i18n } = useTranslation();
  const client = useMemo(() => createWorkerAgencyClient(import.meta.env.MODE, window.location.origin, window.fetch.bind(window)), []);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const [name, setName] = useState(""), [nip, setNip] = useState("");
  const [requests, setRequests] = useState<WorkerRequest[]>([]);
  const [state, setState] = useState<WorkerSubmit["state"]>("unavailable");
  const [busy, setBusy] = useState(Boolean(client));
  const [invalid, setInvalid] = useState(false);
  const operation = useRef<AbortController | null>(null), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (!client) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true);
    void client.load(controller.signal).then(result => {
      if (!mounted.current || controller.signal.aborted) return;
      setState(result.state); setRequests(result.state === "ready" ? result.requests : []);
    }).finally(() => { if (operation.current === controller) operation.current = null; if (mounted.current && !controller.signal.aborted) setBusy(false); });
    return () => { mounted.current = false; operation.current?.abort(); operation.current = null; };
  }, [client, revision]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || operation.current || busy || state !== "ready" && state !== "target-unavailable") return;
    if (!workerDraft(name, nip)) { setInvalid(true); return; }
    setInvalid(false); setBusy(true); const controller = new AbortController(); operation.current = controller;
    try {
      const result = await client.submit(name, nip, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setState(result.state); if (result.state === "ready") setRequests(result.requests);
      if (result.state === "session") setRequests([]);
    } finally { if (operation.current === controller) operation.current = null; if (mounted.current && !controller.signal.aborted) setBusy(false); }
  }
  const ready = state === "ready" || state === "target-unavailable";
  return <section className="worker-join-panel" aria-label={t("workerJoin.title")}>
    <p className="notice-box notice-box--warm">{t("workerJoin.localNotice")}</p>
    <StagingSessionPanel purpose={isUnifiedLocal(import.meta.env.MODE, window.location.origin) ? "existing" : "enrollment"} audience={requests.some(r => r.state === "approved") ? "workspace" : "worker"} onChanged={refresh} />
    <h2>{t("workerJoin.title")}</h2>
    <p role="status" data-testid="worker-join-status">{t("workerJoin." + (busy ? "checking" : state === "ready" ? requests.some(r => r.state === "approved") ? "approved" : requests.length ? "pending" : "ready" : state))}</p>
    {requests.length > 0 && <ul className="worker-join-receipts">{requests.map(request =>
      <li key={request.requestId} className="notice-box" data-testid="worker-join-receipt">
        <strong>{t(request.state === "approved" ? "workerJoin.approved" : "workerJoin.pending")}</strong>
        <dl><dt>{t("workerJoin.nip")}</dt><dd>{request.agencyNip}</dd>
          <dt>{t("workerJoin.requestId")}</dt><dd>{request.requestId}</dd>
          <dt>{t("workerJoin.date")}</dt><dd>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.submittedAt))}</dd></dl>
      </li>)}</ul>}
    {isMembershipLocal(import.meta.env.MODE, window.location.origin) && requests.some(r => r.state === "approved") && <Link className="button button--primary button--full" to="/worker/shifts">{t("localWorkspace.hoursLink")}</Link>}
    <form className="auth-form" onSubmit={send} noValidate aria-busy={busy}>
      <label className="field-label" htmlFor="worker-join-name"><span>{t("workerJoin.name")}</span>
        <input id="worker-join-name" autoComplete="name" value={name} maxLength={120} required disabled={busy} onChange={e => { setName(e.target.value); setInvalid(false); }} />
      </label>
      <label className="field-label" htmlFor="worker-join-nip"><span>{t("workerJoin.nip")}</span>
        <input id="worker-join-nip" inputMode="numeric" autoComplete="off" value={nip} maxLength={24} required disabled={busy} onChange={e => { setNip(e.target.value); setInvalid(false); }} />
      </label>
      <p className="muted-copy">{t("workerJoin.nipHint")}</p>
      {invalid && <p role="alert" className="registration-error">{t("workerJoin.invalid")}</p>}
      <button type="submit" className="button button--primary button--full" disabled={!ready || busy}>{t("workerJoin.submit")}</button>
    </form>
    <button className="button button--outline button--full" type="button" disabled={busy} onClick={refresh}>{t("workerJoin.check")}</button>
    <p className="muted-copy">{t("workerJoin.noAccess")}</p>
  </section>;
}
