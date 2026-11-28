import {createWorkingRegistrationClient,isEmailIdentityOrigin} from "../modules/auth/registration/contract/registration-client.ts";

export const installedAppPath="/app";
type LaunchLocation=Pick<Location,"pathname"|"search"|"hash">;
export type InstalledLaunch="app"|"home-icon";
type LaunchResult={state:"workspace";path:`/workspace/${string}`}|{state:"unavailable"}|{state:"landing"}|{state:"profile";path:"/account"};

export function installedLaunch(location:LaunchLocation,origin:string,standalone:boolean):InstalledLaunch|undefined{
 if(!isEmailIdentityOrigin(origin)||location.search||location.hash)return undefined;
 if(location.pathname===installedAppPath||location.pathname===installedAppPath+"/")return "app";
 if(standalone&&(location.pathname==="/"||location.pathname==="/login"))return "home-icon";
}

export async function checkInstalledLaunch(origin:string,transport:typeof fetch,signal:AbortSignal,_launch:InstalledLaunch):Promise<LaunchResult>{
 try{
  if(!isEmailIdentityOrigin(origin)||signal.aborted)return {state:"unavailable"};
  const context=await createWorkingRegistrationClient(origin,transport,"existing").context(signal);
  if(!context||signal.aborted)return {state:"unavailable"};
  if(context.state==="verified"){
   if(context.selfService){
    const desk='/api/timeax/agency/setup';
    const members='/api/worker-enrollment/context';
    const agencyRead=launchRead(origin,desk,transport,signal);
    const memberRead=context.workerSelfService?launchRead(origin,members,transport,signal):undefined;
    const agency=await agencyRead;
    if(signal.aborted)return {state:"unavailable"};
    const own=object(agency?.data);
    if(agency?.status===200&&own?.state==='ready'&&org(own.organizationId))
     return {state:"workspace",path:`/workspace/${own.organizationId}`};
    const memberResult=await memberRead;
    if(signal.aborted)return {state:"unavailable"};
    const path=installedWorkspace(agency,memberResult);
    if(path)return {state:"workspace",path};
   }
   return {state:"profile",path:"/account"};
  }
  // The icon is not an explicit request to sign in or to resume an OTP challenge.
  return {state:"landing"};
 }catch{return {state:"unavailable"};}
}


type LaunchRead={status:number;data:unknown};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const org=(value:unknown):value is string=>typeof value==='string'&&uuid.test(value)&&value!=='00000000-0000-0000-0000-000000000000';
const object=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
async function launchRead(origin:string,path:string,transport:typeof fetch,signal:AbortSignal):Promise<LaunchRead|undefined>{
 try{
  const url=origin+path,r=await transport(url,{method:'GET',signal,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
  if(signal.aborted||r.redirected||r.url!==url||r.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||
   !r.headers.get('cache-control')?.split(',').some(token=>token.trim().toLowerCase()==='no-store'))return;
  return {status:r.status,data:await r.json()};
 }catch{return undefined;}
}
function installedWorkspace(agency:LaunchRead|undefined,memberResult:LaunchRead|undefined):`/workspace/${string}`|undefined{
 if(!agency)return;
 const own=object(agency.data);

 if(!(agency.status===403&&own?.error==='registration-required'||agency.status===200&&own?.state==='details-required'))return;
 if(memberResult?.status!==200)return;
 const body=object(memberResult.data);
 if(body?.state!=='verified'||!Array.isArray(body.memberships)||body.memberships.length!==1)return;
 const item=object(body.memberships[0]);
 if(!item||!org(item.organizationId)||!org(item.membershipId))return;
 const roles=item.kind==='agency'?['worker','accountant']:item.kind==='factory'?['worker','team_leader','factory_admin']:[];
 if(typeof item.role!=='string'||!roles.includes(item.role))return;
 return `/workspace/${item.organizationId}`;
}
