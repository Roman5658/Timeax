import {ISSUER} from './provider-adapters.mjs';
import {normalizePublicEmail} from './public-email-provider.mjs';
import {readBody} from './session-router.mjs';
export const AGENCY_PROFILE_SIGNATURE='timeax_api.agency_profile(text,text,uuid,text)';
export const AGENCY_PROFILE_SQL='SELECT timeax_api.agency_profile($1::text,$2::text,$3::uuid,$4::text) AS value';
const uuid='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const route=new RegExp('^/api/agency-profile/('+uuid+')(?:/worksite/('+uuid+'))?/(context|settings)$');
const safe=(v,min,max,multiline=false)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max&&
 !/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(multiline?v.replace(/\n/g,''):v);
const timeModes=new Set(['nfc_terminal','nfc_stationary','leader','manual']);
const timePlan=value=>value===null||timeModes.has(value);
const exact=(v,...keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function createAgencyProfileStore(lane){
 return {async get(actor,organizationId,command){
  const r=await lane.query(AGENCY_PROFILE_SQL,[actor.issuer,actor.subject,organizationId,command===null?null:JSON.stringify(command)]);
  const v=r.rows?.[0]?.value;
  if(!v||r.rows.length!==1||v.organizationId!==organizationId||typeof v.name!=='string'||typeof v.address!=='string')throw Error('profile unavailable');
  if(command?.worksiteId){
   if(v.worksiteId!==command.worksiteId||typeof v.connected!=='boolean'||typeof v.description!=='string'||!timePlan(v.plannedTimeMode))throw Error('worksite profile unavailable');
   return {organizationId:v.organizationId,worksiteId:v.worksiteId,connected:v.connected,name:v.name,address:v.address,description:v.description,plannedTimeMode:v.plannedTimeMode};
  }
  if(typeof v.nipVerified!=='boolean'||(v.nip!==null&&!/^\d{10}$/.test(v.nip))||typeof v.contactEmail!=='string')throw Error('profile unavailable');
  return {organizationId:v.organizationId,name:v.name,address:v.address,nip:v.nip,nipVerified:v.nipVerified,contactEmail:v.contactEmail,email:actor.email??null};
 }};
}
export function createAgencyProfileHandler({origin,resolveSession,store,now=Date.now}){
 const send=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
 return async request=>{try{
  const u=new URL(request.url),match=route.exec(u.pathname),write=request.method==='POST';
  if(u.origin!==origin||u.search||u.hash||!match)return send(404,{error:'unavailable'});
  const [,org,worksiteId,action]=match;
  if(request.method!==(action==='settings'?'POST':'GET'))return send(405,{error:'unavailable'});
  const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((write?from!==origin:from!==null&&from!==origin)||(site!==null&&site!=='same-origin')
    ||[...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return send(403,{error:'denied'});
  const s=await resolveSession(request),active=async()=>!request.signal.aborted&&s?.issuer===ISSUER&&s.state==='verified'&&s.emailConfirmed===true&&s.isAnonymous===false&&s.expiresAt>now()&&await s.isActive();
  if(!await active())return send(401,{error:'login'});
  let command=worksiteId?{action:'get-site',worksiteId}:null;
  if(write){
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding'))return send(400,{error:'invalid'});
   let b;try{b=JSON.parse(await readBody(request,8192))}catch{return send(400,{error:'invalid'})}
   if(worksiteId){
    if(exact(b,'plannedTimeMode')&&timePlan(b.plannedTimeMode)){
     command={action:'save-site-time-plan',worksiteId,plannedTimeMode:b.plannedTimeMode};
    }else{
     if(!exact(b,'name','address','description')||!safe(b.name,0,120)||!safe(b.address,0,240)||!safe(b.description,0,1500,true))return send(400,{error:'invalid'});
     command={action:'save-site',worksiteId,name:b.name.trim(),address:b.address.trim(),description:b.description.trim()};
    }
   }else{
    if(!safe(b?.name,2,120))return send(400,{error:'invalid'});
    if(exact(b,'name'))command={action:'save-name',name:b.name.trim()};
    else {
     if(!exact(b,'name','address','contactEmail')||!safe(b.address,0,240)||!safe(b.contactEmail,0,254))return send(400,{error:'invalid'});
     const email=b.contactEmail.trim();
     if(email&&!normalizePublicEmail(email))return send(400,{error:'invalid'});
     command={action:'save-profile',name:b.name.trim(),address:b.address.trim(),contactEmail:email};
    }
   }
  }
  const v=await store.get(s,org,command);
  return await active()?send(200,v):send(401,{error:'login'});
 }catch(e){return send(e?.code==='42501'?403:e?.code==='22023'||e instanceof SyntaxError?400:503,{error:'unavailable'})}};
}
