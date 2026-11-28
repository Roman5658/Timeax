import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
export type BellPreview={anchor:string;title:string;summary:string;at:string;unread:boolean};
const known=/^(team-message|team-notice|agency-join|agency-application|earlier-shift|payslip|backdated-internal|backdated-factory)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const isActionNotice=(anchor:string)=>anchor.startsWith('earlier-shift-')||anchor.startsWith('agency-application-');
export function bellTarget(hash:string){
 const id=hash.slice(1);return hash.startsWith('#')&&known.test(id)?id:undefined;
}
export function useBellAnchor(enabled:boolean){
 const {hash,key}=useLocation(),target=bellTarget(hash);
 useEffect(()=>{
  if(!enabled||!target)return;
  let frame=0,highlighted:HTMLElement|null=null;
  const clear=()=>{highlighted?.removeAttribute('data-bell-target');highlighted=null};
  const focus=()=>{
   const element=document.getElementById(target);
   const visible=element&&element.getClientRects().length>0?element:null;
   if(visible===highlighted)return;
   clear();
   cancelAnimationFrame(frame);
   if(!visible)return;
   highlighted=visible;
   visible.setAttribute('data-bell-target','true');
   frame=requestAnimationFrame(()=>{
    if(!visible.isConnected||highlighted!==visible)return;
    visible.focus({preventScroll:true});
    visible.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   });
  };
  const observer=new MutationObserver(focus);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']});
  focus();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);clear()};
 },[enabled,target,key]);
}
export const noticeDestination=(anchor:string)=>anchor.startsWith('agency-application-')?'workers?tab=applications':anchor.startsWith('earlier-shift-')?'timecards':anchor.startsWith('payslip-')?'payslips':'messages';
export function previewText(v:unknown){
 return typeof v==='string'?v.replace(/\s+/gu,' ').trim().slice(0,130):'';
}
export function latestBellPreviews(entries:BellPreview[],limit=Infinity){
 return entries.filter(e=>bellTarget('#'+e.anchor)&&Number.isFinite(Date.parse(e.at)))
  .sort((a,b)=>Number(b.unread)-Number(a.unread)||Date.parse(b.at)-Date.parse(a.at)).slice(0,limit);
}
