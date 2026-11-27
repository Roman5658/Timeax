import {ISSUER} from './provider-adapters.mjs';
import {readBody} from './session-router.mjs';
export const INBOX_SIGNATURE='timeax_api.inbox(text,text,text,jsonb)';
export const INBOX_SQL='SELECT timeax_api.inbox($1::text,$2::text,$3::text,$4::jsonb) AS value';
export const INBOX_ROLE='timeax_inbox_login';
const uuid='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
export const inboxRoute=new RegExp('^/api/inbox/('+uuid+')/(context|set)$');
const id=new RegExp('^'+uuid+'$');
const kinds=['team-message','team-notice','agency-join','backdated-internal','backdated-factory'];
export const createInboxStore=lane=>({async invoke(s,action,body){
 const r=await lane.query(INBOX_SQL,[s.issuer,s.subject,action,JSON.stringify(body)]);
 if(r.rows?.length!==1||!r.rows[0].value)throw Error('Inbox unavailable');
 return r.rows[0].value;
}});
const respond=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
export function createInboxHandler({origin,resolveSession,store,now=Date.now}){
 return async request=>{try{
  const url=new URL(request.url),match=inboxRoute.exec(url.pathname);
  if(url.origin!==origin||url.search||url.hash||!match)return respond(404,{error:'unavailable'});
  const [,organizationId,action]=match,write=action==='set';
  const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if(request.method!==(write?'POST':'GET'))return respond(405,{error:'unavailable'});
  if((write?from!==origin:from!==null&&from!==origin)||site!==null&&site!=='same-origin')return respond(403,{error:'denied'});
  const s=await resolveSession(request);
  const active=()=>s?.state==='verified'&&s.issuer===ISSUER&&s.emailConfirmed===true&&s.isAnonymous===false&&s.expiresAt>now()&&!request.signal.aborted&&s.isActive();
  if(!await active())return respond(s?.state==='unavailable'?503:401,{error:'login'});
  let data={};
  if(write){
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding'))return respond(400,{error:'invalid'});
   const raw=await readBody(request,1024);
   try{data=JSON.parse(raw??'')}catch{return respond(400,{error:'invalid'})}
   if(!data||Object.keys(data).length!==3||!kinds.includes(data.kind)||typeof data.id!=='string'||!id.test(data.id)||!['archived','active','deleted'].includes(data.state))return respond(400,{error:'invalid'});
  }
  const value=await store.invoke(s,action,{...data,organizationId});
  return await active()?respond(200,value):respond(401,{error:'login'});
 }catch(e){return respond(e?.code==='42501'?403:503,{error:'unavailable'})}};
}
