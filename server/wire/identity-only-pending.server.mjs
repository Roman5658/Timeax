import {createHmac} from 'node:crypto';
import {createBeforeUserProof} from './before-user-proof.server.mjs';
const b64=/^[A-Za-z0-9_-]{43}$/,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const bindings=new WeakMap();
export const readPendingIdentity=receipt=>bindings.get(receipt);
const deny=()=>Object.freeze({state:'denied'});
const opaque=x=>typeof x==='string'&&b64.test(x)&&Buffer.from(x,'base64url').toString('base64url')===x;
const exact=(o,fields)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===fields.length&&fields.every(f=>Object.hasOwn(o,f));
function pending(identity){
 const receipt=Object.freeze({state:'pending',authenticated:true,grants:Object.freeze([])});
 bindings.set(receipt,Object.freeze(identity));return receipt;
}
// Compatibility adapter for the ORIGINAL offline tests only. Production composition
// supplies enrollmentStore and never supplies a table-level database.
function localStore(db,ack){
 const rows=async(q,p)=>(await db.query(q,p)).rows;
 return {
  reserve:async({id,expiry,routeTag})=>(await rows("INSERT INTO timeax_before_user_local.intents(id,expires_at,route_tag) SELECT $1,to_timestamp($2::double precision/1000),$3 WHERE to_timestamp($2::double precision/1000)>clock_timestamp() ON CONFLICT DO NOTHING RETURNING id",[id,expiry,routeTag])).length===1,
  consume:async({id,expiry,subject,providerEvent})=>(await rows("UPDATE timeax_before_user_local.intents SET attempted_at=clock_timestamp(),attempted_subject=$3::uuid,auth_event=$4::uuid WHERE id=$1 AND expires_at=to_timestamp($2::double precision/1000) AND expires_at>clock_timestamp() AND route_tag IS NOT NULL AND attempted_at IS NULL RETURNING id",[id,expiry,subject,providerEvent])).length===1,
  acknowledge:async({id,routeTag,expiry})=>(await rows("UPDATE timeax_before_user_local.intents SET provider_ack_at=clock_timestamp() WHERE id=$1 AND route_tag=$2 AND expires_at=to_timestamp($3::double precision/1000) AND expires_at>clock_timestamp() AND auth_event IS NOT NULL AND attempted_subject IS NOT NULL AND provider_ack_at IS NULL AND finished_at IS NULL RETURNING id",[id,routeTag,expiry])).length===1,
  takeAttempt:async({id,routeTag})=>{
   const r=await rows("UPDATE timeax_before_user_local.intents SET pin_attempts=pin_attempts+1 WHERE id=$1 AND route_tag=$2 AND auth_event IS NOT NULL AND attempted_subject IS NOT NULL AND finished_at IS NULL AND expires_at>clock_timestamp() AND pin_attempts<5 AND ($3::boolean IS FALSE OR provider_ack_at IS NOT NULL) RETURNING attempted_subject,expires_at,pin_attempts",[id,routeTag,ack]);
   return r.length===1?{subject:r[0].attempted_subject,expiresAt:r[0].expires_at,attempt:r[0].pin_attempts}:null;
  },
  finishIdentity:async({id,routeTag,subject,attempt})=>(await rows("UPDATE timeax_before_user_local.intents SET finished_at=clock_timestamp() WHERE id=$1 AND route_tag=$2 AND attempted_subject=$3::uuid AND auth_event IS NOT NULL AND finished_at IS NULL AND expires_at>clock_timestamp() AND ($4::boolean IS FALSE OR provider_ack_at IS NOT NULL) AND pin_attempts=$5 RETURNING id",[id,routeTag,subject,ack,attempt])).length===1,
 };
}
export function createIdentityOnlyPending({mode='off',policy,db,enrollmentStore,verifyProviderWebhook,verifyOtpAndGetUser,now=Date.now,requireProviderAck=false,otpLength=6}={}){
 if(mode==='off')return Object.freeze({begin:async()=>null,authorizeCreation:async()=>deny(),acknowledge:async()=>false,finish:async()=>deny()});
 if(mode!=='local-pinned-fixture'||!opaque(policy?.routeKey)||!opaque(policy.intentKey)||policy.routeKey===policy.intentKey
  ||typeof verifyOtpAndGetUser!=='function'||typeof verifyProviderWebhook!=='function'||typeof now!=='function'
  ||typeof requireProviderAck!=='boolean'||![6,8].includes(otpLength))throw Error('Unsupported enrollment proof mode');
 const otpPattern=new RegExp("^[0-9]{"+otpLength+"}$");
 const storage=enrollmentStore??(typeof db?.query==='function'?localStore(db,requireProviderAck):null);
 if(['reserve','consume','acknowledge','takeAttempt','finishIdentity'].some(k=>typeof storage?.[k]!=='function'))throw Error('Missing enrollment store');
 const {issuer,recipient:intended,intentKey,routeKey}=policy;if(typeof intended!=='string')throw Error('Sealed recipient required');
 const recipient=intended.toLowerCase(),key=Buffer.from(routeKey,'base64url');
 const tag=(id,secret)=>createHmac('sha256',key).update(JSON.stringify(['timeax/identity-only-route/v1',issuer,recipient,id,secret])).digest('hex');
 const proof=routeTag=>createBeforeUserProof({policy:{issuer,recipient,intentKey},store:{
  reserve:p=>storage.reserve({...p,routeTag}),consume:p=>storage.consume(p),
 },verifyProviderWebhook,now});
 const hook=proof(null);
 return Object.freeze({
  begin(ctx){
   if(!exact(ctx,['proofId','routeSecret','expiresAt'])||!opaque(ctx.proofId)||!opaque(ctx.routeSecret)||ctx.proofId===ctx.routeSecret)return Promise.resolve(null);
   return proof(tag(ctx.proofId,ctx.routeSecret)).issue(ctx);
  },
  authorizeCreation:hook.authorize,
  async acknowledge(ctx){
   if(!exact(ctx,['proofId','routeSecret','expiresAt'])||!opaque(ctx.proofId)||!opaque(ctx.routeSecret)||!Number.isSafeInteger(ctx.expiresAt)||ctx.expiresAt<=now())return false;
   try{return await storage.acknowledge({id:ctx.proofId,routeTag:tag(ctx.proofId,ctx.routeSecret),expiry:ctx.expiresAt})===true}catch{return false}
  },
  async finish(ctx){
   if(!exact(ctx,['proofId','routeSecret','code'])||!opaque(ctx.proofId)||!opaque(ctx.routeSecret)||typeof ctx.code!=='string'||!otpPattern.test(ctx.code))return deny();
   const routeTag=tag(ctx.proofId,ctx.routeSecret);
   try{
    const row=await storage.takeAttempt({id:ctx.proofId,routeTag});
    if(!row||!(row.expiresAt instanceof Date)||now()>=row.expiresAt.getTime()||!Number.isInteger(row.attempt)||row.attempt<1||row.attempt>5)return deny();
    const user=await verifyOtpAndGetUser(Object.freeze({issuer,recipient,code:ctx.code}));
    if(!exact(user,['issuer','subject','email','emailConfirmed','isAnonymous'])||user.issuer!==issuer||!uuid.test(user.subject)
     ||user.subject!==row.subject||typeof user.email!=='string'||user.email.toLowerCase()!==recipient
     ||user.emailConfirmed!==true||user.isAnonymous!==false||now()>=row.expiresAt.getTime())return deny();
    if(await storage.finishIdentity({id:ctx.proofId,routeTag,subject:user.subject,attempt:row.attempt})!==true)return deny();
    return pending({issuer,subject:user.subject,emailConfirmed:true,isAnonymous:false,expiresAt:row.expiresAt.getTime()});
   }catch{return deny()}
  },
 });
}
