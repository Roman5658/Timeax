import { ArrowDownRight, ArrowRight, Building2, CalendarDays, Clock3, FileSpreadsheet, ShieldCheck, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PrototypeNotice } from "../../../components/PrototypeNotice";
import { TopBar } from "../../../components/TopBar";

function WorkspacePreview() {
  const { t } = useTranslation();
  return (
    <div className="preview-scene" aria-label={t("home.previewTitle")}>
      <div className="preview-orbit preview-orbit--one" />
      <div className="preview-orbit preview-orbit--two" />
      <div className="workspace-card">
        <div className="workspace-card-top">
          <div>
            <span className="workspace-overline">{t("home.previewLabel")}</span>
            <h2>{t("home.previewTitle")}</h2>
          </div>
          <span className="workspace-mark"><CalendarDays size={19} /></span>
        </div>
        <p className="workspace-subtitle">{t("home.previewSub")}</p>
        <div className="workspace-stats">
          <div className="workspace-stat workspace-stat--lime"><Clock3 size={16} /><span>{t("home.cardHours")}</span><strong>—</strong></div>
          <div className="workspace-stat workspace-stat--blue"><ShieldCheck size={16} /><span>{t("home.cardApprovals")}</span><strong>—</strong></div>
          <div className="workspace-stat workspace-stat--peach"><Building2 size={16} /><span>{t("home.cardTeams")}</span><strong>—</strong></div>
        </div>
        <div className="workspace-week">
          <div className="workspace-week-heading"><span>{t("home.weekLabel")}</span><span className="week-dots">•••</span></div>
          <div className="week-grid" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <span className={`week-cell${index === 3 ? " week-cell--active" : ""}`} key={index} />)}
          </div>
          <p>{t("home.weekEmpty")}</p>
        </div>
        <div className="workspace-footer"><span className="avatar-stack"><i /><i /><i /></span><span>{t("dashboard.scopeNote")}</span></div>
      </div>
      <div className="floating-chip floating-chip--top"><span className="chip-pulse" />{t("common.planned")}</div>
      <div className="floating-chip floating-chip--bottom"><FileSpreadsheet size={15} /> Excel</div>
      <div className="preview-spark preview-spark--a"><ArrowDownRight size={27} /></div>
    </div>
  );
}

export function StartPage() {
  const { t } = useTranslation();
  return (
    <div className="landing-page">
      <TopBar landing />
      <main>
        <section className="hero-shell" id="how-it-works">
          <div className="hero-copy">
            <PrototypeNotice />
            <div className="eyebrow hero-eyebrow"><span className="eyebrow-line" />{t("home.eyebrow")}</div>
            <h1>{t("home.title")}</h1>
            <p className="hero-lead">{t("home.lead")}</p>
            <div className="hero-actions">
              <Link className="button button--primary" to="/login">{t("home.startLogin")} <ArrowRight size={17} /></Link>
              <Link className="button button--outline" to="/register">{t("home.startRegister")}</Link>
            </div>
            <div className="hero-note"><span className="note-check"><ShieldCheck size={15} /></span>{t("home.quietNote")}</div>
          </div>
          <WorkspacePreview />
          <span className="hero-index" aria-hidden="true">01 / 03</span>
        </section>

        <section className="feature-section" id="features">
          <div className="section-intro">
            <div className="eyebrow"><span className="eyebrow-line" />{t("home.featureEyebrow")}</div>
            <h2>{t("home.featureTitle")}</h2>
            <p>{t("home.featureLead")}</p>
          </div>
          <div className="feature-grid">
            <article className="feature-card feature-card--dark">
              <span className="feature-icon"><Clock3 size={20} /></span>
              <span className="feature-number">01</span>
              <h3>{t("home.featureTimeTitle")}</h3>
              <p>{t("home.featureTimeBody")}</p>
              <div className="feature-decoration feature-decoration--clock"><span /></div>
            </article>
            <article className="feature-card feature-card--lime">
              <span className="feature-icon"><UsersRound size={20} /></span>
              <span className="feature-number">02</span>
              <h3>{t("home.featureOrgTitle")}</h3>
              <p>{t("home.featureOrgBody")}</p>
              <div className="feature-decoration feature-decoration--nodes"><i /><i /><i /></div>
            </article>
            <article className="feature-card feature-card--soft">
              <span className="feature-icon"><FileSpreadsheet size={20} /></span>
              <span className="feature-number">03</span>
              <h3>{t("home.featureExportTitle")}</h3>
              <p>{t("home.featureExportBody")}</p>
              <div className="feature-decoration feature-decoration--sheet"><i /><i /><i /><i /></div>
            </article>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="footer-inner"><span>© Timeax</span><span>{t("home.footerLine")}</span><Link to="/support">{t("common.emergency")}</Link></div>
      </footer>
    </div>
  );
}
