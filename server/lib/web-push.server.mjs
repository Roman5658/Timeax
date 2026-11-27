import {createECDH,randomUUID,timingSafeEqual} from 'node:crypto';
import webPush from 'web-push';
import {ISSUER} from './provider-adapters.mjs';

export const PUSH_ROLE='timeax_web_push_login';
export const PUSH_SIGNATURE='timeax_api.web_push(text,text,text,jsonb)';
export const PUSH_SQL='SELECT timeax_api.web_push($1::text,$2::text,$3::text,$4::jsonb) AS value';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const bytes=(s,len)=>{
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s))return null;
 const value=Buffer.from(s,'base64url');
 return value.length===len&&value.toString('base64url')===s?value:null;
};
const endpoint=v=>{
 if(typeof v!=='string'||v.length>1300)return false;
 try{
  const u=new URL(v);
  return u.href===v&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&
   ((u.hostname==='fcm.googleapis.com'&&u.pathname.startsWith('/fcm/send/'))||
    (u.hostname==='updates.push.services.mozilla.com'&&u.pathname.startsWith('/wpush/'))||
    (u.hostname==='web.push.apple.com'&&u.pathname.length>16))&&
   /^\/[A-Za-z0-9_:\-/.]+$/.test(u.pathname);
 }catch{return false}
};
export function validatePushSubscription(v){
 if(!exact(v,['endpoint','keys'])||!endpoint(v.endpoint)||!exact(v.keys,['p256dh','auth'])||!bytes(v.keys.auth,16))return false;
 const key=bytes(v.keys.p256dh,65);if(!key||key[0]!==4)return false;
 try{
  const e=createECDH('prime256v1');e.generateKeys();e.computeSecret(key);return true}catch{return false}
}
const labels={en:'New notification in Timeax',ru:'Новое уведомление в Timeax',pl:'Nowe powiadomienie w Timeax',uk:'Нове сповіщення в Timeax'};
export function createPushSender({publicKey,privateKey,subject='mailto:push@timeax.pl'},fetchImpl=fetch){
 const pub=bytes(publicKey,65),key=bytes(privateKey,32);
 if(!pub||!key||!/^mailto:[A-Za-z0-9._+-]+@timeax\.pl$/.test(subject))throw Error('Invalid Web Push configuration');
 const e=createECDH('prime256v1');e.setPrivateKey(key);
 if(!timingSafeEqual(e.getPublicKey(),pub))throw Error('Invalid Web Push keys');
 return async job=>{
  if(!validatePushSubscription(job.subscription)||!uuid(job.organizationId))return 'discard';
  const details=webPush.generateRequestDetails(job.subscription,JSON.stringify({
   body:labels[job.language]??labels.en,path:'/workspace/'+job.organizationId+'/messages'
  }),{TTL:3600,urgency:'normal',topic:'timeax-bell',vapidDetails:{subject,publicKey,privateKey}});
  const r=await fetchImpl(details.endpoint,{method:'POST',headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(8000)});
  await r.body?.cancel();
  if(r.ok)return 'delivered';
  if(r.status===404||r.status===410)return 'expired';
  if(r.status===429||r.status>=500)return 'retry';
  return 'discard';
 };
}
export function createPushService({origin,lane,publicKey,send,interval=10000}){
 const call=async (action,input={},s=null)=>{
  const r=await lane.query(PUSH_SQL,[s?.issuer??null,s?.subject??null,action,JSON.stringify(input)]);
  if(r.rows?.length!==1||!r.rows[0]?.value)throw Error('Push operation unavailable');
  return r.rows[0].value;
 };
 let timer,busy=false;
 async function tick(){
  if(busy)return;busy=true;
  try{
   const lease=randomUUID(),jobs=await call('claim',{lease});
   if(!Array.isArray(jobs)||jobs.length>12)return;
   await Promise.allSettled(jobs.filter(j=>uuid(j?.id)).map(async job=>{
    let outcome;try{outcome=await send(job)}catch{outcome='retry'}
    await call('finish',{id:job.id,lease,outcome});
   }));
  }catch{}finally{busy=false}
 }
 const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
 return {
  start(){if(!timer){timer=setInterval(()=>void tick(),interval);timer.unref()}},
  stop(){clearInterval(timer);timer=undefined},
  routes(resolve){return async request=>{
   const u=new URL(request.url),write=request.method==='POST';
   if(u.origin!==origin||u.pathname!=='/api/web-push'||u.search||u.hash||!['GET','POST'].includes(request.method)||
    (write?request.headers.get('origin')!==origin:request.headers.has('origin')&&request.headers.get('origin')!==origin)||
    request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin')return reply(403,{error:'denied'});
   try{
    const s=await resolve(request);
    if(s?.state!=='verified'||s.issuer!==ISSUER||!/^[a-f0-9]{64}$/.test(s.pushSessionKey??'')||!await s.isActive())return reply(401,{error:'login'});
    if(!write)return reply(200,{publicKey});
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json'||!request.body||request.headers.has('content-encoding'))return reply(400,{error:'invalid'});
    const reader=request.body.getReader();let parts=[],size=0,alarm;
    try{
     const timeout=new Promise((_,reject)=>{alarm=setTimeout(()=>reject(Error()),1500)});
     for(;;){const r=await Promise.race([reader.read(),timeout]);if(r.done)break;size+=r.value.length;if(size>4096)return reply(400,{error:'invalid'});parts.push(r.value)}
     let b;try{b=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(parts)))}catch{return reply(400,{error:'invalid'})}
     const session=s.pushSessionKey;
     if(!await s.isActive())return reply(401,{error:'login'});
     if(exact(b,['action','subscription','language'])&&b.action==='enable'&&validatePushSubscription(b.subscription)&&Object.hasOwn(labels,b.language))
      return reply(200,await call('enable',{session,language:b.language,...b.subscription},s));
     if(exact(b,['action','endpoint'])&&['disable','status'].includes(b.action)&&endpoint(b.endpoint))
      return reply(200,await call(b.action,{session,endpoint:b.endpoint},s));
     return reply(400,{error:'invalid'});
    }finally{clearTimeout(alarm);void reader.cancel().catch(()=>{})}
   }catch(e){return reply(e?.code==='42501'?403:503,{error:'unavailable'})}
  }}
 };
}
