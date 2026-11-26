import type {WorkerLabel} from './member-label';
import {isWorkerLocal} from './worker-enrollment';import type {ShiftData} from './timecards';
export type RateLine={shiftId:string;date:string;minutes:number;rateId:string|null;basis:'gross'|'net'|null;cents:number|null;effectiveOn:string|null;scope:string};
export type PaySource={kind:'internal'|'factory';sourceId:string;agencyId:string;siteId:string;dateFrom:string;dateTo:string;agencyName:string;siteName:string;workerKey:string;workerName:string;workerLabel?:WorkerLabel;paidMinutes:number;timeZone:'Europe/Warsaw';rows:{id:string;membershipId:string;revision:number;data:ShiftData}[]};
export type PayValues={mode:'saved-rates'|'gross-rate'|'gross-total'|'net-total';amountCents:number|null;knownNetCents:number|null;deductions:{name:string;cents:number}[];note:string};
export type PayCalculation=PayValues&{paidMinutes:number;grossCents:number;netCents:number;deductionCents:number;currency:'PLN';method:'actual-canonical-v1';rateSnapshot:RateLine[]};
export type PayDraft={id:string;agency_id:string;member_id:string;kind:'internal'|'factory';source_id:string;source:PaySource;source_sha256:string;rate_snapshot:RateLine[];assignee_id:string|null;calculation:PayCalculation|null;revision:number};
export type PayPublication={id:string;sha256:string;issued_at:string;delivery:'cabinet';notification:'disabled';document:{id:string;version:1;source:PaySource;sourceSha256:string;calculation:PayCalculation;checkedAt:string;issuedAt:string;notice:string}};
export type PayContext={organizationId:string;membershipId:string;role:'agency_admin'|'accountant'|'worker';notification:'disabled';settings:{enabled:boolean;auto_draft:boolean;revision:number}|null;workers:{id:string}[];accountants:{id:string}[];groups:{id:string;name:string}[];rates:{id:string;group_id:string|null;member_id:string|null;effective_on:string;basis:string;cents:number}[];groupAssignments:{group_id:string;member_id:string;effective_on:string}[];sources:PaySource[];drafts:PayDraft[];published:PayPublication[]};
export async function payslipsCall(org:string,action:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('unavailable');
 const r=await fetch('/api/payslips/'+org+'/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':r.status===409?'conflict':r.status===400?'invalid':'unavailable');
 if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');return r.json();
}
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export function parsePublication(v:unknown,org:string):PayPublication{const p=v as PayPublication,c=p?.document?.calculation,s=p?.document?.source;
 if(!p||!uuid(p.id)||p.document.id!==p.id||p.delivery!=='cabinet'||p.notification!=='disabled'||p.document.version!==1||!s||s.agencyId!==org||!uuid(s.workerKey)||!['internal','factory'].includes(s.kind)||!Array.isArray(s.rows)||!s.rows.length||s.rows.some(r=>r.membershipId!==s.workerKey)||!c||c.method!=='actual-canonical-v1'||c.currency!=='PLN'||!Number.isSafeInteger(c.netCents)||c.netCents<0||c.grossCents-c.deductionCents!==c.netCents||s.rows.reduce((n,r)=>n+r.data.paidMinutes,0)!==c.paidMinutes||s.paidMinutes!==c.paidMinutes||!Array.isArray(c.deductions)||c.deductions.reduce((n,d)=>n+d.cents,0)!==c.deductionCents)throw Error('unavailable');return p;
}
export function parsePayslips(v:unknown,org:string):PayContext{const c=v as PayContext;if(!c||c.organizationId!==org||!uuid(c.membershipId)||!['agency_admin','accountant','worker'].includes(c.role)||c.notification!=='disabled')throw Error('unavailable');
 for(const k of ['workers','accountants','groups','rates','groupAssignments','sources','drafts','published'] as const)if(!Array.isArray(c[k]))throw Error('unavailable');
 for(const p of c.published){parsePublication(p,org);if(c.role==='worker'&&p.document.source.workerKey!==c.membershipId)throw Error('unavailable')}
 for(const d of c.drafts)if(d.agency_id!==org||d.source.agencyId!==org||d.member_id!==d.source.workerKey||!Array.isArray(d.rate_snapshot)||c.role==='accountant'&&d.assignee_id!==c.membershipId)throw Error('unavailable');
 if(c.role!=='agency_admin'&&(c.settings||c.sources.length||c.groups.length||c.rates.length||c.workers.length||c.accountants.length||c.groupAssignments.length))throw Error('unavailable');
 if(c.role==='worker'&&c.drafts.length)throw Error('unavailable');return c;
}
export function cents(value:string):number|undefined{const s=value.trim().replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(s))return;const n=Math.round(Number(s)*100);return Number.isSafeInteger(n)&&n<=1000000000?n:undefined}
export function payPreview(minutes:number,rates:RateLine[],v:PayValues){if(v.deductions.some(d=>!Number.isSafeInteger(d.cents)||d.cents<0))return;const deductions=v.deductions.reduce((n,d)=>n+d.cents,0);let gross:number,net:number;
 if(v.mode==='saved-rates'){if(!rates.length||rates.some(r=>r.cents===null||!r.basis)||new Set(rates.map(r=>r.basis)).size!==1)return;const total=rates.reduce((n,r)=>n+Math.round(r.minutes*r.cents!/60),0);gross=rates[0].basis==='gross'?total:total+deductions;net=gross-deductions}
 else if(v.amountCents===null)return;
 else if(v.mode==='net-total'){net=v.amountCents;gross=net+deductions}
 else{gross=v.mode==='gross-rate'?Math.round(minutes*v.amountCents/60):v.amountCents;net=gross-deductions}
 if(gross<0||gross>1000000000||net<0||v.knownNetCents!==null&&v.knownNetCents!==net)return;return {grossCents:gross,netCents:net,deductionCents:deductions};
}
