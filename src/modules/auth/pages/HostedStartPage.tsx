import { ArrowRight, PlayCircle } from "lucide-react";
import { WorkspacePreview } from "./WorkspacePreview";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PublicHeader, PublicFooter } from "../../../components/PublicExperience";

export function StartPage() {
  const { t } = useTranslation(), tx = (key: string) => t("publicExperience." + key);
  return <div className="public-experience"><PublicHeader landing /><main>
    <section className="public-hero">
      <div className="public-hero-copy"><span className="public-kicker public-hero-brand">AgencyWorkers</span><h1>{tx("landingTitle")}</h1>
        <p className="public-hero-lead">{tx("landingLead")}</p>
        <div className="public-hero-actions"><Link className="button button--primary" to="/register">{tx("create")} <ArrowRight size={18} /></Link><Link className="button button--outline" to="/login">{t("common.login")}</Link></div>
      </div>
      <WorkspacePreview id="features" />
    </section>
    <section className="public-section public-how" id="how-it-works" aria-labelledby="timeax-how-title">
      <h2 id="timeax-how-title">{t("nav.howItWorks")}</h2>
    </section>
    <section className="public-section public-videos" id="video-guides" aria-labelledby="timeax-videos-title">
      <div className="public-video-placeholder">
        <span className="flow-icon"><PlayCircle size={22} aria-hidden="true" /></span>
        <h2 id="timeax-videos-title">{tx("videosTitle")}</h2>
      </div>
    </section>
  </main><PublicFooter /></div>;
}
