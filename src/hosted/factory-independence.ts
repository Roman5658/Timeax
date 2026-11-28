import {isWorkerLocal} from './worker-enrollment';
export type FactoryRequest={id:string;name:string;nip:string;siteName:string;address?:string|null;state:'pending'|'approved'|'rejected';organizationId:string|null;worksiteId:string|null;createdAt:string};
export type FactoryIndependenceContext={reviewer:boolean;requests:FactoryRequest[];workerInvitations:{id:string;factoryId:string;worksiteId:string;membershipId:string|null;startsAt:string;state:string}[];agencyInvitations:{id:string;agencyId:string;factoryNip:string;state:string}[]};
export function parseFactoryLookup(v:unknown):{state:'new'}|{state:'registered';name:string;address:string|null}{
 const r=v as {state?:unknown;name?:unknown;address?:unknown}|null;
 if(r?.state==='new')return {state:'new'};
 if(r?.state==='registered'&&typeof r.name==='string'&&(r.address===null||typeof r.address==='string'))return {state:'registered',name:r.name,address:r.address};
 throw Error('unavailable');
}
export function parseFactoryInvitation(v:unknown){
 const r=v as {code?:string;expiresAt?:string}|null;
 if(!r||typeof r.code!=='string'||!/^[0-9a-f]{64}$/.test(r.code)||typeof r.expiresAt!=='string'||!Number.isFinite(Date.parse(r.expiresAt)))throw Error('unavailable');
 return {code:r.code,expiresAt:r.expiresAt};
}
export function parseFactoryPreview(v:unknown):{state:'legacy'}|{state:'new';name:string;nip:string;address:string}|{state:'registered';name:string;organizationId:string|null}{
 const r=v as {state?:unknown;name?:unknown;nip?:unknown;address?:unknown;organizationId?:unknown}|null;
 if(r?.state==='legacy')return {state:'legacy'};
 if(typeof r?.name==='string'&&r.state==='new'&&typeof r.nip==='string'&&/^\d{10}$/.test(r.nip)&&typeof r.address==='string')return {state:'new',name:r.name,nip:r.nip,address:r.address};
 if(typeof r?.name==='string'&&r.state==='registered'&&(r.organizationId===null||typeof r.organizationId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(r.organizationId)))return {state:'registered',name:r.name,organizationId:r.organizationId};
 throw Error('unavailable');
}
export async function independenceCall(action:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('unavailable');
 const r=await fetch('/api/factory-registration/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':r.status===400?'invalid':'unavailable');
 if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');return r.json();
}
export function parseIndependence(v:unknown):FactoryIndependenceContext{
 const c=v as FactoryIndependenceContext,id=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(s);
 if(!c||typeof c.reviewer!=='boolean'||!Array.isArray(c.requests)||!Array.isArray(c.workerInvitations)||!Array.isArray(c.agencyInvitations))throw Error('unavailable');
 for(const r of c.requests)if(!id(r.id)||typeof r.name!=='string'||typeof r.siteName!=='string'||!/^\d{10}$/.test(r.nip)||!['pending','approved','rejected'].includes(r.state)||!Number.isFinite(Date.parse(r.createdAt))||(r.state==='approved'?(!id(r.organizationId)||!id(r.worksiteId)):(r.organizationId!==null||r.worksiteId!==null)))throw Error('unavailable');
 for(const r of c.workerInvitations)if(!id(r.id)||!id(r.factoryId)||!id(r.worksiteId)||!['pending','claimed','revoked','expired'].includes(r.state)||!Number.isFinite(Date.parse(r.startsAt)))throw Error('unavailable');
 for(const r of c.agencyInvitations)if(!id(r.id)||!id(r.agencyId)||!/^\d{10}$/.test(r.factoryNip)||!['pending','claimed','revoked','expired'].includes(r.state))throw Error('unavailable');
 return c;
}
