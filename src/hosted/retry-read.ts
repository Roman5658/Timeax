export class TemporaryReadError extends Error {
 constructor(){super('unavailable')}
}
export const retryableStatus=(status:number)=>status>=500&&status<=599||status===429;
function pauseRead(ms:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason);return}
  const finish=()=>{signal.removeEventListener('abort',abort);resolve()};
  const timer=setTimeout(finish,ms);
  const abort=()=>{clearTimeout(timer);reject(signal.reason)};
  signal.addEventListener('abort',abort,{once:true});
 });
}
export async function readWithRetry<T>(read:(signal:AbortSignal)=>Promise<T>,signal:AbortSignal,retries=2):Promise<T>{
 for(let n=0;;n++){
  if(signal.aborted)throw signal.reason;
  const attempt=new AbortController();
  const abort=()=>attempt.abort(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  const deadline=setTimeout(()=>attempt.abort(new TemporaryReadError()),8500);
  try{
   const value=await read(attempt.signal);
   if(attempt.signal.aborted)throw attempt.signal.reason;
   return value;
  }catch(error){
   if(signal.aborted)throw signal.reason;
   if(n>=retries||!(attempt.signal.aborted||error instanceof TemporaryReadError||error instanceof TypeError))throw error;
  }finally{clearTimeout(deadline);signal.removeEventListener('abort',abort)}
  await pauseRead(n===0?400:1400,signal);
 }
}
