import {createHash,randomBytes} from 'node:crypto';import {ISSUER} from './provider-adapters.mjs';
export const ACCOUNT_SQL='SELECT timeax_api.account_lifecycle($1::text,$2::text,$3::text,$4::jsonb) AS value';
export function createAccountStore(lane){if(typeof lane?.query!=='function')throw Error('Account lane required');const invoke=async(actor,action,input={})=>{const r=await lane.query(ACCOUNT_SQL,[actor?.issuer??'',actor?.subject??'',action,JSON.stringify(input)]);if(r.rows?.length!==1)throw Error();return r.rows[0].value};return {invoke,async allowed(actor){return (await invoke(actor,'session-status')).allowed===true}}}
const INTENT='__Host-timeax-account-deletion-intent',SESSION='__Host-timeax-pending-session',CHALLENGE='__Host-timeax-enrollment-challenge';
const hash=v=>createHash('sha256').update(v).digest('hex'),id=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const cookie=(name,value='',seconds=0)=>name+'='+value+'; Max-Age='+seconds+'; Path=/; HttpOnly; Secure; SameSite=Strict';
const readIntent=r=>{const a=(r.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(INTENT+'='));const v=a.length===1?a[0].slice(INTENT.length+1):'';return /^[A-Za-z0-9_-]{43}$/.test(v)?v:null};
const reply=(status,body,cookies=[])=>{const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});for(const c of cookies)headers.append('set-cookie',c);return new Response(JSON.stringify(body),{status,headers})};
async function body(r){if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(r.headers.get('content-type')??'')||r.headers.has('content-encoding')||!r.body)throw Error();const reader=r.body.getReader();let timer,size=0,parts=[];try{const limit=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),2500)});for(;;){const v=await Promise.race([reader.read(),limit]);if(v.done)break;size+=v.value.length;if(size>2048)throw Error();parts.push(v.value)}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)))}finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}}
export function createAccountHandler({origin,store=null,resolveSession,revokeSessions,now=Date.now}){
 if(new URL(origin).origin!==origin||!origin.startsWith('https:'))throw Error('HTTPS required');
 let recoveryWindow=0,recoveryCount=0;
 return async r=>{try{
 const u=new URL(r.url),m=u.pathname.match(/^\/api\/personal-account\/(context|export|begin-delete|delete|deletion-status|recovery-request|agency-context|end-membership)$/);
 if(u.origin!==origin||u.search||u.hash||!m)return reply(404,{error:'unavailable'});const action=m[1],write=!['context','export','deletion-status'].includes(action);
 if(r.method!==(write?'POST':'GET'))return reply(405,{error:'unavailable'});
 const mutation=r.method==='POST',from=r.headers.get('origin'),site=r.headers.get('sec-fetch-site');
 if((mutation?from!==origin:from!==null&&from!==origin)||(site!==null&&site!=='same-origin')||[...r.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return reply(403,{error:'denied'});
 if(!store)return reply(503,{error:'not-enabled'});
 let input={};if(mutation){try{input=await body(r)}catch{return reply(400,{error:'invalid'})}}
 if(action==='recovery-request'){
  if(!exact(input,['contactEmail','reference'])||typeof input.contactEmail!=='string'||input.contactEmail.length>254||!/^[^@\s\p{Cc}]+@[^@\s\p{Cc}]+\.[^@\s\p{Cc}]+$/u.test(input.contactEmail)||typeof input.reference!=='string'||input.reference.trim().length<2||input.reference.length>200||/[\p{Cc}\p{Cs}]/u.test(input.reference))return reply(400,{error:'invalid'});
  if(now()-recoveryWindow>3600000){recoveryWindow=now();recoveryCount=0}if(++recoveryCount>20)return reply(429,{error:'try-later'});
  return reply(202,await store.invoke(null,action,{contactEmail:input.contactEmail.toLowerCase(),reference:input.reference.trim()}));
 }
 const proof=readIntent(r),tokenHash=proof?hash(proof):null;
 if(action==='deletion-status'||action==='delete'){
  const state=tokenHash?await store.invoke(null,'deletion-status',{tokenHash}):{state:'unknown'};
  if(action==='deletion-status'||state.state==='closed-provider-cleanup-pending')return reply(200,state,action==='delete'?[cookie(SESSION),cookie(CHALLENGE)]:[]);
 }
 const s=await resolveSession(r),active=async()=>s?.state==='verified'&&s.issuer===ISSUER&&s.emailConfirmed===true&&s.isAnonymous===false&&s.expiresAt>now()&&await s.isActive()===true;
 if(!await active())return reply(s?.state==='unavailable'?503:401,{error:'login'});
 const actor={issuer:s.issuer,subject:s.subject};let result,cookies=[];
 if(action==='context'||action==='export'){
  result=await store.invoke(actor,action);
  if(action==='context')result.deletionState=tokenHash?(await store.invoke(actor,'deletion-readiness',{tokenHash,sessionHash:s.sessionKey,authenticatedAt:new Date(Number.isSafeInteger(s.authenticatedAt)&&s.authenticatedAt<=now()&&now()-s.authenticatedAt<=300000?s.authenticatedAt:0).toISOString()})).state:'none';
 }
 else if(action==='agency-context'){
  if(!exact(input,['organizationId'])||!id(input.organizationId))return reply(400,{error:'invalid'});result=await store.invoke(actor,action,input);
 }else if(action==='end-membership'){
  if(!exact(input,['organizationId','membershipId','operationId','confirmed'])||!id(input.organizationId)||!id(input.membershipId)||!id(input.operationId)||input.confirmed!==true)return reply(400,{error:'invalid'});
  result=await store.invoke(actor,action,input);
 }else if(action==='begin-delete'){
  if(!exact(input,[]))return reply(400,{error:'invalid'});const raw=randomBytes(32).toString('base64url');
  result=await store.invoke(actor,action,{tokenHash:hash(raw),sessionHash:s.sessionKey,requestedAt:new Date(now()).toISOString()});cookies=[cookie(INTENT,raw,600)];
 }else if(action==='delete'){
  if(!tokenHash||!exact(input,['operationId','confirmed'])||!id(input.operationId)||input.confirmed!==true)return reply(400,{error:'invalid'});
  if(!Number.isSafeInteger(s.authenticatedAt)||s.authenticatedAt>now()||now()-s.authenticatedAt>300000)return reply(403,{error:'reauthentication-required'});
  result=await store.invoke(actor,action,{...input,tokenHash,sessionHash:s.sessionKey,authenticatedAt:new Date(s.authenticatedAt).toISOString()});await revokeSessions(actor);return reply(200,result,[cookie(SESSION),cookie(CHALLENGE)]);
 }else return reply(404,{error:'unavailable'});
 if(!await active())return reply(401,{error:'login'});return reply(200,result,cookies);
 }catch(e){return reply(e?.code==='42501'?403:e?.code==='23505'?409:e?.code==='22023'?400:503,{error:e?.code==='42501'?'denied':e?.code==='23505'?'conflict':e?.code==='22023'?'invalid':'unavailable'})}};
}
