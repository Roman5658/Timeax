import {createPushSender,createPushService,PUSH_ROLE,PUSH_SIGNATURE,PUSH_SQL} from './web-push.server.mjs';
import {assembleAgencyOperations} from './agency-operations.mjs';
import {ACCOUNT_ADMIN_ROLE,ACCOUNT_ADMIN_SIGNATURE,ACCOUNT_ADMIN_SQL,createAccountAdminHandler} from './account-admin.mjs';
import {createFactorySetupHandler,createFactorySetupStore,FACTORY_SQL} from './factory-enrollment.server.mjs';
import {SESSION_ROLE,SESSION_RPC,SESSION_SQL,createWebSessionStore} from './web-session-store.mjs';
import {createScopedPgLane} from './scoped-pg.mjs';
import {createWorkspaceReadStore,createWorkspaceReadHandler,WORKSPACE_SQL} from './workspace-read.server.mjs';
import {WORKSPACE_ROLE,WORKSPACE_FUNCTIONS} from './workspace-read.contract.mjs';
import {createEmailIdentityRuntime,assembleScopedPendingStore} from './local-identity-runtime.mjs';
import {createPublicEmailProvider} from './public-email-provider.mjs';
import {createPublicSignupHook} from './public-signup-hook.mjs';
import {createProviderWebhookVerifier} from './provider-adapters.mjs';

// Explicit single-process profile. A separate hourly budget bounds aggregate
// email traffic alongside the per-recipient/minute and verification limits.
// Neither forwarded addresses nor browser-supplied identifiers are trusted.
export function createHourlySendBudget(limit,now=Date.now){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid hourly email budget');
 const admitted=[];
 return ()=>{
  const at=now();
  while(admitted.length&&admitted[0]+3_600_000<=at)admitted.shift();
  if(admitted.length>=limit)return false;
  admitted.push(at);return true;
 };
}

