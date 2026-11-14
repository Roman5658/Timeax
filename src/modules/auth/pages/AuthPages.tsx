import { ArrowLeft, ArrowRight, Building2, HardHat, Mail, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PrototypeNotice } from "../../../components/PrototypeNotice";
import { TopBar } from "../../../components/TopBar";
import { getWorkerInvitationByCode, registerDemoAgency, registerFactoryFromInvitation, registerFactoryWorkspace, registerLeaderFromInvitation, registerWorkerJoinRequest, requestLeaderWorksiteConnection, searchRegisteredCentralsByIdentifier, searchRegisteredCentralsByNip, setActiveMember, useDemoWorkspace } from "../../workflows/demo-store";

function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="auth-page"><TopBar /><main className="auth-main"><PrototypeNotice />{children}</main></div>;
}

function DisabledField({ label, type = "text", placeholder = "" }: { label: string; type?: string; placeholder?: string }) {
  return <label className="field-label"><span>{label}</span><input type={type} placeholder={placeholder} disabled aria-disabled="true" /></label>;
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspace = useDemoWorkspace();
  const agencyAccounts = workspace.members.filter((member) => member.role === "agency");
  const factoryAccounts = workspace.members.filter((member) => member.role === "factory-admin");
  const leaderAccounts = workspace.members.filter((member, index, members) => member.role === "leader"
    && members.findIndex((candidate) => candidate.role === "leader" && (candidate.accountUid ?? candidate.id) === (member.accountUid ?? member.id)) === index);
  return (
    <AuthFrame>
      <section className="auth-card">
        <div className="auth-card-icon"><ShieldCheck size={22} /></div>
        <div className="eyebrow">{t("common.account")}</div>
        <h1>{t("auth.loginTitle")}</h1>
        <p className="auth-lead">{t("auth.loginLead")}</p>
        <div className="notice-box notice-box--warm">{t("auth.authNotice")}</div>
        <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
          <DisabledField label={t("auth.email")} type="email" />
          <DisabledField label={t("auth.password")} type="password" />
          <button className="button button--primary button--full" type="submit" disabled>{t("auth.loginAction")} <ArrowRight size={16} /></button>
        </form>
        <div className="demo-agency-access-list">{agencyAccounts.map((agencyAccount) => {
          const organizationName = workspace.organizations.find((organization) => organization.id === agencyAccount.organizationId)?.name ?? agencyAccount.organizationId;
          return <button className="button button--outline button--full" type="button" key={agencyAccount.id} onClick={() => {
            setActiveMember(agencyAccount.id);
            navigate("/agency");
          }}>{t("auth.demoAgencyAccessFor", { organization: organizationName })}</button>;
        })}</div>
        {factoryAccounts.length > 0 && <div className="demo-agency-access-list">{factoryAccounts.map((factoryAccount) => {
          const companyName = workspace.organizations.find((organization) => organization.id === factoryAccount.organizationId)?.name ?? factoryAccount.organizationId;
          return <button className="button button--outline button--full" type="button" key={factoryAccount.id} onClick={() => {
            setActiveMember(factoryAccount.id);
            navigate("/factory");
          }}>{t("auth.demoFactoryAccessFor", { organization: companyName })}</button>;
        })}</div>}
        {leaderAccounts.length > 0 && <div className="demo-agency-access-list">{leaderAccounts.map((leaderAccount) => {
          const organizationName = workspace.organizations.find((organization) => organization.id === leaderAccount.organizationId)?.name ?? leaderAccount.organizationId;
          return <button className="button button--outline button--full" type="button" key={leaderAccount.accountUid ?? leaderAccount.id} onClick={() => {
            setActiveMember(leaderAccount.id);
            navigate("/leader");
          }}>{t("auth.demoLeaderAccessFor", { name: leaderAccount.name, organization: organizationName })}</button>;
        })}</div>}
        <div className="auth-links"><Link to="/forgot-password">{t("auth.forgot")}</Link><span>{t("auth.noAccount")} <Link to="/register">{t("auth.registerAction")}</Link></span></div>
      </section>
      <p className="auth-footnote">{t("auth.formDisabled")}</p>
    </AuthFrame>
  );
}

