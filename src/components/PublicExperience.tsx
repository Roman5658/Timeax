import { ArrowLeft, ArrowRight, Building2, Factory, LockKeyhole, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BrandMark } from "./BrandMark";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import "../styles/public-experience.css";

export function PublicHeader({ landing = false }: { landing?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); setOpen(false); }, [pathname]);
  return <header className="public-header"><div className="public-header-inner">
    <BrandMark />
    <nav className="public-desktop-nav" aria-label={t("nav.product")}>
      {landing ? <><a href="#features">{t("nav.product")}</a><a href="#how-it-works">{t("nav.howItWorks")}</a></> : <Link to="/">{t("common.backHome")}</Link>}
    </nav>
    <div className="public-controls"><LanguageSwitcher compact /><ThemeToggle />
      <Link className="button button--outline public-login" to="/login">{t("common.login")}</Link>
      <button className="icon-button public-menu-button" aria-label={t(open ? "common.closeMenu" : "common.menu")} aria-expanded={open} aria-controls="public-menu" onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
    </div>
  </div>{open && <nav id="public-menu" className="public-mobile-nav" aria-label={t("nav.product")}>
    <Link to="/" onClick={() => setOpen(false)}>{t("common.backHome")}</Link>
    <Link to="/register" onClick={() => setOpen(false)}>{t("publicExperience.create")}</Link>
    <Link to="/login" onClick={() => setOpen(false)}>{t("common.login")}</Link>
  </nav>}</header>;
}

export function PublicFooter() {
  const { t } = useTranslation();
  return <footer className="public-footer"><span>© Timeax</span><span>{t("home.footerLine")}</span><Link to="/privacy">{t("hostedPrivacy.link")}</Link><Link to="/login">{t("common.login")}</Link></footer>;
}
export const AuthPanelContext = createContext(false);
export function RegistrationFrame({ children, title, lead, back = "/register" }: { children: ReactNode; title: string; lead: string; back?: string }) {
  const { t } = useTranslation();
  const inPanel=useContext(AuthPanelContext);
  if(inPanel)return <section className="enrollment-card auth-book-content">
    {back!=="/"&&<Link className="back-link" to={back}><ArrowLeft size={16}/>{t("common.back")}</Link>}
    <h1 id="auth-book-title">{title}</h1>{lead&&<p className="enrollment-lead">{lead}</p>}{children}
  </section>;
  return <div className="public-experience"><PublicHeader /><main className="enrollment-layout">
    <aside className="enrollment-intro"><span className="public-kicker">TIMEAX</span><h2>{t("publicExperience.joinTitle")}</h2><p>{t("publicExperience.joinLead")}</p>
      <div className="enrollment-trust"><ShieldCheck size={24} /><p>{t("publicExperience.access")}</p></div>
      <p className="enrollment-existing">{t("publicExperience.already")} <Link to="/login">{t("common.login")} <ArrowRight size={16} /></Link></p>
    </aside>
    <section className="enrollment-card"><Link className="back-link" to={back}><ArrowLeft size={16} />{t(back === "/" ? "common.backHome" : "common.back")}</Link>
      <h1>{title}</h1><p className="enrollment-lead">{lead}</p>{children}
    </section>
  </main><PublicFooter /></div>;
}
export function RegistrationProgress({ current = 0, twoSteps = false }: { current?: number; twoSteps?: boolean }) {
  const { t } = useTranslation();
  return <ol className="enrollment-progress" aria-label={t("publicExperience.steps")}>
    {(twoSteps ? ["emailStep", "detailsStep"] : ["emailStep", "detailsStep", "reviewStep"]).map((key, index) => <li key={key} aria-current={index === current ? "step" : undefined} className={index < current ? "complete" : ""}><span>{index + 1}</span>{t("publicExperience." + key)}</li>)}
  </ol>;
}
export function RegistrationChoices() {
  const { t } = useTranslation();
  return <RegistrationFrame title={t("agencyRegistration.startTitle")} lead={t("publicExperience.chooseLead")} back="/">
    <div className="registration-options">
      {[{role:"agency", icon:Building2}, {role:"factory", icon:Factory}, {role:"worker", icon:UserRound}].map(({role,icon:Icon}) =>
        <Link key={role} className="registration-option" to={"/register/" + role}><span className="registration-option-icon"><Icon size={23} /></span><span><strong>{t("publicExperience." + role)}</strong><small>{t("publicExperience." + role + "Hint")}</small></span><ArrowRight size={18} /></Link>)}
    </div><p className="enrollment-note"><LockKeyhole size={17} />{t("publicExperience.access")}</p>
  </RegistrationFrame>;
}
