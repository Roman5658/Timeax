import {ACCOUNT_ADMIN_ROUTE} from './account-admin.mjs';
import {createHash,randomBytes} from 'node:crypto';
import {SESSION_TTL_SECONDS} from './web-session-store.mjs';
import {createPublicEmailRoutes} from './public-email-routes.mjs';
import {createWorkerPasswordHandler,WORKER_PASSWORD_PATH} from './worker-password.server.mjs';
import {createAgencyOnboardingRoutes} from './agency-onboarding.server.mjs';
import {createPublicEmailProvider} from './public-email-provider.mjs';
import {createAgencyPendingHandler} from './agency-pending.server.mjs';
import {createScopedPgLane} from './scoped-pg.mjs';
import {createPendingStore,pendingStatements} from './pending-store.server.mjs';
import {ISSUER} from './provider-adapters.mjs';
const endpoint='/v1/session/timeax-email',logout='/api/timeax/auth/public/logout';
const ttl=900,workerPasswordProofMs=5*60_000;
const loopback=/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/;
const reply=(status,body,headers={})=>new Response(body===undefined?null:JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie',...headers}});
const idFrom=(request,name)=>{
 const value=request.headers.get('cookie')??'';
 if(value.length>8192)return null;
 const matching=value.split(';').map(p=>p.trim()).filter(p=>p.startsWith(name+'='));
 const id=matching.length===1?matching[0].slice(name.length+1):'';
 return /^[A-Za-z0-9_-]{43}$/.test(id)?id:null;
};
export function createLocalIdentityRuntime({origin,...options}){
 if(!loopback.test(origin))throw Error('The local listener must use a loopback origin');
 return createEmailIdentityRuntime({origin,...options,localLoopback:true,admitSend:()=>true,signupHook:null});
}
export function createEmailIdentityRuntime({origin,provider,pendingStore,otpLength,admitSend,signupHook,onboardingStore=null,workspaceFactory=null,accountAdminFactory=null,agencyProductionsFactory=null,agencyOperationsFactory=null,sessionStore=null,localLoopback=false,now=Date.now}){
 if(!localLoopback && (!['https://timeax.pl','https://www.timeax.pl'].includes(origin)||typeof signupHook?.handler!=='function'))
  throw Error('HTTPS Timeax signup must use the verified provider hook');
 const name=localLoopback?'timeax-loopback-email-identity':'__Host-timeax-email-identity';
 const cookieEnd='=; Max-Age=0; Path=/; '+(localLoopback?'':'Secure; ')+'HttpOnly; SameSite=Strict';
 const sessions=new Map(),removedSubjects=new Map(),workerProofs=new Map();
 function purge(){
  const current=now();
  for(const [id,proof] of workerProofs)if(proof.expiresAt<=current)workerProofs.delete(id);
  for(const [id,s] of sessions)if(s.expiresAt<=current)sessions.delete(id);
  for(const [subject,until] of removedSubjects)if(until<=current)removedSubjects.delete(subject);
 }
 const resolve=async request=>{
  purge();const id=idFrom(request,name),local=sessions.get(id),s=local??await sessionStore?.get(id);
  return id&&s&&s.expiresAt>now()&&!removedSubjects.has(s.subject)?{issuer:s.issuer,subject:s.subject,email:s.email,emailConfirmed:true,isAnonymous:false,expiresAt:s.expiresAt,
   state:'verified',sessionKey:createHash('sha256').update('timeax-hosted-session:nfc:v1:').update(id).digest('hex'),registrationAllowed:true,isActive:async()=>s.expiresAt>now()&&!removedSubjects.has(s.subject)&&(local?sessions.get(id)===s:(await sessionStore.get(id))?.subject===s.subject)}
   :{state:'anonymous'};
 };
 async function issueIdentitySession(identity,credential=null,prior=null){
  purge();if(removedSubjects.has(identity.subject))throw Error('Account no longer exists');
  const id=randomBytes(32).toString('base64url');
  const keepWorkerProof=()=>{
   if(prior)workerProofs.delete(prior);
   if(ops?.workerPassword&&credential&&['login','registration'].includes(identity.flow)&&workerProofs.size<1000)
    workerProofs.set(id,{credential,expiresAt:now()+workerPasswordProofMs,busy:false,used:false});
  };
  if(sessionStore&&['login','password'].includes(identity.flow)){
   if(prior&&!sessions.has(prior))await sessionStore.delete(prior);
   await sessionStore.put(id,identity);
   if(prior)sessions.delete(prior);
   keepWorkerProof();
   return {id,maxAge:SESSION_TTL_SECONDS};
  }
  if(sessions.size>=1000&&!sessions.has(prior))throw Error('Session capacity reached');
  if(prior){if(!sessions.has(prior))await sessionStore?.delete(prior);sessions.delete(prior)}
  sessions.set(id,{...identity,credential,expiresAt:now()+ttl*1000});keepWorkerProof();return {id,maxAge:ttl};
 }
 let ops;
 const auth=createPublicEmailRoutes({origin,provider,otpLength,tagKey:randomBytes(32),localLoopback,now,admitSend,
  retainPasswordSetup:onboardingStore!==null,retainWorkerPassword:()=>Boolean(ops?.workerPassword),maxSessionAge:sessionStore?SESSION_TTL_SECONDS:ttl,
  allowNewWorkerIdentity:email=>ops?.provisioning?.hasPending(email)??false,issueIdentitySession,readSessionId:request=>idFrom(request,name)
 });
 const onboarding=onboardingStore&&createAgencyOnboardingRoutes({origin,now,provider,store:onboardingStore,
  readSession:async request=>{purge();const id=idFrom(request,name);return sessions.get(id)??await sessionStore?.get(id)},
  issueSession:async (identity,request,completed=true)=>{
   const issued=await issueIdentitySession({...identity,flow:completed?'password':'password-setup'},null,idFrom(request,name));
   return name+'='+issued.id+'; Max-Age='+issued.maxAge+'; Path=/; '+(localLoopback?'':'Secure; ')+'HttpOnly; SameSite=Strict';
  },
  isActive:async(request,session)=>{const id=idFrom(request,name);if(session.expiresAt<=now()||request.signal.aborted||removedSubjects.has(session.subject))return false;
   const local=sessions.get(id);if(local)return local===session;
   const stored=await sessionStore?.get(id);return stored?.subject===session.subject&&!request.signal.aborted},
  rotateOnComplete:Boolean(sessionStore),isWorkerAccount:identity=>ops?.workerPassword?.(identity)??false,
 });
 const workspace=onboarding&&workspaceFactory?.(resolve);
 const productions=onboarding&&agencyProductionsFactory?.(resolve);
 ops=onboarding&&agencyOperationsFactory?.(resolve);
 const workerPassword=ops?.workerPassword&&createWorkerPasswordHandler({origin,now,provider,resolveSession:resolve,
  eligible:async identity=>await onboardingStore.get(identity)===null&&await ops.workerPassword(identity)===true,
  getProof:request=>workerProofs.get(idFrom(request,name))});
 const admin=accountAdminFactory?.(subject=>{
  removedSubjects.set(subject,now()+ttl*1000);
  for(const [id,proof] of workerProofs)if(proof.credential.subject===subject)workerProofs.delete(id);
  for(const [id,s] of sessions)if(s.issuer===ISSUER&&s.subject===subject)sessions.delete(id);
 });
 const agency=createAgencyPendingHandler({origin,issuer:ISSUER,sessionResolver:resolve,store:pendingStore,now,localLoopback,publicOrigin:!localLoopback});
 return {state:localLoopback?'local-email-auth':'public-email-auth',publicRegistrationEnabled:!!(onboarding&&workspace),async handler(request){
  const url=new URL(request.url),site=request.headers.get('sec-fetch-site'),from=request.headers.get('origin');
  if(!localLoopback&&url.pathname==='/hooks/before-user-created')return signupHook.handler(request);
  if(url.origin!==origin||url.search||url.hash||site!==null&&site!=='same-origin'||(request.method==='POST'?from!==origin:from!==null&&from!==origin))
   return reply(403,{error:'not-permitted'});
  const service=onboarding?{selfService:true,agencyProductions:Boolean(productions),...(ops?{agencyOperations:ops.enabled,workerSelfService:ops.workerSelfService===true,workerPassword:Boolean(workerPassword)}:{})}:{};
  if(url.pathname===endpoint){
   if(request.method!=='GET')return reply(405,{error:'not-allowed'});
   let s;try{s=await resolve(request)}catch{return reply(503,{error:'service-unavailable'})}
   if(s.state==='verified')return reply(200,{version:1,state:'verified',verified:true,...service,serverTime:new Date(now()).toISOString(),
    expiresAt:new Date(s.expiresAt).toISOString(),grants:[],capabilities:{login:false,verify:false,agencyRegistration:true,logout:true}});
   const emailChallengeFlow=auth.challengeFlow(request);
   return reply(200,{version:1,state:emailChallengeFlow?'verification-required':'anonymous',otpLength,...service,...(emailChallengeFlow?{emailChallengeFlow}:{}),
    capabilities:{login:true,verify:!!emailChallengeFlow,agencyRegistration:false,logout:false}});
  }
  if(url.pathname===logout){
   if(request.method!=='POST')return reply(405,{error:'not-allowed'});
   const id=idFrom(request,name);
   try{if(id&&!sessions.has(id))await sessionStore?.delete(id)}catch{return reply(503,{error:'service-unavailable'})}
   sessions.delete(id);workerProofs.delete(id);
   return reply(204,undefined,{'Set-Cookie':name+cookieEnd});
  }
  if(workerPassword&&url.pathname===WORKER_PASSWORD_PATH)return workerPassword(request);
  if(onboarding&&onboarding.matches(url.pathname))return onboarding.handler(request);
  if(workspace&&url.pathname.startsWith('/api/workspace-access/'))return workspace(request);
  if(productions&&url.pathname.startsWith('/api/factory-setup/'))return productions(request);
  const operational=ops?.find(url.pathname);
  if(operational)return operational(request);
  if(url.pathname===ACCOUNT_ADMIN_ROUTE)return admin?admin(request):reply(503,{error:'admin-not-configured'});
  if(url.pathname==='/api/agency-registration')return agency(request);
  if(url.pathname.startsWith('/api/timeax/auth/public/'))return auth(request);
  return reply(503,{error:'service-unavailable'});
 }};
}
const role='timeax_pending_registration_login';
export async function assembleLocalIdentityRuntime({origin,env=process.env}){
 const config={
  host:env.TIMEAX_LOCAL_DB_HOST, password:env.TIMEAX_LOCAL_PENDING_PASSWORD,ca:env.TIMEAX_LOCAL_DB_CA?.replaceAll('\\n','\n'),
  key:env.TIMEAX_LOCAL_SUPABASE_KEY??env.VITE_SUPABASE_PUBLISHABLE_KEY,otpLength:Number(env.TIMEAX_LOCAL_OTP_LENGTH??8),
  registrationSha:env.TIMEAX_LOCAL_REGISTRATION_SHA256,statusSha:env.TIMEAX_LOCAL_STATUS_SHA256
 };
 const pendingStore=await assembleScopedPendingStore(config);
 const provider=createPublicEmailProvider({publishableKey:config.key,otpLength:config.otpLength});
 return createLocalIdentityRuntime({origin,provider,pendingStore,otpLength:config.otpLength});
}
export async function assembleScopedPendingStore(config,{laneFactory=createScopedPgLane}={}){
 if(['host','password','ca','registrationSha','statusSha'].some(k=>typeof config[k]!=='string'||!config[k]))throw Error('Scoped registration config is incomplete');
 const statements=pendingStatements(role);
 const lane=laneFactory({host:config.host,password:config.password,ca:config.ca,role,namespace:'timeax_api',functions:[
  {signature:'timeax_api.request_agency_registration(text,text,text,text)',owner:'postgres',sha256:config.registrationSha},
  {signature:'timeax_api.my_agency_registration(text,text)',owner:'postgres',sha256:config.statusSha},
 ],statements:Object.values(statements)});
 await lane.preflight();
 return createPendingStore(lane,{role});
}
