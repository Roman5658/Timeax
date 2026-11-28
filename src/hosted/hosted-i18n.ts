import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";

export const languageCodes=["pl","uk","ru","en"] as const;
export type LanguageCode=(typeof languageCodes)[number];
const dictionaries={
 pl:()=>import("../i18n/locales/pl.json"),
 uk:()=>import("../i18n/locales/uk.json"),
 ru:()=>import("../i18n/locales/ru.json"),
 en:()=>import("../i18n/locales/en.json"),
};
const normalize=(value?:string|null)=>languageCodes.find(code=>code===value?.toLowerCase().split("-")[0]);
let stored:string|null=null;
try{stored=localStorage.getItem("timeax-language")}catch{}
const initial=normalize(stored)??normalize(navigator.language)??normalize(navigator.languages?.[0])??"pl";
document.documentElement.lang=initial;
const backend:BackendModule={
 type:"backend",
 init(){},
 read(lang,namespace,done){
  const code=normalize(lang);
  if(!code||namespace!=="translation"){done(null,false);return}
  void dictionaries[code]().then(({default:messages})=>done(null,messages),()=>done(Error("Timeax translation unavailable"),false));
 },
};
export const hostedTranslationsReady=i18n.use(backend).use(initReactI18next).init({
 lng:initial, fallbackLng:"en", supportedLngs:[...languageCodes], load:"languageOnly",
 interpolation:{escapeValue:false}, returnNull:false,
});
i18n.on("languageChanged",language=>{
 const code=normalize(language)??"pl";
 try{localStorage.setItem("timeax-language",code)}catch{}
 document.documentElement.lang=code;
});
export default i18n;
