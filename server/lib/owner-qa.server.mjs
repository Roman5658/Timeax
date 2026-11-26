// Owner authority is resolved in SQL from the verified session's immutable issuer+subject.
import {ISSUER} from './provider-adapters.mjs';
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
async function input(r){
 if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(r.headers.get('content-type')??'')||r.headers.has('content-encoding')||!r.body)return null;
 const reader=r.body.getReader();let size=0,parts=[],timer;
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),2500)});
  for(;;){const v=await Promise.race([reader.read(),timeout]);if(v.done)break;size+=v.value.byteLength;if(size>2048)return null;parts.push(v.value)}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,size)));
 }catch{return null}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock()}
}
export function createOwnerQaHandler({origin,resolveSession,service=null,now=Date.now}){
 return async r=>{try{
  const u=new URL(r.url),action=u.pathname.slice('/api/owner-qa/'.length);
  if(u.origin!==origin||u.search||u.hash||!u.pathname.startsWith('/api/owner-qa/')||!['context','preview','cleanup'].includes(action)
   ||r.method!==(action==='context'?'GET':'POST'))return reply(404,{error:'unavailable'});
  if(!service)return reply(action==='context'?503:404,{error:'owner-not-configured',cleanupEnabled:false});
  if(service.version!=='reviewed-owner-qa-v2'||typeof service.execute!=='function')return reply(503,{error:'owner-not-configured',cleanupEnabled:false});
  if((r.method==='POST'&&r.headers.get('origin')!==origin)||(r.headers.has('sec-fetch-site')&&r.headers.get('sec-fetch-site')!=='same-origin'))return reply(403,{error:'denied'});
  const s=await resolveSession(r);
  if(s?.state!=='verified'||s.issuer!==ISSUER||typeof s.subject!=='string'||!s.subject||s.emailConfirmed!==true||s.isAnonymous!==false
   ||!Number.isFinite(s.expiresAt)||s.expiresAt<=now()||typeof s.isActive!=='function'||!await s.isActive())return reply(401,{error:'login'});
  let value={};
  if(action!=='context'){
   value=await input(r);
   const keys=action==='preview'?['id']:['previewId','confirmation'];
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))
    ||!uuid(value[action==='preview'?'id':'previewId'])||action==='cleanup'&&value.confirmation!=='END QA MEMBERSHIP')return reply(400,{error:'confirmation-required'});
   if(!Number.isFinite(s.authenticatedAt)||now()-s.authenticatedAt>300000||s.authenticatedAt>now())return reply(401,{error:'reauthenticate'});
  }
  // Same resolver as the other canonical lanes; no client email/role/subject is forwarded.
  const result=await service.execute({issuer:s.issuer,subject:s.subject},action,value);
  if(!await s.isActive())return reply(401,{error:'login'});
  if(action==='context'){
   if(result?.state!=='owner'||result.cleanupMode!=='end-marked-worker-membership'||!Array.isArray(result.accounts)||result.accounts.length>100)throw Error('Invalid context');
   const accounts=result.accounts.map(x=>{if(!uuid(x.id)||typeof x.label!=='string'||x.label.length>80||typeof x.organizationLabel!=='string'||x.organizationLabel.length>80||!['active','revoked','suspended'].includes(x.state))throw Error();return {id:x.id,label:x.label,organizationLabel:x.organizationLabel,state:x.state}});
   return reply(200,{state:'owner',qaScope:result.qaScope,accounts,cleanupEnabled:true,cleanupMode:result.cleanupMode});
  }
  if(action==='preview'){
   if(!uuid(result?.previewId)||!uuid(result?.id)||typeof result.label!=='string'||typeof result.organizationLabel!=='string'||!Number.isFinite(Date.parse(result.expiresAt)))throw Error();
   return reply(200,{previewId:result.previewId,id:result.id,label:result.label,organizationLabel:result.organizationLabel,expiresAt:result.expiresAt,
    assignments:result.assignments,preserves:['personal-account','other-memberships','issued-documents'],confirmation:'END QA MEMBERSHIP'});
  }
  if(result?.state!=='ended'||!uuid(result.receiptId))throw Error();
  return reply(200,{state:'ended',receiptId:result.receiptId,providerIdentityDeleted:false,documentsPreserved:true});
 }catch(e){return reply(e.code==='42501'?403:e.code==='22023'?400:['23505','55000'].includes(e.code)?409:503,{error:e.code==='42501'?'denied':e.code==='55000'?'preview-expired-or-changed':'unavailable'})}};
}
