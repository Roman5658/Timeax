import {createHash} from 'node:crypto';
import {ISSUER} from './provider-adapters.mjs';

export const SESSION_ROLE='timeax_web_session_login';
export const SESSION_RPC='timeax_api.web_session(text,text,uuid)';
export const SESSION_SQL='SELECT timeax_api.web_session($1::text,$2::text,$3::uuid) AS session';
export const SESSION_TTL_SECONDS=12*60*60;
const digest=id=>createHash('sha256').update(id).digest('hex');
function validToken(id){return typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id)}
export function managedWebSessions(env){
 const password=env.TIMEAX_WEB_SESSION_DB, sha=env.TIMEAX_WEB_SESSION_RPC_SHA256;
 if(password===undefined&&sha===undefined)return null;
 if(!/^[-_A-Za-z0-9]{43,128}$/.test(password??'')||! /^[a-f0-9]{64}$/.test(sha??''))throw Error('Managed web session configuration incomplete');
 return {password,sha};
}
export function createWebSessionStore(lane){
 async function query(action,id,subject=null){
  const result=await lane.query(SESSION_SQL,[action,digest(id),subject]);
  if(result.rows?.length!==1||!Object.hasOwn(result.rows[0],'session'))throw Error('Web session result invalid');
  return result.rows[0].session;
 }
 return {
  async get(id){if(!validToken(id))return null;
   const s=await query('read',id);
   if(s===null)return null;
   const expiresAt=Date.parse(s.expiresAt);
   if(!Number.isFinite(expiresAt)||typeof s.email!=='string'||typeof s.subject!=='string')throw Error('Web session response invalid');
   return {issuer:ISSUER,subject:s.subject,email:s.email,expiresAt,emailConfirmed:true,isAnonymous:false,flow:'login'};
  },
  async put(id,identity){if(!validToken(id)||identity.issuer!==ISSUER||await query('issue',id,identity.subject)!==true)throw Error('Web session was not issued')},
  async delete(id){if(validToken(id))await query('revoke',id)},
 };
}
