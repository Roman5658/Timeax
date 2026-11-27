import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readBody} from './session-router.mjs';

export const ACCOUNT_ADMIN_SIGNATURE='timeax_api.admin_accounts(text,uuid,text)';
export const ACCOUNT_ADMIN_SQL='SELECT timeax_api.admin_accounts($1::text,$2::uuid,$3::text) AS result';
export const ACCOUNT_ADMIN_ROLE='timeax_account_admin_login';
export const ACCOUNT_ADMIN_ROUTE='/api/timeax/account-admin';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(v);
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function managedAccountAdmin(env){
 const values=[env.TIMEAX_ACCOUNT_ADMIN_KEY_SHA256,env.TIMEAX_ACCOUNT_ADMIN_DB,env.TIMEAX_ACCOUNT_ADMIN_RPC_SHA256];
 if(!values.every(x=>typeof x==='string'))return null;
 const [keySha,password,functionSha]=values;
 if(!/^[a-f0-9]{64}$/.test(keySha)||!/^[-_A-Za-z0-9]{43,128}$/.test(password)||! /^[a-f0-9]{64}$/.test(functionSha))return null;
 return {keySha,password,functionSha};
}
export function createAccountAdminHandler({origin,keySha,lane,revoked,now=Date.now}){
 const hash=Buffer.from(keySha,'hex');
 if(hash.length!==32||typeof lane?.query!=='function'||typeof revoked!=='function')throw Error('Account admin configuration invalid');
 let failures=0,windowStart=now();
 const previews=new Map();
 const sql=(action,id=null,email=null)=>lane.query(ACCOUNT_ADMIN_SQL,[action,id,email]).then(r=>r.rows[0]?.result);
 return async r=>{
  if(r.method!=='POST'||r.headers.get('origin')!==origin||r.headers.has('sec-fetch-site')&&r.headers.get('sec-fetch-site')!=='same-origin')return reply(403,{error:'denied'});
  const current=now();
  if(current-windowStart>=60_000){windowStart=current;failures=0}
  const token=(r.headers.get('authorization')??'').match(/^Bearer ([-_A-Za-z0-9]{43,128})$/)?.[1];
  if(!token||!timingSafeEqual(hash,createHash('sha256').update(token).digest())){failures++;return failures>15?reply(429,{error:'wait'}):reply(401,{error:'denied'})}
  let v;try{v=JSON.parse(await readBody(r,2048))}catch{}
  try{
   if(exact(v,['action','after'])&&v.action==='list'&&(v.after===null||uuid(v.after))){
    const result=await sql('list',v.after);
    if(!Array.isArray(result?.accounts)||result.accounts.length>51)throw Error('Invalid list');
    const more=result.accounts.length===51;
    const accounts=result.accounts.slice(0,50);
    return reply(200,{accounts,next:more?accounts.at(-1)?.id:null});
   }
   if(exact(v,['action','id'])&&v.action==='preview'&&uuid(v.id)){
    const p=await sql('preview',v.id);
    if(p?.state!=='preview'||p.id!==v.id)return reply(404,{error:'missing'});
    for(const [key,item] of previews)if(item.expires<=current)previews.delete(key);
    if(!p.canDelete||typeof p.email!=='string')return reply(200,{...p,token:null});
    if(previews.size>=64)return reply(429,{error:'wait'});
    const token=randomBytes(32).toString('base64url');
    previews.set(token,{id:p.id,email:p.email,expires:current+120_000});
    return reply(200,{...p,token});
   }
   if(exact(v,['action','token','email'])&&v.action==='delete'&&typeof v.token==='string'){
    const p=previews.get(v.token);
    if(!p||p.expires<=current||v.email!==p.email)return reply(409,{error:'changed'});
    previews.delete(v.token);
    const result=await sql('delete',p.id,p.email);
    if(result?.state!=='deleted'||result.id!==p.id)return reply(409,{error:'blocked'});
    revoked(p.id);
    return reply(200,{state:'deleted',id:p.id});
   }
   return reply(400,{error:'invalid'});
  }catch{return reply(503,{error:'unavailable'})}
 };
}
