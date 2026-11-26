// Additive closed profile; SQL membership is the only source of organization permissions.
import {WORKER_SQL,createWorkerEnrollmentStore} from './worker-enrollment.server.mjs';
import {WORKSPACE_SQL} from './workspace-read.server.mjs';
import {FACTORY_SQL,createFactorySetupStore} from './factory-enrollment.server.mjs';
import {FACTORY_REGISTRATION_SQL,createFactoryRegistrationStore} from './factory-registration.server.mjs';
import {TIMECARDS_SQL,createTimecardsStore} from './timecards.server.mjs';
import {FACTORY_TIMECARDS_SQL,createFactoryTimecardsStore} from './factory-timecards.server.mjs';
import {PAYSLIPS_SQL,createPayslipsStore} from './payslips.server.mjs';
import {ACCOUNT_SQL,createAccountStore} from './worker-account.server.mjs';
import {MEMBER_NAMES_SQL,createMemberNamesStore} from './member-names.server.mjs';
export const INTEGRATED_PROFILE='integrated-closed-qa-v1';
export const INTEGRATED_SCOPE='reviewed-integrated-qa';
const fn=(name,args,owner)=>({signature:'timeax_api.'+name+'('+args+')',owner});
const workerFunctions=[
 fn('worker_enrollment_context','text,text','timeax_worker_nip_owner'),
 fn('find_worker_agency','text,text,text','timeax_worker_nip_owner'),
 fn('request_worker_agency','text,text,uuid,text','timeax_worker_nip_owner'),
 fn('claim_agency_worker_invite','text,text,text','postgres'),
 fn('issue_agency_worker_invite','text,text,uuid,integer','postgres'),
 fn('my_agency_worker_application','text,text,uuid','postgres'),
 fn('pending_agency_worker_applications','text,text,uuid,integer,timestampwithtimezone,uuid','postgres'),
 fn('approve_agency_worker_application','text,text,uuid,uuid','postgres'),
 fn('my_membership','text,text,uuid','postgres'),
 fn('my_worksites','text,text,uuid','postgres')
];
const lane=(id,role,owner,name,sql,storeKey,create)=>({id,role,functions:[fn(name,'text,text,text,jsonb',owner)],statements:[sql],storeKey,create});
export const INTEGRATED_LANES=Object.freeze([
 {id:'worker',role:'timeax_worker_enrollment_login',functions:workerFunctions,statements:[...Object.values(WORKER_SQL),WORKSPACE_SQL],storeKey:'workerEnrollmentStore',create:createWorkerEnrollmentStore},
 lane('factory','timeax_factory_setup_login','timeax_factory_setup_owner','factory_setup',FACTORY_SQL,'factorySetupStore',createFactorySetupStore),
 lane('registration','timeax_factory_registration_login','timeax_factory_registration_owner','factory_registration',FACTORY_REGISTRATION_SQL,'factoryRegistrationStore',createFactoryRegistrationStore),
 lane('timecards','timeax_timecards_login','timeax_timecards_owner','timecards',TIMECARDS_SQL,'timecardsStore',createTimecardsStore),
 lane('factoryTimecards','timeax_factory_timecards_login','timeax_factory_timecards_owner','factory_timecards',FACTORY_TIMECARDS_SQL,'factoryTimecardsStore',createFactoryTimecardsStore),
 lane('payroll','timeax_payroll_login','timeax_payroll_owner','payslips',PAYSLIPS_SQL,'payslipsStore',createPayslipsStore),
 lane('account','timeax_account_login','timeax_account_owner','account_lifecycle',ACCOUNT_SQL,'accountStore',createAccountStore),
 lane('names','timeax_member_names_login','timeax_member_names_owner','member_names',MEMBER_NAMES_SQL,'memberNamesStore',createMemberNamesStore)
]);
export const INTEGRATED_FUNCTIONS=Object.freeze(INTEGRATED_LANES.flatMap(v=>v.functions));
export function validateIntegratedContract(c){
 if(c?.version!==1||c.reviewed!==true||!Array.isArray(c.functions)||c.functions.length!==INTEGRATED_FUNCTIONS.length||!/^[a-f0-9]{64}$/.test(c.sqlManifestSha256??''))throw Error('Reviewed integrated contract required');
 const seen=new Set();
 for(const f of c.functions){
  const expected=INTEGRATED_FUNCTIONS.find(v=>v.signature===f.signature);
  if(!expected||seen.has(f.signature)||f.owner!==expected.owner||!/^[a-f0-9]{64}$/.test(f.sha256??''))throw Error('Integrated function review incomplete');
  seen.add(f.signature);
 }
 return c;
}
export function integratedEnabled(config){
 if(config.operations===undefined){if(config.hostedProfile?.id===INTEGRATED_PROFILE)throw Error('Integrated configuration missing');return false}
 if(config.hostedProfile?.id!==INTEGRATED_PROFILE||config.operations?.mode!=='reviewed-canonical-v1'||Object.keys(config.operations).length!==1||config.workspace?.mode!=='reviewed-readonly-v1')throw Error('Integrated profile denied');
 validateIntegratedContract(config.contract?.operations);return true;
}
export function createIntegratedStores(config,{laneFactory,common}){
 validateIntegratedContract(config.contract.operations);
 const passwords=INTEGRATED_LANES.map(l=>config.secrets[l.id+'Password']);
 const all=[config.secrets.webPassword,config.secrets.hookPassword,config.secrets.pendingPassword,config.secrets.workspacePassword,...passwords];
 if(passwords.some(p=>typeof p!=='string'||p.length<24||p.length>256||/[\u0000-\u0020]/.test(p))||new Set(all).size!==all.length)throw Error('Separate operational credentials required');
 const lanes=[],stores={};
 for(const spec of INTEGRATED_LANES){
  const lane=laneFactory({...common,role:spec.role,password:config.secrets[spec.id+'Password'],namespace:'timeax_api',functions:spec.functions.map(f=>config.contract.operations.functions.find(v=>v.signature===f.signature)),statements:spec.statements});
  lanes.push(lane);stores[spec.storeKey]=spec.create(lane);
 }
 return {stores,async preflight(){await Promise.all(lanes.map(lane=>lane.preflight()))}};
}
