import {ISSUER} from './provider-adapters.mjs';
import {shiftInput} from './timecards-input.mjs';
export const TIMECARDS_SQL='SELECT timeax_api.timecards($1::text,$2::text,$3::text,$4::jsonb) AS value';
export function createTimecardsStore(lane){if(typeof lane?.query!=='function')throw Error('Timecards lane required');return {async invoke(actor,action,input){const r=await lane.query(TIMECARDS_SQL,[actor.issuer,actor.subject,action,JSON.stringify(input)]);if(r.rows?.length!==1||!r.rows[0].value)throw Error('Invalid result');return r.rows[0].value}}}
const id=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const clean=x=>typeof x==='string'&&x.length>=2&&x.length<=500&&!/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(x);
const ownFields=['operationId','localDate','startTime','endTime','breakStatus','breakMinutes','breakTreatment','comment'];
export function assignedWorkerDraft(body,session){
 if(!exact(body,ownFields))return {};
 const sites=session.workspaceWorksites;
 if(!Array.isArray(sites)||sites.length!==1||!id(sites[0]))return {unassigned:true};
 const value=normalizeTimecard({...body,worksiteId:sites[0]});
 return {value};
}
export function normalizeTimecard(input,correction=false){
 const keys=['worksiteId','operationId','localDate','startTime','endTime','breakStatus','breakMinutes','breakTreatment','comment',...(correction?['id','revision','reason']:[])];
 if(!exact(input,keys)||!id(input.worksiteId)||!id(input.operationId)||correction&&(!id(input.id)||!Number.isInteger(input.revision)||input.revision<1||!clean(input.reason)))return;
 const {worksiteId,operationId,id:shiftId,revision,reason,...draft}=input;
 const normalized=shiftInput({...draft,employmentId:worksiteId,submissionId:operationId});if(!normalized)return;
 const {employmentId,submissionId,...data}=normalized;
 return {worksiteId,operationId,data:{...data,timeZone:'Europe/Warsaw'},...(correction?{id:shiftId,revision,reason:reason.trim()}:{})};
}
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createTimecardsHandler({origin,resolveSession,store=null,now=Date.now}){
 if(new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('HTTPS required');
 return async request=>{try{
  const u=new URL(request.url),m=u.pathname.match(/^\/api\/timecards\/([0-9a-f-]+)\/(context|create|correct|archive|read|history)(?:\/([0-9a-f-]+))?$/);
  if(u.origin!==origin||u.search||u.hash||!m||!id(m[1])||m[3]&&!id(m[3]))return reply(404,{error:'unavailable'});
  const [,organizationId,action,recordId]=m,write=['create','correct','archive'].includes(action);
  if(request.method!==(write?'POST':'GET')||(['read','history'].includes(action)?!recordId:!!recordId))return reply(405,{error:'unavailable'});
  const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((write?from!==origin:from!==null&&from!==origin)||(site!==null&&site!=='same-origin')||[...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return reply(403,{error:'denied'});
  if(!store)return reply(503,{error:'not-enabled'});
  const s=await resolveSession(request);
  const active=async()=>!request.signal.aborted&&s?.state==='verified'&&s.issuer===ISSUER&&typeof s.subject==='string'&&s.emailConfirmed===true&&s.isAnonymous===false&&s.expiresAt>now()&&typeof s.isActive==='function'&&await s.isActive()===true;
  if(!await active())return reply(s?.state==='unavailable'?503:401,{error:'login'});
  let value={};
  if(write){
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding')||!request.body)return reply(400,{error:'invalid'});
   const reader=request.body.getReader();let timer;
   try{let bytes=0,chunks=[];const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),2500)});
    for(;;){const r=await Promise.race([reader.read(),timeout]);if(r.done)break;bytes+=r.value.length;if(bytes>8192)return reply(400,{error:'invalid'});chunks.push(r.value)}
    const body=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));
    if(action==='archive'){
     if(!exact(body,['worksiteId','dateFrom','dateTo','confirmed'])||!id(body.worksiteId)||body.confirmed!==true||![body.dateFrom,body.dateTo].every(d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)))return reply(400,{error:'invalid'});
     value=body;
    }else if(s.workspaceRole==='worker'){
     if(action!=='create')return reply(403,{error:'denied'});
     const draft=assignedWorkerDraft(body,s);if(draft.unassigned)return reply(409,{error:'assignment-required'});
     if(!draft.value)return reply(400,{error:'invalid'});value=draft.value;
    }else{value=normalizeTimecard(body,action==='correct');if(!value)return reply(400,{error:'invalid'});}
   }finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
  }
  const actor={issuer:s.issuer,subject:s.subject};
  if(s.workspaceRole==='worker'&&action==='create'){
   // Fail closed if a previous DB version is still serving this route. The
   // new RPC checks the same mode again under lock when saving.
   const context=await store.invoke(actor,'context',{organizationId});
   if(context?.organizationId!==organizationId||context?.membershipId!==s.workspaceMembershipId||context.role!=='worker'
    ||!Array.isArray(context.worksites)||!context.worksites.some(w=>w?.id===value.worksiteId&&w?.manualEntry===true)||!await active())
     return reply(403,{error:'denied'});
  }
  let result;
  try {
   result=await store.invoke(actor,action,{...value,organizationId,...(recordId?{id:recordId}:{})});
  } catch(e) {
   // Translate only the known assignment guard after a verified worker create.
   // Other permission errors stay generic; no database diagnostics are sent.
   if(s.workspaceRole==='worker'&&action==='create'&&e?.code==='42501'&&e.message==='Active assignment required'&&await active())
    return reply(409,{error:'outside-assignment-period'});
   throw e;
  }
  if(!await active())return reply(401,{error:'login'});
  if(s.workspaceRole==='worker'&&action==='create'&&(!id(result?.id)||!Number.isSafeInteger(result?.revision)||result.revision<1||result?.saved!==true))return reply(503,{error:'unavailable'});
  return reply(200,result);
 }catch(e){const code=e?.code;return reply(code==='42501'?403:code==='23505'||code==='P0001'?409:['22023','22007','22008','23514'].includes(code)?400:503,{error:code==='P0001'?'period-closed':code==='23505'?'conflict':code==='42501'?'denied':['22023','22007','22008','23514'].includes(code)?'invalid':'unavailable'})}};
}
