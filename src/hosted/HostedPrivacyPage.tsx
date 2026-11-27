import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PublicFooter, PublicHeader } from "../components/PublicExperience";

export function HostedPrivacyPage() {
  const { t } = useTranslation();
  const {hash}=useLocation();
  useEffect(()=>{if(hash==="#privacy-access")document.getElementById("privacy-access")?.scrollIntoView()},[hash]);
  const text = (key: string) => t("hostedPrivacy." + key);
  return <div className="public-experience">
    <PublicHeader />
    <main className="public-section public-policy">
      <h1 id="privacy-access">{text("title")}</h1>
      <p>{text("accessBody")}</p>
      {["responsibility", "data", "recipients", "records", "factory", "storage", "requests"].map(key => <section key={key} id={"privacy-" + key}>
        <h2>{text(key + "Title")}</h2><p>{text(key + "Body")}</p>
        {key==="requests" && <a href="mailto:no-reply@timeax.pl">no-reply@timeax.pl</a>}
      </section>)}
    </main>
    <PublicFooter />
  </div>;
}
