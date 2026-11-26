import {Buffer} from 'node:buffer';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const zero='00000000-0000-0000-0000-000000000000';
const jsonType=/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?$/i;
const badName=/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u;
const denied=/^(authorization|forwarded|x-forwarded-.*|x-timeax-.*|x-role|x-user-id|x-subject|x-issuer|x-tenant(?:-id)?|x-organization-id|tenant|role)$/i;
const reply=(status,body,extra={})=>Response.json(body,{status,headers:{
 'Cache-Control':'no-store, private','Vary':'Cookie','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',...extra}});
const fail=(status,error)=>reply(status,{error});
const unavailable=()=>fail(503,'service-unavailable');
const caps=agencyRegistration=>({login:false,verify:false,agencyRegistration,logout:false});

async function draftFrom(request) {
 const type=request.headers.get('content-type'),size=request.headers.get('content-length');
 if(request.headers.has('content-encoding')||!jsonType.test(type??''))return {error:415};
 if(size!==null&&!/^\d+$/.test(size))return {error:400};
 if(Number(size)>4096)return {error:413};
 if(!request.body)return {error:400};
 const reader=request.body.getReader();let timer;
 const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),2500)});
 try {
  const chunks=[];let length=0;
  for(;;) {
   const part=await Promise.race([reader.read(),deadline]);
   if(part.timeout)return {error:408};
   if(part.done)break;
   length+=part.value.byteLength;if(length>4096)return {error:413};chunks.push(part.value);
  }
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,length)));
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['agencyName','nip'].includes(k))
   ||typeof value.agencyName!=='string'||badName.test(value.agencyName))return {error:400};
  const agencyName=value.agencyName.trim(),nip=value.nip??null;
  if([...agencyName].length<2||[...agencyName].length>120||(nip!==null&&(typeof nip!=='string'||!/^\d{10}$/.test(nip))))return {error:400};
  return {agencyName,nip};
 }catch{return {error:400};}
 finally {clearTimeout(timer);void reader.cancel().catch(()=>{});try{reader.releaseLock()}catch{}}
}

/**
 * Proposed server-only session port. No auth provider, JWT decoder, user creation,
 * listener, environment credentials, or fixture allowlist is installed here.
 * A trusted HTTPS framework must construct Request.url from its fixed authority.
 */
export function createAgencyPendingHandler({origin,issuer,sessionResolver=null,store=null,now=Date.now}) {
 const url=new URL(origin);
 if(url.origin!==origin||url.protocol!=='https:'||url.username||url.password
  ||['timeax.pl','www.timeax.pl'].includes(url.hostname)||!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/auth\/v1$/.test(issuer))
  throw Error('Invalid isolated registration origin or issuer');
 if(sessionResolver!==null&&typeof sessionResolver!=='function')throw Error('Invalid session resolver');
 if(store!==null&&(typeof store.get!=='function'||typeof store.submit!=='function'))throw Error('Invalid pending store');
 return async request=>{
  try {
   const target=new URL(request.url),context=target.pathname==='/v1/session/context';
   if(target.origin!==origin||target.username||target.password)return fail(403,'not-permitted');
   if(!context&&target.pathname!=='/api/agency-registration'||target.search||target.hash)return fail(404,'not-found');
   if(!['GET',...(context?[]:['POST'])].includes(request.method))
    return reply(405,{error:'not-allowed'},{Allow:context?'GET':'GET, POST'});
   const from=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
   if((request.method==='POST'?from!==origin:from!==null&&from!==origin)
    ||site!==null&&site!=='same-origin'||[...request.headers.keys()].some(k=>denied.test(k)))return fail(403,'not-permitted');
   if(request.signal.aborted)return fail(400,'invalid-request');
   if(!sessionResolver||!store)return unavailable();
   const session=await sessionResolver(request);
   if(session?.state==='unavailable')return unavailable();
   if(session?.state==='anonymous')return context?reply(200,{version:1,state:'anonymous',capabilities:caps(false)}):fail(401,'valid-session-required');
   if(session?.state!=='verified'||session.issuer!==issuer||!uuid.test(session.subject??'')||session.subject===zero
    ||!Number.isFinite(session.expiresAt)||typeof session.isActive!=='function'||typeof session.registrationAllowed!=='boolean')return unavailable();
   if(session.emailConfirmed!==true||session.isAnonymous!==false)return fail(403,'email-confirmation-required');
   const active=async()=>!request.signal.aborted&&session.expiresAt>now()&&await session.isActive()===true;
   if(!await active())return fail(401,'valid-session-required');
   if(context)return reply(200,{version:1,state:'verified',verified:true,serverTime:new Date(now()).toISOString(),
    expiresAt:new Date(session.expiresAt).toISOString(),grants:[],capabilities:caps(session.registrationAllowed)});
   if(!session.registrationAllowed)return fail(403,'not-permitted');
   let draft;
   if(request.method==='POST'){
    draft=await draftFrom(request);if(draft.error)return fail(draft.error,'invalid-request');
   }else if(request.body)return fail(400,'invalid-request');
   if(!await active())return fail(401,'valid-session-required');
   const identity=Object.freeze({issuer:session.issuer,subject:session.subject});
   const registration=draft?await store.submit(identity,draft):await store.get(identity);
   return reply(draft?202:200,{registration});
  }catch(error){
   if(error?.code==='22023')return fail(400,'invalid-request');
   if(error?.code==='42501')return fail(403,'not-permitted');
   return unavailable();
  }
 };
}
