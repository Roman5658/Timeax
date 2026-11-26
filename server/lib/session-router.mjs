import {createTeamHandler} from './team-workflow.server.mjs';
import {createOwnerQaHandler} from './owner-qa.server.mjs';
import {createMemberNamesHandler} from './member-names.server.mjs';
import {createAccountHandler} from './worker-account.server.mjs';
import {createPayslipsHandler} from './payslips.server.mjs';
import {createFactoryTimecardsHandler} from './factory-timecards.server.mjs';
import {createFactoryRegistrationHandler} from './factory-registration.server.mjs';
import {createTimecardsHandler} from './timecards.server.mjs';
import {createFactorySetupHandler} from './factory-enrollment.server.mjs';
import {createHmac,randomBytes} from 'node:crypto';
import {readPendingIdentity} from '../wire/identity-only-pending.server.mjs';
import {createAgencyPendingHandler} from './agency-pending.server.mjs';
import {createWorkerAgencyRequestHandler} from './worker-agency-request.server.mjs';
import {createWorkerEnrollmentHandler} from './worker-enrollment.server.mjs';
import {ISSUER} from './provider-adapters.mjs';
const SESSION='__Host-timeax-pending-session',CHALLENGE='__Host-timeax-enrollment-challenge';
export const PERMIT_COOKIE='__Host-timeax-enrollment-permit';
const reply=(status,body,cookies=[])=>{
 const headers=new Headers({'Cache-Control':'no-store, private','Content-Type':'application/json',
  Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 for(const cookie of cookies)headers.append('Set-Cookie',cookie);
 return new Response(status===204?null:JSON.stringify(body),{status,headers});
};
const cookie=(name,id='',seconds=0)=>name+'='+id+'; Max-Age='+seconds+'; Path=/; HttpOnly; Secure; SameSite=Strict';
const getCookie=(request,name)=>{
 const value=request.headers.get('cookie');if(!value||value.length>16384)return null;
 const pieces=value.split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 return pieces.length===1?pieces[0].slice(name.length+1):null;
};
export async function readBody(request,limit){
 if(!request.body)return null;
 const type=request.headers.get('content-type');
 if(request.headers.has('content-encoding')||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(type??''))return null;
 const reader=request.body.getReader();let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),2500)});
 try{
  let size=0;const chunks=[];
  for(;;){const part=await Promise.race([reader.read(),timeout]);if(part.done)break;size+=part.value.byteLength;if(size>limit)return null;chunks.push(part.value)}
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
 }catch{return null}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});try{reader.releaseLock()}catch{}}
}
export function createSessionRouter({origin,wire=null,pendingStore=null,approval=null,recipient,routeKey,existingAuth=null,localWorkerJoinStore=null,localBillingFactory=null,localWorkspaceFactory=null,localConnectedFactory=null,workspaceReadFactory=null,workerEnrollmentStore=null,factorySetupStore=null,timecardsStore=null,factoryRegistrationStore=null,factoryTimecardsStore=null,payslipsStore=null,accountStore=null,memberNamesStore=null,ownerQaService=null,teamStore=null,otpLength=6,now=Date.now}){
 if(![6,8].includes(otpLength))throw Error("Unsupported OTP length");
 const otpPattern=new RegExp("^[0-9]{"+otpLength+"}$");
 const base=new URL(origin);if(base.origin!==origin||base.protocol!=='https:')throw Error('HTTPS origin required');
 if((localWorkerJoinStore||localBillingFactory||localWorkspaceFactory||localConnectedFactory)&&base.hostname!=='127.0.0.1')throw Error('Local adapters require loopback');
 const configured=wire&&pendingStore&&approval&&typeof recipient==='string'&&typeof routeKey==='string';
 const sessions=new Map(),challenges=new Map();
 if(existingAuth!==null&&['start','finish','readIdentity'].some(k=>typeof existingAuth[k]!=='function'))throw Error('Invalid existing-session adapter');
 const recipientTag=configured?createHmac('sha256',Buffer.from(routeKey,'base64url')).update(recipient.toLowerCase()).digest('hex'):null;
 async function ready(){
  if(!configured)return false;
  try{await approval.readiness({issuer:ISSUER,signal:AbortSignal.timeout(2500)});return true}catch{return false}
 }
 function purge(){for(const map of[sessions,challenges])for(const[k,v]of map)if(v.expiresAt<=now()||map===challenges&&v.sessionId&&!sessions.has(v.sessionId))map.delete(k)}
 const resolve=async request=>{
  if(!await ready())return {state:'unavailable'};
  const sid=getCookie(request,SESSION),s=sid?sessions.get(sid):null;
  if(!s||s.expiresAt<=now())return {state:'anonymous'};
  if(accountStore&&!await accountStore.allowed(s)){sessions.delete(sid);return {state:'anonymous'}}
  return {...s,sessionKey:createHmac('sha256',Buffer.from(routeKey,'base64url')).update('capability/'+sid).digest('hex'),state:'verified',registrationAllowed:true,isActive:async()=>sessions.get(sid)===s&&s.expiresAt>now()&&await ready()&&(!accountStore||await accountStore.allowed(s))};
 };
 const team=createTeamHandler({origin,resolveSession:resolve,store:teamStore,inviteKey:routeKey,now});
 const ownerQa=createOwnerQaHandler({origin,resolveSession:resolve,service:ownerQaService,now});
 const memberNames=createMemberNamesHandler({origin,store:memberNamesStore,resolveSession:resolve,now});
 const account=createAccountHandler({origin,store:accountStore,resolveSession:resolve,now,revokeSessions:async actor=>{for(const [id,s] of sessions)if(s.issuer===actor.issuer&&s.subject===actor.subject){sessions.delete(id);for(const [key,c] of challenges)if(c.sessionId===id)challenges.delete(key)}}});
 const workerEnrollment=createWorkerEnrollmentHandler({origin,store:workerEnrollmentStore,resolveSession:resolve,now});
 const timecards=createTimecardsHandler({origin,store:timecardsStore,resolveSession:resolve,now});
 const payslips=createPayslipsHandler({origin,store:payslipsStore,resolveSession:resolve,now});
 const factoryTimecards=createFactoryTimecardsHandler({origin,store:factoryTimecardsStore,resolveSession:resolve,now});
 const factoryRegistration=createFactoryRegistrationHandler({origin,store:factoryRegistrationStore,resolveSession:resolve,now});
 const factorySetup=createFactorySetupHandler({origin,store:factorySetupStore,resolveSession:resolve,now});
 const agency=createAgencyPendingHandler({origin,issuer:ISSUER,sessionResolver:resolve,store:pendingStore,now});
 const worker=createWorkerAgencyRequestHandler({sessionResolver:resolve,store:localWorkerJoinStore,now});
 const billing=localBillingFactory?localBillingFactory(resolve):null;
 const workspace=localWorkspaceFactory?localWorkspaceFactory(resolve):null;
 const connected=localConnectedFactory?localConnectedFactory(resolve):null;
 const workspaceRead=workspaceReadFactory?workspaceReadFactory(resolve):null;
 return async request=>{
  try{
   const url=new URL(request.url);purge();if(request.signal.aborted)return reply(400,{error:'invalid-request'});
   if(url.origin!==origin||url.username||url.password)return reply(403,{error:'not-permitted'});
   const path=url.pathname;
   // The billing document contract has one read-only download query; other routes remain query-free.
   const documentDownload=request.method==='GET'&&/^\/api\/billing\/documents\/[a-z]+$/.test(path)&&url.search==='?download=1';
   if(url.hash||url.search&&!documentDownload)return reply(404,{error:'not-found'});
   const existing=path==='/v1/session/existing-context'||path.startsWith('/api/timeax/auth/existing/');
   if(existing&&!existingAuth)return reply(404,{error:'not-found'});
   if(path==='/hooks/before-user-created'){
    if(request.method!=='POST')return reply(405,{error:{http_code:405,message:'Method denied'}});
    if(!await ready())return reply(503,{error:{http_code:503,message:'Enrollment unavailable'}});
    const raw=await readBody(request,20480);if(raw===null)return reply(400,{error:{http_code:400,message:'Invalid hook body'}});
    const r=await wire.authorizeCreation(raw,request.headers);
    return r.state==='creation-attempt-authorized'?reply(200,{}):reply(403,{error:{http_code:403,message:'Enrollment denied'}});
   }
   if(!['/v1/session/existing-context','/api/timeax/auth/existing/start','/api/timeax/auth/existing/verify','/v1/session/context','/api/agency-registration','/api/worker-agency-request','/api/timeax/auth/start','/api/timeax/auth/verify','/api/timeax/auth/logout'].includes(path)&&!path.startsWith('/api/billing/')&&!path.startsWith('/api/workspace/')&&!path.startsWith('/api/connected-factory/')&&!path.startsWith('/api/workspace-access/')&&!path.startsWith('/api/worker-enrollment/')&&!path.startsWith('/api/factory-setup/')&&!path.startsWith('/api/timecards/')&&!path.startsWith('/api/factory-registration/')&&!path.startsWith('/api/factory-timecards/')&&!path.startsWith('/api/payslips/')&&!path.startsWith('/api/personal-account/')&&!path.startsWith('/api/member-names/')&&!path.startsWith('/api/owner-qa/')&&!path.startsWith('/api/team/'))
    return reply(404,{error:'not-found'});
   const mutate=request.method==='POST',from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
   if((mutate?from!==origin:from!==null&&from!==origin)||(site!==null&&site!=='same-origin')
    ||[...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))
    return reply(403,{error:'not-permitted'});
   if(path.startsWith('/api/team/'))return team(request);
   if(path.startsWith('/api/owner-qa/'))return ownerQa(request);
   if(path.startsWith('/api/member-names/'))return memberNames(request);
   if(path.startsWith('/api/personal-account/'))return account(request);
   if(path.startsWith('/api/payslips/'))return payslips(request);
   if(path.startsWith('/api/factory-timecards/'))return factoryTimecards(request);
   if(path.startsWith('/api/factory-registration/'))return factoryRegistration(request);
   if(path.startsWith('/api/timecards/'))return timecards(request);
   if(path.startsWith('/api/factory-setup/'))return factorySetup(request);
   if(path.startsWith('/api/worker-enrollment/'))return workerEnrollment(request);
   if(path.startsWith('/api/workspace-access/'))return workspaceRead?workspaceRead(request):reply(503,{error:'workspace-not-enabled'});
   if(path.startsWith('/api/connected-factory/'))return connected?connected(request):reply(503,{error:'factory-not-enabled'});
   if(path.startsWith('/api/workspace/'))return workspace?workspace(request):reply(503,{error:'workspace-not-enabled'});
   if(path.startsWith('/api/billing/'))return billing?billing(request):reply(503,{error:'billing-not-enabled'});
   if(path==='/api/worker-agency-request')return worker(request);
   if(path==='/api/agency-registration')return agency(request);
   if(path==='/v1/session/context'||path==='/v1/session/existing-context'){
    if(request.method!=='GET')return reply(405,{error:'not-allowed'});
    if(!await ready())return reply(503,{error:'service-unavailable'});
    const s=await resolve(request);
    if(s.state==='verified')return reply(200,{version:1,state:'verified',verified:true,serverTime:new Date(now()).toISOString(),
     expiresAt:new Date(s.expiresAt).toISOString(),grants:[],capabilities:{login:false,verify:false,agencyRegistration:true,logout:true,...(localWorkerJoinStore?{workerAgencyRequest:true}:{})}});
    const currentChallenge=challenges.get(getCookie(request,CHALLENGE));
    const challenge=currentChallenge?.kind===(existing?'existing':'enrollment')?currentChallenge:null;
    const permit=approval.permit(getCookie(request,PERMIT_COOKIE),recipientTag);
    return reply(200,{version:1,state:challenge?'verification-required':'anonymous',...(otpLength===8?{otpLength}:{}),capabilities:{
     login:!!permit&&!challenge,verify:!!permit&&!!challenge,agencyRegistration:false,logout:false}});
   }
   if(request.method!=='POST')return reply(405,{error:'not-allowed'});
   const raw=await readBody(request,2048);let body;
   try{body=JSON.parse(raw)}catch{return reply(400,{error:'invalid-request'})}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'invalid-request'});
   if(path.endsWith('/logout')){
    if(Object.keys(body).length)return reply(400,{error:'invalid-request'});
    sessions.delete(getCookie(request,SESSION));challenges.delete(getCookie(request,CHALLENGE));
    return reply(204,null,[cookie(SESSION),cookie(CHALLENGE)]);
   }
   if(!await ready())return reply(503,{error:'service-unavailable'});
   const permit=approval.permit(getCookie(request,PERMIT_COOKIE),recipientTag);
   if(!permit)return reply(403,{error:'not-permitted'});
   const verifying=path.endsWith('/verify'),keys=verifying?['email','code']:['email'];
   if(Object.keys(body).length!==keys.length||keys.some(k=>!Object.hasOwn(body,k))||typeof body.email!=='string'
    ||body.email.length>254||verifying&&(typeof body.code!=='string'||!otpPattern.test(body.code)))return reply(400,{error:'invalid-request'});
   if(body.email.toLowerCase()!==recipient.toLowerCase())return reply(verifying?401:202,verifying?{error:'verification-failed'}:{status:'accepted'});
   if(!verifying){
    if(challenges.size>=1000)return reply(429,{error:'try-later'});
    const nonce=existing?'/existing/'+randomBytes(32).toString('base64url'):'';
    const proofId=createHmac('sha256',Buffer.from(routeKey,'base64url')).update('timeax/proof/'+permit.id+nonce).digest('base64url');
    const routeSecret=createHmac('sha256',Buffer.from(routeKey,'base64url')).update('timeax/route/'+permit.id+nonce).digest('base64url');
    const value={proofId,routeSecret,expiresAt:permit.expiresAt,permitId:permit.id,kind:existing?'existing':'enrollment'};
    const id=randomBytes(32).toString('base64url');challenges.set(id,value);
    await (existing?existingAuth:wire).start({proofId,routeSecret,expiresAt:value.expiresAt});
    return reply(202,{status:'accepted'},[cookie(CHALLENGE,id,Math.max(1,Math.floor((value.expiresAt-now())/1000)))]);
   }
   const cid=getCookie(request,CHALLENGE),challenge=challenges.get(cid);
   if(!challenge||challenge.kind!==(existing?'existing':'enrollment')||challenge.permitId!==permit.id||challenge.busy||challenge.expiresAt<=now())return reply(401,{error:'verification-failed'});
   challenge.busy=true;
   try{
    if(challenge.sessionId&&sessions.has(challenge.sessionId)){const current=sessions.get(challenge.sessionId);if(accountStore&&!await accountStore.allowed(current)){sessions.delete(challenge.sessionId);return reply(401,{error:'verification-failed'})}return reply(200,{status:'authenticated'},[cookie(SESSION,challenge.sessionId,Math.floor((current.expiresAt-now())/1000))]);}
    const receipt=await (existing?existingAuth:wire).finish({proofId:challenge.proofId,routeSecret:challenge.routeSecret,code:body.code});
    const identity=existing?existingAuth.readIdentity(receipt):readPendingIdentity(receipt);
    if(receipt.state!=='pending'||!identity||identity.issuer!==ISSUER||identity.expiresAt<=now()
     ||challenges.get(cid)!==challenge||request.signal.aborted)return reply(401,{error:'verification-failed'});
    if(accountStore&&!await accountStore.allowed(identity))return reply(401,{error:'verification-failed'});
    if(sessions.size>=1000)return reply(429,{error:'try-later'});
    const id=randomBytes(32).toString('base64url');sessions.set(id,identity);challenge.sessionId=id;
    return reply(200,{status:'authenticated'},[cookie(SESSION,id,Math.floor((identity.expiresAt-now())/1000))]);
   }finally{challenge.busy=false}
  }catch{return reply(503,{error:'service-unavailable'})}
 };
}
