import {isCanonicalEmailOrigin} from '../modules/auth/registration/contract/registration-client';

export type WorkerSessionResult='ready'|'login'|'unavailable';
export async function persistApprovedWorkerSession(signal?:AbortSignal):Promise<WorkerSessionResult>{
 if(!isCanonicalEmailOrigin(location.origin)||signal?.aborted)return 'unavailable';
 const c=new AbortController(),abort=()=>c.abort();
 signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,5000);
 try{
  const res=await fetch('/api/timeax/auth/public/worker-session',{
   method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
   headers:{'Content-Type':'application/json'},body:'{}',signal:c.signal,
  });
  return res.status===204?'ready':res.status===401?'login':'unavailable';
 }catch{return 'unavailable'}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
