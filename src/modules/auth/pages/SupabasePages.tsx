import { ArrowLeft, ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TopBar } from "../../../components/TopBar";
import { useAuth } from "../AuthProvider";
import { getPortalRole, getSignInDestination } from "../portal-access";
import { authClient } from "../supabase-auth";

function AccountPage({ title, lead, children, back = true }: { title: string; lead?: string; children?: ReactNode; back?: boolean }) {
  const { t } = useTranslation();
  return <div className="auth-page">
    <TopBar />
    <main className="auth-main">
      <section className="auth-card">
        {back && <Link className="back-link" to="/login"><ArrowLeft size={15} />{t("common.back")}</Link>}
        <div className="auth-card-icon"><ShieldCheck size={22} /></div>
        <h1>{title}</h1>
        {lead && <p className="auth-lead">{lead}</p>}
        {children}
      </section>
    </main>
  </div>;
}

export function SignOutButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    if (!authClient || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await authClient.signOut({ scope: "local" });
      if (error) setFailed(true);
      else navigate("/login", { replace: true });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <button type="button" className="button button--outline button--small" disabled={busy} onClick={signOut}>{t("auth.signOut")}</button>
    {failed && <p className="notice-box notice-box--warm" role="alert">{t("auth.actionFailed")}</p>}
  </div>;
}

export function SupabaseLoginPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authClient || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await authClient.signInWithPassword({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
      });
      if (error) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (auth.status === "signed-in") {
    if (auth.recovering) return <Navigate replace to="/reset-password" />;
    const role = getPortalRole(auth.user.app_metadata.timeax_role);
    if (role) return <Navigate replace to={getSignInDestination(location.state?.from, role)} />;
    return <AccountPage title={t("auth.accessPending")} lead={t("auth.accessPendingLead")} back={false}><SignOutButton /></AccountPage>;
  }

  const unavailable = auth.status === "unavailable";
  const disabled = busy || auth.status === "loading" || auth.status === "unconfigured" || unavailable;
  return <AccountPage title={t("auth.loginTitle")} lead={t("auth.loginLead")} back={false}>
    {auth.status === "unconfigured" && <p className="notice-box notice-box--warm" role="alert">{t("auth.configurationMissing")}</p>}
    {unavailable && <div className="notice-box notice-box--warm" role="alert">
      <p>{t("auth.sessionUnavailable")}</p>
      <button type="button" className="button button--outline button--small" onClick={() => window.location.reload()}>{t("auth.tryAgain")}</button>
    </div>}
    {location.state?.passwordChanged === true && <p className="notice-box" role="status">{t("auth.passwordChanged")}</p>}
    <form className="auth-form" onSubmit={signIn} aria-busy={busy || auth.status === "loading"}>
      <label className="field-label"><span>{t("auth.email")}</span><input name="email" type="email" autoComplete="email" required disabled={disabled} /></label>
      <label className="field-label"><span>{t("auth.password")}</span><input name="password" type="password" autoComplete="current-password" required disabled={disabled} /></label>
      {failed && <p className="notice-box notice-box--warm" role="alert">{t("auth.signInFailed")}</p>}
      <button className="button button--primary button--full" type="submit" disabled={disabled}>{t("auth.loginAction")} <ArrowRight size={16} /></button>
    </form>
    <div className="auth-links"><Link to="/forgot-password">{t("auth.forgot")}</Link><Link to="/register">{t("auth.requestAccess")}</Link></div>
  </AccountPage>;
}

export function RequestAccessPage() {
  const { t } = useTranslation();
  return <AccountPage title={t("auth.requestAccess")} lead={t("auth.requestAccessLead")} />;
}

export function SupabaseForgotPasswordPage() {
  const { t } = useTranslation();
  const [result, setResult] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function sendReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authClient || result === "sending") return;
    const email = String(new FormData(event.currentTarget).get("email")).trim();
    setResult("sending");
    try {
      const { error } = await authClient.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      setResult(error ? "failed" : "sent");
    } catch {
      setResult("failed");
    }
  }

  return <AccountPage title={t("auth.forgotTitle")} lead={t("auth.resetRequestLead")}>
    {!authClient && <p className="notice-box notice-box--warm" role="alert">{t("auth.configurationMissing")}</p>}
    {result === "sent" ? <p className="notice-box" role="status">{t("auth.resetEmailSent")}</p> : <form className="auth-form" onSubmit={sendReset} aria-busy={result === "sending"}>
      <label className="field-label"><span>{t("auth.email")}</span><input name="email" type="email" autoComplete="email" required disabled={!authClient || result === "sending"} /></label>
      {result === "failed" && <p className="notice-box notice-box--warm" role="alert">{t("auth.actionFailed")}</p>}
      <button type="submit" className="button button--primary button--full" disabled={!authClient || result === "sending"}><Mail size={16} />{t("auth.sendReset")}</button>
    </form>}
  </AccountPage>;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "saving" | "mismatch" | "failed" | "sign-out">("idle");

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authClient || state === "saving") return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== form.get("confirmation")) {
      setState("mismatch");
      return;
    }
    setState("saving");
    try {
      const { error } = await authClient.updateUser({ password });
      if (error) {
        setState("failed");
        return;
      }
      setState("sign-out");
      const { error: signOutError } = await authClient.signOut({ scope: "local" });
      if (!signOutError) navigate("/login", { replace: true, state: { passwordChanged: true } });
    } catch {
      setState((current) => current === "sign-out" ? current : "failed");
    }
  }

  return <AccountPage title={t("auth.resetPasswordTitle")} back={false}>
    {auth.status === "loading" ? <p role="status">{t("auth.sessionLoading")}</p>
      : state === "sign-out" ? <><p role="status">{t("auth.passwordChanged")}</p><SignOutButton /></>
        : auth.status === "signed-in" && auth.recovering ? <form className="auth-form" onSubmit={changePassword} aria-busy={state === "saving"}>
          <label className="field-label"><span>{t("auth.newPassword")}</span><input name="password" type="password" autoComplete="new-password" required disabled={state === "saving"} /></label>
          <label className="field-label"><span>{t("auth.confirmPassword")}</span><input name="confirmation" type="password" autoComplete="new-password" required disabled={state === "saving"} /></label>
          {state === "mismatch" && <p className="notice-box notice-box--warm" role="alert">{t("auth.passwordMismatch")}</p>}
          {state === "failed" && <p className="notice-box notice-box--warm" role="alert">{t("auth.actionFailed")}</p>}
          <button className="button button--primary button--full" type="submit" disabled={state === "saving"}>{t("auth.savePassword")}</button>
        </form> : <>
          <p className="notice-box notice-box--warm" role="alert">{t("auth.resetLinkUnavailable")}</p>
          <Link className="button button--outline" to="/forgot-password">{t("auth.sendReset")}</Link>
        </>}
  </AccountPage>;
}
