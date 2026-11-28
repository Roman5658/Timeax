import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readBody} from './session-router.mjs';
import {WORKER_TERMS_METHOD} from './worker-terms.mjs';

export const ACCOUNT_ADMIN_SIGNATURE='timeax_api.admin_accounts(text,uuid,text)';
export const ACCOUNT_ADMIN_SQL='SELECT timeax_api.admin_accounts($1::text,$2::uuid,$3::text) AS result';
export const ACCOUNT_ADMIN_ROLE='timeax_account_admin_login';
export const ACCOUNT_ADMIN_ROUTE='/api/timeax/account-admin';
export const ACCOUNT_SUPPORT_ROLE='timeax_owner_support_login';
export const ACCOUNT_SUPPORT_SIGNATURE='timeax_api.admin_support(text,uuid,jsonb)';
export const ACCOUNT_SUPPORT_SQL='SELECT timeax_api.admin_support($1::text,$2::uuid,$3::jsonb) AS result';
const uuid=v=>typeof v==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(v);
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const validCount=v=>Number.isSafeInteger(v)&&v>=0;
const validSearch=v=>v===null||typeof v==='string'&&v.length>=1&&v.length<=254&&v.trim()===v&&!/[\x00-\x1f\x7f-\x9f]/.test(v);
const supportAction=/^support-(account|shifts|correct-shift|revoke-sessions|audit)$/;
const time=x=>typeof x==='string'&&/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(x);
const day=x=>typeof x==='string'&&/^[1-9]\d{3}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const reason=x=>typeof x==='string'&&x.length>=3&&x.length<=200&&x===x.trim()&&!/[\p{Cc}\p{Cf}]/u.test(x);
function validSupport(v,a){
 if(!uuid(v.accountId))return false;
 const base=['action','accountId'];
 if(a==='account'||a==='audit')return exact(v,base);
 if(a==='shifts')return exact(v,[...base,'from','to'])&&day(v.from)&&day(v.to)&&v.from<=v.to&&Date.parse(v.to)-Date.parse(v.from)<=30*86400000;
 if(a==='revoke-sessions')return exact(v,[...base,'reason'])&&reason(v.reason);
 return a==='correct-shift'&&exact(v,[...base,'id','source','revision','start','end','reason'])&&uuid(v.id)&&['agency','factory'].includes(v.source)&&
  Number.isSafeInteger(v.revision)&&v.revision>0&&v.revision<=999999999&&time(v.start)&&time(v.end)&&v.start!==v.end&&reason(v.reason);
}
const summaryKeys=['accounts','verifiedAccounts','agencies','factories','newAgencies30d'];
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function managedAccountAdmin(env){
 const values=[env.TIMEAX_ACCOUNT_ADMIN_KEY_SHA256,env.TIMEAX_ACCOUNT_ADMIN_DB,env.TIMEAX_ACCOUNT_ADMIN_RPC_SHA256];
 if(!values.every(x=>typeof x==='string'))return null;
 const [keySha,password,functionSha]=values;
 if(!/^[a-f0-9]{64}$/.test(keySha)||!/^[-_A-Za-z0-9]{43,128}$/.test(password)||! /^[a-f0-9]{64}$/.test(functionSha))return null;
 const supportPassword=env.TIMEAX_OWNER_SUPPORT_DB,supportSha=env.TIMEAX_OWNER_SUPPORT_RPC_SHA256;
 const support=typeof supportPassword==='string'&&/^[-_A-Za-z0-9]{43,128}$/.test(supportPassword)&&supportPassword!==password&&
  typeof supportSha==='string'&&/^[a-f0-9]{64}$/.test(supportSha)?{password:supportPassword,sha:supportSha}:null;
 return {keySha,password,functionSha,...(support?{support}:{})};
}
export function createAccountAdminHandler({origin,keySha,lane,supportLane=null,revoked,now=Date.now}){
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
   const action=typeof v?.action==='string'?v.action.match(supportAction)?.[1]:null;
   if(action){
    if(!validSupport(v,action))return reply(400,{error:'invalid'});
    if(!supportLane)return reply(503,{error:'support-not-configured'});
    const {action:_,accountId,...input}=v;
    const result=(await supportLane.query(ACCOUNT_SUPPORT_SQL,[action,accountId,JSON.stringify(input)])).rows?.[0]?.result;
    if(result?.state==='missing')return reply(404,{error:'missing'});
    if(['blocked','changed'].includes(result?.state))return reply(409,{error:result.state});
    if(!result||result.state!==({account:'ready',shifts:'ready',audit:'ready','correct-shift':'corrected','revoke-sessions':'revoked'})[action])throw Error('Invalid support result');
    if(action==='account'){
     const a=result.account;
     if(a?.id!==accountId||!Array.isArray(a.memberships))throw Error('Invalid account diagnostic');
     return reply(200,{state:'ready',account:{
      id:a.id,email:a.email,createdAt:a.createdAt,verified:a.verified,lastSignInAt:a.lastSignInAt,bannedUntil:a.bannedUntil,
      hasPassword:a.hasPassword,activeSessions:a.activeSessions,memberships:a.memberships.map(m=>({
       id:m.id,organizationId:m.organizationId,organizationName:m.organizationName,kind:m.kind,role:m.role,state:m.state,
      })),
     }});
    }
    if(action==='shifts'){
     if(!Array.isArray(result.shifts)||result.shifts.length>250||typeof result.truncated!=='boolean')throw Error('Invalid shift list');
     return reply(200,{state:'ready',truncated:result.truncated,shifts:result.shifts.map(s=>({
      id:s.id,source:s.source,organizationName:s.organizationName,worksiteName:s.worksiteName,day:s.day,start:s.start,end:s.end,
      revision:s.revision,state:s.state,editable:s.editable,
     }))});
    }
    if(action==='audit'){
     if(!Array.isArray(result.events)||result.events.length>50)throw Error('Invalid history');
     return reply(200,{state:'ready',events:result.events.map(e=>({id:e.id,action:e.action,objectId:e.objectId,reason:e.reason,at:e.at,
      before:publicAudit(e.before),after:publicAudit(e.after)}))});
    }
    if(result.id!==(action==='correct-shift'?v.id:accountId))throw Error('Support result mismatch');
    if(action==='revoke-sessions')revoked(accountId,'sessions');
    return reply(200,{state:result.state,id:result.id});
   }
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

// Never echo arbitrary database audit objects to the browser.
function publicAudit(value){
 if(!value||typeof value!=='object')return {};
 return Object.fromEntries(Object.entries(value).filter(([k,v])=>['start','end','startTime','endTime','day','localDate','state','revision','paidMinutes',
  'timeaxSessions','providerSessions','activeSessions','durableSessionsRevoked','providerSessionsRevoked','refreshTokensRevoked','webSessions','authSessions','refreshTokens','legacyRefreshTokens'].includes(k)&&
  (typeof v==='string'&&v.length<=40||Number.isSafeInteger(v)||typeof v==='boolean'||v===null)));
}
