const id=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(x)&&x!=='00000000-0000-0000-0000-000000000000';
const setupToken=x=>typeof x==='string'&&/^nsetup1_[A-Za-z0-9_-]{43}$/.test(x);
const exact=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));
const restricted=/^(?:authorization|forwarded|x-forwarded-.*|x-role|x-subject|x-issuer|x-tenant.*|x-timeax-.*)$/;
const states=['stationary_tag','personal_card','terminal_reader'];
const reply=(status,payload)=>Response.json(payload,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie, Origin','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});

async function bodyOf(request){
 if(!request.body||request.headers.has('content-encoding')||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))return null;
 const reader=request.body.getReader();
 let timer;
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(reject,2000)});
  const chunks=[];let size=0;
  for(;;){
   if(request.signal.aborted)return null;
   const r=await Promise.race([reader.read(),timeout]);if(r.done)break;
   size+=r.value.length;if(size>10_240)return null;chunks.push(r.value);
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 }catch{return null}finally{clearTimeout(timer);void reader.cancel().catch(()=>{})}
}

// Mount only for a pilot with a durable setup store, independently verified
// native provisioner and scoped verified session resolution. This boundary
// issues or revokes setup grants only; it cannot record attendance.
export function createNfcProvisioningHandler({origin,gate,resolveAgencySite,allowClaim}){
 if(typeof origin!=='string'||new URL(origin).origin!==origin||!origin.startsWith('https://')||
    !['issue','claim','revokeGrant','revokeDevice'].every(k=>typeof gate?.[k]==='function')||
    typeof resolveAgencySite!=='function'||typeof allowClaim!=='function')throw Error('NFC provisioner unavailable');
 return async request=>{
  try{
   const u=new URL(request.url),path=u.pathname.match(/^\/api\/nfc\/setup\/(issue|claim|revoke-grant|revoke-device)$/);
   if(u.origin!==origin||u.search||u.hash||!path)return reply(404,{error:'unavailable'});
   if(request.method!=='POST')return reply(405,{error:'unavailable'});
   const site=request.headers.get('sec-fetch-site');
   if(request.headers.get('origin')!==origin||(site!==null&&site!=='same-origin')||[...request.headers.keys()].some(k=>restricted.test(k)))return reply(403,{error:'denied'});
   const data=await bodyOf(request);if(!data||request.signal.aborted)return reply(400,{error:'invalid'});
   const action=path[1];
   if(action==='claim'){
    if(!exact(data,['token','nativeProof'])||!setupToken(data.token)||typeof data.nativeProof!=='string'||
      !/^[A-Za-z0-9_-]{32,8192}$/.test(data.nativeProof))return reply(400,{error:'invalid'});
    // Trusted rate limiter/installation allow-list, never a grant from headers.
    if(await allowClaim(request)!==true)return reply(403,{error:'denied'});
    const result=await gate.claim(data.token,data.nativeProof);
    return result?reply(200,result):reply(403,{error:'denied'});
   }
   const required=action==='issue'?['agencyId','worksiteId','kind',...(data.kind==='personal_card'?['membershipId']:[])]:['agencyId','worksiteId','id'];
   if(!exact(data,required)||!id(data.agencyId)||!id(data.worksiteId))return reply(400,{error:'invalid'});
   if(action==='issue'?(!states.includes(data.kind)||data.kind==='personal_card'&&!id(data.membershipId)):!id(data.id))return reply(400,{error:'invalid'});
   const session=await resolveAgencySite(request,data.agencyId,data.worksiteId);
   if(session?.role!=='agency_admin'||session.agencyId!==data.agencyId||session.worksiteId!==data.worksiteId||
      !id(session.adminMembershipId)||typeof session.isActive!=='function'||await session.isActive()!==true||request.signal.aborted)return reply(403,{error:'denied'});
   const scope={agencyId:session.agencyId,worksiteId:session.worksiteId,adminMembershipId:session.adminMembershipId};
   if(action==='issue'){
    const result=await gate.issue(scope,{kind:data.kind,...(data.kind==='personal_card'?{membershipId:data.membershipId}:{})});
    return result?reply(200,result):reply(403,{error:'denied'});
   }
   const revoked=await gate[action==='revoke-grant'?'revokeGrant':'revokeDevice'](scope,data.id);
   return revoked===true?reply(200,{state:'revoked'}):reply(403,{error:'denied'});
  }catch{return reply(503,{error:'unavailable'})}
 };
}