export async function assembleHostedEmailAuth(config,{fetchImpl=globalThis.fetch,laneFactory,now=Date.now,env=process.env}={}){
 if(config?.mode!=='public-email-v1'||config.instances!==1||
  !['https://timeax.pl','https://www.timeax.pl'].includes(config.origin))throw Error('Expected explicit canonical HTTPS email profile');
 if(!/^[a-f0-9]{64}$/.test(config.registrationSha??'')||!/^[a-f0-9]{64}$/.test(config.statusSha??''))
  throw Error('Pinned registration database definitions required');
 const admitSend=createHourlySendBudget(config.hourlyEmailBudget,now);
 const verifyWebhook=createProviderWebhookVerifier(config.webhookSecret);
 const signupHook=createPublicSignupHook({origin:config.origin,verifyWebhook,now});
 const provider=createPublicEmailProvider({publishableKey:config.key,otpLength:config.otpLength,
  signupIntent:signupHook.withRegistrationIntent},{fetchImpl,now});
 const pendingStore=await assembleScopedPendingStore(config,{laneFactory});
 const scoped=laneFactory??createScopedPgLane;
 let sessionStore=null;
 if(config.webSessions){
  const {password,sha}=config.webSessions;
  if([config.password,config.agencyOnboardingPassword,config.workspaceReadPassword,config.accountAdmin?.password,config.agencyProductions?.password,...Object.values(config.agencyOperations??{}).map(v=>v?.password)].includes(password))throw Error('Independent session credential required');
  const lane=scoped({host:config.host,ca:config.ca,role:SESSION_ROLE,password,namespace:'timeax_api',
   functions:[{signature:SESSION_RPC,owner:'postgres',sha256:sha}],statements:[SESSION_SQL]});
  await lane.preflight();
  sessionStore=createWebSessionStore(lane);
 }
 let onboardingStore=null,workspaceFactory=null,sharedWorkspaceStore=null,accountAdminFactory=null,agencyProductionsFactory=null;
 if(config.accountAdmin&&![config.password,config.agencyOnboardingPassword,config.workspaceReadPassword].includes(config.accountAdmin.password)){
  const {keySha,password,functionSha}=config.accountAdmin;
  const lane=scoped({host:config.host,ca:config.ca,role:ACCOUNT_ADMIN_ROLE,password,namespace:'timeax_api',
   functions:[{signature:ACCOUNT_ADMIN_SIGNATURE,owner:'postgres',sha256:functionSha}],statements:[ACCOUNT_ADMIN_SQL]});
  // A missing admin migration must never take normal login or registration down.
  if(await lane.preflight().then(()=>true,()=>false))accountAdminFactory=revoked=>createAccountAdminHandler({origin:config.origin,keySha,lane,revoked,now});
 }
 if(config.agencyProductions&&![config.password,config.agencyOnboardingPassword,config.workspaceReadPassword,config.accountAdmin?.password].includes(config.agencyProductions.password)){
  const {password,functionSha}=config.agencyProductions;
  const lane=scoped({host:config.host,ca:config.ca,role:'timeax_factory_setup_login',password,namespace:'timeax_api',
   functions:[{signature:'timeax_api.factory_setup(text,text,text,jsonb)',owner:'timeax_factory_setup_owner',sha256:functionSha}],statements:[FACTORY_SQL]});
  if(await lane.preflight().then(()=>true,()=>false))agencyProductionsFactory=resolveSession=>createFactorySetupHandler({origin:config.origin,resolveSession,
    store:createFactorySetupStore(lane),productionRoles:true,now});
 }
 if(config.selfService!==undefined){
  const credentials=[config.password,config.agencyOnboardingPassword,config.workspaceReadPassword];
  if(config.selfService?.mode!=='verified-email-agency-v1'||! /^[a-f0-9]{64}$/.test(config.selfService.functionSha??'')||
   credentials.some(p=>typeof p!=='string'||p.length<24)||new Set(credentials).size!==credentials.length)
   throw Error('Independent onboarding credentials required');
  const signature='timeax_api.self_service_agency(text,text,text,text)';
  const statement='SELECT timeax_api.self_service_agency($1::text,$2::text,$3::text,$4::text) AS organization_id';
  const createStatement="WITH receipt AS MATERIALIZED (SELECT set_config('timeax.registration_terms_version',$5::text,true) AS version) SELECT timeax_api.self_service_agency($1::text,$2::text,$3::text,$4::text) AS organization_id FROM receipt WHERE receipt.version=$5::text";
  const lane=scoped({host:config.host,ca:config.ca,role:'timeax_agency_onboarding_login',
   password:config.agencyOnboardingPassword,namespace:'timeax_api',functions:[{signature,owner:'postgres',sha256:config.selfService.functionSha}],statements:[statement,createStatement]});
  const workspaces=scoped({host:config.host,ca:config.ca,role:WORKSPACE_ROLE,password:config.workspaceReadPassword,
   namespace:'timeax_api',functions:WORKSPACE_FUNCTIONS,statements:[WORKSPACE_SQL]});
  await Promise.all([lane.preflight(),workspaces.preflight()]);
  async function read(identity,name=null,nip=null,termsVersion=null){
   const args=[identity.issuer,identity.subject,name,nip];
   const result=await (termsVersion?lane.query(createStatement,[...args,termsVersion]):lane.query(statement,args));
   if(result?.rows?.length!==1||!Object.hasOwn(result.rows[0],'organization_id'))throw Error('Workspace result unavailable');
   return result.rows[0].organization_id;
  }
  onboardingStore={get:identity=>read(identity),create:(identity,draft)=>read(identity,draft.agencyName,draft.nip,draft.termsVersion)};
  sharedWorkspaceStore=createWorkspaceReadStore(workspaces);
  workspaceFactory=resolveSession=>createWorkspaceReadHandler({origin:config.origin,store:sharedWorkspaceStore,resolveSession,now});
 }
 const agencyOperationsFactory=await assembleAgencyOperations(config,scoped,{now,sharedWorkspaceStore});
 let pushService;
 const password=env.TIMEAX_WEB_PUSH_DB,sha=env.TIMEAX_WEB_PUSH_RPC_SHA256,publicKey=env.TIMEAX_WEB_PUSH_PUBLIC_KEY,privateKey=env.TIMEAX_WEB_PUSH_PRIVATE_KEY;
 if(sessionStore&&/^[-_A-Za-z0-9]{43,128}$/.test(password??'')&&/^[a-f0-9]{64}$/.test(sha??'')&&
  ![config.password,config.agencyOnboardingPassword,config.workspaceReadPassword,config.webSessions?.password,config.accountAdmin?.password,config.agencyProductions?.password,...Object.values(config.agencyOperations??{}).map(v=>v?.password)].includes(password)){
  try{
   const send=createPushSender({publicKey,privateKey},fetchImpl);
   const db=scoped({host:config.host,ca:config.ca,role:PUSH_ROLE,password,namespace:'timeax_api',functions:[{signature:PUSH_SIGNATURE,owner:'postgres',sha256:sha}],statements:[PUSH_SQL]});
   await db.preflight();pushService=createPushService({origin:config.origin,lane:db,publicKey,send});
  }catch{}
 }
 return createEmailIdentityRuntime({origin:config.origin,provider,pendingStore,otpLength:config.otpLength,admitSend,signupHook,now,onboardingStore,workspaceFactory,accountAdminFactory,agencyProductionsFactory,agencyOperationsFactory,sessionStore,pushService});
}
