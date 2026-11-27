import {ISSUER} from './provider-adapters.mjs';
import {createWorkspaceReadStore} from './workspace-read.server.mjs';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export const validNip=v=>typeof v==='string'&&/^[0-9]{10}$/.test(v)&&[6,5,7,2,3,4,5,6,7].reduce((n,w,i)=>n+w*Number(v[i]),0)%11===Number(v[9]);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export const WORKER_SQL=Object.freeze({
 context:'SELECT timeax_api.worker_enrollment_context($1::text,$2::text) AS value',
 lookup:'SELECT * FROM timeax_api.find_worker_agency($1::text,$2::text,$3::text)',
 request:'SELECT * FROM timeax_api.request_worker_agency($1::text,$2::text,$3::uuid,$4::text)',
 claim:'SELECT * FROM timeax_api.claim_agency_worker_invite($1::text,$2::text,$3::text)',
 invite:'SELECT * FROM timeax_api.issue_agency_worker_invite($1::text,$2::text,$3::uuid,$4::integer)',
 queue:'SELECT * FROM timeax_api.pending_agency_worker_applications($1::text,$2::text,$3::uuid,50::integer,NULL::timestamptz,NULL::uuid)',
 approve:'SELECT * FROM timeax_api.approve_agency_worker_application($1::text,$2::text,$3::uuid,$4::uuid)'
});
export function createWorkerEnrollmentStore(lane){
 if(typeof lane?.query!=='function')throw Error('Worker RPC lane missing');
 const call=async(key,actor,...args)=>{
  const run=()=>lane.query(WORKER_SQL[key],[actor.issuer,actor.subject,...args]);
  try{return (await run()).rows}catch(e){
   // A burst of cabinet reads can briefly saturate a scoped pool. Never retry a write.
   if(key!=='queue'||!['53300','57P03','08006','ECONNRESET','ETIMEDOUT'].includes(e?.code))throw e;
   await new Promise(resolve=>setTimeout(resolve,160));
   return (await run()).rows;
  }
 };
 return {call,workspace:createWorkspaceReadStore(lane)};
}
export function createWorkerEnrollmentHandler({origin,store=null,resolveSession,now=Date.now}){
 const base=new URL(origin);if(base.origin!==origin||base.protocol!=='https:'||typeof resolveSession!=='function')throw Error('Guarded worker dependencies required');
 return async request=>{
  try{
   const u=new URL(request.url),path=u.pathname,mutate=request.method==='POST';
   if(u.origin!==origin||u.search||u.hash||!path.startsWith('/api/worker-enrollment/'))return reply(404,{error:'not-found'});
   if(!['GET','POST'].includes(request.method))return reply(405,{error:'not-allowed'});
   const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
   if((mutate?from!==origin:from!==null&&from!==origin)||(site!==null&&site!=='same-origin')||[...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return reply(403,{error:'not-permitted'});
   if(!store)return reply(503,{error:'worker-not-enabled'});
   const s=await resolveSession(request),active=async()=>!request.signal.aborted&&s?.state==='verified'&&s.issuer===ISSUER&&typeof s.subject==='string'&&s.subject.length>0&&s.subject.length<=255&&s.emailConfirmed===true&&s.isAnonymous===false&&Number.isSafeInteger(s.expiresAt)&&s.expiresAt>now()&&typeof s.isActive==='function'&&await s.isActive()===true;
   if(s?.state==='unavailable')return reply(503,{error:'session-unavailable'});
   if(!await active())return reply(401,{error:'valid-session-required'});
   const actor={issuer:s.issuer,subject:s.subject};
   let body=null;
   if(mutate){
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding'))return reply(400,{error:'invalid-request'});
    const reader=request.body?.getReader();if(!reader)return reply(400,{error:'invalid-request'});
    let bytes=0,parts=[],timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('body-timeout')),2500)});try{for(;;){const r=await Promise.race([reader.read(),timeout]);if(r.done)break;bytes+=r.value.length;if(bytes>2048)return reply(400,{error:'invalid-request'});parts.push(r.value)}}finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
    try{body=JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{return reply(400,{error:'invalid-request'})}
   }
   let result;
   const agency=path.match(/^\/api\/worker-enrollment\/agency\/([0-9a-f-]+)(?:\/(invite|approve))?$/);
   const workspace=path.match(/^\/api\/worker-enrollment\/workspace\/([0-9a-f-]+)$/);
   if(path==='/api/worker-enrollment/context'&&!mutate){
    const rows=await store.call('context',actor);if(rows.length!==1||!Array.isArray(rows[0].value?.memberships)||!Array.isArray(rows[0].value?.applications))throw Error();
    result={state:'verified',...rows[0].value};
   }else if(path==='/api/worker-enrollment/lookup'&&mutate){
    if(!exact(body,['nip'])||!validNip(body.nip))return reply(400,{error:'invalid-nip'});
    const rows=await store.call('lookup',actor,body.nip);if(rows.length>1)throw Error();result={agency:rows[0]??null};
   }else if(path==='/api/worker-enrollment/request'&&mutate){
    if(!exact(body,['agencyId','nip'])||!uuid(body.agencyId)||!validNip(body.nip))return reply(400,{error:'invalid-request'});
    const rows=await store.call('request',actor,body.agencyId,body.nip);if(rows.length!==1||!uuid(rows[0].application_id))throw Error();result={application:rows[0]};
   }else if(path==='/api/worker-enrollment/claim'&&mutate){
    if(!exact(body,['code'])||typeof body.code!=='string'||!/^[0-9a-f]{64}$/.test(body.code))return reply(400,{error:'invalid-invitation'});
    const rows=await store.call('claim',actor,body.code);if(rows.length!==1||!uuid(rows[0].application_id))throw Error();result={application:rows[0]};
   }else if(agency&&uuid(agency[1])){
    if(!agency[2]&&!mutate){result={applications:await store.call('queue',actor,agency[1])};}
    else if(agency[2]==='invite'&&mutate&&exact(body,['minutes'])&&Number.isInteger(body.minutes)&&body.minutes>=5&&body.minutes<=10080){
     const rows=await store.call('invite',actor,agency[1],body.minutes);if(rows.length!==1||!/^[0-9a-f]{64}$/.test(rows[0].invite_code))throw Error();result={invitation:rows[0]};
    }else if(agency[2]==='approve'&&mutate&&exact(body,['applicationId'])&&uuid(body.applicationId)){
     const rows=await store.call('approve',actor,agency[1],body.applicationId);if(rows.length!==1||rows[0].status!=='approved')throw Error();result={application:rows[0]};
    }else return reply(400,{error:'invalid-request'});
   }else if(workspace&&!mutate&&uuid(workspace[1])){
    result=await store.workspace.get(actor,workspace[1]);if(!result)return reply(403,{error:'workspace-not-authorized'});
   }else return reply(404,{error:'not-found'});
   if(!await active())return reply(401,{error:'valid-session-required'});
   return reply(200,result);
  }catch(e){return reply(e?.code==='42501'?403:e?.code==='22023'?400:503,{error:e?.code==='42501'?'not-permitted':'worker-unavailable'})}
 };
}
