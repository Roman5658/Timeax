import {ISSUER} from './provider-adapters.mjs';
import {normalizeTimecard} from './timecards.server.mjs';
export const FACTORY_TIMECARDS_SQL='SELECT timeax_api.factory_timecards($1::text,$2::text,$3::text,$4::jsonb) AS value';
export function createFactoryTimecardsStore(lane){if(typeof lane?.query!=='function')throw Error('Timecards lane required');return {async invoke(actor,action,input){const r=await lane.query(FACTORY_TIMECARDS_SQL,[actor.issuer,actor.subject,action,JSON.stringify(input)]);if(r.rows?.length!==1||!r.rows[0].value)throw Error('Invalid result');return r.rows[0].value}}}
const id=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const clean=x=>typeof x==='string'&&x.length>=2&&x.length<=500&&!/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(x);

const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createFactoryTimecardsHandler({origin,resolveSession,store=null,now=Date.now}){
 if(new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('HTTPS required');
 return async request=>{try{
  const u=new URL(request.url),m=u.pathname.match(/^\/api\/factory-timecards\/([0-9a-f-]+)\/(context|create|correct|set-mode|propose-placement|approve-placement|revoke-placement|review|confirm|dispute|send|read|history)(?:\/([0-9a-f-]+))?$/);
  if(u.origin!==origin||u.search||u.hash||!m||!id(m[1])||m[3]&&!id(m[3]))return reply(404,{error:'unavailable'});
  const [,organizationId,action,recordId]=m,write=!['context','read'].includes(action);
  if(request.method!==(write?'POST':'GET')||(action==='read'?!recordId:!!recordId))return reply(405,{error:'unavailable'});
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
    if(['create','correct'].includes(action)){
     if(!id(body.membershipId))return reply(400,{error:'invalid'});
     if(s.workspaceRole==='worker'&&(action!=='create'||body.membershipId!==s.workspaceMembershipId))return reply(403,{error:'denied'});
     const {membershipId,...draft}=body;const normalized=normalizeTimecard(draft,action==='correct');if(!normalized)return reply(400,{error:'invalid'});value={...normalized,membershipId};
    }else{
     const fields={
      'set-mode':['worksiteId','operationId','revision','mode'],
      'propose-placement':['worksiteId','operationId','membershipId','startsAt'],
      'approve-placement':['worksiteId','operationId','id','confirmed'],'revoke-placement':['worksiteId','operationId','id'],
      'review':['worksiteId','operationId','id','revision'],'confirm':['worksiteId','operationId','id','revision'],
      'dispute':['worksiteId','operationId','id','revision','note'],
      'send':['worksiteId','operationId','agencyId','dateFrom','dateTo','confirmed'],
      'history':['worksiteId','id']
     }[action];
     if(!fields||!exact(body,fields))return reply(400,{error:'invalid'});
     for(const key of fields){const v=body[key];if((key==='id'||key.endsWith('Id'))&&!id(v))return reply(400,{error:'invalid'});
      if(key==='revision'&&(!Number.isInteger(v)||v<(action==='set-mode'?0:1)))return reply(400,{error:'invalid'});
      if(key==='mode'&&!['self','attendance'].includes(v)||key==='confirmed'&&v!==true||key==='note'&&!clean(v))return reply(400,{error:'invalid'});
      if(['dateFrom','dateTo'].includes(key)&&(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)))return reply(400,{error:'invalid'});
      if(key==='startsAt'&&(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)||!Number.isFinite(Date.parse(v))))return reply(400,{error:'invalid'});
     }value=body;
    }
   }finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
  }
  const result=await store.invoke({issuer:s.issuer,subject:s.subject},action,{...value,organizationId,...(recordId?{id:recordId}:{})});
  if(!await active())return reply(401,{error:'login'});
  return reply(200,result);
 }catch(e){const code=e?.code;return reply(code==='42501'?403:code==='23505'||code==='P0001'||code==='P0002'?409:['22023','22007','22008','23514'].includes(code)?400:503,{error:code==='P0002'?'unresolved':code==='P0001'?'period-closed':code==='23505'?'conflict':code==='42501'?'denied':['22023','22007','22008','23514'].includes(code)?'invalid':'unavailable'})}};
}
