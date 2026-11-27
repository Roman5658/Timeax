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

export async function assembleHostedEmailAuth(config,{fetchImpl=globalThis.fetch,laneFactory,now=Date.now}={}){
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
 let onboardingStore=null,workspaceFactory=null;
 if(config.selfService!==undefined){
  const credentials=[config.password,config.agencyOnboardingPassword,config.workspaceReadPassword];
  if(config.selfService?.mode!=='verified-email-agency-v1'||! /^[a-f0-9]{64}$/.test(config.selfService.functionSha??'')||
   credentials.some(p=>typeof p!=='string'||p.length<24)||new Set(credentials).size!==credentials.length)
   throw Error('Independent onboarding credentials required');
  const signature='timeax_api.self_service_agency(text,text,text,text)';
  const statement='SELECT timeax_api.self_service_agency($1::text,$2::text,$3::text,$4::text) AS organization_id';
  const lane=scoped({host:config.host,ca:config.ca,role:'timeax_agency_onboarding_login',
   password:config.agencyOnboardingPassword,namespace:'timeax_api',functions:[{signature,owner:'postgres',sha256:config.selfService.functionSha}],statements:[statement]});
  const workspaces=scoped({host:config.host,ca:config.ca,role:WORKSPACE_ROLE,password:config.workspaceReadPassword,
   namespace:'timeax_api',functions:WORKSPACE_FUNCTIONS,statements:[WORKSPACE_SQL]});
  await Promise.all([lane.preflight(),workspaces.preflight()]);
  async function read(identity,name=null,nip=null){
   const result=await lane.query(statement,[identity.issuer,identity.subject,name,nip]);
   if(result?.rows?.length!==1||!Object.hasOwn(result.rows[0],'organization_id'))throw Error('Workspace result unavailable');
   return result.rows[0].organization_id;
  }
  onboardingStore={get:identity=>read(identity),create:(identity,draft)=>read(identity,draft.agencyName,draft.nip)};
  workspaceFactory=resolveSession=>createWorkspaceReadHandler({origin:config.origin,store:createWorkspaceReadStore(workspaces),resolveSession,now});
 }
 return createEmailIdentityRuntime({origin:config.origin,provider,pendingStore,otpLength:config.otpLength,admitSend,signupHook,now,onboardingStore,workspaceFactory});
}
