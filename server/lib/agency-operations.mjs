import {createAgencyProfileHandler,createAgencyProfileStore,AGENCY_PROFILE_SIGNATURE,AGENCY_PROFILE_SQL} from './agency-profile.mjs';
import {INTEGRATED_LANES} from './integrated.contract.mjs';
import {createWorkspaceReadStore,WORKSPACE_SQL} from './workspace-read.server.mjs';
import {WORKSPACE_ROLE,WORKSPACE_FUNCTIONS} from './workspace-read.contract.mjs';
import {createWorkerProvisioning,WORKER_PROVISIONING_SIGNATURE,WORKER_PROVISIONING_ROLE,WORKER_PROVISIONING_SQL} from './worker-provisioning.mjs';
import {createWorkerEnrollmentHandler} from './worker-enrollment.server.mjs';
import {createWorkerInvitationMailer} from './worker-invitation-mail.mjs';
import {createWorkerTerms,WORKER_TERMS_ROLE,WORKER_TERMS_SIGNATURE,WORKER_TERMS_SQL} from './worker-terms.mjs';
import {createTimecardsHandler} from './timecards.server.mjs';
import {createFactoryTimecardsHandler} from './factory-timecards.server.mjs';
import {createPayslipsHandler} from './payslips.server.mjs';
import {createMemberNamesHandler} from './member-names.server.mjs';
import {createAccountHandler} from './worker-account.server.mjs';
import {createFactoryRegistrationHandler} from './factory-registration.server.mjs';
import {createPayNoticeHandler,createPayNoticeStore,payNoticeRoute,PAY_NOTICE_SIGNATURE,PAY_NOTICE_ROLE,PAY_NOTICE_SQL} from './pay-notices.server.mjs';
import {createPayEstimateHandler,createPayEstimateStore,payEstimateRoute,PAY_ESTIMATE_SIGNATURE,PAY_ESTIMATE_ROLE,PAY_ESTIMATE_SQL} from './pay-estimates.server.mjs';
import {createInboxHandler,createInboxStore,inboxRoute,INBOX_SIGNATURE,INBOX_ROLE,INBOX_SQL} from './inbox.server.mjs';
import {createTeamHandler,createTeamStore,TEAM_SQL,TEAM_FUNCTION} from './team-workflow.server.mjs';

const id='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const orgRoute=(prefix,actions)=>new RegExp('^/api/'+prefix+'/('+id+')/(?:'+actions+')$');
const specs={
 payNotices:{handler:createPayNoticeHandler,match:payNoticeRoute},
 estimates:{handler:createPayEstimateHandler,match:payEstimateRoute},
 inbox:{handler:createInboxHandler,match:inboxRoute},
 profile:{handler:createAgencyProfileHandler,match:new RegExp('^/api/agency-profile/('+id+')(?:/worksite/'+id+')?/(?:context|settings)$')},
 worker:{handler:createWorkerEnrollmentHandler,match:new RegExp('^/api/worker-enrollment/(?:agency/('+id+')(?:/(?:invite|approve|provision|directory|cards|send-invitation|joins))?|context|lookup|request|claim|email-invitations|accept-email-invitation|terms)$')},
 timecards:{handler:createTimecardsHandler,match:orgRoute('timecards','context|create|archive|backdated-list|backdated-read|earlier-list|earlier-approve|earlier-reject|(?:read|history)/'+id)},
 factoryTimecards:{handler:createFactoryTimecardsHandler,match:orgRoute('factory-timecards','context|create|correct|set-mode|propose-placement|approve-placement|revoke-placement|review|confirm|dispute|send|history|read/'+id)},
 payroll:{handler:createPayslipsHandler,match:orgRoute('payslips','context|settings|group|group-member|rate|create|assign|save|issue|read/'+id)},
 names:{handler:createMemberNamesHandler,match:orgRoute('member-names','context|set')},
 account:{handler:createAccountHandler,match:/^\/api\/personal-account\/(?:context|export|agency-context|end-membership)$/},
 registration:{handler:createFactoryRegistrationHandler,match:/^\/api\/factory-registration\/(?:context|submit|review|invite-worker|claim-worker|revoke-worker|invite-factory|claim-agency-invitation|revoke-agency-invitation|lookup-factory|prepare-factory|preview-factory-invitation|submit-invited-factory)$/},
 team:{handler:createTeamHandler,match:orgRoute('team','context|read|message|absence|schedule|update-plan|cancel|save-template|delete-template|invite-accountant|revoke-accountant')}
};
const agencyTeamActions=new Set(['context','read','message','invite-accountant','revoke-accountant']);
const workerTeamActions=new Set(['context','read','message','absence','update-plan','cancel','save-template','delete-template']);
const agencyFactoryActions=new Set(['context','propose-placement','revoke-placement']);
const leaderFactoryWrites=new Set(['create','correct','set-mode','review','send','history']);
const factoryChatActions=new Set(['context','read','message']);
const leaderTeamActions=new Set(['context','read','message','schedule','update-plan','cancel']);
function workerWorkspaceAction(name,pathname,method){
 // Factory create is separately checked in its RPC against the worker's own
 // active placement, connection and exact existing factory self-entry policy.
 if(method==='POST')return name==='timecards'&&pathname.endsWith('/create')||name==='factoryTimecards'&&/\/(create|confirm|dispute|history)$/.test(pathname);
 if(method!=='GET')return false;
 return name==='timecards'&&new RegExp('/(?:context|history/'+id+')$').test(pathname)
  ||['factoryTimecards','names'].includes(name)&&pathname.endsWith('/context')
  ||name==='payroll'&&new RegExp('/(?:context|read/'+id+')$').test(pathname);
}
const lanes=[{id:'payNotices',role:PAY_NOTICE_ROLE,functions:[{signature:PAY_NOTICE_SIGNATURE,owner:'postgres'}],statements:[PAY_NOTICE_SQL],create:createPayNoticeStore},
 {id:'estimates',role:PAY_ESTIMATE_ROLE,functions:[{signature:PAY_ESTIMATE_SIGNATURE,owner:'postgres'}],statements:[PAY_ESTIMATE_SQL],create:createPayEstimateStore},
 {id:'inbox',role:INBOX_ROLE,functions:[{signature:INBOX_SIGNATURE,owner:'postgres'}],statements:[INBOX_SQL],create:createInboxStore},...INTEGRATED_LANES.filter(l=>l.id!=='factory'),
 {id:'profile',role:'timeax_agency_profile_login',functions:[{signature:AGENCY_PROFILE_SIGNATURE,owner:'postgres'}],statements:[AGENCY_PROFILE_SQL],create:createAgencyProfileStore},
 {id:'team',role:'timeax_team_login',functions:[TEAM_FUNCTION],statements:[TEAM_SQL],create:createTeamStore}];
