import {ISSUER} from './provider-adapters.mjs';
import {readBody} from './session-router.mjs';
export const PAY_NOTICE_ROLE='timeax_pay_notice_login';
export const PAY_NOTICE_SIGNATURE='timeax_api.pay_notices(text,text,text,jsonb)';
export const PAY_NOTICE_SQL='SELECT timeax_api.pay_notices($1::text,$2::text,$3::text,$4::jsonb) AS value';
const uuid='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const id=v=>typeof v==='string'&&new RegExp('^'+uuid+'$').test(v);
export const payNoticeRoute=new RegExp('^/api/pay-notices/('+uuid+')/(context|read|state)$');
export const createPayNoticeStore=lane=>({async invoke(s,action,body){
 const r=await lane.query(PAY_NOTICE_SQL,[s.issuer,s.subject,action,JSON.stringify(body)]);
 if(r.rows?.length!==1||!r.rows[0].value)throw Error('Notifications unavailable');
 return r.rows[0].value;
}});
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const legalStates=['active','archived','deleted'];
export function createPayNoticeHandler({origin,resolveSession,store,now=Date.now}){
 return async request=>{try{
  const u=new URL(request.url),match=payNoticeRoute.exec(u.pathname);
  if(u.origin!==origin||u.search||u.hash||!match)return reply(404,{error:'unavailable'});
  const [,organizationId,action]=match,write=action!=='context';
  if(request.method!==(write?'POST':'GET'))return reply(405,{error:'unavailable'});
  const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((write?from!==origin:from!==null&&from!==origin)||site!==null&&site!=='same-origin'||
   [...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return reply(403,{error:'denied'});
  if(!store)return reply(503,{error:'unavailable'});
  const s=await resolveSession(request);
  const active=()=>s?.state==='verified'&&s.issuer===ISSUER&&typeof s.subject==='string'&&s.emailConfirmed===true&&s.isAnonymous===false&&
   s.workspaceRole==='worker'&&id(s.workspaceMembershipId)&&s.expiresAt>now()&&!request.signal.aborted&&s.isActive();
  if(!await active())return reply(s?.state==='unavailable'?503:401,{error:'login'});
  let data={};
  if(write){
   try{data=JSON.parse(await readBody(request,1024)??'')}catch{return reply(400,{error:'invalid'})}
   if(!data||!id(data.id)||(action==='read'?Object.keys(data).length!==1:Object.keys(data).length!==2||!legalStates.includes(data.state)))return reply(400,{error:'invalid'});
  }
  const result=await store.invoke(s,action,{...data,organizationId});
  if(!await active())return reply(401,{error:'login'});
  if(action==='context'){
   if(result.organizationId!==organizationId||result.membershipId!==s.workspaceMembershipId||!Array.isArray(result.items)||result.items.length>100||
    result.items.some(n=>!id(n?.id)||typeof n.at!=='string'||!Number.isFinite(Date.parse(n.at))||typeof n.read!=='boolean'||!legalStates.slice(0,2).includes(n.state)))
    return reply(503,{error:'unavailable'});
   return reply(200,{organizationId,membershipId:result.membershipId,items:result.items.map(({id,at,read,state})=>({id,at,read,state}))});
  }
  if(action==='read'&&result.read===true)return reply(200,{read:true});
  if(action==='state'&&result.state===data.state)return reply(200,{state:data.state});
  return reply(409,{error:'conflict'});
 }catch(e){return reply(e?.code==='42501'?403:503,{error:e?.code==='42501'?'denied':'unavailable'})}};
}
