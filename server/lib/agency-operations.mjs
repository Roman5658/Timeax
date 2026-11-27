import {createAgencyProfileHandler,createAgencyProfileStore,AGENCY_PROFILE_SIGNATURE,AGENCY_PROFILE_SQL} from './agency-profile.mjs';
import {INTEGRATED_LANES} from './integrated.contract.mjs';
import {createWorkspaceReadStore,WORKSPACE_SQL} from './workspace-read.server.mjs';
import {WORKSPACE_ROLE,WORKSPACE_FUNCTIONS} from './workspace-read.contract.mjs';
import {createWorkerEnrollmentHandler} from './worker-enrollment.server.mjs';
import {createTimecardsHandler} from './timecards.server.mjs';
import {createFactoryTimecardsHandler} from './factory-timecards.server.mjs';
import {createPayslipsHandler} from './payslips.server.mjs';
import {createMemberNamesHandler} from './member-names.server.mjs';
import {createAccountHandler} from './worker-account.server.mjs';
import {createFactoryRegistrationHandler} from './factory-registration.server.mjs';
import {createTeamHandler,createTeamStore,TEAM_SQL,TEAM_FUNCTION} from './team-workflow.server.mjs';

const id='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const orgRoute=(prefix,actions)=>new RegExp('^/api/'+prefix+'/('+id+')/(?:'+actions+')$');
const specs={
 profile:{handler:createAgencyProfileHandler,match:orgRoute('agency-profile','context|settings')},
 worker:{handler:createWorkerEnrollmentHandler,match:new RegExp('^/api/worker-enrollment/agency/('+id+')(?:/(?:invite|approve))?$')},
 timecards:{handler:createTimecardsHandler,match:orgRoute('timecards','context|archive|(?:read|history)/'+id)},
 factoryTimecards:{handler:createFactoryTimecardsHandler,match:orgRoute('factory-timecards','context|propose-placement|revoke-placement|read/'+id)},
 payroll:{handler:createPayslipsHandler,match:orgRoute('payslips','context|settings|group|group-member|rate|create|assign|save|issue|read/'+id)},
 names:{handler:createMemberNamesHandler,match:orgRoute('member-names','context|set')},
 account:{handler:createAccountHandler,match:/^\/api\/personal-account\/(?:agency-context|end-membership)$/},
 registration:{handler:createFactoryRegistrationHandler,match:/^\/api\/factory-registration\/(?:context|invite-factory|revoke-agency-invitation)$/,agencyOnly:true},
 team:{handler:createTeamHandler,match:orgRoute('team','context|read|message|invite-accountant|revoke-accountant')}
};
const lanes=[...INTEGRATED_LANES.filter(l=>l.id!=='factory'),
 {id:'profile',role:'timeax_agency_profile_login',functions:[{signature:AGENCY_PROFILE_SIGNATURE,owner:'postgres'}],statements:[AGENCY_PROFILE_SQL],create:createAgencyProfileStore},
 {id:'team',role:'timeax_team_login',functions:[TEAM_FUNCTION],statements:[TEAM_SQL],create:createTeamStore}];
const key=v=>typeof v==='string'&&/^[-_A-Za-z0-9]{43,128}$/.test(v);
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export function managedAgencyOperations(env){
 try{
  const v=JSON.parse(env.TIMEAX_AGENCY_OPERATIONS??'null');
  if(!v||Array.isArray(v)||typeof v!=='object')return null;
  const teamFingerprint=env.TIMEAX_AGENCY_TEAM_RPC_SHA256;
  if(sha(teamFingerprint)&&v.team&&typeof v.team==='object'&&!Array.isArray(v.team))
   v.team={...v.team,hashes:{...v.team.hashes,[TEAM_FUNCTION.signature]:teamFingerprint}};
  return v;
 }catch{return null}
}
export async function assembleAgencyOperations(config,lane,{now=Date.now}={}){
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
 const access=createWorkspaceReadStore(lane({...common,role:WORKSPACE_ROLE,password:config.workspaceReadPassword,functions:WORKSPACE_FUNCTIONS,statements:[WORKSPACE_SQL]}));
 return resolveSession=>{
  const handlers=ready.map(([name,store,inviteKey])=>{
   const spec=specs[name];
   return [spec.match,spec.handler({origin:config.origin,now,store,inviteKey,agencyOnly:spec.agencyOnly,revokeSessions:async()=>{},
    resolveSession:async request=>{
     const session=await resolveSession(request);
     if(session.state!=='verified')return session;
     const organization=spec.match.exec(new URL(request.url).pathname)?.[1];
     // These routes already lock and verify the exact agency administrator in their RPC.
     if(!organization||name==='worker')return session;
     const scope=await access.get(session,organization);
     return scope?.organization.kind==='agency'&&scope.membership.role==='agency_admin'&&await session.isActive()?session:{state:'anonymous'};
    }})];
  });
  return {enabled:ready.map(([name])=>name),find:path=>handlers.find(([match])=>match.test(path))?.[1]};
 };
}
