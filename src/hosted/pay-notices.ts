import {useCallback,useEffect,useRef,useState} from 'react';
import type {Disposition} from './inbox';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
type Notice={id:string;at:string;read:boolean;state:Exclude<Disposition,'deleted'>};
type Feed={organizationId:string;membershipId:string;items:Notice[]};
type Action='read'|'state';
async function request(org:string,signal?:AbortSignal,action?:Action,body?:Record<string,string>){
 const r=await fetch('/api/pay-notices/'+org+'/'+(action??'context'),{
  credentials:'same-origin',cache:'no-store',redirect:'error',signal,method:action?'POST':'GET',
  ...(action?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
 });
 if(!r.ok||r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error();
 return r.json();
}
export function usePayNotices(org:string,membership:string,enabled:boolean){
 const [value,V]=useState<Feed>(),[error,E]=useState(false),[busy,B]=useState(false),[version,U]=useState(0);
 const scope=useRef<string>(undefined),running=useRef(false),seen=useRef(new Set<string>()),rev=useRef(0);
 const identity=org+'/'+membership;
 const refresh=useCallback(()=>U(x=>x+1),[]);
 useEffect(()=>{scope.current=identity;running.current=false;seen.current.clear();E(false);B(false);return()=>{scope.current=undefined}},[identity]);
 useEffect(()=>{
  if(!enabled)return;
  const c=new AbortController(),initial=rev.current;
  void request(org,c.signal).then((f:Feed)=>{
   if(f?.organizationId!==org||f.membershipId!==membership||!Array.isArray(f.items)||f.items.length>100||
    !f.items.every(n=>uuid.test(n?.id)&&typeof n.at==='string'&&Number.isFinite(Date.parse(n.at))&&typeof n.read==='boolean'&&['active','archived'].includes(n.state)))throw Error();
   if(!c.signal.aborted&&rev.current===initial)V(f);
  }).catch(()=>{});
  return()=>c.abort();
 },[enabled,org,membership,version]);
 useEffect(()=>{
  if(!enabled)return;
  const visible=()=>{if(!document.hidden)refresh()};
  window.addEventListener('focus',visible);const timer=window.setInterval(visible,30000);
  return()=>{window.removeEventListener('focus',visible);window.clearInterval(timer)}
 },[enabled,refresh]);
 const rows=enabled&&value?.organizationId===org&&value?.membershipId===membership?value.items:[];
 const markRead=useCallback(async(id:string)=>{
  if(!enabled||!uuid.test(id)||seen.current.has(id))return;
  const seenNow=seen.current;seenNow.add(id);rev.current++;
  try{
   const result=await request(org,undefined,'read',{id});
   if(result.read!==true)throw Error();
   if(scope.current===identity)V(v=>v?.organizationId===org&&v?.membershipId===membership?{...v,items:v.items.map(x=>x.id===id?{...x,read:true}:x)}:v);
  }catch{seenNow.delete(id)}finally{if(scope.current===identity)refresh()}
 },[enabled,org,membership,identity,refresh]);
 async function setState(id:string,state:Disposition){
  if(!enabled||!uuid.test(id)||running.current||!rows.some(n=>n.id===id))return;
  running.current=true;B(true);E(false);rev.current++;
  try{
   const result=await request(org,undefined,'state',{id,state});
   if(result.state!==state)throw Error();
   if(scope.current!==identity)return;
   V(v=>{
    if(v?.organizationId!==org||v.membershipId!==membership)return v;
    return {...v,items:state==='deleted'?v.items.filter(n=>n.id!==id):v.items.map(n=>n.id===id?{...n,state}:n)};
   });
  }catch{if(scope.current===identity)E(true)}
  finally{if(scope.current===identity){running.current=false;B(false);refresh()}}
 }
 return {rows,error,busy,markRead,setState,refresh};
}

const labels={
 en:{title:'New payslip',open:'Open payslip',summary:'A payslip is available in your account.'},
 ru:{title:'Новый расчётный листок',open:'Открыть расчётку',summary:'Расчётный листок доступен в твоём кабинете.'},
 pl:{title:'Nowy pasek płacowy',open:'Otwórz pasek płacowy',summary:'Pasek płacowy jest dostępny na Twoim koncie.'},
 uk:{title:'Новий розрахунковий листок',open:'Відкрити розрахунковий листок',summary:'Розрахунковий листок доступний у твоєму кабінеті.'}
};
export const payNoticeCopy=(lang?:string)=>labels[(lang??'en').split('-')[0] as keyof typeof labels]??labels.en;
