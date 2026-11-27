import {randomBytes} from 'node:crypto';
import {createPublicEmailRoutes} from './public-email-routes.mjs';
import {createAgencyOnboardingRoutes} from './agency-onboarding.server.mjs';
import {createPublicEmailProvider} from './public-email-provider.mjs';
import {createAgencyPendingHandler} from './agency-pending.server.mjs';
import {createScopedPgLane} from './scoped-pg.mjs';
import {createPendingStore,pendingStatements} from './pending-store.server.mjs';
import {ISSUER} from './provider-adapters.mjs';
const endpoint='/v1/session/timeax-email',logout='/api/timeax/auth/public/logout';
const ttl=900;
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
export function createEmailIdentityRuntime({origin,provider,pendingStore,otpLength,admitSend,signupHook,onboardingStore=null,workspaceFactory=null,localLoopback=false,now=Date.now}){
 if(!localLoopback && (!['https://timeax.pl','https://www.timeax.pl'].includes(origin)||typeof signupHook?.handler!=='function'))
  throw Error('HTTPS Timeax signup must use the verified provider hook');
 const name=localLoopback?'timeax-loopback-email-identity':'__Host-timeax-email-identity';
 const cookieEnd='=; Max-Age=0; Path=/; '+(localLoopback?'':'Secure; ')+'HttpOnly; SameSite=Strict';
 const sessions=new Map();
 function purge(){for(const [id,s] of sessions)if(s.expiresAt<=now())sessions.delete(id)}
 const resolve=async request=>{
  purge();const id=idFrom(request,name),s=sessions.get(id);
  return s?{issuer:s.issuer,subject:s.subject,emailConfirmed:true,isAnonymous:false,expiresAt:s.expiresAt,
   state:'verified',registrationAllowed:true,isActive:async()=>sessions.get(id)===s&&s.expiresAt>now()}
   :{state:'anonymous'};
 };
 function issueIdentitySession(identity,credential=null,prior=null){
  purge();if(sessions.size>=1000&&!sessions.has(prior))throw Error('Session capacity reached');
  if(prior)sessions.delete(prior);
  const id=randomBytes(32).toString('base64url');
  sessions.set(id,{...identity,credential,expiresAt:now()+ttl*1000});return {id,maxAge:ttl};
 }
 const auth=createPublicEmailRoutes({origin,provider,otpLength,tagKey:randomBytes(32),localLoopback,now,admitSend,
  retainPasswordSetup:onboardingStore!==null,issueIdentitySession,readSessionId:request=>idFrom(request,name)
 });
 const onboarding=onboardingStore&&createAgencyOnboardingRoutes({origin,now,provider,store:onboardingStore,
  readSession:request=>{purge();return sessions.get(idFrom(request,name))},
  issueSession:(identity,request)=>{
   const issued=issueIdentitySession({...identity,flow:'password'},null,idFrom(request,name));
   return name+'='+issued.id+'; Max-Age='+issued.maxAge+'; Path=/; '+(localLoopback?'':'Secure; ')+'HttpOnly; SameSite=Strict';
  },
  isActive:(request,session)=>sessions.get(idFrom(request,name))===session&&session.expiresAt>now()&&!request.signal.aborted,
 });
 const workspace=onboarding&&workspaceFactory?.(resolve);
 const agency=createAgencyPendingHandler({origin,issuer:ISSUER,sessionResolver:resolve,store:pendingStore,now,localLoopback,publicOrigin:!localLoopback});
 return {state:localLoopback?'local-email-auth':'public-email-auth',publicRegistrationEnabled:!!(onboarding&&workspace),async handler(request){
  const url=new URL(request.url),site=request.headers.get('sec-fetch-site'),from=request.headers.get('origin');
  if(!localLoopback&&url.pathname==='/hooks/before-user-created')return signupHook.handler(request);
  if(url.origin!==origin||url.search||url.hash||site!==null&&site!=='same-origin'||(request.method==='POST'?from!==origin:from!==null&&from!==origin))
   return reply(403,{error:'not-permitted'});
  const service=onboarding?{selfService:true}:{};
  if(url.pathname===endpoint){
   if(request.method!=='GET')return reply(405,{error:'not-allowed'});
   const s=await resolve(request);
   if(s.state==='verified')return reply(200,{version:1,state:'verified',verified:true,...service,serverTime:new Date(now()).toISOString(),
    expiresAt:new Date(s.expiresAt).toISOString(),grants:[],capabilities:{login:false,verify:false,agencyRegistration:true,logout:true}});
   return reply(200,{version:1,state:auth.hasChallenge(request)?'verification-required':'anonymous',otpLength,...service,
    capabilities:{login:true,verify:auth.hasChallenge(request),agencyRegistration:false,logout:false}});
  }
  if(url.pathname===logout){
   if(request.method!=='POST')return reply(405,{error:'not-allowed'});
   sessions.delete(idFrom(request,name));
   return reply(204,undefined,{'Set-Cookie':name+cookieEnd});
  }
  if(onboarding&&onboarding.matches(url.pathname))return onboarding.handler(request);
  if(workspace&&url.pathname.startsWith('/api/workspace-access/'))return workspace(request);
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
