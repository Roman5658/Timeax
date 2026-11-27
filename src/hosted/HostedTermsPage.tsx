import {useTranslation} from "react-i18next";
import {PublicHeader,PublicFooter} from "../components/PublicExperience";

export function HostedTermsContent(){
 const {t}=useTranslation();
 return <>
  <p>{t("hostedLegal.version")}: <time dateTime="2026-11-27">2026-11-27</time></p>
  {["service","account","organization","help","closing"].map(key=><section key={key}>
   <h2>{t("hostedLegal."+key+"Title")}</h2><p>{t("hostedLegal."+key+"Body")}</p>
   {key==="help"&&<a href="mailto:no-reply@timeax.pl">no-reply@timeax.pl</a>}
  </section>)}
 </>;
}

export function HostedTermsPage(){
 const {t}=useTranslation();
 return <div className="public-experience"><PublicHeader/><main className="public-section public-policy">
  <h1>{t("hostedLegal.termsLink")}</h1><HostedTermsContent/>
 </main><PublicFooter/></div>;
}
