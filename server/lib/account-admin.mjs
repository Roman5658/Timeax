import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readBody} from './session-router.mjs';
import {WORKER_TERMS_METHOD} from './worker-terms.mjs';

export const ACCOUNT_ADMIN_SIGNATURE='timeax_api.admin_accounts(text,uuid,text)';
export const ACCOUNT_ADMIN_SQL='SELECT timeax_api.admin_accounts($1::text,$2::uuid,$3::text) AS result';
export const ACCOUNT_ADMIN_ROLE='timeax_account_admin_login';
export const ACCOUNT_ADMIN_ROUTE='/api/timeax/account-admin';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(v);
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const validCount=v=>Number.isSafeInteger(v)&&v>=0;
const validSearch=v=>v===null||typeof v==='string'&&v.length>=1&&v.length<=254&&v.trim()===v&&!/[\x00-\x1f\x7f-\x9f]/.test(v);
const summaryKeys=['accounts','verifiedAccounts','agencies','factories','newAgencies30d'];
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
   if(v?.action==='summary'&&exact(v,['action'])){
    const result=await sql('summary');
    if(!exact(result,summaryKeys)||!summaryKeys.every(k=>validCount(result[k])))throw Error('Invalid summary');
    return reply(200,result);
   }
   if(v?.action==='organizations'&&exact(v,['action','after'])&&(v.after===null||uuid(v.after))){
    const result=await sql('organizations',v.after);
    if(!Array.isArray(result?.organizations)||result.organizations.length>51)throw Error('Invalid organizations');
    const organizations=result.organizations.slice(0,50).map(o=>{
     if(!o||!uuid(o.id)||typeof o.name!=='string'||!['agency','factory'].includes(o.kind)||
      typeof o.state!=='string'||!validCount(o.activeMembers))throw Error('Invalid organization');
     return {id:o.id,name:o.name,kind:o.kind,state:o.state,activeMembers:o.activeMembers};
    });
    return reply(200,{organizations,next:result.organizations.length===51?organizations.at(-1)?.id:null});
   }
   if(v?.action==='list'&&(exact(v,['action','after'])||exact(v,['action','after','search']))&&
     (v.after===null||uuid(v.after))&&validSearch(Object.hasOwn(v,'search')?v.search:null)){
    const result=await sql('list',v.after,v.search??null);
    if(!Array.isArray(result?.accounts)||result.accounts.length>51)throw Error('Invalid list');
    const more=result.accounts.length===51;
    const accounts=result.accounts.slice(0,50).map(a=>{
     if(!a||!uuid(a.id)||(a.email!==null&&typeof a.email!=='string')||
      typeof a.createdAt!=='string'||typeof a.verified!=='boolean')throw Error('Invalid account');
     const receipt=a.termsReceipt;
     const termsReceipt=receipt&&receipt.method==='registration-checkbox'&&typeof receipt.version==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(receipt.version)&&typeof receipt.acceptedAt==='string'&&Number.isFinite(Date.parse(receipt.acceptedAt))
      ?{version:receipt.version,acceptedAt:receipt.acceptedAt,method:receipt.method}:null;
     const receipts=a.workerTermsReceipts??[];
     if(!Array.isArray(receipts)||receipts.length>8)throw Error('Invalid worker terms history');
     const workerTermsReceipts=receipts.map(r=>{
      if(!r||r.method!==WORKER_TERMS_METHOD||typeof r.version!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.version)
       ||typeof r.documentSha256!=='string'||!(/^[0-9a-f]{64}$/).test(r.documentSha256)
       ||typeof r.acceptedAt!=='string'||!Number.isFinite(Date.parse(r.acceptedAt)))throw Error('Invalid worker terms receipt');
      return {version:r.version,documentSha256:r.documentSha256,acceptedAt:r.acceptedAt,method:r.method};
     });
     return {id:a.id,email:a.email,createdAt:a.createdAt,verified:a.verified,termsReceipt,workerTermsReceipts};
    });
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
