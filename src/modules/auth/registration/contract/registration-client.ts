import { instant, projection, type SessionProjection } from "./access-boundary.ts";

const registrationPath="/api/agency-registration";
const logoutPath="/api/timeax/auth/logout";
type Capabilities={login:boolean;verify:boolean;agencyRegistration:boolean;logout:boolean};
export type AccessContext =({state:"anonymous"|"verification-required";capabilities:Capabilities}
  |{state:"verified";capabilities:Capabilities;session:SessionProjection}) & {otpLength?:6|8;emailChallengeFlow?:'login'|'registration';workerSelfService?:boolean;workerProvisioning?:boolean};
export type PendingRegistration={requestId:string;status:"pending";requestedAt:string};
export type RegistrationOutcome={state:"none"|"session"|"unavailable"}|{state:"pending";registration:PendingRegistration};
export type ActionState="accepted"|"verified"|"invalid"|"unavailable";

const record=(raw:unknown):Record<string,unknown>|undefined=>raw&&typeof raw==="object"&&!Array.isArray(raw)?raw as Record<string,unknown>:undefined;
const noControls=/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u;
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail=(value:string)=>value.length<=254&&!noControls.test(value)&&emailPattern.test(value);
export const validOtp=(value:string,length:6|8=6)=>(length===6||length===8)&&new RegExp("^[0-9]{"+length+"}$").test(value);

export function agencyDraft(name:string,nip:string):{agencyName:string;nip?:string}|undefined {
  const agencyName=name.trim(),normalized=nip.trim().replace(/[ -]/g,"");
  if([...agencyName].length<2||[...agencyName].length>120||noControls.test(agencyName)||normalized&&!/^\d{10}$/.test(normalized))return undefined;
  return normalized?{agencyName,nip:normalized}:{agencyName};
}
export function parseAccessContext(raw:unknown):AccessContext|undefined{
  const value=record(raw);
  const caps=record(value?.capabilities);
  if(!value||value.version!==1||!caps||(value.otpLength!==undefined&&value.otpLength!==6&&value.otpLength!==8)||
    typeof caps.login!=="boolean"||typeof caps.verify!=="boolean"||typeof caps.agencyRegistration!=="boolean"||
    caps.logout!==undefined&&typeof caps.logout!=="boolean")return undefined;
  const capabilities={login:caps.login,verify:caps.verify,agencyRegistration:caps.agencyRegistration,logout:caps.logout===true};
  const workerSelfService=value.workerSelfService===true;
  const workerProvisioning=Array.isArray(value.agencyOperations)&&value.agencyOperations.includes('workerProvisioning');
  if(value.state==="verified"){
    const session=projection(value);
    return session?{state:"verified",capabilities,session,...(workerSelfService?{workerSelfService}:{}),...(workerProvisioning?{workerProvisioning}:{})}:undefined;
  }
  if(value.state==="anonymous"||value.state==="verification-required"){
    if(capabilities.agencyRegistration||capabilities.logout)return undefined;
    const flow=value.emailChallengeFlow;
    const emailChallengeFlow=flow==='login'||flow==='registration'?flow:undefined;
    return {state:value.state,capabilities,...(value.otpLength===8?{otpLength:8 as const}:{}),...(emailChallengeFlow?{emailChallengeFlow}:{}),...(workerSelfService?{workerSelfService}:{}),...(workerProvisioning?{workerProvisioning}:{})};
  }
  return undefined;
}
function parseReceipt(raw:unknown):RegistrationOutcome{
  const body=record(raw);
  if(!body||!Object.hasOwn(body,"registration"))return {state:"unavailable"};
  if(body.registration===null)return {state:"none"};
  const receipt=record(body.registration);
  if(!receipt||receipt.status!=="pending"||typeof receipt.requestId!=="string"||!uuid.test(receipt.requestId)||
    receipt.requestId==="00000000-0000-0000-0000-000000000000"||!instant(receipt.requestedAt))return {state:"unavailable"};
  return {state:"pending",registration:{status:"pending",requestId:receipt.requestId,requestedAt:receipt.requestedAt}};
}

export const isLoopbackEmailOrigin=(origin:string)=>/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin);

/** Future same-origin BFF owns the session; UI never reads or supplies a credential outside email/OTP form POSTs. */
export const isCanonicalEmailOrigin=(origin:string)=>origin==="https://timeax.pl"||origin==="https://www.timeax.pl";
export const isEmailIdentityOrigin=(origin:string)=>isLoopbackEmailOrigin(origin)||isCanonicalEmailOrigin(origin);

