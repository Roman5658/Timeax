import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RegistrationFrame } from "../components/PublicExperience";
import { accountAdminCopy } from "./account-admin-copy";
import "./account-admin.css";

type Account = { id: string; email: string | null; createdAt: string; verified: boolean; termsReceipt?: {version: string; acceptedAt: string} | null };
type Preview = { id: string; email: string; scope: string; canDelete: boolean; token: string | null };
type Organization = { id: string; name: string; kind: "agency" | "factory"; state: string; activeMembers: number };
type Summary = { accounts: number; verifiedAccounts: number; agencies: number; factories: number; newAgencies30d: number };
const keyPattern = /^[-_A-Za-z0-9]{43,128}$/;
const summaryMetrics = ["accounts", "verifiedAccounts", "agencies", "factories", "newAgencies30d"] as const;

async function ownerCall<T>(key: string, body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/timeax/account-admin", {
    method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw Error(payload.error);
  return payload as T;
}

export function AccountAdminPage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage ?? "en").split("-")[0] as keyof typeof accountAdminCopy;
  const strings: Record<string, string> = accountAdminCopy[lang] ?? accountAdminCopy.en;
  const tx = (k: string) => strings[k] ?? strings.unavailable;
  const location = useLocation();
  const section = location.pathname.replace(/\/$/, "") === "/super-admin/accounts" ? "users"
    : new URLSearchParams(location.search).get("section") === "organizations" ? "organizations" : "overview";
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const [draftKey, setDraftKey] = useState("");
  const [key, setKey] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [cursor, setCursor] = useState<{ section: string; after: string } | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [listError, setListError] = useState("");
  const [revision, refresh] = useState(0);
  const after = cursor?.section === section ? cursor.after : null;
  const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium" });
  const acceptanceDate = new Intl.DateTimeFormat(lang,{dateStyle:"medium",timeStyle:"long",timeZone:"Europe/Warsaw"});
  const number = new Intl.NumberFormat(lang);

  function lock() {
    setDraftKey(""); setKey(""); setSummary(null); setAccounts(null); setOrganizations(null);
    setCursor(null); setNext(null); setDraftSearch(""); setSearch(null);
    setPreview(null); setConfirm(""); setListBusy(false); setListError(""); setStatus("");
  }

  useEffect(() => {
    setPreview(null); setConfirm(""); setStatus("");
    setCursor(null); setSearch(null); setDraftSearch("");
  }, [section]);

  useEffect(() => { if (preview) previewHeading.current?.focus(); }, [preview]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const { signal } = controller;
    setListBusy(true);
    setListError("");
    setNext(null);
    async function load() {
      try {
        if (section === "overview") {
          const value = await ownerCall<Summary>(key, { action: "summary" }, signal);
          if (!signal.aborted) setSummary(value);
        } else if (section === "organizations") {
          const value = await ownerCall<{ organizations: Organization[]; next: string | null }>(key, { action: "organizations", after }, signal);
          if (!signal.aborted) { setOrganizations(value.organizations); setNext(value.next); }
        } else {
          const value = await ownerCall<{ accounts: Account[]; next: string | null }>(key, { action: "list", after, search }, signal);
          if (!signal.aborted) { setAccounts(value.accounts); setNext(value.next); }
        }
      } catch (error) {
        if (signal.aborted) return;
        if ((error as Error).message === "denied") { lock(); setStatus("denied"); }
        else { setAccounts(null); setOrganizations(null); setListError("unavailable"); }
      } finally { if (!signal.aborted) setListBusy(false); }
    }
    void load();
    return () => controller.abort();
  }, [key, section, after, search, revision]);

  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setStatus("");
    try { await task(); }
    catch (error) {
      const reason = (error as Error).message;
      if (reason === "denied") lock();
      setStatus(["admin-not-configured", "denied", "blocked", "changed", "wait", "missing"].includes(reason) ? reason : "unavailable");
    } finally { setBusy(false); }
  }

  function unlock(e: FormEvent) {
    e.preventDefault();
    if (!keyPattern.test(draftKey)) return;
    void run(async () => {
      const value = await ownerCall<Summary>(draftKey, { action: "summary" });
      setSummary(value);
      setKey(draftKey);
      setDraftKey("");
    });
  }

  async function review(id: string) {
    setPreview(null); setConfirm("");
    const result = await ownerCall<Preview>(key, { action: "preview", id });
    if (sectionRef.current === "users") setPreview(result);
  }

  async function remove(item: Preview) {
    if (!item.token || confirm !== item.email) return;
    const result = await ownerCall<{ state: string; id: string }>(key, { action: "delete", token: item.token, email: confirm });
    if (result.state !== "deleted" || result.id !== item.id) throw Error("unavailable");
    setAccounts(items => items?.filter(a => a.id !== result.id) ?? null);
    setPreview(null); setConfirm(""); setStatus("deleted");
    refresh(n => n + 1);
  }

  function goTo(after: string | null) {
    setPreview(null); setConfirm(""); setStatus("");
    setCursor(after ? { section, after } : null);
  }

  if (!key) return <RegistrationFrame title={tx("panel")} lead={tx("panelLead")} back="/">
    <form className="auth-form" onSubmit={unlock}>
      <label className="field-label">{tx("key")}
        <input type="password" autoComplete="off" spellCheck={false} value={draftKey} onChange={e => setDraftKey(e.target.value.trim())} disabled={busy} required maxLength={128} />
      </label>
      <button className="button button--primary" disabled={busy || !keyPattern.test(draftKey)}>{tx("enter")}</button>
    </form>
    {status && <p role="alert">{tx(status)}</p>}
  </RegistrationFrame>;

  const controlsDisabled = busy || listBusy;
  const showPaging = section !== "overview" && !listError && (after || next);
  return <div className="owner-panel">
    <aside className="owner-panel__sidebar">
      <Link to="/" className="owner-panel__brand">Timeax</Link>
      <p>{tx("panel")}</p>
      <nav aria-label={tx("panel")}>
        <Link to="/super-admin" aria-current={section === "overview" ? "page" : undefined}>{tx("overview")}</Link>
        <Link to="/super-admin?section=organizations" aria-current={section === "organizations" ? "page" : undefined}>{tx("organizations")}</Link>
        <Link to="/super-admin/accounts" aria-current={section === "users" ? "page" : undefined}>{tx("users")}</Link>
      </nav>
      <button type="button" className="button button--outline" disabled={busy} onClick={lock}>{tx("lock")}</button>
    </aside>
    <main className="owner-panel__content">
      <div className="owner-panel__leaf" key={section}>
        <header className="owner-panel__heading">
          <h1>{tx(section)}</h1>
          <button type="button" className="button button--outline" disabled={controlsDisabled} onClick={() => refresh(n => n + 1)}>{tx("refresh")}</button>
        </header>
        {listBusy && <p role="status">{tx("loading")}</p>}
        {listError && <p role="alert">{tx(listError)}</p>}
        {!listError && section === "overview" && summary && <>
          <dl className="owner-panel__stats">
            {summaryMetrics.map(k => <div key={k} className="owner-panel__card">
              <dt>{k==="agencies"||k==="factories"||k==="newAgencies30d"?<Link to="/super-admin?section=organizations">{tx("metric-"+k)}</Link>:<Link to="/super-admin/accounts">{tx("metric-"+k)}</Link>}</dt><dd>{number.format(summary[k])}</dd>
            </div>)}
          </dl>
          <p>{tx("statsScope")}</p>
        </>}
        {section === "organizations" && !listError && organizations && <section className="owner-panel__card" aria-label={tx("organizations")}>
          {!organizations.length && <p>{tx("emptyOrganizations")}</p>}
          <ul className="owner-panel__accounts">{organizations.map(o => <li key={o.id}>
            <div><strong>{o.name}</strong><p>{tx(o.kind)} · {strings["org-" + o.state] ?? o.state}</p></div>
            <p>{tx("activeMembers")}: {number.format(o.activeMembers)}</p>
          </li>)}</ul>
        </section>}
        {section === "users" && <>
          <form className="owner-panel__search" onSubmit={e => {
            e.preventDefault(); goTo(null); setSearch(draftSearch.trim() || null); refresh(n => n + 1);
          }}>
            <label className="field-label">{tx("searchLabel")}
              <input type="search" maxLength={254} value={draftSearch} onChange={e => setDraftSearch(e.target.value)} />
            </label>
            <button className="button button--outline" disabled={controlsDisabled}>{tx("search")}</button>
          </form>
          {!listError && accounts && <section className="owner-panel__card" aria-label={tx("users")}>
            <p>{tx("usersLead")}</p>
            {!accounts.length && <p>{tx("empty")}</p>}
            <ul className="owner-panel__accounts">{accounts.map(a => <li key={a.id}>
              <div>
                <strong>{a.email || a.id}</strong>
                <p>{tx(a.verified ? "verified" : "unverified")}{Number.isFinite(Date.parse(a.createdAt)) ? " · " + date.format(new Date(a.createdAt)) : ""}</p>
                {a.termsReceipt&&<p>{tx("termsAccepted")}: <Link to={"/terms/"+a.termsReceipt.version}>{a.termsReceipt.version}</Link> · {acceptanceDate.format(new Date(a.termsReceipt.acceptedAt))} · {tx("termsMethod")}</p>}
              </div>
              <button type="button" className="button button--outline" disabled={controlsDisabled} onClick={() => void run(() => review(a.id))}>{tx("review")}</button>
            </li>)}</ul>
          </section>}
        </>}
        {showPaging && <div className="owner-panel__pages">
          {after && <button type="button" className="button button--outline" disabled={controlsDisabled} onClick={() => goTo(null)}>{tx("first")}</button>}
          {next && <button type="button" className="button button--outline" disabled={controlsDisabled} onClick={() => goTo(next)}>{tx("next")}</button>}
        </div>}
        {section === "users" && preview && <section className="notice-box owner-panel__leaf" aria-labelledby="owner-preview-title">
          <h2 tabIndex={-1} ref={previewHeading} id="owner-preview-title">{tx("confirmTitle")}</h2>
          <p>{preview.email}</p><p>{tx(preview.scope)}</p>
          {preview.canDelete && preview.token && <form className="auth-form" onSubmit={e => { e.preventDefault(); void run(() => remove(preview)); }}>
            <label className="field-label">{tx("confirmEmail")}
              <input type="email" autoComplete="off" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </label>
            <button className="button button--primary" disabled={controlsDisabled || confirm !== preview.email}>{tx("delete")}</button>
          </form>}
          <button type="button" className="button button--outline" disabled={busy} onClick={() => { setPreview(null); setConfirm(""); }}>{t("common.close")}</button>
        </section>}
        {status && <p role={status === "deleted" ? "status" : "alert"}>{tx(status)}</p>}
      </div>
    </main>
  </div>;
}
