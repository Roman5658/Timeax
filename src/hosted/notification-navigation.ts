import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
export type BellPreview={anchor:string;title:string;summary:string;at:string;unread:boolean};
const known=/^(team-message|team-notice|agency-join|earlier-shift|payslip|backdated-internal|backdated-factory)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function bellTarget(hash:string){
 const id=hash.slice(1);return hash.startsWith('#')&&known.test(id)?id:undefined;
}
export function useBellAnchor(enabled:boolean){
 const {hash,key}=useLocation(),target=bellTarget(hash);
 useEffect(()=>{
  if(!enabled||!target)return;
  let frame=0;
  const focus=()=>{
   const el=document.getElementById(target);
   if(!el||!el.getClientRects().length)return false;
   frame=requestAnimationFrame(()=>{
    el.focus({preventScroll:true});
    el.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
   });
   return true;
  };
  const observer=new MutationObserver(()=>{if(focus())observer.disconnect()});
  if(!focus())observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  const timer=window.setTimeout(()=>observer.disconnect(),12000);
  return()=>{observer.disconnect();window.clearTimeout(timer);cancelAnimationFrame(frame)};
 },[enabled,target,key]);
}
export const noticeDestination=(anchor:string)=>anchor.startsWith('earlier-shift-')?'timecards':anchor.startsWith('payslip-')?'payslips':'messages';
export function previewText(v:unknown){
 return typeof v==='string'?v.replace(/\s+/gu,' ').trim().slice(0,130):'';
}
export function latestBellPreviews(entries:BellPreview[],limit=Infinity){
 return entries.filter(e=>bellTarget('#'+e.anchor)&&Number.isFinite(Date.parse(e.at)))
  .sort((a,b)=>Number(b.unread)-Number(a.unread)||Date.parse(b.at)-Date.parse(a.at)).slice(0,limit);
}