export function createWorkingRegistrationClient(origin:string,transport:typeof fetch,purpose:"enrollment"|"existing"="enrollment"){
  if(!["enrollment","existing"].includes(purpose))throw Error("Unknown sign-in purpose");
  const local=isLoopbackEmailOrigin(origin),emailIdentity=isEmailIdentityOrigin(origin);
  const contextPath =emailIdentity?"/v1/session/timeax-email":purpose==="existing"?"/v1/session/existing-context":"/v1/session/context";
  const startPath =emailIdentity?"/api/timeax/auth/public/start":purpose==="existing"?"/api/timeax/auth/existing/start":"/api/timeax/auth/start";
  const verifyPath =emailIdentity?"/api/timeax/auth/public/verify":purpose==="existing"?"/api/timeax/auth/existing/verify":"/api/timeax/auth/verify";
  const base=new URL(origin);
  if(base.origin!==origin||!local&&base.protocol!=="https:"||base.username||base.password)throw Error("Explicit HTTPS origin required");
  async function request(path:string,signal:AbortSignal,post?:object){
    const url=base.origin+path;
    const res=await transport(url,{method:post?"POST":"GET",signal,credentials:"same-origin",redirect:"error",cache:"no-store",
      referrerPolicy:"no-referrer",headers:{Accept:"application/json",...(post?{"Content-Type":"application/json"}:{})},
      ...(post?{body:JSON.stringify(post)}:{})});
    const noCache=res.headers.get("cache-control")?.split(",").some(token=>token.trim().toLowerCase()==="no-store");
    if(res.redirected||res.url!==url||!noCache)throw Error("Untrusted response");
    return res;
  }
  async function json(res:Response){
    if(res.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")throw Error("Untrusted response");
    return await res.json() as unknown;
  }
  async function context(signal:AbortSignal):Promise<AccessContext|undefined>{
    try{
      const res=await request(contextPath,signal);
      return res.status===200?parseAccessContext(await json(res)):undefined;
    }catch{return undefined;}
  }
  async function sendCode(email:string,signal:AbortSignal):Promise<ActionState>{
    if(!validEmail(email))return "invalid";
    const scope=await context(signal);
    if(signal.aborted||!scope||scope.state==="verified"||!scope.capabilities.login)return "unavailable";
    try{
      const res=await request(startPath,signal,emailIdentity?{email,flow:purpose==="existing"?"login":"registration"}:{email});
      return res.status===202&&record(await json(res))?.status==="accepted"?"accepted":"unavailable";
    }catch{return "unavailable";}
  }
  async function verifyCode(email:string,code:string,signal:AbortSignal):Promise<ActionState>{
    if(!emailIdentity&&!validEmail(email)||!(validOtp(code,6)||validOtp(code,8)))return "invalid";
    const scope=await context(signal);
    if(signal.aborted||!scope||scope.state==="verified"||!scope.capabilities.verify||
      emailIdentity&&scope.emailChallengeFlow!==undefined&&scope.emailChallengeFlow!==(purpose==='existing'?'login':'registration'))return "unavailable";
    if(!validOtp(code,scope.otpLength??6))return "invalid";
    try{
      const res=await request(verifyPath,signal,emailIdentity?{code}:{email,code});
      if(res.status===400||res.status===401)return "invalid";
      if(res.status!==200||record(await json(res))?.status!==(emailIdentity?"email-verified":"authenticated"))return "unavailable";
      return (await context(signal))?.state==="verified"?"verified":"unavailable";
    }catch{return "unavailable";}
  }
  async function logout(signal:AbortSignal){
    const scope=await context(signal);
    if(signal.aborted||scope?.state!=="verified"||!scope.capabilities.logout)return false;
    try{
      const res=await request(emailIdentity?"/api/timeax/auth/public/logout":logoutPath,signal,{});
      return res.status===204&&(await context(signal))?.state==="anonymous";
    }catch{return false;}
  }
  async function registration(signal:AbortSignal,draft?:{agencyName:string;nip?:string}):Promise<RegistrationOutcome>{
    const scope=await context(signal);
    if(signal.aborted||!scope)return {state:"unavailable"};
    if(scope.state!=="verified")return {state:"session"};
    if(!scope.capabilities.agencyRegistration)return {state:"unavailable"};
    const payload=draft?agencyDraft(draft.agencyName,draft.nip??""):undefined;
    if(draft&&!payload)return {state:"unavailable"};
    try{
      const res=await request(registrationPath,signal,payload);
      if(res.status===401||res.status===403)return {state:"session"};
      if(res.status!==(payload?202:200))return {state:"unavailable"};
      const result=parseReceipt(await json(res));
      if(payload&&result.state!=="pending")return {state:"unavailable"};
      return result;
    }catch{return {state:"unavailable"};}
  }
  return {context,sendCode,verifyCode,logout,registration};
}
