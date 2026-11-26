import { createWorkspaceClient } from "../../memberships/workspace-client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RegistrationChoices, RegistrationFrame, RegistrationProgress } from "../../../components/PublicExperience";
import { createRegistrationTransport, isRegistrationReview, isStagingRegistration, isUnifiedLocal, isMembershipLocal, validateAgencyDraft, type RegistrationState } from "../registration/agency-registration";
import "../../../styles/agency-registration.css";
import { StagingSessionPanel } from "./StagingSessionPanel";

export function RegistrationLandingPage() { return <RegistrationChoices />; }

export function AgencyRegistrationPage() {
  const { t, i18n } = useTranslation();
  const transport = useMemo(() => createRegistrationTransport(import.meta.env.MODE, window.location.origin, window.fetch.bind(window)), []);
  const [approvedAgency, setApprovedAgency] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const refreshSession = useCallback(() => setSessionRevision(value => value + 1), []);
  const staging = isStagingRegistration(import.meta.env.MODE, window.location.origin);
  const review = isRegistrationReview(import.meta.env.MODE, window.location.origin) || isUnifiedLocal(import.meta.env.MODE, window.location.origin);
  const [name, setName] = useState("");
  const [nip, setNip] = useState("");
  const [state, setState] = useState<RegistrationState>({ state: "unavailable" });
  const [busy, setBusy] = useState(Boolean(transport));
  const [errors, setErrors] = useState<{ name?: true; nip?: true }>({});
  const nameInput = useRef<HTMLInputElement>(null);
  const nipInput = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (transport) {
      const request = new AbortController();
      operation.current = request;
      void transport.check(request.signal).then(async (result) => {
        let approved = false;
        if (isMembershipLocal(import.meta.env.MODE, window.location.origin)) {
          try { const value = await createWorkspaceClient(import.meta.env.MODE, window.location.origin, window.fetch.bind(window))?.context(request.signal); approved = Boolean(value?.memberships.some(m => m.role === "agency")); } catch { /* Unknown rights remain closed. */ }
        }
        if (!request.signal.aborted && mounted.current) setApprovedAgency(approved);
        if (!request.signal.aborted && mounted.current) setState(result);
      }).finally(() => {
        if (operation.current === request) operation.current = null;
        if (!request.signal.aborted && mounted.current) setBusy(false);
      });
    }
    return () => { mounted.current = false; operation.current?.abort(); operation.current = null; };
  }, [transport, sessionRevision]);

  async function run(submit: boolean) {
    if (!transport || operation.current) return;
    const request = new AbortController();
    operation.current = request;
    setBusy(true);
    try {
      const validated = validateAgencyDraft(name, nip);
      const result = submit && validated.draft
        ? await transport.submit(validated.draft, request.signal)
        : await transport.check(request.signal);
      if (!request.signal.aborted && mounted.current) setState(result);
    } catch {
      if (!request.signal.aborted && mounted.current) setState({ state: submit ? "uncertain" : "unavailable" });
    } finally {
      if (operation.current === request) operation.current = null;
      if (!request.signal.aborted && mounted.current) setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || operation.current || !transport || state.state !== "none") return;
    const result = validateAgencyDraft(name, nip);
    setErrors(result.errors);
    if (!result.draft) { (result.errors.name ? nameInput : nipInput).current?.focus(); return; }
    void run(true);
  }
  const registrationText = (key: string) => t((staging && ["ready", "sessionMissing", "pendingTitle", "pendingLead", "receiptLabel"].includes(key) ? "stagingRegistration." : "agencyRegistration.") + key);
  const pending = state.state === "pending" ? state.registration : undefined;
  const ready = Boolean(transport) && state.state === "none";
  const message = !transport ? "notConnected" : busy ? "checking" : state.state === "none" ? "ready"
    : state.state === "session" ? "sessionMissing" : state.state === "uncertain" ? "uncertain" : "unavailable";
  return <RegistrationFrame title={t("agencyRegistration.title")} lead={t(staging ? "publicExperience.registerLead" : "agencyRegistration.lead")}>
      {staging && <RegistrationProgress current={pending ? 2 : ready ? 1 : 0} />}
      {staging && <StagingSessionPanel onChanged={refreshSession} />}
      {review && <p className="notice-box notice-box--warm" data-testid="review-notice">{t("agencyRegistration.reviewNotice")}</p>}
      {approvedAgency ? <div className="notice-box" data-testid="agency-approved"><p>{t("localWorkspace.approvedAgencyNotice")}</p><Link className="button button--primary button--full" to="/agency/workers">{t("localWorkspace.agencyCabinet")}</Link></div> : pending ? <div role="status" className="notice-box registration-receipt">
        <ShieldCheck size={21} aria-hidden="true" /><h2>{registrationText("pendingTitle")}</h2>
        <p>{registrationText("pendingLead")}</p>
        <dl><dt>{registrationText("receiptLabel")}</dt><dd>{pending.requestId}</dd>
          <dt>{t("agencyRegistration.dateLabel")}</dt><dd>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(pending.requestedAt))}</dd></dl>
      </div> : <>
        <p role="status" className="notice-box" data-testid="registration-status">{registrationText(message)}</p>
        <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
          <label className="field-label" htmlFor="agency-name"><span>{t("agencyRegistration.nameLabel")}</span>
            <input ref={nameInput} id="agency-name" name="agencyName" autoComplete="organization" maxLength={120} required value={name}
              disabled={busy} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "agency-name-error" : undefined}
              onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }} />
          </label>
          {errors.name && <p id="agency-name-error" className="registration-error" role="alert">{t("agencyRegistration.nameError")}</p>}
          <label className="field-label" htmlFor="agency-nip"><span>{t("agencyRegistration.nipLabel")}</span>
            <input ref={nipInput} id="agency-nip" name="nip" inputMode="numeric" autoComplete="off" maxLength={24} value={nip}
              disabled={busy} aria-invalid={Boolean(errors.nip)} aria-describedby={errors.nip ? "agency-nip-error" : "agency-nip-hint"}
              onChange={(event) => { setNip(event.target.value); setErrors((current) => ({ ...current, nip: undefined })); }} />
          </label>
          <p id="agency-nip-hint" className="muted-copy registration-field-hint">{t("agencyRegistration.nipHint")}</p>
          {errors.nip && <p id="agency-nip-error" className="registration-error" role="alert">{t("agencyRegistration.nipError")}</p>}
          <button className="button button--primary button--full" type="submit" disabled={busy || !ready}>
            {t(busy ? "agencyRegistration.checking" : transport ? staging ? "stagingSession.submit" : "agencyRegistration.submitReview" : "agencyRegistration.submitUnavailable")} <ArrowRight size={16} />
          </button>
        </form>
        {transport && !busy && !ready && <button className="button button--outline button--full" type="button" onClick={() => void run(false)}>{t("agencyRegistration.recheck")}</button>}
      </>}
      <p className="muted-copy">{t("agencyRegistration.accessNote")}</p>
      <Link className="back-link" to="/login">{t("agencyRegistration.existingAccount")}</Link>
  </RegistrationFrame>;
}
