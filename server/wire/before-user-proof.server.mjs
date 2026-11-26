import {createHmac,timingSafeEqual} from 'node:crypto';

const proofKey='timeax_creation_intent';
const issuerShape=/^https:\/\/[a-z0-9]{20}\.supabase\.co\/auth\/v1$/;
const u4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const b64=/^[A-Za-z0-9_-]{43}$/;
const emailShape=/^[^@\s\p{Cc}]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu;
const maxAge=300_000;
const mail=x=>typeof x==='string'&&x.length<=254&&emailShape.test(x)?x.toLowerCase():null;
const emptyOrUnset=x=>x===undefined||x==='';
const attemptOnly=()=>Object.freeze({state:'creation-attempt-authorized'});
const deny=()=>Object.freeze({state:'denied'});

export function createBeforeUserProof({policy=null,store,verifyProviderWebhook,now=Date.now}={}) {
  // Pinned synthetic contract. A future HTTP route must instantiate the
  // Standard Webhooks SDK with this project's exact hosted hook secret and
  // give the verified raw payload to this adapter. No parser fallback.
  if(policy===null)return Object.freeze({issue:async()=>null,authorize:async()=>deny()});
  if(!policy||typeof policy.issuer!=='string'||!issuerShape.test(policy.issuer)||
    !mail(policy.recipient)||typeof policy.intentKey!=='string'||!b64.test(policy.intentKey)||
    typeof verifyProviderWebhook!=='function'||typeof now!=='function'||
    typeof store?.reserve!=='function'||typeof store?.consume!=='function')
    throw Error('Invalid controlled creation policy');
  const {issuer}=policy, recipient=mail(policy.recipient);
  const key=Buffer.from(policy.intentKey,'base64url');
  const mac=(id,expiry)=>createHmac('sha256',key)
    .update(JSON.stringify(['timeax/auth-before-user/v1',issuer,recipient,id,expiry])).digest();
  const parse=value=>{
    if(typeof value!=='string'||value.length>120)return null;
    const parts=value.split('.');
    if(parts.length!==4||parts[0]!=='v1'||!b64.test(parts[1])||!/^[0-9]{13}$/.test(parts[2])||!b64.test(parts[3]))return null;
    const [_,id,raw,tag]=parts, expiry=Number(raw);
    const supplied=Buffer.from(tag,'base64url');
    if(supplied.toString('base64url')!==tag||!timingSafeEqual(supplied,mac(id,expiry)))return null;
    return {id,expiry};
  };
  return Object.freeze({
    // Callable only by the existing server-side authorized enrollment state
    // machine. It must never be a public endpoint accepting an email.
    async issue({proofId,expiresAt}={}) {
      const at=now();
      if(typeof proofId!=='string'||!b64.test(proofId)||!Number.isSafeInteger(expiresAt)||
          expiresAt<=at||expiresAt-at>maxAge)return null;
      try {
        if(!await store.reserve({id:proofId,expiry:expiresAt}))return null;
        return Object.freeze({[proofKey]:['v1',proofId,expiresAt,mac(proofId,expiresAt).toString('base64url')].join('.')});
      }catch{return null;}
    },
    async authorize(rawPayload,signatureHeaders) {
      // Bound before transmission to persistence. Standard Webhooks authenticates
      // the provider and exact raw bytes; raw JSON alone is not provider proof.
      if(typeof rawPayload!=='string'||Buffer.byteLength(rawPayload)>20_480)return deny();
      try {
        const event=await verifyProviderWebhook(rawPayload,signatureHeaders);
        const h=event?.metadata,u=event?.user, p=u?.app_metadata;
        if(h?.name!=='before-user-created'||typeof h.uuid!=='string'||!u4.test(h.uuid)||
           typeof h.time!=='string'||!Number.isFinite(Date.parse(h.time))||
           typeof u?.id!=='string'||!u4.test(u.id)||u.is_anonymous!==false||
           u.aud!=='authenticated'||!emptyOrUnset(u.role)||!emptyOrUnset(u.phone)||
           mail(u.email)!==recipient||p?.provider!=='email'||!Array.isArray(p.providers)||
           p.providers.length!==1||p.providers[0]!=='email')return deny();
        const marked=parse(u?.user_metadata?.[proofKey]), at=now(), eventAt=Date.parse(h.time);
        if(!marked||marked.expiry<=at||eventAt>at+10_000||at-eventAt>maxAge)return deny();
        if(!await store.consume({...marked,subject:u.id,providerEvent:h.uuid}))return deny();
        // Authorization to attempt creation only. Never emits subject, grants,
        // session, identity binding, email delivery attestation or user status.
        return attemptOnly();
      }catch{return deny();}
    }
  });
}

// Embedded Postgres fixture adapter only. No production schema/runtime grant.
export function makeBeforeUserFixtureStore(db) {
  const once=async(q,args)=>(await db.query(q,args)).rows.length===1;
  return Object.freeze({
    reserve:({id,expiry})=>once(`INSERT INTO timeax_before_user_local.intents(id,expires_at)
      SELECT $1,to_timestamp($2::double precision/1000) WHERE to_timestamp($2::double precision/1000)>clock_timestamp()
      ON CONFLICT DO NOTHING RETURNING id`,[id,expiry]),
    consume:({id,expiry,subject,providerEvent})=>once(`UPDATE timeax_before_user_local.intents
      SET attempted_at=clock_timestamp(),attempted_subject=$3::uuid,auth_event=$4::uuid
      WHERE id=$1 AND expires_at=to_timestamp($2::double precision/1000) AND expires_at>clock_timestamp()
      AND attempted_at IS NULL RETURNING id`,[id,expiry,subject,providerEvent]),
  });
}