const key=v=>typeof v==='string'&&/^[-_A-Za-z0-9]{43,128}$/.test(v);
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export function managedAgencyOperations(env){
 try{
  const v=JSON.parse(env.TIMEAX_AGENCY_OPERATIONS??'null');
  if(!v||Array.isArray(v)||typeof v!=='object')return null;
  const workerPassword=env.TIMEAX_WORKER_CONNECTION_DB,workerSha=env.TIMEAX_WORKER_CONNECTION_RPC_SHA256;
  if(key(workerPassword)&&sha(workerSha))v.workerProvisioning={password:workerPassword,sha:workerSha};
  const termsPassword=env.TIMEAX_WORKER_TERMS_DB,termsSha=env.TIMEAX_WORKER_TERMS_RPC_SHA256;
  if(key(termsPassword)&&sha(termsSha))v.workerTerms={password:termsPassword,sha:termsSha};
  const profileFingerprint=env.TIMEAX_AGENCY_PROFILE_RPC_SHA256;
  if(sha(profileFingerprint)&&v.profile&&typeof v.profile==='object'&&!Array.isArray(v.profile))
   v.profile={...v.profile,hashes:{...v.profile.hashes,[AGENCY_PROFILE_SIGNATURE]:profileFingerprint}};
  const timecardsFingerprint=env.TIMEAX_AGENCY_TIMECARDS_RPC_SHA256;
  if(sha(timecardsFingerprint)&&v.timecards&&typeof v.timecards==='object'&&!Array.isArray(v.timecards))
   v.timecards={...v.timecards,hashes:{...v.timecards.hashes,['timeax_api.timecards(text,text,text,jsonb)']:timecardsFingerprint}};
  const factoryFingerprint=env.TIMEAX_FACTORY_TIMECARDS_RPC_SHA256;
  if(sha(factoryFingerprint)&&v.factoryTimecards&&typeof v.factoryTimecards==='object'&&!Array.isArray(v.factoryTimecards))
   v.factoryTimecards={...v.factoryTimecards,hashes:{...v.factoryTimecards.hashes,['timeax_api.factory_timecards(text,text,text,jsonb)']:factoryFingerprint}};
  const teamFingerprint=env.TIMEAX_AGENCY_TEAM_RPC_SHA256;
  if(sha(teamFingerprint)&&v.team&&typeof v.team==='object'&&!Array.isArray(v.team))
   v.team={...v.team,hashes:{...v.team.hashes,[TEAM_FUNCTION.signature]:teamFingerprint}};
  const registrationFingerprint=env.TIMEAX_FACTORY_REGISTRATION_RPC_SHA256;
  if(sha(registrationFingerprint)&&v.registration&&typeof v.registration==='object'&&!Array.isArray(v.registration))
   v.registration={...v.registration,hashes:{...v.registration.hashes,['timeax_api.factory_registration(text,text,text,jsonb)']:registrationFingerprint}};
  if(key(env.TIMEAX_INBOX_DB)&&sha(env.TIMEAX_INBOX_RPC_SHA256))v.inbox={password:env.TIMEAX_INBOX_DB,hashes:{[INBOX_SIGNATURE]:env.TIMEAX_INBOX_RPC_SHA256}};
  if(key(env.TIMEAX_PAY_ESTIMATE_DB)&&sha(env.TIMEAX_PAY_ESTIMATE_RPC_SHA256))v.estimates={password:env.TIMEAX_PAY_ESTIMATE_DB,hashes:{[PAY_ESTIMATE_SIGNATURE]:env.TIMEAX_PAY_ESTIMATE_RPC_SHA256}};
  if(key(env.TIMEAX_PAY_NOTICE_DB)&&sha(env.TIMEAX_PAY_NOTICE_RPC_SHA256))v.payNotices={password:env.TIMEAX_PAY_NOTICE_DB,hashes:{[PAY_NOTICE_SIGNATURE]:env.TIMEAX_PAY_NOTICE_RPC_SHA256}};
  return v;
 }catch{return null}
}
export async function assembleAgencyOperations(config,lane,{now=Date.now,sharedWorkspaceStore=null}={}){
 if(!config.agencyOperations||!config.selfService)return null;
 const common={host:config.host,ca:config.ca,namespace:'timeax_api'};
 const used=[config.password,config.agencyOnboardingPassword,config.workspaceReadPassword,config.agencyProductions?.password,config.accountAdmin?.password];
 const ready=(await Promise.all(lanes.map(async l=>{
  const entry=config.agencyOperations[l.id];
  if(!key(entry?.password)||used.includes(entry.password)||lanes.some(other=>other.id!==l.id&&config.agencyOperations[other.id]?.password===entry.password)
   ||l.id==='team'&&(!key(entry.inviteKey)||entry.inviteKey===entry.password)||!l.functions.every(fn=>entry.hashes&&sha(entry.hashes[fn.signature])))return null;
  try{
   const db=lane({...common,role:l.role,password:entry.password,functions:l.functions.map(fn=>({...fn,sha256:entry.hashes[fn.signature]})),statements:l.statements});
   await db.preflight();
   return [l.id,l.create(db),entry.inviteKey];
  }catch{return null}
 }))).filter(Boolean);
 if(!ready.length)return null;
 let workerTerms;
 const terms=config.agencyOperations.workerTerms;
 if(ready.some(([id])=>id==='worker')&&key(terms?.password)&&sha(terms?.sha)
  &&!used.includes(terms.password)&&!Object.entries(config.agencyOperations).some(([id,value])=>id!=='workerTerms'&&value?.password===terms.password)){
  try{
   const db=lane({...common,role:WORKER_TERMS_ROLE,password:terms.password,
    functions:[{signature:WORKER_TERMS_SIGNATURE,owner:'postgres',sha256:terms.sha}],statements:[WORKER_TERMS_SQL]});
   await db.preflight();
   workerTerms=createWorkerTerms(db);
  }catch{}
 }
 let provisioning;
 const extra=config.agencyOperations.workerProvisioning;
 if(ready.some(([id])=>id==='worker')&&key(extra?.password)&&sha(extra?.sha)
  &&!used.includes(extra.password)&&!Object.entries(config.agencyOperations).some(([id,value])=>id!=='workerProvisioning'&&value?.password===extra.password)){
  try{
   const db=lane({...common,role:WORKER_PROVISIONING_ROLE,password:extra.password,
    functions:[{signature:WORKER_PROVISIONING_SIGNATURE,owner:'postgres',sha256:extra.sha}],statements:[WORKER_PROVISIONING_SQL]});
   await db.preflight();
   provisioning=createWorkerProvisioning(db);
  }catch{}
 }
 const workerStore=ready.find(([id])=>id==='worker')?.[1];
 const workerPassword=workerStore&&workerTerms?async actor=>{
  const rows=await workerStore.call('context',actor),members=rows.length===1?rows[0].value?.memberships:null;
  // The provider's credential belongs to the person, so a worker-only route
  // must never change a password for an account with another active role.
  return Array.isArray(members)&&members.length>0&&members.every(m=>m?.role==='worker')&&await workerTerms.accepted(actor)===true;
 }:undefined;
 const access=sharedWorkspaceStore??createWorkspaceReadStore(lane({...common,role:WORKSPACE_ROLE,password:config.workspaceReadPassword,functions:WORKSPACE_FUNCTIONS,statements:[WORKSPACE_SQL]}));
 const invitationMailer=provisioning?createWorkerInvitationMailer():null;
 return resolveSession=>{
  const handlers=ready.map(([name,store,inviteKey])=>{
   const spec=specs[name];
   return [spec.match,spec.handler({origin:config.origin,now,store,inviteKey,provisioning:name==='worker'?provisioning:undefined,invitationMailer:name==='worker'?invitationMailer:undefined,workerTerms:name==='worker'?workerTerms:undefined,requireWorkerTerms:name==='worker',agencyOnly:spec.agencyOnly,personalReadOnly:name==='account',revokeSessions:async()=>{},
    resolveSession:async request=>{
     const session=await resolveSession(request);
     if(session.state!=='verified')return session;
     const pathname=new URL(request.url).pathname;
     const organization=spec.match.exec(pathname)?.[1];
     // These routes already lock and verify the exact agency administrator in their RPC.
     if(!organization||name==='worker')return session;
     const scope=await access.get(session,organization);
     const action=pathname.slice(pathname.lastIndexOf('/')+1);
     if(name==='payNotices')return scope?.organization.kind==='agency'&&scope.membership.role==='worker'&&await workerTerms?.accepted(session)===true&&await session.isActive()?
      {...session,workspaceRole:'worker',workspaceMembershipId:scope.membership.id}:{state:'anonymous'};
     if(name==='estimates')return scope?.organization.kind==='agency'&&scope.membership.role==='agency_admin'&&await session.isActive()?session:{state:'anonymous'};
     if(name==='inbox'){
      const role=scope?.membership.role;
      const allowed=scope?.organization.kind==='agency'?role==='agency_admin'||role==='worker'&&await workerTerms?.accepted(session)===true:
       scope?.organization.kind==='factory'&&(role==='factory_admin'||role==='team_leader'||role==='worker'&&await workerTerms?.accepted(session)===true);
      return allowed&&await session.isActive()?session:{state:'anonymous'};
     }
     if(scope?.organization.kind==='factory'){
      const role=scope.membership.role,method=request.method;
      const context=method==='GET'&&action==='context';
      const allowed=role==='factory_admin'&&(name==='factoryTimecards'&&(context||method==='GET'&&new RegExp('/read/'+id+'$').test(pathname)||method==='POST'&&['approve-placement','revoke-placement'].includes(action))
       ||name==='names'&&(context||method==='POST'&&action==='set')||name==='team'&&factoryChatActions.has(action))
       ||role==='team_leader'&&(name==='team'&&leaderTeamActions.has(action)||name==='names'&&context
        ||name==='factoryTimecards'&&(context||method==='GET'&&new RegExp('/read/'+id+'$').test(pathname)||method==='POST'&&leaderFactoryWrites.has(action)));
      const workerChat=role==='worker'&&name==='team'&&factoryChatActions.has(action)&&await workerTerms?.accepted(session)===true;
      return (allowed||workerChat)&&await session.isActive()?{...session,workspaceRole:role,workspaceMembershipId:scope.membership.id}:{state:'anonymous'};
     }
     if(scope?.organization.kind!=='agency')return {state:'anonymous'};
     if(scope.membership.role==='agency_admin')return (name!=='team'||agencyTeamActions.has(action))
      &&!(name==='timecards'&&action==='create')&&(name!=='factoryTimecards'||agencyFactoryActions.has(action)||request.method==='GET'&&new RegExp('/read/'+id+'$').test(pathname))
      &&await session.isActive()?session:{state:'anonymous'};
     if(scope.membership.role==='worker'&&(name==='team'?workerTeamActions.has(action):workerWorkspaceAction(name,pathname,request.method))
      &&await workerTerms?.accepted(session)===true&&await session.isActive())
       return {...session,workspaceRole:'worker',workspaceMembershipId:scope.membership.id,workspaceWorksites:scope.worksites.map(w=>w.id)};
     return {state:'anonymous'};
    }})];
  });
  return {enabled:[...ready.map(([name])=>name),...(provisioning?['workerProvisioning']:[]),...(workerTerms?['workerTerms']:[])],provisioning,workerPassword,workerSelfService:ready.some(([name])=>name==='worker'),find:path=>handlers.find(([match])=>match.test(path))?.[1]};
 };
}
