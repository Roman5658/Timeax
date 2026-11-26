import { ArrowRight, Building2, Clock3, FileSpreadsheet, ShieldCheck, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PublicHeader, PublicFooter } from "../../../components/PublicExperience";

export function StartPage({ closedHosted = false }: { closedHosted?: boolean }) {
  const { t } = useTranslation(), tx = (key: string) => t("publicExperience." + key);
  return <div className="public-experience"><PublicHeader landing /><main>
    <section className="public-hero">
      <div className="public-hero-copy"><span className="public-kicker">{t("home.eyebrow")}</span><h1>{t("home.title")}</h1>
        <p className="public-hero-lead">{tx("lead")}</p>
        <div className="public-hero-actions"><Link className="button button--primary" to="/register">{tx("create")} <ArrowRight size={18} /></Link><Link className="button button--outline" to="/login">{t("common.login")}</Link></div>
        <p className="public-access-note"><ShieldCheck size={18} />{tx("access")}</p>
      </div>
      <div className="public-flow" aria-label={tx("flowTitle")}><div className="public-flow-heading"><span>TIMEAX / WORKFLOW</span><ShieldCheck size={22} /></div><h2>{tx("flowTitle")}</h2>
        <ol>{[{icon:Clock3,key:"time"},{icon:FileSpreadsheet,key:"sheet"},{icon:UsersRound,key:"pay"}].map(({icon:Icon,key},i)=><li key={key}><span className="flow-icon"><Icon size={22} /></span><div><span className="flow-number">0{i+1}</span><h3>{tx(key+"Title")}</h3><p>{tx(key+"Body")}</p></div></li>)}</ol>
        <p className="public-flow-foot">{tx("flowNote")}</p>
      </div>
    </section>
    {closedHosted && <div className="public-availability" role="note"><ShieldCheck size={20} /><div><strong>{tx("closedTitle")}</strong><p>{tx("closedBody")}</p></div><Link to="/register">{tx("availability")} <ArrowRight size={16} /></Link></div>}
    <section className="public-section" id="features"><div className="public-section-heading"><span className="public-kicker">{tx("forTeams")}</span><h2>{tx("featuresTitle")}</h2></div>
      <div className="public-feature-grid">{[{icon:Building2,key:"agencyFeature"},{icon:UsersRound,key:"factoryFeature"},{icon:ShieldCheck,key:"workerFeature"}].map(({icon:Icon,key})=><article key={key}><Icon size={25} /><h3>{tx(key+"Title")}</h3><p>{tx(key+"Body")}</p></article>)}</div>
    </section>
    <section className="public-section public-start" id="how-it-works"><div><span className="public-kicker">{tx("startEyebrow")}</span><h2>{tx("startTitle")}</h2><p>{tx("startBody")}</p></div><Link className="button button--primary" to="/register">{tx("create")} <ArrowRight size={18} /></Link></section>
  </main><PublicFooter /></div>;
}
