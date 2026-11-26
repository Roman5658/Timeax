import {createEmailIdentityRuntime,assembleScopedPendingStore} from './local-identity-runtime.mjs';
import {createPublicEmailProvider} from './public-email-provider.mjs';
import {createPublicSignupHook} from './public-signup-hook.mjs';
import {createProviderWebhookVerifier} from './provider-adapters.mjs';

// Explicit single-process profile. A separate hourly budget bounds aggregate
// email traffic alongside the per-recipient/minute and verification limits.
// Neither forwarded addresses nor browser-supplied identifiers are trusted.
export function createHourlySendBudget(limit,now=Date.now){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid hourly email budget');
 const admitted=[];
 return ()=>{
  const at=now();
  while(admitted.length&&admitted[0]+3_600_000<=at)admitted.shift();
  if(admitted.length>=limit)return false;
  admitted.push(at);return true;
 };
}

export async function assembleHostedEmailAuth(config,{fetchImpl=globalThis.fetch,laneFactory,now=Date.now}={}){
 if(config?.mode!=='public-email-v1'||config.instances!==1||
  !['https://timeax.pl','https://www.timeax.pl'].includes(config.origin))throw Error('Expected explicit canonical HTTPS email profile');
 if(!/^[a-f0-9]{64}$/.test(config.registrationSha??'')||!/^[a-f0-9]{64}$/.test(config.statusSha??''))
  throw Error('Pinned registration database definitions required');
 const admitSend=createHourlySendBudget(config.hourlyEmailBudget,now);
 const verifyWebhook=createProviderWebhookVerifier(config.webhookSecret);
 const signupHook=createPublicSignupHook({origin:config.origin,verifyWebhook,now});
 const provider=createPublicEmailProvider({publishableKey:config.key,otpLength:config.otpLength,
  signupIntent:signupHook.withRegistrationIntent},{fetchImpl,now});
 const pendingStore=await assembleScopedPendingStore(config,{laneFactory});
 return createEmailIdentityRuntime({origin:config.origin,provider,pendingStore,otpLength:config.otpLength,admitSend,signupHook,now});
}
