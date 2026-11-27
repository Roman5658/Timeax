import {useTranslation} from "react-i18next";
import {PublicHeader,PublicFooter} from "../components/PublicExperience";
import snapshot from "../shared/legal/hosted-terms-2026-11-27.json";

export const HOSTED_TERMS_VERSION=snapshot.document.version;
export const HOSTED_TERMS_SHA256=snapshot.sha256;
const language=(input?:string)=>{
 const base=input?.toLowerCase().split('-')[0];
 return base==='pl'||base==='uk'||base==='ru'||base==='en'?base:'en';
};

export function HostedTermsContent(){
 const {t,i18n}=useTranslation();
 const document=snapshot.document;
 const localized=document.locales[language(i18n.resolvedLanguage)];
 return <>
  <p>{t("hostedLegal.version")}: <time dateTime={document.version}>{document.version}</time></p>
  {localized.sections.map(section=><section key={section.id}>
   <h2>{section.title}</h2><p>{section.body}</p>
   {section.id==="help"&&<a href={'mailto:'+document.contact}>{document.contact}</a>}
  </section>)}
 </>;
}

export function HostedTermsPage(){
 const {i18n}=useTranslation();
 return <div className="public-experience"><PublicHeader/><main className="public-section public-policy">
  <h1>{snapshot.document.locales[language(i18n.resolvedLanguage)].title}</h1><HostedTermsContent/>
 </main><PublicFooter/></div>;
}
