const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const invalidName=/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u;
async function draft(request){
 if(request.headers.has('content-encoding')||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??'')||!request.body)return null;
 const reader=request.body.getReader();let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Body timeout')),2500)});
 try{
  const chunks=[];let bytes=0;
  for(;;){const r=await Promise.race([reader.read(),deadline]);if(r.done)break;bytes+=r.value.byteLength;if(bytes>4096)return null;chunks.push(r.value)}
  const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==2||typeof v.name!=='string'||typeof v.agencyNip!=='string'
   ||invalidName.test(v.name)||[...v.name.trim()].length<2||[...v.name.trim()].length>120||!/^\d{10}$/.test(v.agencyNip))return null;
  return {name:v.name.trim(),agencyNip:v.agencyNip};
 }catch{return null}finally{clearTimeout(timer);void reader.cancel().catch(()=>{});try{reader.releaseLock()}catch{}}
}
// Mounted only behind the existing session router's origin and request guards.
export function createWorkerAgencyRequestHandler({sessionResolver,store=null,now=Date.now}){
 return async request=>{
  if(!['GET','POST'].includes(request.method))return reply(405,{error:'not-allowed'});
  if(!store||!sessionResolver)return reply(503,{error:'service-unavailable'});
  try{
   const session=await sessionResolver(request);
   if(session?.state==='unavailable')return reply(503,{error:'service-unavailable'});
   if(session?.state!=='verified'||!uuid.test(session.subject??'')||session.emailConfirmed!==true||session.isAnonymous!==false)
    return reply(401,{error:'valid-session-required'});
   const active=async()=>!request.signal.aborted&&session.expiresAt>now()&&await session.isActive()===true;
   if(!await active())return reply(401,{error:'valid-session-required'});
   const input=request.method==='POST'?await draft(request):null;
   if(request.method==='POST'&&!input)return reply(400,{error:'invalid-request'});
   if(!await active())return reply(401,{error:'valid-session-required'});
   const identity={issuer:session.issuer,subject:session.subject};
   if(!input)return reply(200,{requests:await store.list(identity)});
   const saved=await store.submit(identity,input);
   return saved?reply(202,{request:saved}):reply(404,{error:'agency-unavailable'});
  }catch{return reply(503,{error:'service-unavailable'})}
 };
}
