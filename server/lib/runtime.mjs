import {TEAM_SQL,TEAM_FUNCTION,createTeamStore} from './team-workflow.server.mjs';
import {createOwnerQaLane} from './owner-qa-store.mjs';
import {INTEGRATED_PROFILE,INTEGRATED_SCOPE,integratedEnabled,createIntegratedStores} from './integrated.contract.mjs';
import {createReadinessDelivery} from './readiness-delivery.mjs';
import {createHmac} from 'node:crypto';
import {createHostedExistingLogin} from './existing-session.server.mjs';
import {createDeploymentApproval,privateAdmission} from './hosted-controls.mjs';
import {createEnrollmentSupabaseWire,EXPECTED_PROJECT} from '../wire/enrollment-supabase-wire.server.mjs';
import {createEnrollmentRpcStore,ENROLLMENT_SQL,ENROLLMENT_SIGNATURES} from './enrollment-rpc-store.mjs';
import {createProviderTransport,createProviderWebhookVerifier,createSignedApprovalReader,ISSUER} from './provider-adapters.mjs';
import {createScopedPgLane} from './scoped-pg.mjs';
import {createPendingStore,pendingStatements} from './pending-store.server.mjs';
import {createSessionRouter} from './session-router.mjs';
import {WORKSPACE_ROLE,WORKSPACE_PROFILE,WORKSPACE_FUNCTIONS} from './workspace-read.contract.mjs';
import {WORKSPACE_SQL,createWorkspaceReadStore,createWorkspaceReadHandler} from './workspace-read.server.mjs';
export async function assembleRuntime(config,{laneFactory=createScopedPgLane,fetchImpl=globalThis.fetch,readApproval,readDeploymentApproval,now=Date.now,localWorkerJoinStore=null}={}){
 const origin=config?.origin??'https://staging.invalid';
 if(config?.mode===undefined||config.mode==='closed')return {state:'closed',handler:createSessionRouter({origin})};
 if(config.mode!=='configured')throw Error('Unsupported runtime mode');
 // Supabase Email provider observed 2026-11-24: eight digits; retain six only for legacy local fixtures.
 const otpLength=config.hostedProfile?8:(config.otpLength??6);
 const operationsEnabled=integratedEnabled(config);
 const workspaceEnabled=config.workspace!==undefined;
 if(workspaceEnabled&&(config.workspace?.mode!=='reviewed-readonly-v1'||Object.keys(config.workspace).length!==1||![WORKSPACE_PROFILE,INTEGRATED_PROFILE].includes(config.hostedProfile?.id))||config.hostedProfile?.id===WORKSPACE_PROFILE&&!workspaceEnabled)throw Error('Explicit workspace profile required');
 const contract=config.contract;
 if(!contract||contract.reviewed!==true||!/^[0-9a-f]{64}$/.test(contract.sourceSha256??'')
  ||!Array.isArray(contract.functions)||!/^timeax_[a-z0-9_]+_login$/.test(contract.pendingRole??'')
  ||['timeax_enrollment_web_login','timeax_enrollment_hook_login'].includes(contract.pendingRole))throw Error('Reviewed hosted contract missing');
 const u=new URL(origin);
 if(u.origin!==origin||u.protocol!=='https:'||u.username||u.password||['timeax.pl','www.timeax.pl'].includes(u.hostname))throw Error('Isolated HTTPS origin required');
 const secrets=config.secrets;
 if(!secrets||new Set([secrets.webPassword,secrets.hookPassword,secrets.pendingPassword]).size!==3)throw Error('Separate DB credentials required');
 const pending=pendingStatements(contract.pendingRole);
 const pendingSigs=['timeax_api.request_agency_registration(text,text,text,text)','timeax_api.my_agency_registration(text,text)'];
 const select=names=>names.map(signature=>{const f=contract.functions.find(x=>x.signature===signature);if(!f)throw Error('Approved RPC definition missing');return f});
 if(contract.functions.length!==7)throw Error('Exactly five enrollment and two pending RPC definitions required');
 const common={host:config.poolerHost,ca:secrets.dbCA};
 const web=laneFactory({...common,role:'timeax_enrollment_web_login',password:secrets.webPassword,namespace:'timeax_enrollment_rpc',
  functions:select(ENROLLMENT_SIGNATURES.web),statements:[ENROLLMENT_SQL.reserve,ENROLLMENT_SQL.acknowledge,ENROLLMENT_SQL.takeAttempt,ENROLLMENT_SQL.finishIdentity]});
 const hook=laneFactory({...common,role:'timeax_enrollment_hook_login',password:secrets.hookPassword,namespace:'timeax_enrollment_rpc',
  functions:select(ENROLLMENT_SIGNATURES.hook),statements:[ENROLLMENT_SQL.consume]});
 const pendingLane=laneFactory({...common,role:contract.pendingRole,password:secrets.pendingPassword,namespace:'timeax_api',
  functions:select(pendingSigs),statements:[pending.register,pending.status]});
 let workspaceLane=null;
 if(workspaceEnabled){
  if(typeof secrets.workspacePassword!=='string'||[secrets.webPassword,secrets.hookPassword,secrets.pendingPassword].includes(secrets.workspacePassword))throw Error('Separate read-only credential required');
  workspaceLane=laneFactory({...common,role:WORKSPACE_ROLE,password:secrets.workspacePassword,namespace:'timeax_api',functions:WORKSPACE_FUNCTIONS,statements:[WORKSPACE_SQL]});
 }
 const operations=operationsEnabled?createIntegratedStores(config,{laneFactory,common}):null;
 let team=null;
 if(config.team!==undefined){
  const f=config.contract?.team,p=secrets.teamPassword;
  if(!operationsEnabled||config.team?.mode!=='reviewed-canonical-v1'||Object.keys(config.team).length!==1
   ||f?.signature!==TEAM_FUNCTION.signature||f?.owner!==TEAM_FUNCTION.owner||!/^[a-f0-9]{64}$/.test(f?.sha256??'')
   ||typeof p!=='string'||p.length<24||p.length>256||/[\u0000-\u0020]/.test(p)
   ||Object.entries(secrets).some(([k,v])=>k!=='teamPassword'&&k.endsWith('Password')&&v===p))throw Error('Reviewed separate team lane required');
  const lane=laneFactory({...common,role:'timeax_team_login',password:p,namespace:'timeax_api',functions:[f],statements:[TEAM_SQL]});
  team={store:createTeamStore(lane),preflight:()=>lane.preflight()};
 }

 if(config.owner!==undefined&&!operationsEnabled)throw Error('Owner requires reviewed integrated profile');
 const owner=createOwnerQaLane(config,{laneFactory,common,usedPasswords:Object.entries(secrets).filter(([k])=>k.endsWith('Password')&&k!=='ownerPassword').map(([,v])=>v)});
 // No mutation or provider call during preflight.
 await web.preflight();await hook.preflight();await pendingLane.preflight();if(workspaceLane)await workspaceLane.preflight();if(operations)await operations.preflight();if(owner)await owner.preflight();if(team)await team.preflight();
 const store=createEnrollmentRpcStore({web,hook,contract:contract.enrollmentResult});
 const signedApproval=createSignedApprovalReader({publicKeyPem:config.approvalPublicKeyPem,readinessPath:config.readinessPath,now,...(readApproval?{read:readApproval}:{})});
 const hosted=config.hostedProfile;
 if(hosted&&(!['agency-pending-single-process-v1',WORKSPACE_PROFILE,INTEGRATED_PROFILE].includes(hosted.id)||hosted.instances!==1||localWorkerJoinStore))throw Error('Closed single-process profile required');
 const deployment=hosted?createDeploymentApproval({databaseScope:operationsEnabled?INTEGRATED_SCOPE:workspaceEnabled?'reviewed-pending-and-workspace-read':'reviewed-pending-only',publicKeyPem:config.approvalPublicKeyPem,path:config.deploymentApprovalPath,origin,
  recipientTag:createHmac('sha256',Buffer.from(secrets.routeKey,'base64url')).update(config.recipient.toLowerCase()).digest('hex'),buildSha256:config.buildSha256,contractSha256:config.contractSha256,now,
  ...(readDeploymentApproval?{read:readDeploymentApproval}:{})}):null;
 if(config.readinessDelivery&&(!hosted||config.readinessDelivery.mode!=='signed-push-window-v1'||Object.keys(config.readinessDelivery).length!==1))throw Error('Readiness delivery profile denied');
 const delivery=config.readinessDelivery?createReadinessDelivery({databaseScope:operationsEnabled?INTEGRATED_SCOPE:workspaceEnabled?'reviewed-pending-and-workspace-read':'reviewed-pending-only',rootPublicKeyPem:config.approvalPublicKeyPem,now,binding:{issuer:ISSUER,origin,
  recipientTag:createHmac('sha256',Buffer.from(secrets.routeKey,'base64url')).update(config.recipient.toLowerCase()).digest('hex'),buildSha256:config.buildSha256,contractSha256:config.contractSha256}}):null;
 const readinessSource=delivery??signedApproval;
 const approval=deployment?{permit:signedApproval.permit,async readiness(input){await deployment(input.signal);await pendingLane.preflight();if(workspaceLane)await workspaceLane.preflight();if(operations)await operations.preflight();if(owner)await owner.preflight();if(team)await team.preflight();return readinessSource.readiness(input)}}:signedApproval;
 const transport=createProviderTransport({fetchImpl});
 const existingAuth=hosted?createHostedExistingLogin({mode:'reviewed-single-recipient-login',origin,recipient:config.recipient,routeKey:secrets.routeKey,publishableKey:config.publishableKey,sessionLifetimeMs:60000,otpLength},
  {transport,checkReadiness:approval.readiness,now}):null;
 const wire=createEnrollmentSupabaseWire({mode:'reviewed-enrollment-wire',projectRef:EXPECTED_PROJECT,issuer:ISSUER,
  recipient:config.recipient,intentKey:secrets.intentKey,routeKey:secrets.routeKey,publishableKey:config.publishableKey,timeoutMs:2500},{
  transport,otpLength,checkHookReadiness:approval.readiness,
  verifyProviderWebhook:createProviderWebhookVerifier(secrets.webhookSecret),enrollmentStore:store});
 const handler=createSessionRouter({origin,wire,pendingStore:createPendingStore(pendingLane,{role:contract.pendingRole}),
  approval,recipient:config.recipient,routeKey:secrets.routeKey,existingAuth,localWorkerJoinStore,otpLength,now,ownerQaService:owner?.service??null,teamStore:team?.store??null,...(operations?.stores??{}),
   workspaceReadFactory:workspaceLane?resolveSession=>createWorkspaceReadHandler({origin,store:createWorkspaceReadStore(workspaceLane),resolveSession,now}):null});
 const admitted=hosted?privateAdmission({handler,approval,origin,recipient:config.recipient,routeKey:secrets.routeKey,now}):handler;
 return {state:'configured-gated',handler:delivery?delivery.wrap(admitted):admitted,
  async preflight(){await web.preflight();await hook.preflight();await pendingLane.preflight();if(workspaceLane)await workspaceLane.preflight();if(operations)await operations.preflight();if(owner)await owner.preflight();if(team)await team.preflight();await approval.readiness({issuer:ISSUER,signal:AbortSignal.timeout(2500)});return true}};
}
