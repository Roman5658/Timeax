import {useTranslation} from "react-i18next";
import brandLogo from "../components/timeax-brand.webp";

export function HostedLoading({compact=false}:{compact?:boolean}){
 const {i18n}=useTranslation();
 const lang=(i18n.resolvedLanguage??i18n.language??"pl").split("-")[0];
 const label=lang==="ru"?"Загрузка…":lang==="uk"?"Завантаження…":lang==="en"?"Loading…":"Wczytywanie…";
 if(compact)return <p role="status">{label}</p>;
 return <main className="auth-page"><div className="auth-main">
  <section className="auth-card" aria-label="Timeax" aria-busy="true">
   <img className="brand-mark-image" src={brandLogo} alt="Timeax"/>
   <p role="status">{label}</p>
  </section>
 </div></main>;
}
