import {createHash,randomBytes} from 'node:crypto';
import {normalizePublicEmail} from './public-email-provider.mjs';
import {readBody} from './session-router.mjs';

const FIELD='timeax_signup_intent';
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const result=(status,message)=>Response.json(message?{error:{http_code:status,message}}:{},{status,headers:{'Cache-Control':'no-store'}});
const digest=value=>createHash('sha256').update(value).digest('hex');
const TTL=30_000,MAX_IN_FLIGHT=120;

// No account or Timeax grants are issued here. Supabase checks the address via OTP afterward.
export function createPublicSignupHook({origin,verifyWebhook,now=Date.now}){
 if(!['https://timeax.pl','https://www.timeax.pl'].includes(origin)||typeof verifyWebhook!=='function')
  throw Error('Public signup hook requires the canonical HTTPS origin and verifier');
 const intents=new Map();
 const prune=at=>{for(const [key,v] of intents)if(v.expiry<=at)intents.delete(key)};
 return Object.freeze({
  async withRegistrationIntent(rawEmail,request){
   const email=normalizePublicEmail(rawEmail),at=now();prune(at);
   if(!email||typeof request!=='function'||intents.size>=MAX_IN_FLIGHT)return false;
   const token=randomBytes(32).toString('base64url'),key=digest(token);
   intents.set(key,{email,expiry:at+TTL});
   try{return await request({[FIELD]:token})}finally{intents.delete(key)}
  },
  async handler(request){
   const u=new URL(request.url);
   if(u.origin!==origin||u.pathname!=='/hooks/before-user-created'||u.search||u.hash)return result(404,'Not found');
   if(request.method!=='POST')return result(405,'Method not allowed');
   const denied=()=>result(403,'Account creation not permitted');
   try{
    const raw=await readBody(request,20_480);
    if(raw===null||request.signal.aborted)return denied();
    const event=await verifyWebhook(raw,request.headers),meta=event?.metadata,user=event?.user;
    if(meta?.name!=='before-user-created'||!UUID.test(meta?.uuid??'')||!UUID.test(user?.id??'')||
     user?.aud!=='authenticated'||user?.is_anonymous!==false||user?.role&&user.role!=='authenticated'||
     user?.phone||user?.app_metadata?.provider!=='email'||
     !Array.isArray(user?.app_metadata?.providers)||user.app_metadata.providers.length!==1||user.app_metadata.providers[0]!=='email')return denied();
    const at=now(),issued=Date.parse(meta.time),email=normalizePublicEmail(user.email),token=user?.user_metadata?.[FIELD];
    if(!email||typeof token!=='string'||!TOKEN.test(token)||!Number.isFinite(issued)||issued>at+5000||issued<at-TTL||request.signal.aborted)return denied();
    prune(at);
    const key=digest(token),intent=intents.get(key);
    if(!intent||intent.email!==email)return denied();
    intents.delete(key);
    return result(200);
   }catch{return denied()}
  }
 });
}
