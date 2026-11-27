import {createHash,createHmac} from 'node:crypto';
import {ISSUER} from './provider-adapters.mjs';
import {normalizeTimecard} from './timecards.server.mjs';
export const TEAM_SQL='SELECT timeax_api.team_workflow($1::text,$2::text,$3::text,$4::jsonb,$5::jsonb) AS value';
export const TEAM_FUNCTION={signature:'timeax_api.team_workflow(text,text,text,jsonb,jsonb)',owner:'timeax_team_owner'};
export function createTeamStore(lane){return {async invoke(s,action,input){const r=await lane.query(TEAM_SQL,[s.issuer,s.subject,action,JSON.stringify(input),JSON.stringify({email:s.email,emailConfirmed:s.emailConfirmed===true})]);if(r.rows?.length!==1||!r.rows[0].value)throw Error('Invalid team result');return r.rows[0].value}}}
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\p{Cc}\p{Cs}]/u.test(v.replace(/\n/g,''));
const parseDay=v=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return NaN;
 const ms=Date.parse(v+'T00:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===v?ms:NaN;
};
const hash=v=>createHash('sha256').update(v).digest('hex');
const reply=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createTeamHandler({origin,resolveSession,store=null,inviteKey,now=Date.now}){
 if(!origin.startsWith('https://')||new URL(origin).origin!==origin)throw Error('HTTPS required');
 return async request=>{try{
  const u=new URL(request.url),m=u.pathname.match(/^\/api\/team\/(?:([0-9a-f-]+)\/(context|read|message|absence|schedule|update-plan|cancel|save-template|delete-template|invite-accountant|revoke-accountant)|(accept-accountant))$/);
  if(u.origin!==origin||u.search||u.hash||!m||m[1]&&!id(m[1]))return reply(404,{error:'unavailable'});
  const org=m[1],action=m[2]||m[3],write=action!=='context';
  if(request.method!==(write?'POST':'GET'))return reply(405,{error:'unavailable'});
  if((write?request.headers.get('origin')!==origin:request.headers.has('origin')&&request.headers.get('origin')!==origin)
   ||request.headers.has('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'
   ||[...request.headers.keys()].some(k=>/^(authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/.test(k)))return reply(403,{error:'denied'});
  if(!store)return reply(503,{error:'closed'});
  const s=await resolveSession(request);
  const active=async()=>!request.signal.aborted&&s?.state==='verified'&&s.issuer===ISSUER&&s.emailConfirmed===true&&s.isAnonymous===false&&s.expiresAt>now()&&typeof s.isActive==='function'&&await s.isActive()===true;
  if(!await active())return reply(s?.state==='unavailable'?503:401,{error:'login'});
  let b={},token;
  if(write){
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||request.headers.has('content-encoding')||!request.body)return reply(400,{error:'invalid'});
   const reader=request.body.getReader();let timer,parts=[],size=0;
   try{const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),2500)});
    for(;;){const r=await Promise.race([reader.read(),timeout]);if(r.done)break;size+=r.value.length;if(size>16384)return reply(400,{error:'invalid'});parts.push(r.value)}
    b=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(parts)));
   }finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
   const fields={
    read:['id'],message:['operationId','siteId','recipients','payload'],absence:['operationId','siteId','payload'],
    schedule:['operationId','siteId','recipients','payload'],'update-plan':['operationId','id','revision','payload'],
    cancel:['operationId','id','revision'],'save-template':['operationId','id','revision','name','data'],
    'delete-template':['operationId','id','revision'],'invite-accountant':['operationId','email'],
    'revoke-accountant':['operationId','id'],'accept-accountant':['operationId','code']
   }[action];
   if(!exact(b,fields)||action!=='read'&&!id(b.operationId)||b.id!==undefined&&b.id!==null&&!id(b.id)
    ||b.revision!==undefined&&b.revision!==null&&(!Number.isSafeInteger(b.revision)||b.revision<1))return reply(400,{error:'invalid'});
   if(['message','absence','schedule'].includes(action)&&b.siteId!==null&&!id(b.siteId))return reply(400,{error:'invalid'});
   if(b.recipients&&(!Array.isArray(b.recipients)||b.recipients.length<1||b.recipients.length>100||!b.recipients.every(id)))return reply(400,{error:'invalid'});
   if(action==='message'&&(!exact(b.payload,['text'])||!text(b.payload.text,2000)))return reply(400,{error:'invalid'});
   if(action==='absence'||action==='update-plan'&&Object.hasOwn(b.payload??{},'dateFrom')){
    if(!exact(b.payload,['dateFrom','dateTo'])||action==='absence'&&!id(b.siteId))return reply(400,{error:'invalid'});
    const days=(parseDay(b.payload.dateTo)-parseDay(b.payload.dateFrom))/86_400_000;
    if(!Number.isInteger(days)||days<0||days>90)return reply(400,{error:'invalid'});
   }
   if(action==='schedule'||action==='update-plan'&&!Object.hasOwn(b.payload??{},'dateFrom')){
    if(!exact(b.payload,['localDate','startTime','endTime']))return reply(400,{error:'invalid'});
    const normalized=normalizeTimecard({...b.payload,worksiteId:b.siteId??b.id,operationId:b.operationId,breakStatus:'not-taken',breakMinutes:0,breakTreatment:'unpaid',comment:''});
    if(!normalized)return reply(400,{error:'invalid'});
    b.payload=normalized.data;
   }
   if(action==='save-template'){
    if(!text(b.name,80)||!exact(b.data,['startTime','endTime','breakMinutes','breakTreatment'])
     ||![b.data.startTime,b.data.endTime].every(x=>typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x))
     ||b.data.startTime===b.data.endTime||!Number.isInteger(b.data.breakMinutes)||b.data.breakMinutes<0||b.data.breakMinutes>720
     ||!['paid','unpaid'].includes(b.data.breakTreatment)||((b.id===null)!==(b.revision===null)))return reply(400,{error:'invalid'});
   }
   if(action==='invite-accountant'){
    if(!text(b.email,254)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)||typeof inviteKey!=='string'||inviteKey.length<32)return reply(400,{error:'invalid'});
    token=createHmac('sha256',Buffer.from(inviteKey,'base64url')).update('team-accountant/'+s.issuer+'/'+s.subject+'/'+org+'/'+b.operationId).digest('hex');
    b={...b,email:b.email.trim().toLowerCase(),tokenHash:hash(token)};
   }
   if(action==='accept-accountant'){
    if(typeof b.code!=='string'||!/^[a-f0-9]{64}$/.test(b.code))return reply(400,{error:'invalid'});
    b={operationId:b.operationId,tokenHash:hash(b.code)};
   }
  }
  const value=await store.invoke(s,action,{...b,...(org?{organizationId:org}:{})});
  if(!await active())return reply(401,{error:'login'});
  return reply(200,token?{...value,code:token}:value);
 }catch(e){return reply(e?.code==='42501'?403:e?.code==='22023'||e?.code?.startsWith('22')?400:e?.code==='23505'?409:503,{error:e?.code==='42501'?'denied':e?.code==='23505'?'conflict':'unavailable'})}};
}
