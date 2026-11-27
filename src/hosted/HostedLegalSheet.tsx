import {useLayoutEffect,useEffect,useRef,useState} from "react";
import {X} from "lucide-react";
import {useTranslation} from "react-i18next";
import type {LegalDocument} from "../components/PublicExperience";
import {HostedPrivacyContent} from "./HostedPrivacyPage";
import {HostedTermsContent} from "./HostedTermsPage";

export function HostedLegalSheet({kind,opener,onClosed,centered=false}:{kind:LegalDocument;opener:HTMLAnchorElement;onClosed:()=>void;centered?:boolean}){
 const {t}=useTranslation(),dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const [closing,setClosing]=useState(false);
 useLayoutEffect(()=>{
  const node=dialog.current;
  if(!node)return;
  const overflow=document.body.style.overflow;
  node.showModal();
  if(centered)document.body.style.overflow="hidden";
  heading.current?.focus({preventScroll:true});
  return()=>{node.close();if(centered)document.body.style.overflow=overflow;if(opener.isConnected)opener.focus({preventScroll:true});};
 },[opener,centered]);
 function close(){
  if(closing)return;
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){onClosed();return;}
  setClosing(true);
 }
 useEffect(()=>{
  if(!closing)return;
  const timeout=window.setTimeout(onClosed,460);
  return()=>window.clearTimeout(timeout);
 },[closing,onClosed]);
 return <dialog ref={dialog} className={`auth-book enrollment-card auth-legal-sheet${centered?" auth-book--centered auth-legal-sheet--centered":""}${closing?" is-closing":""}`}
  aria-labelledby="legal-sheet-title"
  onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close()}}}
  onCancel={event=>{event.preventDefault();event.stopPropagation();close()}}
  onAnimationEnd={event=>{if(closing&&event.target===event.currentTarget&&event.animationName==="auth-page-unturn")onClosed()}}
  onClick={event=>{if(event.target===event.currentTarget){const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close()}}}>
  <button type="button" className="icon-button auth-book-close" aria-label={t("common.close")} aria-disabled={closing} onClick={close}><X size={20}/></button>
  <section className="auth-book-content public-policy" inert={closing}>
   <h1 id="legal-sheet-title" tabIndex={-1} ref={heading}>{t(kind==="support"?"common.support":kind==="terms"?"hostedLegal.termsLink":"hostedPrivacy.title")}</h1>
   {kind==="support"?<a href="mailto:no-reply@timeax.pl">no-reply@timeax.pl</a>:kind==="terms"?<HostedTermsContent/>:<HostedPrivacyContent/>}
  </section>
 </dialog>;
}
