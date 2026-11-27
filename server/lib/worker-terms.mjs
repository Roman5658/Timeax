const dateVersion=/^\d{4}-\d{2}-\d{2}$/;
export const WORKER_TERMS_VERSION='2026-11-27';
export const WORKER_TERMS_SHA256='fb3399d1d8a5a9334310091bc247b810e189bbd92a7b2b682be890c099f2559e';
export const WORKER_TERMS_ROLE='timeax_worker_terms_login';
export const WORKER_TERMS_SIGNATURE='timeax_api.worker_terms(text,text,text,text)';
export const WORKER_TERMS_SQL='SELECT timeax_api.worker_terms($1::text,$2::text,$3::text,$4::text) AS value';
export const WORKER_TERMS_METHOD='worker-terms-checkbox';
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});

function project(value){
 if(!value||typeof value.accepted!=='boolean'||value.version!==WORKER_TERMS_VERSION||value.documentSha256!==WORKER_TERMS_SHA256||
  (value.accepted?typeof value.acceptedAt!=='string'||!Number.isFinite(Date.parse(value.acceptedAt)):value.acceptedAt!==null))throw Error('Worker terms result unavailable');
 return {accepted:value.accepted,acceptedAt:value.acceptedAt,version:value.version,documentSha256:value.documentSha256};
}

export function createWorkerTerms(lane){
 if(typeof lane?.query!=='function')throw Error('Worker terms lane missing');
 async function read(action,actor,version=null){
  const {rows}=await lane.query(WORKER_TERMS_SQL,[action,actor.issuer,actor.subject,version]);
  if(rows?.length!==1)throw Error('Worker terms result unavailable');
  return project(rows[0].value);
 }
 return Object.freeze({
  async accepted(actor){return (await read('status',actor)).accepted},
  async handle(actor,mutate,body,active){
   if(mutate&&(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length!==2
    ||!Object.hasOwn(body,'version')||!Object.hasOwn(body,'accepted')||body.accepted!==true
    ||typeof body.version!=='string'||!dateVersion.test(body.version)))return reply(400,{error:'invalid-request'});
   if(mutate&&body.version!==WORKER_TERMS_VERSION)return reply(409,{error:'worker-terms-changed'});
   if(!await active())return reply(401,{error:'valid-session-required'});
   const value=await read(mutate?'accept':'status',actor,mutate?WORKER_TERMS_VERSION:null);
   if(!await active())return reply(401,{error:'valid-session-required'});
   if(mutate&&!value.accepted)return reply(503,{error:'worker-terms-unavailable'});
   return reply(200,value);
  },
 });
}
