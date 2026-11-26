import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync,sign,createHmac} from 'node:crypto';
import {createHostedExistingLogin} from '../lib/existing-session.server.mjs';
import {createProviderTransport,createSignedApprovalReader,ISSUER} from '../lib/provider-adapters.mjs';
import {createDeploymentApproval,privateAdmission} from '../lib/hosted-controls.mjs';
import {targetNode,requireTargetNode,verifyRuntimeManifest} from '../lib/hosted-config.mjs';
import {assembleRuntime} from '../lib/runtime.mjs';
const origin='https://closed-registration.example.test',recipient='synthetic-agency@example.test';
const signed=(key,v)=>{const bytes=Buffer.from(JSON.stringify(v));return bytes.toString('base64url')+'.'+sign(null,bytes,key).toString('base64url')};
function fixture(otpLength=6){
 let at=Date.now(),ready=true,otpOk=true,userConfirmed=true,userEmail=recipient;
 const calls=[],subject=randomUUID(),routeKey=randomBytes(32).toString('base64url');
 const settings={mode:'reviewed-single-recipient-login',origin,recipient,routeKey,publishableKey:'sb_publishable_unit_only_not_a_credential',sessionLifetimeMs:60000,otpLength};
 const response=(url,body,status=200)=>{const r=Response.json(body,{status});Object.defineProperty(r,'url',{value:url});return r};
 const fetchImpl=async(url,init)=>{
  calls.push({path:url.slice(ISSUER.length),method:init.method});
  assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
  if(url.endsWith('/otp')){assert.deepEqual(JSON.parse(init.body),{email:recipient,create_user:false});return response(url,{},otpOk?200:503)}
  if(url.endsWith('/verify')){
   const input=JSON.parse(init.body);assert.equal(input.email,recipient);assert.equal(input.type,'email');
   if(input.token!==(otpLength===8?'12345678':'123456'))return response(url,{},401);
   const claims={iss:ISSUER,sub:subject,aud:'authenticated',role:'authenticated',is_anonymous:false,aal:'aal1',iat:Math.floor(at/1000),exp:Math.floor(at/1000)+600,session_id:randomUUID()};
   return response(url,{access_token:Buffer.from('{"alg":"test-only"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fixture'});
  }
  assert.equal(url,ISSUER+'/user');
  return response(url,{id:subject,email:userEmail,aud:'authenticated',role:'authenticated',is_anonymous:false,email_confirmed_at:userConfirmed?new Date(at-1000).toISOString():null});
 };
 const deps={transport:createProviderTransport({fetchImpl}),checkReadiness:async()=>{if(!ready)throw Error('Closed')},now:()=>at};
 const auth=createHostedExistingLogin(settings,deps);
 const proof=()=>({proofId:randomBytes(32).toString('base64url'),routeSecret:randomBytes(32).toString('base64url'),expiresAt:at+180000});
 return{auth,proof,calls,subject,settings,deps,advance:ms=>at+=ms,setReady:v=>ready=v,setOtp:v=>otpOk=v,setEmail:v=>userEmail=v,setConfirmed:v=>userConfirmed=v};
}
test('target runtime guard keeps exact lower and upper bounds',()=>{
 for(const v of ['24.16.0','24.22.2','23.99.9','25.0.0','invalid','24.23.bad'])assert.equal(targetNode(v),false);
 for(const v of ['24.22.3','24.23.0'])assert.equal(targetNode(v),true);
 assert.throws(()=>requireTargetNode('24.16.0'));assert.doesNotThrow(()=>requireTargetNode('24.22.3'));
});
test('closed configured runtime cannot proceed with an unreviewed DB contract',async()=>{
 let touched=0;await assert.rejects(()=>assembleRuntime({mode:'configured',origin,contract:{reviewed:false}},{laneFactory:()=>{touched++;throw Error()},fetchImpl:()=>{touched++;throw Error()}}));
 assert.equal(touched,0);
 const r=await assembleRuntime({mode:'closed',origin});
 assert.equal((await r.handler(new Request(origin+'/v1/session/context'))).status,503);
});
test('existing sign-in uses real adapter contract, fresh provider verification and a private no-grant receipt',async()=>{
 const f=fixture(),p=f.proof();assert.deepEqual(await f.auth.start(p),{status:'accepted'});
 const receipt=await f.auth.finish({...p,code:'123456'});assert.equal(receipt.state,'pending');assert.deepEqual(receipt.grants,[]);
 assert.equal(f.auth.readIdentity(receipt).subject,f.subject);assert.equal(f.auth.readIdentity(receipt).email,recipient);
 assert.equal(f.auth.readIdentity({state:'pending'}),undefined);assert.deepEqual(f.calls.map(c=>c.path),['/otp','/verify','/user']);
 assert.equal((await f.auth.finish({...p,code:'123456'})).state,'denied');
});
test('missing readiness sends nothing; provider failure does not claim verification',async()=>{
 const f=fixture(),p=f.proof();f.setReady(false);await f.auth.start(p);assert.equal(f.calls.length,0);
 assert.equal((await f.auth.finish({...p,code:'123456'})).state,'denied');
 const g=fixture(),q=g.proof();g.setOtp(false);await g.auth.start(q);assert.equal((await g.auth.finish({...q,code:'123456'})).state,'denied');assert.deepEqual(g.calls.map(c=>c.path),['/otp']);
});
test('confirmed recipient, expiry and five bounded ordinary retries are required',async()=>{
 const f=fixture(),p=f.proof();await f.auth.start(p);f.setConfirmed(false);assert.equal((await f.auth.finish({...p,code:'123456'})).state,'denied');
 f.setConfirmed(true);f.setEmail('another@example.test');assert.equal((await f.auth.finish({...p,code:'123456'})).state,'denied');
 f.setEmail(recipient);for(let i=0;i<3;i++)assert.equal((await f.auth.finish({...p,code:'000000'})).state,'denied');
 assert.equal((await f.auth.finish({...p,code:'123456'})).state,'denied');
 const g=fixture(),q=g.proof();await g.auth.start(q);g.advance(180001);assert.equal((await g.auth.finish({...q,code:'123456'})).state,'denied');
});
test('relogin after a fresh code needs no SQL fixture; restart invalidates in-flight verification',async()=>{
 const f=fixture(),p=f.proof();await f.auth.start(p);const a=await f.auth.finish({...p,code:'123456'});assert.equal(a.state,'pending');
 f.advance(61000);const q=f.proof();await f.auth.start(q);const b=await f.auth.finish({...q,code:'123456'});assert.equal(b.state,'pending');assert.equal(f.auth.readIdentity(b).subject,f.subject);
 const afterRestart=createHostedExistingLogin(f.settings,f.deps);assert.equal((await afterRestart.finish({...q,code:'123456'})).state,'denied');
});
test('ordinary repeated send is bounded and two simultaneous verifications consume once',async()=>{
 const f=fixture(),p=f.proof();await f.auth.start(p);await f.auth.start(p);await f.auth.start(f.proof());assert.equal(f.calls.length,1);
 const receipts=await Promise.all([f.auth.finish({...p,code:'123456'}),f.auth.finish({...p,code:'123456'})]);assert.equal(receipts.filter(r=>r.state==='pending').length,1);
});
test('signed deployment gate binds mail review, build, origin and expiry',async()=>{
 const keys=generateKeyPairSync('ed25519'),at=Date.now(),publicKeyPem=keys.publicKey.export({type:'spki',format:'pem'}),buildSha256='a'.repeat(64),contractSha256='d'.repeat(64),recipientTag='b'.repeat(64);
 let value={purpose:'timeax/closed-hosting/v1',issuer:ISSUER,origin,recipientTag,buildSha256,contractSha256,mail:'operator-confirmed-ready',database:'reviewed-pending-only',instances:1,checkedAt:at-1,validUntil:at+30000};
 const gate=createDeploymentApproval({publicKeyPem,path:'synthetic',origin,recipientTag,buildSha256,contractSha256,read:async()=>signed(keys.privateKey,value),now:()=>at});
 assert.equal((await gate()).instances,1);
 value={...value,mail:null};await assert.rejects(()=>gate());
 value={...value,mail:'operator-confirmed-ready',buildSha256:'c'.repeat(64)};await assert.rejects(()=>gate());
 value={...value,buildSha256,validUntil:at};await assert.rejects(()=>gate());
});
test('private UI admission installs only the recipient-bound signed permit and never sends a code',async()=>{
 const keys=generateKeyPairSync('ed25519'),at=Date.now(),routeKey=randomBytes(32).toString('base64url');
 let ready=true,calls=0;
 const approval=createSignedApprovalReader({publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),readinessPath:'synthetic',now:()=>at,
  read:async()=>{if(!ready)throw Error();return signed(keys.privateKey,{issuer:ISSUER,hook:'verified-deny-by-default',signup:'separately-approved',scope:'pending-no-app-rights',checkedAt:at-1,validUntil:at+30000})}});
 const handler=privateAdmission({handler:async()=>{calls++;return Response.json({})},approval,origin,recipient,routeKey,now:()=>at});
 const permit=signed(keys.privateKey,{purpose:'timeax/enrollment-route/v1',issuer:ISSUER,id:randomBytes(32).toString('base64url'),
  recipientTag:createHmac('sha256',Buffer.from(routeKey,'base64url')).update(recipient).digest('hex'),issuedAt:at-1,expiresAt:at+180000});
 const request=()=>new Request(origin+'/api/timeax/access/open',{method:'POST',headers:{origin,'Content-Type':'application/json','sec-fetch-site':'same-origin'},body:JSON.stringify({permit})});
 let r=await handler(request());assert.equal(r.status,200);assert.deepEqual((await r.json()).grants,[]);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);assert.equal(calls,0);
 ready=false;r=await handler(request());assert.equal(r.status,503);assert.equal(r.headers.get('set-cookie'),null);assert.equal(calls,0);
});

