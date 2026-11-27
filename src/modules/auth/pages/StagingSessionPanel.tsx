import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LegalLink } from "../../../components/PublicExperience";
import { useTranslation } from "react-i18next";
import { createWorkingRegistrationClient, isEmailIdentityOrigin, validEmail, validOtp, type AccessContext } from "../registration/contract/registration-client";

export function StagingSessionPanel({ onChanged, purpose = "enrollment", audience = "agency", guided = false, signup = false, simple = signup, termsHref }: { termsHref?: string; simple?: boolean; signup?: boolean; guided?: boolean; onChanged: () => void; purpose?: "enrollment" | "existing"; audience?: "agency" | "worker" | "workspace" }) {
  const { t } = useTranslation();
  const emailIdentity=isEmailIdentityOrigin(window.location.origin);
  const client = useMemo(() => window.location.protocol === "https:" || emailIdentity ? createWorkingRegistrationClient(window.location.origin, window.fetch.bind(window), purpose) : undefined, [purpose,emailIdentity]);
  const sessionText = (key: string) => t(simple && ["accepted","enterCode","verified","logout"].includes(key) ? "publicSignup."+key : audience === "workspace" && key === "verified" ? "localWorkspace.sessionVerified" : audience === "workspace" && key === "scope" ? "localWorkspace.sessionScope" : audience === "worker" && key === "verified" ? "workerJoin.sessionVerified" : audience === "worker" && key === "scope" ? "workerJoin.sessionScope" : (purpose === "existing" ? "existingSession." : "stagingSession.") + (otpLength === 8 && (key === "code" || key === "enterCode") ? key + "8" : key));
  const [scope, setScope] = useState<AccessContext>();
  const [busy, setBusy] = useState(true);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("checking");
  const operation = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (!client) { setBusy(false); setNotice("closed"); return () => { mounted.current = false; }; }
    const request = new AbortController(); operation.current = request;
    void client.context(request.signal).then(result => {
      if (!mounted.current || request.signal.aborted) return;
      setScope(result); setNotice(result?.state === "verified" ? "verified" : result?.capabilities.verify ? "enterCode" : result?.capabilities.login ? "ready" : "closed");
    }).finally(() => {
      if (operation.current === request) operation.current = null;
      if (mounted.current && !request.signal.aborted) setBusy(false);
    });
    return () => { mounted.current = false; operation.current?.abort(); operation.current = null; };
  }, [client]);
  async function act(action: "send" | "verify" | "check" | "logout") {
    if (!client || operation.current) return;
    const request = new AbortController(); operation.current = request; setBusy(true);
    try {
      let message = "closed";
      if (action === "send") message = await client.sendCode(email.trim(), request.signal) === "accepted" ? "accepted" : "closed";
      if (action === "verify") {
        const result = await client.verifyCode(email.trim(), code, request.signal);
        message = result === "verified" ? "verified" : result === "invalid" ? "invalid" : "closed";
      }
      if (action === "logout") await client.logout(request.signal);
      const result = await client.context(request.signal);
      if (!mounted.current || request.signal.aborted) return;
      setScope(result);
      if (action === "check" || action === "logout") message = result?.state === "verified" ? "verified" : result?.capabilities.verify ? "enterCode" : result?.capabilities.login ? "ready" : "closed";
      setNotice(message); onChanged();
      if (action === "verify" || action === "logout") setCode("");
    } finally {
      if (operation.current === request) operation.current = null;
      if (mounted.current && !request.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    if (scope?.state !== "verified") return;
    const delay = Math.max(1, Date.parse(scope.session.expiresAt) - Date.parse(scope.session.serverTime) + 50);
    const timer = window.setTimeout(() => void act("check"), delay);
    return () => window.clearTimeout(timer);
  }, [scope]);
  const verified = scope?.state === "verified";
  const otpLength = scope?.otpLength ?? 6;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && (emailIdentity || validEmail(email.trim())) && scope?.capabilities.verify && validOtp(code, otpLength)) void act("verify");
    else if (!busy && !scope?.capabilities.verify && validEmail(email.trim()) && scope?.capabilities.login) void act("send");
  }
  if (signup && verified) return null;
  return <section aria-label={sessionText("title")} className="registration-session">
    {!simple && <h2>{sessionText("title")}</h2>}
    {(!simple || !["checking", "ready"].includes(notice)) && <p className="notice-box" role="status" data-testid="session-status">{sessionText(!simple && busy ? "checking" : notice)}</p>}
    {!guided&&<p className="muted-copy">{sessionText("scope")}</p>}
    {!verified && <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      {!guided&&<p className="muted-copy">{t("publicExperience.codePurpose")}</p>}
      {termsHref&&<p className="muted-copy" id="agency-email-use">{t("publicSignup.agencyEmailUse")}</p>}
      <div className={simple?"public-legal-links":"muted-copy"} id="enrollment-privacy">
        {!simple&&<>{t("hostedPrivacy.beforeEmail")}{" "}</>}
        {termsHref&&<LegalLink kind="terms" to={termsHref}/>}
        <LegalLink kind="privacy" to={simple?"/privacy#privacy-access":"/privacy"}/>
      </div>
      <label className="field-label" htmlFor="enrollment-email"><span>{sessionText("email")}</span>
        <input id="enrollment-email" aria-describedby={termsHref?"agency-email-use":"enrollment-privacy"} type="email" autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={e => setEmail(e.target.value)} required={!emailIdentity || !scope?.capabilities.verify} />
      </label>
      {scope?.capabilities.verify && <label className="field-label" htmlFor="enrollment-code"><span>{sessionText("code")}</span>
        <input id="enrollment-code" inputMode="numeric" autoComplete="one-time-code" pattern={"[0-9]{" + otpLength + "}"} minLength={otpLength} maxLength={otpLength} value={code} disabled={busy} onChange={e => setCode(e.target.value)} required={!emailIdentity || !scope?.capabilities.verify} />
      </label>}
      <button className="button button--primary button--full" type="submit"
        disabled={busy || (scope?.capabilities.verify ? !validOtp(code, otpLength) || !emailIdentity && !validEmail(email.trim()) : !scope?.capabilities.login || !validEmail(email.trim()))}>
        {sessionText(scope?.capabilities.verify ? "verifyAction" : "sendAction")}
      </button>
      {emailIdentity && scope?.capabilities.verify && <button type="button" className="button button--outline button--full" disabled={busy || !validEmail(email.trim())} onClick={() => void act("send")}>{sessionText("sendAction")}</button>}
    </form>}
    {guided&&!simple&&!verified&&<details className="enrollment-code-help"><summary>{t("publicExperience.codesHelp")}</summary><p>{t("publicExperience.codePurpose")}</p></details>}
    {(!simple || (!scope && !busy)) && <button className="button button--outline button--full" type="button" disabled={busy} onClick={() => void act("check")}>{simple?t("publicSignup.retry"):sessionText("recheck")}</button>}
    {verified && scope.capabilities.logout && <button className="button button--outline button--full" type="button" disabled={busy} onClick={() => void act("logout")}>{sessionText("logout")}</button>}
  </section>;
}
