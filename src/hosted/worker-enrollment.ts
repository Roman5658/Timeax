export type Membership={organizationId:string;name:string;kind:'agency'|'factory';role:string;membershipId:string};
export type Application={id:string;organizationId:string;name:string;source:'nip'|'invitation';status:'pending'|'approved';claimedAt:string};
export type EnrollmentContext={state:'verified';memberships:Membership[];applications:Application[]};
export const isWorkerLocal=()=>import.meta.env.MODE==='worker-enrollment-local'&&location.protocol==='http:'&&location.hostname==='127.0.0.1';
export async function workerCall(path:string,body?:unknown,signal?:AbortSignal):Promise<unknown>{
 if(location.protocol!=='https:'&&!isWorkerLocal())throw Error('unavailable');
 const response=await fetch('/api/worker-enrollment/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok)throw Error(response.status===401?'login':response.status===403?'denied':'unavailable');
 if(response.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');
 return response.json();
}
export function enrollmentContext(v:unknown):EnrollmentContext{
 const x=v as EnrollmentContext,uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
 if(x?.state!=='verified'||!Array.isArray(x.memberships)||!Array.isArray(x.applications))throw Error('unavailable');
 for(const m of x.memberships)if(!uuid(m.organizationId)||!uuid(m.membershipId)||typeof m.name!=='string'||!['agency','factory'].includes(m.kind)||!['agency_admin','factory_admin','worker','team_leader','accountant'].includes(m.role))throw Error('unavailable');
 for(const a of x.applications)if(!uuid(a.id)||!uuid(a.organizationId)||typeof a.name!=='string'||!['pending','approved'].includes(a.status)||!['nip','invitation'].includes(a.source)||!Number.isFinite(Date.parse(a.claimedAt)))throw Error('unavailable');
 return x;
}
