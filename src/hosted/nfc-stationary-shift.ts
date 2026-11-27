export type NfcShiftOffer={token:string;action:'start'|'end';expiresAt:string};
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&
 !Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const opaque=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const time=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
export function readChallenge(value:unknown){
 if(!exact(value,['challenge','expiresAt'])||!opaque(value.challenge)||!time(value.expiresAt))return null;
 return {challenge:value.challenge,expiresAt:value.expiresAt};
}
export function readOffer(value:unknown):NfcShiftOffer|null{
 if(!exact(value,['token','action','expiresAt'])||!opaque(value.token)||!time(value.expiresAt)||value.action!=='start'&&value.action!=='end')return null;
 return {token:value.token,action:value.action,expiresAt:value.expiresAt};
}
export function readRecord(value:unknown,action:NfcShiftOffer['action']){
 const state=action==='start'?'started':'ended';
 return exact(value,['state'])&&value.state===state?state:null;
}
export async function nfcShiftRequest(operation:'prepare'|'proof'|'record',payload:Record<string,string>,signal:AbortSignal){
 const response=await fetch('/api/nfc/shift/'+operation,{method:'POST',credentials:'same-origin',
  cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal,headers:{'Content-Type':'application/json'},
  body:JSON.stringify(payload)});
 const data:unknown=response.ok?await response.json():null;
 return {ok:response.ok,status:response.status,data};
}
