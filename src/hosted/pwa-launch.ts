import {createWorkingRegistrationClient,isEmailIdentityOrigin} from "../modules/auth/registration/contract/registration-client.ts";

export const installedAppPath="/app";
type LaunchLocation=Pick<Location,"pathname"|"search"|"hash">;
export type InstalledLaunch="app"|"home-icon";
type LaunchResult={state:"unavailable"}|{state:"landing"}|{state:"login";path:"/login"|"/login?method=code"};

export function installedLaunch(location:LaunchLocation,origin:string,standalone:boolean):InstalledLaunch|undefined{
 if(!isEmailIdentityOrigin(origin)||location.search||location.hash)return undefined;
 if(location.pathname===installedAppPath||location.pathname===installedAppPath+"/")return "app";
 if(location.pathname==="/"&&standalone)return "home-icon";
}

export async function checkInstalledLaunch(origin:string,transport:typeof fetch,signal:AbortSignal,launch:InstalledLaunch):Promise<LaunchResult>{
 try{
  if(!isEmailIdentityOrigin(origin)||signal.aborted)return {state:"unavailable"};
  const context=await createWorkingRegistrationClient(origin,transport,"existing").context(signal);
  if(!context||signal.aborted)return {state:"unavailable"};
  if(context.state==="verified")return {state:"login",path:"/login"};
  if(context.state==="verification-required"&&context.emailChallengeFlow==="login")return {state:"login",path:"/login?method=code"};
  // A pending registration should not be reinterpreted as an existing account.
  if(launch==="app"&&context.state==="anonymous")return {state:"login",path:"/login"};
  return {state:"landing"};
 }catch{return {state:"unavailable"};}
}
