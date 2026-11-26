export type WorkingRole = "worker"|"agency_admin"|"factory_admin"|"accountant"|"team_leader";
type Surface = "entry"|"registration"|"portal"|"unsupported"|"blocked-input";
export type WorkingRoute = { surface: Surface; role?: WorkingRole; registration?:"agency"|"other"; auth?: "verify" };
export type SessionProjection = { state:"verified"; verified:boolean; version:1; serverTime:string; expiresAt:string; grants:WorkingRole[] };
export type WorkingDecision="unavailable"|"sign-in"|"denied"|"connected-pending";
export type WorkingSessionReader = { read:(signal:AbortSignal)=>Promise<unknown> };

const roles:ReadonlySet<string>=new Set(["worker","agency_admin","factory_admin","accountant","team_leader"]);
const pathRole:Record<string,WorkingRole>={worker:"worker",agency:"agency_admin",factory:"factory_admin",accountant:"accountant",leader:"team_leader"};
const normalize=(path:string)=>path.replace(/\/+$/,"")||"/";

export function classifyWorkingRoute(location:Pick<Location,"pathname"|"search"|"hash">):WorkingRoute {
  const {pathname,search,hash}=location;
  if(search || hash.includes("?"))return {surface:"blocked-input"};
  if(hash&&!hash.startsWith("#/"))return {surface:"unsupported"};
  const direct=normalize(pathname), routed=hash?normalize(hash.slice(1)):direct;
  // Ambiguous sources are denied; no decoding or executing old callback/invite/user parameters.
  if(hash&&direct!=="/"&&direct!=="/index.html")return {surface:"blocked-input"};
  if(!/^(?:\/[a-z]+(?:-[a-z]+)*)*\/?$/.test(routed)&&routed!=="/index.html")return {surface:"unsupported"};
  if(routed==="/"||routed==="/index.html"||routed==="/login")return {surface:"entry"};
  if(routed==="/auth/verify")return {surface:"entry",auth:"verify"};
  const [,root,...rest]=routed.split("/");
  if(root==="register" || routed==="/registration-conditions" ||
    (["worker","agency","factory","accountant","leader"].includes(root) && rest.some(name=>name==="register" || name==="invite")))return {surface:"registration",registration:routed==="/register"||routed==="/register/agency"||routed==="/agency/register"?"agency":"other"};
  const role=Object.hasOwn(pathRole,root)?pathRole[root]:undefined;
  return role?{surface:"portal",role}:{surface:"unsupported"};
}

export function instant(value:unknown):value is string {
  return typeof value==="string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
}
export function projection(value:unknown):SessionProjection|undefined {
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  const s=value as Record<string,unknown>;
  if(s.state!=="verified"||s.verified!==true||s.version!==1||!instant(s.serverTime)||!instant(s.expiresAt)||s.expiresAt<=s.serverTime
    ||!Array.isArray(s.grants)||s.grants.length>5||s.grants.some(role=>typeof role!=="string"||!roles.has(role)))return undefined;
  return {state:"verified",verified:true,version:1,serverTime:s.serverTime,expiresAt:s.expiresAt,grants:s.grants as WorkingRole[]};
}

export async function resolveWorkingDecision(route:WorkingRoute,adapter:WorkingSessionReader|undefined,signal:AbortSignal):Promise<WorkingDecision> {
  if(route.surface==="blocked-input"||route.surface==="unsupported")return "denied";
  // No network, cookie read or simulated grants when the approved integration is not installed.
  if(!adapter||signal.aborted)return "unavailable";
  try{
    const value=await adapter.read(signal);
    if(signal.aborted)return "unavailable";
    const session=projection(value);
    if(!session)return (value as {state?:unknown}|undefined)?.state==="anonymous"?"sign-in":"unavailable";
    if(route.surface==="portal"&&(!route.role||!session.grants.includes(route.role)))return "denied";
    // No demo or real business portal until its real operations are reviewed, wired and authorized.
    return "connected-pending";
  }catch{return "unavailable";}
}
