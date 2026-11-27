import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailIdentityRuntime} from '../lib/local-identity-runtime.mjs';
import {createWorkspaceReadHandler} from '../lib/workspace-read.server.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl',email='agency@example.test',password='fixture-only-pw-983';
const actor={issuer:ISSUER,subject:'913b7a53-415d-491d-9e10-731c69476e77',emailConfirmed:true,isAnonymous:false};
const orgId='f4f325b3-7a76-46a4-9065-d6cd8d23507d',memberId='ace5cd8f-28eb-4983-b894-9fc46a049c5e',other='af14b130-a135-4afd-b781-c24fd3af74a3';
const nip='1234567883';
const termsVersion='2026-11-27';
const api='/api/timeax/auth/public/',setup='/api/timeax/agency/setup';
const simulate=(handler,path,body,cookie,from=origin)=>handler(new Request(origin+path,{method:body?'POST':'GET',headers:{
 origin:from,...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
const cookie=res=>res.headers.getSetCookie()[0].split(';')[0];
function fixture(){
 let set=false,failed=true,creates=0;
 const issued=new WeakSet(),owners=new Map();
 const provider={
  requestCode:async()=>true,
  verifyCode:async(a,b,options)=>{const identity={...actor};if(options?.forPasswordSetup)issued.add(identity);return identity;},
  passwordLogin:async(a,p)=>a===email&&p===password&&set?actor:null,
  setPassword:async(credential,p)=>{assert.ok(issued.has(credential));assert.equal(p,password);issued.delete(credential);set=true;return true;},
 };
 const onboardingStore={
  get:async subject=>owners.get(subject.subject)??null,
  create:async(subject,draft)=>{assert.equal(subject.issuer,ISSUER);assert.deepEqual(draft,{agencyName:'Test agency',nip,termsVersion});
   if(failed){failed=false;throw Error('fixture interruption')}
   creates++;owners.set(subject.subject,orgId);return orgId;},
 };
 const start=()=>createEmailIdentityRuntime({origin,provider,otpLength:8,admitSend:()=>true,
  signupHook:{handler:async()=>new Response(null,{status:204})},onboardingStore,
  pendingStore:{get:async()=>null,submit:async()=>null},
  workspaceFactory:resolveSession=>createWorkspaceReadHandler({origin,resolveSession,store:{get:async(identity,id)=>
   owners.get(identity.subject)===id?{state:'ready',organization:{id,kind:'agency'},membership:{id:memberId,role:'agency_admin'},worksites:[]}:null}}),
 }).handler;
 return {start,creates:()=>creates};
}
async function verification(handler,flow){
 const start=await simulate(handler,api+'start',{email,flow});
 const verified=await simulate(handler,api+'verify',{code:'09876543'},cookie(start));
 assert.equal(verified.status,200);
 const json=await verified.json();assert.deepEqual(json,{status:'email-verified'});
 return cookie(verified);
}
test('finish email and password setup after an interruption without duplicating an agency',async()=>{
 const f=fixture();let handler=f.start();
 assert.equal((await simulate(handler,setup)).status,401);
 const session=await verification(handler,'registration');
 const initial=await simulate(handler,setup,null,session);assert.deepEqual(await initial.json(),{state:'details-required',passwordRequired:true});
 assert.equal((await simulate(handler,setup,{agencyName:'Test agency',nip:'1234567890',password,termsVersion},session)).status,400);
 assert.equal((await simulate(handler,'/api/workspace-access/'+orgId,null,session)).status,403);
 const blankNip=await simulate(handler,setup,{agencyName:'Test agency',nip:'',password,termsVersion},session);
 assert.deepEqual(await blankNip.json(),{error:'invalid-nip'});
 const missing=await simulate(handler,setup,{agencyName:'Test agency',nip:'',password},session);
 assert.deepEqual(await missing.json(),{error:'terms-required'});
 assert.equal((await simulate(handler,api+'password',{email,password})).status,401);
 const stale=await simulate(handler,setup,{agencyName:'Test agency',nip:'',password,termsVersion:'2026-01-01'},session);
 assert.deepEqual(await stale.json(),{error:'terms-required'});
 const incomplete=await simulate(handler,setup,{agencyName:'Test agency',nip,password,termsVersion},session);
 assert.equal(incomplete.status,503);assert.equal(f.creates(),0);
 const current=await simulate(handler,setup,null,session);assert.deepEqual(await current.json(),{state:'details-required',passwordRequired:false});
 handler=f.start(); // process restart loses app session, but not the provider password
 assert.equal((await simulate(handler,setup,null,session)).status,401);
 const reentry=await simulate(handler,api+'password',{email,password});
 assert.equal(reentry.status,200);assert.equal((await reentry.json()).state,'details-required');
 const resumed=cookie(reentry);
 const finish=await simulate(handler,setup,{agencyName:'Test agency',nip,termsVersion},resumed);
 assert.deepEqual(await finish.json(),{state:'ready',organizationId:orgId});
 const repeat=await simulate(handler,setup,{agencyName:'Test agency',nip,termsVersion},resumed);
 assert.deepEqual(await repeat.json(),{state:'ready',organizationId:orgId});assert.equal(f.creates(),1);
 assert.equal((await simulate(handler,'/api/workspace-access/'+orgId,null,resumed)).status,200);
 assert.equal((await simulate(handler,'/api/workspace-access/'+other,null,resumed)).status,403);
 const revisit=await simulate(handler,api+'password',{email,password},resumed);
 assert.deepEqual(await revisit.json(),{state:'ready',organizationId:orgId});
 assert.equal((await simulate(handler,setup,null,resumed)).status,401);
});
test('login OTP cannot overwrite a password and cross-origin setup is denied',async()=>{
 const f=fixture(),handler=f.start(),session=await verification(handler,'login');
 assert.equal((await simulate(handler,setup,{agencyName:'Test agency',nip:'',password,termsVersion},session)).status,403);
 assert.equal((await simulate(handler,setup,{agencyName:'Test agency',nip:'',password,termsVersion},session,'https://elsewhere.test')).status,403);
 assert.equal((await simulate(handler,api+'password',{email,password})).status,401);
 assert.equal(f.creates(),0);
});
