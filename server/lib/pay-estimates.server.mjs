import {ISSUER} from './provider-adapters.mjs';
import {readBody} from './session-router.mjs';

export const PAY_ESTIMATE_ROLE='timeax_pay_estimate_login';
export const PAY_ESTIMATE_SIGNATURE='timeax_api.pay_estimates(text,text,text,jsonb)';
export const PAY_ESTIMATE_SQL='SELECT timeax_api.pay_estimates($1::text,$2::text,$3::text,$4::jsonb) AS value';
const uuid='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const id=new RegExp('^'+uuid+'$');
export const payEstimateRoute=new RegExp('^/api/pay-estimates/('+uuid+')/(context|set)$');
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validPayEstimateSetting(v,minRevision=0){
 return exact(v,['workerId','effectiveMonth','basis','rateCents','deductions','revision'])&&
  typeof v.workerId==='string'&&id.test(v.workerId)&&typeof v.effectiveMonth==='string'&&/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(v.effectiveMonth)&&
  ['gross','net'].includes(v.basis)&&integer(v.rateCents,1,1000000)&&integer(v.revision,minRevision,999999999)&&
  Array.isArray(v.deductions)&&v.deductions.length<=(v.basis==='net'?0:20)&&
  v.deductions.every(r=>exact(r,['name','cents'])&&typeof r.name==='string'&&r.name===r.name.trim()&&
   [...r.name].length>=2&&[...r.name].length<=80&&!/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(r.name)&&integer(r.cents,1,1000000000))&&
  v.deductions.reduce((sum,r)=>sum+r.cents,0)<=1000000000;
}
export const createPayEstimateStore=lane=>({async invoke(s,action,body){
 const r=await lane.query(PAY_ESTIMATE_SQL,[s.issuer,s.subject,action,JSON.stringify(body)]);
 if(r.rows?.length!==1||!r.rows[0].value)throw Error('Estimates unavailable');
 return r.rows[0].value;
}});
const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createPayEstimateHandler({origin,resolveSession,store,now=Date.now}){
 return async request=>{try{
  const u=new URL(request.url),match=payEstimateRoute.exec(u.pathname);
  if(u.origin!==origin||u.search||u.hash||!match)return reply(404,{error:'unavailable'});
  const [,organizationId,action]=match,write=action==='set';
  if(request.method!==(write?'POST':'GET'))return reply(405,{error:'unavailable'});
  const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((write?from!==origin:from!==null&&from!==origin)||site!==null&&site!=='same-origin'||
   [...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return reply(403,{error:'denied'});
  if(!store)return reply(503,{error:'unavailable'});
  const s=await resolveSession(request);
  const active=()=>s?.state==='verified'&&s.issuer===ISSUER&&typeof s.subject==='string'&&s.emailConfirmed===true&&s.isAnonymous===false&&s.expiresAt>now()&&!request.signal.aborted&&s.isActive();
  if(!await active())return reply(s?.state==='unavailable'?503:401,{error:'login'});
  let data={};
  if(write){
   try{data=JSON.parse(await readBody(request,8192)??'')}catch{return reply(400,{error:'invalid'})}
   if(!validPayEstimateSetting(data))return reply(400,{error:'invalid'});
  }
  const result=await store.invoke(s,action,{...data,organizationId});
  if(!await active())return reply(401,{error:'login'});
  if(write?!validPayEstimateSetting(result,1)||result.workerId!==data.workerId||result.effectiveMonth!==data.effectiveMonth||
     result.revision!==data.revision+1||result.basis!==data.basis||result.rateCents!==data.rateCents||
     result.deductions.length!==data.deductions.length||result.deductions.some((x,i)=>x.name!==data.deductions[i].name||x.cents!==data.deductions[i].cents):
    result?.organizationId!==organizationId||!Array.isArray(result.settings)||!result.settings.every(v=>validPayEstimateSetting(v,1)))return reply(503,{error:'unavailable'});
  return reply(200,result);
 }catch(e){const code=e?.code;return reply(code==='42501'?403:code==='23505'?409:code?.startsWith('22')?400:503,
  {error:code==='42501'?'denied':code==='23505'?'conflict':code?.startsWith('22')?'invalid':'unavailable'})}};
}
