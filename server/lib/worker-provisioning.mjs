import {normalizePublicEmail} from './public-email-provider.mjs';

export const WORKER_PROVISIONING_SIGNATURE='timeax_api.worker_connection(text,text,text,jsonb)';
export const WORKER_PROVISIONING_ROLE='timeax_worker_connection_login';
export const WORKER_PROVISIONING_SQL='SELECT timeax_api.worker_connection($1::text,$2::text,$3::text,$4::jsonb) AS value';

export function createWorkerProvisioning(lane){
 async function call(action,actor,payload={}){
  const rows=(await lane.query(WORKER_PROVISIONING_SQL,[action,actor?.issuer??null,actor?.subject??null,JSON.stringify(payload)])).rows;
  if(rows?.length!==1||typeof rows[0].value!=='object'||!rows[0].value)throw Error('Worker connection result unavailable');
  return rows[0].value;
 }
 return {call,async hasPending(raw){
  const email=normalizePublicEmail(raw);
  if(!email)return false;
  try{return (await call('admit',null,{email})).pending===true}catch{return false}
 }};
}
