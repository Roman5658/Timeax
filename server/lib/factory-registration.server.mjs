import {ISSUER} from './provider-adapters.mjs';
import {validNip} from './worker-enrollment.server.mjs';
export const FACTORY_REGISTRATION_SQL='SELECT timeax_api.factory_registration($1::text,$2::text,$3::text,$4::jsonb) AS value';
export function createFactoryRegistrationStore(lane){if(typeof lane?.query!=='function')throw Error('Factory registration RPC lane missing');return {async invoke(actor,action,input){const r=await lane.query(FACTORY_REGISTRATION_SQL,[actor.issuer,actor.subject,action,JSON.stringify(input)]);if(r.rows?.length!==1||!r.rows[0].value||typeof r.rows[0].value!=='object')throw Error('Invalid factory result');return r.rows[0].value}}}
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const fields={
 'submit':['name','nip','siteName','confirmed'],'review':['id','decision','reference','confirmed'],
 'invite-worker':['worksiteId','startsAt'],'claim-worker':['code'],'revoke-worker':['id'],
 'invite-factory':['agencyId','factoryNip'],'claim-agency-invitation':['worksiteId','code'],'revoke-agency-invitation':['id']
};
const valid=(action,b)=>{
 const keys=fields[action];if(!keys||!b||Array.isArray(b)||typeof b!=='object'||Object.keys(b).length!==keys.length||keys.some(k=>!Object.hasOwn(b,k)))return false;
 for(const key of keys){
  const v=b[key];
  if((key==='id'||key.endsWith('Id'))&&!uuid(v))return false;
  if(key==='startsAt'&&(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))))return false;
  if(['nip','factoryNip'].includes(key)&&!validNip(v))return false;
  if(['name','siteName','reference'].includes(key)&&(typeof v!=='string'||v.trim().length<1||v.trim().length>(key==='reference'?200:120)||/[\p{Cc}]/u.test(v)))return false;
  if(key==='decision'&&!['approved','rejected'].includes(v))return false;
  if(key==='confirmed'&&v!==true)return false;
  if(key==='code'&&(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v)))return false;
 }return true;
};
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createFactoryRegistrationHandler({origin,resolveSession,store=null,agencyOnly=false,now=Date.now}){
 const base=new URL(origin);if(base.origin!==origin||base.protocol!=='https:'||typeof resolveSession!=='function')throw Error('Guarded factory dependencies required');
 return async request=>{
  try{
   const url=new URL(request.url),match=url.pathname.match(/^\/api\/factory-registration\/([a-z-]+)$/);
   if(url.origin!==origin||url.search||url.hash||!match)return reply(404,{error:'not-found'});
   const action=match[1],write=action!=='context';
   if(request.method!==(write?'POST':'GET'))return reply(405,{error:'not-allowed'});
   const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
   if((write?from!==origin:from!==null&&from!==origin)||(site!==null&&site!=='same-origin')||[...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return reply(403,{error:'not-permitted'});
   if(!store)return reply(503,{error:'factory-not-enabled'});
   const s=await resolveSession(request);
   if(s?.state==='unavailable')return reply(503,{error:'session-unavailable'});
   const active=async()=>!request.signal.aborted&&s?.state==='verified'&&s.issuer===ISSUER&&typeof s.subject==='string'&&s.subject.length>0&&s.subject.length<=255&&s.emailConfirmed===true&&s.isAnonymous===false&&Number.isSafeInteger(s.expiresAt)&&s.expiresAt>now()&&typeof s.isActive==='function'&&await s.isActive()===true;
   if(!await active())return reply(401,{error:'valid-session-required'});
   let input={};
   if(write){
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding'))return reply(400,{error:'invalid-request'});
    const reader=request.body?.getReader();if(!reader)return reply(400,{error:'invalid-request'});
    let size=0,parts=[],timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),2500)});
    try{for(;;){const r=await Promise.race([reader.read(),timeout]);if(r.done)break;size+=r.value.length;if(size>2048)return reply(400,{error:'invalid-request'});parts.push(r.value)}input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(parts)))}finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
    if(!valid(action,input))return reply(400,{error:'invalid-request'});
   }
   const result=await store.invoke({issuer:s.issuer,subject:s.subject},action,input);
   const value=agencyOnly&&action==='context'?{reviewer:false,requests:[],workerInvitations:[],agencyInvitations:result.agencyInvitations}:result;
   if(!await active())return reply(401,{error:'valid-session-required'});
   return reply(200,value);
  }catch(e){return reply(e?.code==='42501'?403:e?.code==='22023'?400:503,{error:e?.code==='42501'?'not-permitted':'factory-unavailable'})}
 };
}
