import {useEffect,useState} from 'react';
import {enrollmentContext,workerCall,type EnrollmentContext} from './worker-enrollment';

export function useWorkerConnections(enabled:boolean,revision=0){
 return useWorkerEnrollmentStatus(enabled,revision)?.memberships;
}

export function useWorkerEnrollmentStatus(enabled:boolean,revision=0,watchPending=false){
 const [result,setResult]=useState<{revision:number;context:EnrollmentContext}>();
 const waiting=result?.context.applications.some(a=>a.status==='pending')===true;
 useEffect(()=>{
  setResult(undefined);
  if(!enabled)return;
  const controller=new AbortController();
  void workerCall('context',undefined,controller.signal).then(enrollmentContext).then(context=>{
   if(!controller.signal.aborted)setResult({revision,context});
  }).catch(()=>{ /* Unknown is not the same as zero active connections. */ });
  return()=>controller.abort();
 },[enabled,revision]);
 useEffect(()=>{
  if(!enabled||!watchPending||!waiting)return;
  const controller=new AbortController();
  let busy=false;
  async function check(){
   if(busy||document.hidden)return;
   busy=true;
   try{
    const context=enrollmentContext(await workerCall('context',undefined,controller.signal));
    if(!controller.signal.aborted)setResult({revision,context});
   }catch{}finally{busy=false}
  }
  const timer=window.setInterval(check,30000);
  window.addEventListener('focus',check);
  return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener('focus',check)};
 },[enabled,watchPending,waiting,revision]);
 return enabled&&result?.revision===revision?result.context:undefined;
}
