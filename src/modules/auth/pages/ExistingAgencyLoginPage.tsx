import { createWorkspaceClient, type WorkspaceContext } from "../../memberships/workspace-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TopBar } from "../../../components/TopBar";
import { StagingSessionPanel } from "./StagingSessionPanel";
import { createWorkingRegistrationClient, type RegistrationOutcome } from "../registration/contract/registration-client";
import { isLocalSessionResume, isUnifiedLocal, isMembershipLocal } from "../registration/agency-registration";
import "../../../styles/agency-registration.css";

export function ExistingAgencyLoginPage() {
  const { t, i18n } = useTranslation();
  const enabled = isLocalSessionResume(import.meta.env.MODE, window.location.origin);
  const client = useMemo(() => enabled ? createWorkingRegistrationClient(window.location.origin, window.fetch.bind(window), "existing") : undefined, [enabled]);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<RegistrationOutcome>({ state: "session" });
  const [busy, setBusy] = useState(true);
  const [workspace, setWorkspace] = useState<WorkspaceContext>();
  const [billingReady, setBillingReady] = useState(false);
  const refresh = useCallback(() => { setState({ state: "session" }); setBillingReady(false); setWorkspace(undefined); setRevision(v => v + 1); }, []);
  useEffect(() => {
    const request = new AbortController();
    setBusy(true);
    if (!client) { setState({ state: "unavailable" }); setBusy(false); return; }
    void client.registration(request.signal).then(async result => {
      let billing = false;
      if (isMembershipLocal(import.meta.env.MODE, window.location.origin)) {
        try { const api = createWorkspaceClient(import.meta.env.MODE, window.location.origin, window.fetch.bind(window)); const value = await api?.context(request.signal); if (!request.signal.aborted) setWorkspace(value); } catch { if (!request.signal.aborted) setWorkspace(undefined); }
      }
      if (isUnifiedLocal(import.meta.env.MODE, window.location.origin) && (result.state === "none" || result.state === "pending")) {
        try { const response = await fetch("/api/billing/context", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: request.signal }); billing = response.ok; } catch { /* Unknown membership remains closed. */ }
      }
      if (!request.signal.aborted) setBillingReady(billing);
      if (!request.signal.aborted) setState(result);
    }).finally(() => { if (!request.signal.aborted) setBusy(false); });
    return () => request.abort();
  }, [client, revision]);
  const agencyReady = workspace?.memberships.some(m => m.role === "agency");
  const pending = !busy && state.state === "pending" ? state.registration : undefined;
  return <div className="auth-page"><TopBar /><main className="auth-main">
    <section className="auth-card registration-card">
      <h1>{t("existingSession.pageTitle")}</h1>
      <p className="auth-lead">{t("existingSession.lead")}</p>
      <p className="notice-box notice-box--warm" data-testid="local-resume-notice">{t("existingSession.localNotice")}</p>
      {enabled && <StagingSessionPanel purpose="existing" onChanged={refresh} />}
      {agencyReady ? <div className="notice-box" data-testid="agency-approved"><p>{t("localWorkspace.approvedAgencyNotice")}</p><Link className="button button--primary button--full" to="/agency/workers">{t("localWorkspace.agencyCabinet")}</Link></div> : pending ? <div role="status" className="notice-box registration-receipt">
        <h2>{t("stagingRegistration.pendingTitle")}</h2><p>{t("stagingRegistration.pendingLead")}</p>
        <dl><dt>{t("stagingRegistration.receiptLabel")}</dt><dd>{pending.requestId}</dd>
          <dt>{t("agencyRegistration.dateLabel")}</dt><dd>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(pending.requestedAt))}</dd></dl>
      </div> : <p role="status" data-testid="resume-status" className="notice-box">{t("existingSession." + (busy ? "checking" : state.state === "none" ? billingReady ? "billingReady" : "noApplication" : state.state === "session" ? "signInToRead" : "unavailable"))}</p>}
      {!busy && !billingReady && state.state === "none" && <Link className="back-link" to="/register/agency">{t("existingSession.registrationLink")}</Link>}
      {!busy && billingReady && <Link className="button button--primary button--full" to="/agency/subscription">{t("existingSession.billingLink")}</Link>}
    </section>
  </main></div>;
}
