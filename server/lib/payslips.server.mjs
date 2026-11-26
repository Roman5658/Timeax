import {ISSUER} from './provider-adapters.mjs';
export const PAYSLIPS_SQL='SELECT timeax_api.payslips($1::text,$2::text,$3::text,$4::jsonb) AS value';
export function createPayslipsStore(lane){if(typeof lane?.query!=='function')throw Error('Payslip lane required');return {async invoke(actor,action,input){const r=await lane.query(PAYSLIPS_SQL,[actor.issuer,actor.subject,action,JSON.stringify(input)]);if(r.rows?.length!==1||!r.rows[0].value)throw Error('Invalid result');return r.rows[0].value}}}
const id=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const clean=x=>typeof x==='string'&&x.length>=2&&x.length<=500&&!/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u.test(x);

const cash=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000000;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v));
export function validCanonicalPayslipInput(a,v){
 const fields={settings:['operationId','revision','enabled','autoDraft'],group:['operationId','name'],'group-member':['operationId','memberId','groupId','effectiveOn'],rate:['operationId','memberId','groupId','effectiveOn','basis','cents'],create:['operationId','kind','sourceId','memberId'],assign:['operationId','id','revision','accountantId'],save:['operationId','id','revision','values'],issue:['operationId','id','revision','confirmed']}[a];
 if(!fields||!exact(v,fields)||!id(v.operationId))return false;
 if('revision' in v&&(!Number.isSafeInteger(v.revision)||v.revision<(a==='settings'?0:1)))return false;
 if('id' in v&&!id(v.id))return false;
 if(a==='settings')return typeof v.enabled==='boolean'&&typeof v.autoDraft==='boolean';
 if(a==='group')return clean(v.name)&&v.name.trim().length<=80;
 if(a==='group-member')return id(v.memberId)&&id(v.groupId)&&date(v.effectiveOn);
 if(a==='rate')return (id(v.memberId)&&v.groupId===null||v.memberId===null&&id(v.groupId))&&date(v.effectiveOn)&&['gross','net'].includes(v.basis)&&cash(v.cents)&&v.cents<=1000000;
 if(a==='create')return ['internal','factory'].includes(v.kind)&&id(v.sourceId)&&id(v.memberId);
 if(a==='assign')return v.accountantId===null||id(v.accountantId);
 if(a==='issue')return v.confirmed===true;
 const x=v.values;return exact(x,['mode','amountCents','knownNetCents','deductions','note'])&&['saved-rates','gross-rate','gross-total','net-total'].includes(x.mode)&&(x.mode==='saved-rates'?x.amountCents===null:cash(x.amountCents))&&(x.mode!=='gross-rate'||x.amountCents<=1000000)&&(x.knownNetCents===null||cash(x.knownNetCents))&&Array.isArray(x.deductions)&&x.deductions.length<=20&&x.deductions.every(d=>exact(d,['name','cents'])&&clean(d.name)&&d.name.trim().length<=80&&cash(d.cents))&&clean(x.note);
}
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createPayslipsHandler({origin,resolveSession,store=null,now=Date.now}){
 if(new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('HTTPS required');
 return async request=>{try{
  const u=new URL(request.url),m=u.pathname.match(/^\/api\/payslips\/([0-9a-f-]+)\/(context|settings|group|group-member|rate|create|assign|save|issue|read)(?:\/([0-9a-f-]+))?$/);
  if(u.origin!==origin||u.search||u.hash||!m||!id(m[1])||m[3]&&!id(m[3]))return reply(404,{error:'unavailable'});
  const [,organizationId,action,recordId]=m,write=!['context','read'].includes(action);
  if(request.method!==(write?'POST':'GET')||(action==='read'?!recordId:!!recordId))return reply(405,{error:'unavailable'});
  const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((write?from!==origin:from!==null&&from!==origin)||(site!==null&&site!=='same-origin')||[...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return reply(403,{error:'denied'});
  if(!store)return reply(503,{error:'not-enabled'});
  const s=await resolveSession(request);
  const active=async()=>!request.signal.aborted&&s?.state==='verified'&&s.issuer===ISSUER&&typeof s.subject==='string'&&s.emailConfirmed===true&&s.isAnonymous===false&&s.expiresAt>now()&&typeof s.isActive==='function'&&await s.isActive()===true;
  if(!await active())return reply(s?.state==='unavailable'?503:401,{error:'login'});
  let value={};
  if(write){
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding')||!request.body)return reply(400,{error:'invalid'});
   const reader=request.body.getReader();let timer;
   try{let bytes=0,chunks=[];const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),2500)});
    for(;;){const r=await Promise.race([reader.read(),timeout]);if(r.done)break;bytes+=r.value.length;if(bytes>8192)return reply(400,{error:'invalid'});chunks.push(r.value)}
    const body=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));
    if(!validCanonicalPayslipInput(action,body))return reply(400,{error:'invalid'});value=body;
   }finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
  }
  const result=await store.invoke({issuer:s.issuer,subject:s.subject},action,{...value,organizationId,...(recordId?{id:recordId}:{})});
  if(!await active())return reply(401,{error:'login'});
  return reply(200,result);
 }catch(e){const code=e?.code;return reply(code==='42501'?403:code==='23505'||code==='P0001'||code==='P0002'?409:['22023','22007','22008','23514'].includes(code)?400:503,{error:code==='P0002'?'unresolved':code==='P0001'?'period-closed':code==='23505'?'conflict':code==='42501'?'denied':['22023','22007','22008','23514'].includes(code)?'invalid':'unavailable'})}};
}