test('configured hosted composition exposes only guarded existing identity; unavailable pending SQL never becomes a successful application',async()=>{
 const {ENROLLMENT_SIGNATURES,ENROLLMENT_RESULT_CONTRACT}=await import('../lib/enrollment-rpc-store.mjs');
 const f=fixture(8),keys=generateKeyPairSync('ed25519'),at=Date.now(),buildSha256='a'.repeat(64),contractSha256='d'.repeat(64);
 const signatures=[...ENROLLMENT_SIGNATURES.web,...ENROLLMENT_SIGNATURES.hook,'timeax_api.request_agency_registration(text,text,text,text)','timeax_api.my_agency_registration(text,text)'];
 let dbReady=true,mailReady=true,sqlQueries=0;const preflights=[];
 const config={mode:'configured',origin,recipient,hostedProfile:{id:'agency-pending-single-process-v1',instances:1},poolerHost:'aws-0-eu-central-1.pooler.supabase.com',
 publishableKey:f.settings.publishableKey,buildSha256,contractSha256,deploymentApprovalPath:'unit-deployment',readinessPath:'unit-readiness',
 approvalPublicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),
 secrets:{dbCA:'unit lane only',webPassword:'w'.repeat(32),hookPassword:'h'.repeat(32),pendingPassword:'p'.repeat(32),intentKey:randomBytes(32).toString('base64url'),routeKey:f.settings.routeKey,webhookSecret:'whsec_'+randomBytes(32).toString('base64')},
 contract:{reviewed:true,sourceSha256:'e'.repeat(64),pendingRole:'timeax_pending_registration_login',enrollmentResult:ENROLLMENT_RESULT_CONTRACT,
 functions:signatures.map(signature=>({signature,owner:signature.startsWith('timeax_api.')?'postgres':'timeax_enrollment_owner',sha256:'f'.repeat(64)}))}};
 const tag=createHmac('sha256',Buffer.from(config.secrets.routeKey,'base64url')).update(recipient).digest('hex');
 const runtime=await assembleRuntime(config,{
 laneFactory:s=>({async preflight(){preflights.push(s.role);if(!dbReady)throw Error('Database unavailable');return true},async query(){sqlQueries++;throw Error('No real SQL in this unit test')}}),
 fetchImpl:f.deps.transport,
 readApproval:async()=>signed(keys.privateKey,{issuer:ISSUER,hook:'verified-deny-by-default',signup:'separately-approved',scope:'pending-no-app-rights',checkedAt:Date.now()-1,validUntil:Date.now()+30000}),
 readDeploymentApproval:async()=>signed(keys.privateKey,{purpose:'timeax/closed-hosting/v1',issuer:ISSUER,origin,recipientTag:tag,buildSha256,contractSha256,
 mail:mailReady?'operator-confirmed-ready':null,database:'reviewed-pending-only',instances:1,checkedAt:at-1,validUntil:at+300000})});
 const jar=new Map();
 async function request(route,input){
  const r=await runtime.handler(new Request(origin+route,{method:input?'POST':'GET',headers:{cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(input?{origin,'Content-Type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})}));
  for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1))}
  return r;
 }
 const permit=signed(keys.privateKey,{purpose:'timeax/enrollment-route/v1',issuer:ISSUER,id:randomBytes(32).toString('base64url'),recipientTag:tag,issuedAt:at-1,expiresAt:at+180000});
 assert.equal((await request('/api/timeax/access/open',{permit})).status,200);
 assert.equal((await(await request('/v1/session/existing-context')).json()).capabilities.login,true);
 assert.equal((await request('/api/timeax/auth/existing/start',{email:recipient})).status,202);
 assert.equal((await(await request('/v1/session/existing-context')).json()).otpLength,8);
 assert.equal((await request('/api/timeax/auth/existing/verify',{email:recipient,code:'123456'})).status,400);
 assert.equal((await request('/api/timeax/auth/existing/verify',{email:recipient,code:'12345678'})).status,200);
 const context=await(await request('/v1/session/context')).json();assert.equal(context.state,'verified');assert.deepEqual(context.grants,[]);
 assert.equal((await request('/api/agency-registration')).status,503);assert.equal(sqlQueries,1);
 assert.equal((await request('/api/workspace/context')).status,503);
 const before=f.calls.length;dbReady=false;
 assert.equal((await request('/api/timeax/auth/existing/start',{email:recipient})).status,503);assert.equal(f.calls.length,before);
 dbReady=true;mailReady=false;assert.equal((await request('/v1/session/context')).status,503);assert.equal(f.calls.length,before);
 assert.ok(preflights.length>3);
});