const registrationOptions = [
  { path: "/register/worker", key: "worker", description: "workerDescription", icon: HardHat, tone: "mint" },
  { path: "/register/agency", key: "agency", description: "agencyDescription", icon: Building2, tone: "violet" },
  { path: "/factory/register", key: "factory", description: "factoryDescription", icon: Building2, tone: "peach" },
  { path: "/leader/register", key: "leaderRegistrationOption", description: "leaderRegistrationOptionDescription", icon: ShieldCheck, tone: "violet" },
] as const;

export function RegistrationChoicePage() {
  const { t } = useTranslation();
  return (
    <AuthFrame>
      <section className="auth-card auth-card--wide">
        <div className="eyebrow">{t("common.account")}</div>
        <h1>{t("auth.registerTitle")}</h1>
        <p className="auth-lead">{t("auth.registerLead")}</p>
        <div className="registration-options">
          {registrationOptions.map(({ path, key, description, icon: Icon, tone }) => (
            <Link to={path} className="registration-option" key={key}>
              <span className={`registration-icon registration-icon--${tone}`}><Icon size={20} /></span>
              <span className="registration-copy"><strong>{t(`auth.${key}`)}</strong><small>{t(`auth.${description}`)}</small></span>
              <ArrowRight size={17} className="registration-arrow" />
            </Link>
          ))}
        </div>
        <div className="auth-links auth-links--bottom"><span>{t("auth.alreadyHave")}</span><Link to="/login">{t("common.login")}</Link></div>
      </section>
      <p className="auth-footnote">{t("auth.formDisabled")}</p>
    </AuthFrame>
  );
}

export function RegistrationPage() {
  const { role } = useParams<{ role: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspace = useDemoWorkspace();
  const safeRole = role === "agency" ? role : "worker";
  const titleKey = `registrationTitle${safeRole[0].toUpperCase()}${safeRole.slice(1)}`;
  const leadKey = `registrationLead${safeRole[0].toUpperCase()}${safeRole.slice(1)}`;
  const [organizationName, setOrganizationName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [workerPhone, setWorkerPhone] = useState("");
  const [inviteCode, setInviteCode] = useState(searchParams.get("invitation") ?? "");
  const [message, setMessage] = useState("");
  const workerInvitation = getWorkerInvitationByCode(inviteCode, workspace);
  const validWorkerInvitation = workerInvitation?.state === "pending" && Date.parse(workerInvitation.expiresAt) > Date.now();

  function registerAgency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const member = registerDemoAgency({ organizationName, adminName, email });
    if (!member) { setMessage(t("auth.registrationFailed")); return; }
    navigate("/agency", { replace: true });
  }

  function registerWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = registerWorkerJoinRequest(inviteCode, { name: workerName, email, phone: workerPhone });
    setMessage(t(submitted ? "auth.workerJoinRequested" : "auth.invalidWorkerInvitation"));
  }

  return (
    <AuthFrame>
      <section className="auth-card">
        <Link className="back-link" to="/register"><ArrowLeft size={15} />{t("common.back")}</Link>
        <div className="eyebrow">{t(`auth.${safeRole}`)}</div>
        <h1>{t(`auth.${titleKey}`)}</h1>
        <p className="auth-lead">{t(`auth.${leadKey}`)}</p>
        {safeRole === "agency" ? <>
          <div className="notice-box notice-box--warm">{t("auth.demoRegistrationNotice")}</div>
          <form className="auth-form" onSubmit={registerAgency}>
            <label className="field-label"><span>{t("auth.organizationName")}</span><input autoComplete="organization" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required /></label>
            <label className="field-label"><span>{t("auth.name")}</span><input autoComplete="name" value={adminName} onChange={(event) => setAdminName(event.target.value)} required /></label>
            <label className="field-label"><span>{t("auth.email")}</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <button className="button button--primary button--full" type="submit">{t("auth.createAgencyWorkspace")} <ArrowRight size={16} /></button>
          </form>
          {message && <p className="notice-box notice-box--warm" role="alert">{message}</p>}
        </> : safeRole === "worker" ? <>
          <div className="notice-box notice-box--warm">{t("auth.demoRegistrationNotice")}</div>
          {validWorkerInvitation && <p className="auth-lead">{t("auth.workerInvitationFrom", { agency: workspace.organizations.find((item) => item.id === workerInvitation.organizationId)?.name ?? workerInvitation.organizationId })}</p>}
          {inviteCode.trim() && !validWorkerInvitation && <p className="notice-box notice-box--warm" role="alert">{t("auth.invalidWorkerInvitation")}</p>}
          <form className="auth-form" onSubmit={registerWorker}>
            <label className="field-label"><span>{t("auth.inviteCode")}</span><input autoComplete="off" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} required /></label>
            <label className="field-label"><span>{t("auth.name")}</span><input autoComplete="name" value={workerName} onChange={(event) => setWorkerName(event.target.value)} required /></label>
            <label className="field-label"><span>{t("auth.email")}</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label className="field-label"><span>{t("auth.phone")}</span><input type="tel" autoComplete="tel" value={workerPhone} onChange={(event) => setWorkerPhone(event.target.value)} /></label>
            <button className="button button--primary button--full" type="submit" disabled={!validWorkerInvitation}>{t("auth.submitWorkerRegistration")} <ArrowRight size={16} /></button>
          </form>
          {message && <p className="notice-box notice-box--warm" role="status">{message}</p>}
        </> : <>
          <div className="notice-box notice-box--warm">{t("auth.authNotice")}</div>
          <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
            <DisabledField label={t("auth.inviteCode")} />
            <DisabledField label={t("auth.name")} />
            <DisabledField label={t("auth.email")} type="email" />
            <DisabledField label={t("auth.password")} type="password" />
            <button className="button button--primary button--full" type="submit" disabled>{t("auth.createAccount")} <ArrowRight size={16} /></button>
          </form>
        </>}
      </section>
      <p className="auth-footnote">{t(safeRole === "agency" ? "auth.demoRegistrationNotice" : "auth.formDisabled")}</p>
    </AuthFrame>
  );
}

