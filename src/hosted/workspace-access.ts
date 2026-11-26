export type WorkspaceRole='agency_admin'|'factory_admin'|'worker'|'team_leader'|'accountant';
export type WorkspaceAccess={version:1;state:'ready';organization:{id:string;kind:'agency'|'factory'};membership:{id:string;role:WorkspaceRole};worksites:{id:string;name:string}[]};
export type WorkspaceResult={state:'ready';value:WorkspaceAccess}|{state:'login'|'denied'|'unavailable'};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
export function parseWorkspaceAccess(value:unknown,organizationId:string):WorkspaceAccess|null{
 if(!value||typeof value!=='object')return null;
 const v=value as WorkspaceAccess;
 if(v.version!==1||v.state!=='ready'||v.organization?.id!==organizationId||!id(organizationId)||!['agency','factory'].includes(v.organization?.kind)||!id(v.membership?.id)||!['agency_admin','factory_admin','worker','team_leader','accountant'].includes(v.membership?.role)||!Array.isArray(v.worksites)||v.worksites.length>500)return null;
 if(['agency_admin','accountant'].includes(v.membership.role)&&v.organization.kind!=='agency'||v.membership.role==='factory_admin'&&v.organization.kind!=='factory')return null;
 const seen=new Set<string>();
 for(const site of v.worksites){if(!site||!id(site.id)||seen.has(site.id)||typeof site.name!=='string'||site.name.trim().length<1||site.name.trim().length>120)return null;seen.add(site.id)}
 return v;
}
export async function loadWorkspaceAccess(organizationId:string,origin:string,transport:typeof fetch,signal:AbortSignal):Promise<WorkspaceResult>{
 try{
  const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:'||!id(organizationId))return {state:'unavailable'};
  const response=await transport(origin+'/api/workspace-access/'+organizationId,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{Accept:'application/json'}});
  if(signal.aborted)return {state:'unavailable'};
  if(response.status===401)return {state:'login'};
  if(response.status===403)return {state:'denied'};
  if(response.status!==200||response.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return {state:'unavailable'};
  const value=parseWorkspaceAccess(await response.json(),organizationId);return value?{state:'ready',value}:{state:'unavailable'};
 }catch{return {state:'unavailable'}}
}
