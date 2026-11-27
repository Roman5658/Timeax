import {ISSUER} from './provider-adapters.mjs';
import {validNip} from './worker-enrollment.server.mjs';
export const FACTORY_SQL='SELECT timeax_api.factory_setup($1::text,$2::text,$3::text,$4::jsonb) AS value';
export function createFactorySetupStore(lane){if(typeof lane?.query!=='function')throw Error('Factory RPC lane missing');return {async invoke(actor,action,input){const r=await lane.query(FACTORY_SQL,[actor.issuer,actor.subject,action,JSON.stringify(input)]);if(r.rows?.length!==1||!r.rows[0].value||typeof r.rows[0].value!=='object')throw Error('Invalid factory result');return r.rows[0].value}}}
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const rosterFields={
 'factory-roster':['organizationId','worksiteId'],
 'factory-schedule':['organizationId','worksiteId','dateFrom','dateTo'],
 'factory-unit-save':['organizationId','worksiteId','id','revision','kind','name','departmentId','leaderId','workers'],
 'factory-unit-archive':['organizationId','worksiteId','id','revision'],
};
const day=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00.000Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
};
function validRoster(action,b){
 const keys=rosterFields[action];
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==keys.length||keys.some(k=>!Object.hasOwn(b,k))||!uuid(b.organizationId)||!uuid(b.worksiteId))return false;
 if(action==='factory-roster')return true;
 if(action==='factory-schedule')return day(b.dateFrom)&&day(b.dateTo)&&b.dateFrom<=b.dateTo&&(Date.parse(b.dateTo)-Date.parse(b.dateFrom))/86400000<=31;
 const revision=uuid(b.id)&&Number.isSafeInteger(b.revision)&&b.revision>=1&&b.revision<2_147_483_647;
 if(action==='factory-unit-archive')return revision;
 return (revision||b.id===null&&b.revision===null)&&['department','group'].includes(b.kind)&&typeof b.name==='string'&&b.name.trim().length>=1&&b.name.trim().length<=80&&!/[\p{Cc}]/u.test(b.name)
  &&(b.departmentId===null||b.kind==='group'&&uuid(b.departmentId))&&(b.leaderId===null||b.kind==='group'&&uuid(b.leaderId))
  &&Array.isArray(b.workers)&&b.workers.length<=200&&b.workers.every(uuid)&&new Set(b.workers).size===b.workers.length;
}
const fields={
 'create-site':['organizationId','name','operationId'],'assign-internal':['worksiteId','membershipId','startsAt'],
 'rename-site':['worksiteId','name'],'transfer-internal':['worksiteId','fromWorksiteId','membershipId','startsAt'],
 'request-connection':['worksiteId','agencyNip'],'approve-connection':['id','confirmed'],'decline-connection':['id'],
 'revoke-connection':['id'],'invite-leader':['worksiteId','startsAt'],'revoke-invitation':['id'],
 'claim-leader':['code'],'revoke-assignment':['worksiteId','membershipId']
};
const valid=(action,b)=>{
 const keys=fields[action];if(!keys||!b||Array.isArray(b)||typeof b!=='object'||Object.keys(b).length!==keys.length||keys.some(k=>!Object.hasOwn(b,k)))return false;
 for(const key of keys){
  const v=b[key];
  if((key==='id'||key.endsWith('Id'))&&!uuid(v))return false;
  if(key==='startsAt'&&(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))))return false;
  if(key==='agencyNip'&&!validNip(v))return false;
  if(key==='name'&&(typeof v!=='string'||v.trim().length<1||v.trim().length>120||/[\p{Cc}]/u.test(v)))return false;
  if(key==='confirmed'&&v!==true)return false;
  if(key==='code'&&(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v)))return false;
 }return true;
};
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createFactorySetupHandler({origin,resolveSession,store=null,agencyOnly=false,productionRoles=false,now=Date.now}){
 const base=new URL(origin);if(base.origin!==origin||base.protocol!=='https:'||typeof resolveSession!=='function')throw Error('Guarded factory dependencies required');
 return async request=>{
  try{
   const url=new URL(request.url),match=url.pathname.match(/^\/api\/factory-setup\/([a-z-]+)$/);
   if(url.origin!==origin||url.search||url.hash||!match)return reply(404,{error:'not-found'});
   const action=match[1],write=action!=='context';
   const rosterAction=Object.hasOwn(rosterFields,action);
   if(rosterAction&&!productionRoles)return reply(404,{error:'not-found'});
   if(agencyOnly&&!productionRoles&&!['context','create-site','approve-connection','decline-connection','revoke-connection','assign-internal','revoke-assignment','transfer-internal','rename-site'].includes(action))return reply(404,{error:'not-found'});
   if(productionRoles&&action!=='context'&&!rosterAction&&!Object.hasOwn(fields,action))return reply(404,{error:'not-found'});
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
    try{for(;;){const r=await Promise.race([reader.read(),timeout]);if(r.done)break;size+=r.value.length;if(size>(action==='factory-unit-save'?10_240:2048))return reply(400,{error:'invalid-request'});parts.push(r.value)}input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(parts)))}finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
    if(!(rosterAction?validRoster(action,input):valid(action,input))||!agencyOnly&&!productionRoles&&['transfer-internal','rename-site'].includes(action))return reply(400,{error:'invalid-request'});
   }
   const actor={issuer:s.issuer,subject:s.subject};
   let value;
   if(agencyOnly&&!productionRoles){
    const c=await store.invoke(actor,'context',{});
    const memberships=c.memberships.filter(m=>m.role==='agency_admin'&&m.kind==='agency');
    const scopes=new Set(memberships.map(m=>m.organizationId));
    const connections=c.connections.filter(v=>scopes.has(v.agencyId));
    const worksites=c.worksites.filter(w=>scopes.has(w.organizationId));
    const workers=c.workers.filter(w=>scopes.has(w.organizationId));
    const owned=worksites.filter(w=>w.ownerId===w.organizationId);
    const assignments=c.assignments.filter(a=>a.role==='worker'&&owned.some(w=>w.id===a.worksiteId&&w.organizationId===a.organizationId));
    if(action==='context')value={memberships,connections,worksites,workers,invitations:[],assignments};
    else{
     const site=owned.find(w=>w.id===input.worksiteId);
     const sameWorker=site&&workers.some(w=>w.id===input.membershipId&&w.organizationId===site.organizationId);
     const allowed=action==='create-site'?scopes.has(input.organizationId)
      :action==='rename-site'?!!site
      :action==='assign-internal'?!!sameWorker
      :action==='transfer-internal'?!!sameWorker&&owned.some(w=>w.id===input.fromWorksiteId&&w.organizationId===site.organizationId)
      :action==='revoke-assignment'?!!site&&assignments.some(a=>a.membershipId===input.membershipId&&a.worksiteId===site.id)
      :connections.some(v=>v.id===input.id);
     if(!allowed||!await active())return reply(403,{error:'not-permitted'});
     value=await store.invoke(actor,action,input);
    }
   }else value=await store.invoke(actor,action,input);
   if(!await active())return reply(401,{error:'valid-session-required'});
   return reply(200,value);
  }catch(e){if(e?.code==='23505')return reply(409,{error:'conflict'});return reply(e?.code==='42501'?403:e?.code==='22023'?400:503,{error:e?.code==='42501'?'not-permitted':'factory-unavailable'})}
 };
}