export function FactoryRegistrationPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workspace = useDemoWorkspace();
  const token = searchParams.get("invitation") ?? "";
  const invitation = workspace.factoryInvitations?.find((item) => item.token === token && item.state === "pending" && Date.parse(item.expiresAt) > Date.now());
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitation?.email ?? "");
  const [message, setMessage] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [nip, setNip] = useState("");
  const [city, setCity] = useState("");
  const [worksiteName, setWorksiteName] = useState("");
  const [address, setAddress] = useState("");

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const member = registerFactoryFromInvitation(token, { name, email });
    if (!member) {
      setMessage(t("factoryRegistration.invalidInvitation"));
      return;
    }
    navigate("/factory", { replace: true });
  }

  function registerIndependently(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = registerFactoryWorkspace({ companyName, nip, city, adminName: name, email, worksiteName, address });
    if (result.kind === "created") {
      navigate("/factory", { replace: true });
      return;
    }
    setMessage(result.kind === "existing" ? t("factoryRegistration.existingCompany", { company: result.businessEntity.name })
      : result.reason === "invalid-nip" ? t("factoryRegistration.invalidNip")
        : result.reason === "invalid-email" ? t("factoryRegistration.invalidEmail")
          : t("factoryRegistration.requiredFields"));
  }

  return (
    <AuthFrame>
      <section className="auth-card">
        <div className="auth-card-icon"><Building2 size={22} /></div>
        <div className="eyebrow">{t(token ? "factoryRegistration.eyebrow" : "factoryRegistration.selfEyebrow")}</div>
        <h1>{t(token ? "factoryRegistration.title" : "factoryRegistration.selfTitle")}</h1>
        {invitation ? <>
          <p className="auth-lead">{t("factoryRegistration.invitedBy", { agency: workspace.organizations.find((item) => item.id === invitation.organizationId)?.name ?? invitation.organizationId })}</p>
          <div className="notice-box">{invitation.companyName} · {invitation.worksiteName} · {invitation.worksiteAddress} · {invitation.productionName}</div>
          <form className="auth-form" onSubmit={register}>
            <label className="field-label"><span>{t("auth.name")}</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label className="field-label"><span>{t("auth.email")}</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <button className="button button--primary button--full" type="submit">{t("factoryRegistration.createAdmin")}</button>
          </form>
          {message && <p className="notice-box notice-box--warm" role="alert">{message}</p>}
        </> : token ? <>
          <p className="auth-lead">{t("factoryRegistration.invalidInvitation")}</p>
          <Link className="button button--outline button--full" to="/login">{t("common.login")}</Link>
        </> : <>
          <p className="auth-lead">{t("factoryRegistration.selfLead")}</p>
          <div className="notice-box notice-box--warm">{t("factoryRegistration.demoNotice")}</div>
          <form className="auth-form" onSubmit={registerIndependently}>
            <label className="field-label"><span>{t("auth.organizationName")}</span><input autoComplete="organization" value={companyName} onChange={(event) => setCompanyName(event.target.value)} required /></label>
            <label className="field-label"><span>{t("factoryRegistration.nip")}</span><input inputMode="numeric" autoComplete="off" value={nip} onChange={(event) => setNip(event.target.value)} required /></label>
            <label className="field-label"><span>{t("factoryRegistration.city")}</span><input autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} required /></label>
            <label className="field-label"><span>{t("auth.name")}</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></label>
            <label className="field-label"><span>{t("auth.email")}</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label className="field-label"><span>{t("factoryRegistration.worksiteName")}</span><input value={worksiteName} onChange={(event) => setWorksiteName(event.target.value)} required /></label>
            <label className="field-label"><span>{t("factoryRegistration.address")}</span><input autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} required /></label>
            <button className="button button--primary button--full" type="submit">{t("factoryRegistration.createWorkspace")}</button>
          </form>
          {message && <p className="notice-box notice-box--warm" role="alert">{message}</p>}
          <div className="auth-links auth-links--bottom"><span>{t("factoryRegistration.alreadyRegistered")}</span><Link to="/login">{t("common.login")}</Link></div>
        </>}
      </section>
      <p className="auth-footnote">{t("factoryRegistration.demoNotice")}</p>
    </AuthFrame>
  );
}

