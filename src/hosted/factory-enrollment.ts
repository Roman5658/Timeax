import {isWorkerLocal} from './worker-enrollment';
export type SetupMembership={id:string;organizationId:string;name:string;kind:'agency'|'factory';role:string};
export type SetupSite={id:string;name:string;ownerId:string;ownerKind:'agency'|'factory';organizationId:string;role:string};
export type SetupConnection={id:string;factoryId:string;factoryName:string;agencyId:string;agencyName:string;worksiteId:string;worksiteName:string;state:'pending'|'active'|'rejected'|'revoked'};
export type SetupInvitation={id:string;factoryId:string;worksiteId:string;expiresAt:string;state:string};
export type SetupAssignment={membershipId:string;worksiteId:string;organizationId:string;startsAt:string;state:string;role:string};
export type SetupContext={memberships:SetupMembership[];worksites:SetupSite[];connections:SetupConnection[];workers:{id:string;organizationId:string}[];invitations:SetupInvitation[];assignments:SetupAssignment[]};
export async function factoryCall(action:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('unavailable');
 const r=await fetch('/api/factory-setup/'+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw Error(r.status===401?'login':r.status===403?'denied':'unavailable');
 if(r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');return r.json();
}
export function parseSetupContext(v:unknown):SetupContext{
 const c=v as SetupContext;
 for(const k of ['memberships','worksites','connections','workers','invitations','assignments'] as const)if(!Array.isArray(c?.[k]))throw Error('unavailable');
 const id=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
 for(const m of c.memberships)if(!id(m.id)||!id(m.organizationId)||!['agency','factory'].includes(m.kind)||!['agency_admin','factory_admin','worker','team_leader','accountant'].includes(m.role)||typeof m.name!=='string')throw Error('unavailable');
 for(const w of c.worksites)if(!id(w.id)||!id(w.ownerId)||!id(w.organizationId)||typeof w.name!=='string'||!['agency','factory'].includes(w.ownerKind))throw Error('unavailable');
 for(const r of c.connections)if(!id(r.id)||!id(r.factoryId)||!id(r.agencyId)||!id(r.worksiteId)||!['pending','active','rejected','revoked'].includes(r.state))throw Error('unavailable');
 return c;
}
