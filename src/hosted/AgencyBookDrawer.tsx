import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './agency-workers.css';

/** Native modal dialog with book motion, keyboard dismissal, and return focus. */
export function AgencyBookDrawer({title,closeLabel,busy=false,centered=false,onClose,children}:{
 title:string;closeLabel:string;busy?:boolean;centered?:boolean;onClose:()=>void;children:ReactNode
}){
 const ref=useRef<HTMLDialogElement>(null),titleId=useId(),timer=useRef<number>(0),opener=useRef<HTMLElement|null>(null);
 const [closing,setClosing]=useState(false);
 const dismiss=()=>{
  if(busy||closing)return;
  if(window.matchMedia('(prefers-reduced-motion:reduce)').matches){onClose();return}
  setClosing(true);
  timer.current=window.setTimeout(onClose,280);
 };
 useEffect(()=>{
  const el=ref.current;
  opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  if(el&&!el.open)el.showModal();
  return()=>{window.clearTimeout(timer.current);if(el?.open)el.close();opener.current?.focus()};
 },[]);
 return <dialog ref={ref} className={'agency-book'+(centered?' agency-book--center':'')+(closing?' agency-book--closing':'')}
  aria-labelledby={titleId} onCancel={e=>{e.preventDefault();dismiss()}}
  onClick={e=>{if(e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dismiss()}}}>
  <header><h2 id={titleId}>{title}</h2><button type="button" className="button button--outline" disabled={busy||closing} onClick={dismiss} aria-label={closeLabel} autoFocus>×</button></header>
  <div className="agency-book__body" inert={closing}>{children}</div>
 </dialog>;
}

