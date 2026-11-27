import {ISSUER} from './provider-adapters.mjs';
export const AGENCY_PROFILE_SIGNATURE='timeax_api.agency_profile(text,text,uuid,text)';
export const AGENCY_PROFILE_SQL='SELECT timeax_api.agency_profile($1::text,$2::text,$3::uuid,$4::text) AS value';
export function createAgencyProfileStore(lane){
 return {async get(actor,organizationId,name){
  const r=await lane.query(AGENCY_PROFILE_SQL,[actor.issuer,actor.subject,organizationId,name]);
  const v=r.rows?.[0]?.value;
  if(!v||r.rows.length!==1||v.organizationId!==organizationId||typeof v.name!=='string'||typeof v.nipVerified!=='boolean'||(v.nip!==null&&!/^\d{10}$/.test(v.nip)))throw Error('profile unavailable');
  return {...v,email:actor.email??null};
 }};
}
export function createAgencyProfileHandler({origin,resolveSession,store,now=Date.now}){
 const send=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
 return async request=>{try{
  const u=new URL(request.url),org=u.pathname.split('/')[3],write=request.method==='POST';
  if(u.origin!==origin||u.search||u.hash||!/^\/api\/agency-profile\/[a-f0-9-]{36}\/(?:context|settings)$/.test(u.pathname))return send(404,{error:'unavailable'});
  if(request.method!==(u.pathname.endsWith('/settings')?'POST':'GET'))return send(405,{error:'unavailable'});
  const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((write?from!==origin:from!==null&&from!==origin)||(site!==null&&site!=='same-origin')
    ||[...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return send(403,{error:'denied'});
  const s=await resolveSession(request),active=async()=>!request.signal.aborted&&s?.issuer===ISSUER&&s.state==='verified'&&s.emailConfirmed===true&&s.expiresAt>now()&&await s.isActive();
  if(!await active())return send(401,{error:'login'});
  let name=null;
  if(write){
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding'))return send(400,{error:'invalid'});
    const raw=await request.text();if(Buffer.byteLength(raw)>1024)return send(400,{error:'invalid'});
    const b=JSON.parse(raw);
    if(!b||Object.keys(b).length!==1||typeof b.name!=='string'||b.name.trim().length<2||b.name.length>120||/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(b.name))return send(400,{error:'invalid'});
    name=b.name.trim();
  }
  const v=await store.get(s,org,name);
  return await active()?send(200,v):send(401,{error:'login'});
 }catch(e){return send(e?.code==='42501'?403:e?.code==='22023'||e instanceof SyntaxError?400:503,{error:'unavailable'})}};
}
