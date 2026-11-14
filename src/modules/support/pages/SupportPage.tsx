import { AlertTriangle, ArrowLeft, LifeBuoy, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PageHeading } from "../../../components/PageHeading";
import { PrototypeNotice } from "../../../components/PrototypeNotice";
import { TopBar } from "../../../components/TopBar";

export function SupportPage() {
  const { t } = useTranslation();
  return (
    <div className="public-page">
      <TopBar />
      <main className="content-page content-page--narrow">
        <Link className="back-link" to="/"><ArrowLeft size={15} />{t("common.backHome")}</Link>
        <PrototypeNotice />
        <PageHeading eyebrow={t("common.support")} title={t("support.title")} description={t("support.lead")} />
        <div className="support-grid">
          <article className="support-card support-card--emergency">
            <div className="support-card-icon"><AlertTriangle size={20} /></div>
            <span className="eyebrow">{t("support.emergencyTitle")}</span>
            <p>{t("support.emergencyBody")}</p>
            <div className="contact-placeholder"><span className="contact-status" />{t("home.contactPending")}</div>
          </article>
          <article className="support-card">
            <div className="support-card-icon support-card-icon--mint"><LifeBuoy size={20} /></div>
            <span className="eyebrow">{t("support.ticketTitle")}</span>
            <p>{t("support.ticketBody")}</p>
            <form className="support-form" onSubmit={(event) => event.preventDefault()}>
              <label className="field-label"><span>{t("support.subject")}</span><input disabled /></label>
              <label className="field-label"><span>{t("support.message")}</span><textarea rows={4} disabled /></label>
              <button className="button button--primary" type="submit" disabled><Send size={15} />{t("support.send")}</button>
            </form>
            <small>{t("support.privacy")}</small>
          </article>
        </div>
      </main>
    </div>
  );
}