export function LeaderRegistrationPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workspace = useDemoWorkspace();
  const token = searchParams.get("invitation") ?? "";
  const invitation = workspace.leaderInvitations?.find((item) => item.token === token && item.state === "pending" && Date.parse(item.expiresAt) > Date.now());
  const [name, setName] = useState(invitation?.name ?? "");
  const [email, setEmail] = useState(invitation?.email ?? "");
  const [message, setMessage] = useState("");
  const [searchKind, setSearchKind] = useState<"nip" | "identifier">("nip");
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<ReturnType<typeof searchRegisteredCentralsByNip>>([]);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [selectedWorksiteId, setSelectedWorksiteId] = useState("");
  const selectedEntity = searchResults.find((item) => item.businessEntityId === selectedEntityId);
  const pendingLeaderRequests = (workspace.leaderConnectionRequests ?? []).filter((item) => item.email.trim().toLocaleLowerCase("en-US") === email.trim().toLocaleLowerCase("en-US"));

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const member = registerLeaderFromInvitation(token, { name, email });
    if (!member) {
      setMessage(t("leaderRegistration.invalidInvitation"));
      return;
    }
    navigate("/leader", { replace: true });
  }

  function searchCentrals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelectedEntityId("");
    setSelectedWorksiteId("");
    setMessage("");
    setSearchResults(searchKind === "nip" ? searchRegisteredCentralsByNip(searchValue) : searchRegisteredCentralsByIdentifier(searchValue));
  }

  function sendConnectionRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntity || !selectedWorksiteId) return;
    const request = requestLeaderWorksiteConnection({ businessEntityId: selectedEntity.businessEntityId, worksiteId: selectedWorksiteId, name, email });
    setMessage(t(request ? "leaderRegistration.requestPending" : "leaderRegistration.requestCouldNotCreate"));
  }

  return <AuthFrame>
    <section className="auth-card">
      <div className="auth-card-icon"><ShieldCheck size={22} /></div>
      <div className="eyebrow">{t(invitation ? "leaderRegistration.eyebrow" : "leaderRegistration.selfEyebrow")}</div>
      <h1>{t(invitation ? "leaderRegistration.title" : "leaderRegistration.selfTitle")}</h1>
      {invitation ? <>
        <p className="auth-lead">{t("leaderRegistration.invitedTo", { company: workspace.businessEntities?.find((item) => item.id === invitation.businessEntityId)?.name ?? "Timeax" })}</p>
        <form className="auth-form" onSubmit={register}>
          <label className="field-label"><span>{t("auth.name")}</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label className="field-label"><span>{t("auth.email")}</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <button className="button button--primary button--full" type="submit">{t("leaderRegistration.accept")}</button>
        </form>
        {message && <p className="notice-box notice-box--warm" role="alert">{message}</p>}
      </> : token ? <>
        <p className="auth-lead">{t("leaderRegistration.invalidInvitation")}</p>
        <Link className="button button--outline button--full" to="/login">{t("common.login")}</Link>
      </> : <>
        <p className="auth-lead">{t("leaderRegistration.selfLead")}</p>
        <div className="notice-box notice-box--warm">{t("leaderRegistration.demoNotice")}</div>
        <form className="auth-form" onSubmit={searchCentrals}>
          <label className="field-label"><span>{t("leaderRegistration.searchBy")}</span><select value={searchKind} onChange={(event) => { setSearchKind(event.target.value as typeof searchKind); setSearchResults([]); setSelectedEntityId(""); }}><option value="nip">{t("workflow.factoryAccess.nip")}</option><option value="identifier">{t("workflow.factoryAccess.centralIdentifier")}</option></select></label>
          <label className="field-label"><span>{t(searchKind === "nip" ? "workflow.factoryAccess.nip" : "workflow.factoryAccess.centralIdentifier")}</span><input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} required /></label>
          <button className="button button--outline button--full" type="submit">{t("leaderRegistration.search")}</button>
        </form>
        {searchResults.length > 0 && <div className="agency-access-list"><h3>{t("leaderRegistration.searchResults")}</h3>{searchResults.map((result) => <article className="employment-history-row" key={result.businessEntityId}>
          <strong>{result.name} · {result.city ?? "—"}</strong>
          <span>{t("workflow.factoryAccess.nip")}: {result.nip ?? "—"} · {t("workflow.factoryAccess.centralIdentifier")}: {result.identifier ?? "—"}</span>
          <div className="agency-access-list">{result.worksites.map((worksite) => <small key={worksite.id}>{worksite.name} · {worksite.address ?? "—"} · {worksite.identifier ?? "—"}</small>)}</div>
          <button className="button button--outline button--small" type="button" onClick={() => { setSelectedEntityId(result.businessEntityId); setSelectedWorksiteId(result.matchedWorksiteId ?? ""); setMessage(""); }}>{t("workflow.factoryAccess.selectCentral")}</button>
        </article>)}</div>}
        {selectedEntity && <form className="auth-form" onSubmit={sendConnectionRequest}>
          <div className="notice-box">{selectedEntity.name} · {selectedEntity.city ?? "—"} · {selectedEntity.identifier ?? "—"}</div>
          <label className="field-label"><span>{t("workflow.factoryAccess.selectWorksite")}</span><select value={selectedWorksiteId} onChange={(event) => setSelectedWorksiteId(event.target.value)} required><option value="">{t("workflow.factoryAccess.chooseWorksite")}</option>{selectedEntity.worksites.map((worksite) => <option key={worksite.id} value={worksite.id}>{worksite.name} · {worksite.address ?? "—"} · {worksite.identifier ?? "—"}</option>)}</select></label>
          <label className="field-label"><span>{t("auth.name")}</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label className="field-label"><span>{t("auth.email")}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <button className="button button--primary button--full" type="submit">{t("leaderRegistration.sendRequest")}</button>
        </form>}
        {message && <p className="notice-box notice-box--warm" role="status">{message}</p>}
        {pendingLeaderRequests.length > 0 && <div className="agency-access-list"><h3>{t("leaderRegistration.requestHistory")}</h3>{pendingLeaderRequests.map((request) => <article className="employment-history-row" key={request.id}><strong>{workspace.businessEntities?.find((item) => item.id === request.businessEntityId)?.name ?? request.businessEntityId}</strong><span>{workspace.worksites?.find((item) => item.id === request.worksiteId)?.name ?? request.worksiteId}</span><small>{t(`leaderRegistration.requestState.${request.state}`)}</small></article>)}</div>}
      </>}
    </section>
    <p className="auth-footnote">{t("leaderRegistration.demoNotice")}</p>
  </AuthFrame>;
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  return (
    <AuthFrame>
      <section className="auth-card">
        <Link className="back-link" to="/login"><ArrowLeft size={15} />{t("common.back")}</Link>
        <div className="auth-card-icon"><Mail size={21} /></div>
        <div className="eyebrow">{t("common.account")}</div>
        <h1>{t("auth.forgotTitle")}</h1>
        <p className="auth-lead">{t("auth.forgotLead")}</p>
        <div className="notice-box notice-box--warm">{t("common.notConnected")}</div>
        <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
          <DisabledField label={t("auth.email")} type="email" />
          <button className="button button--primary button--full" type="submit" disabled>{t("auth.sendReset")}</button>
        </form>
      </section>
    </AuthFrame>
  );
}
