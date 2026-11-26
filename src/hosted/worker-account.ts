import {isWorkerLocal} from './worker-enrollment';
import {parsePublication,type PayPublication,type PaySource} from './payslips';
export type PersonalMembership={membershipId:string;organizationId:string;name:string;role:'worker';state:'active'|'revoked'|'ended';endedAt:string|null};
export type PersonalAccount={state:'active';identityId:string;memberships:PersonalMembership[];timecards:PaySource[];payslips:PayPublication[];exportVersion:1;deletionState:'none'|'reauthentication-required'|'ready-to-confirm'};
export async function accountCall(action:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('unavailable');
 const r=await fetch('/api/personal-account/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':r.status===409?'conflict':r.status===400?'invalid':r.status===429?'tryLater':'unavailable');
 if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');return r.json();
}
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export function parsePersonal(v:unknown):PersonalAccount{
 const c=v as PersonalAccount;if(c?.state!=='active'||!uuid(c.identityId)||c.exportVersion!==1||!Array.isArray(c.memberships)||!Array.isArray(c.timecards)||!Array.isArray(c.payslips)||!['none','reauthentication-required','ready-to-confirm'].includes(c.deletionState))throw Error('unavailable');
 for(const m of c.memberships)if(!uuid(m.membershipId)||!uuid(m.organizationId)||m.role!=='worker'||typeof m.name!=='string'||!['active','revoked','ended'].includes(m.state))throw Error('unavailable');
 const own=(s:PaySource)=>c.memberships.some(m=>m.membershipId===s.workerKey&&m.organizationId===s.agencyId);
 for(const s of c.timecards)if(!own(s)||!['internal','factory'].includes(s.kind)||!Array.isArray(s.rows)||!s.rows.length||s.rows.some(r=>r.membershipId!==s.workerKey)||s.rows.reduce((n,r)=>n+r.data.paidMinutes,0)!==s.paidMinutes)throw Error('unavailable');
 for(const p of c.payslips){parsePublication(p,p.document.source.agencyId);if(!own(p.document.source))throw Error('unavailable')}
 return c;
}
export function savePersonalExport(value:unknown){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='timeax-personal-documents.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
