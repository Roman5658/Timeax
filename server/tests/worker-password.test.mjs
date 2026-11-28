import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailIdentityRuntime} from '../lib/local-identity-runtime.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';
import {hasWorkerPasswordScope} from '../lib/worker-password.server.mjs';
import {createPushService} from '../lib/web-push.server.mjs';

const origin='https://timeax.pl',path='/api/timeax/auth/public/',password='fixture-worker-password',email='worker@example.test',owner='owner@example.test';
const U='91ab2f65-cee9-47c9-918b-a121efa2df4d',A='91ab2f65-cee9-47c9-918b-a121efa2df4e',
 O='f4f325b3-7a76-46a4-9065-d6cd8d23507d';
const request=(suffix,body,cookie,from=origin)=>new Request(origin+path+suffix,{method:body?'POST':'GET',
 headers:{origin:from,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
const cookie=r=>r.headers.getSetCookie()[0].split(';')[0];
function fixture({pending=false}={}){
 let now=500_000,workerAllowed=true,ownerCalls=0,approved=!pending,puts=0,putGate=async()=>{};
 const credentials=new WeakSet(),sessions=new Map(),writes=[];
 const identity=email=>({issuer:ISSUER,subject:email===owner?A:U,email,emailConfirmed:true,isAnonymous:false});
 const sessionStore={
  async put(id,actor){puts++;await putGate();sessions.set(id,{...actor,expiresAt:now+43_200_000})},async get(id){return sessions.get(id)??null},
  async delete(id){sessions.delete(id)}
 };
 const provider={requestCode:async()=>true,
  async verifyCode(email,_otp,opts){
   const actor=identity(email);if(opts?.forPasswordSetup)credentials.add(actor);return actor;
  },
  async setPassword(actor,password,options){
   assert.deepEqual(options,{verifyLogin:true});
   assert.ok(credentials.has(actor));assert.equal(actor.subject,U);
   credentials.delete(actor);writes.push([actor.email,password]);return true;
  },
  async passwordLogin(e,p){return e===email&&writes.some(([,password])=>p===password)?identity(e):null}
 };
 function start(){
  const pushService=createPushService({origin,publicKey:'A'.repeat(87),lane:{query:async()=>({rows:[{value:{enabled:true}}]})},send:async()=>{}});
  return createEmailIdentityRuntime({origin,otpLength:8,provider,now:()=>now,admitSend:()=>true,sessionStore,
   pushService,
   pendingStore:{get:async()=>null,submit:async()=>null},signupHook:{handler:async()=>new Response(null,{status:204})},
   onboardingStore:{get:async actor=>actor.subject===A?O:null,create:async()=>{ownerCalls++;return O}},
   agencyOperationsFactory:()=>({enabled:['worker','workerTerms'],workerSelfService:true,find:()=>null,
    workerSession:async actor=>actor.subject===U&&workerAllowed&&approved,
    workerPassword:async actor=>actor.subject===U&&workerAllowed&&hasWorkerPasswordScope({
     memberships:pending?[]:[{role:'worker'}],
     applications:pending?[{id:U,organizationId:O,status:'pending',source:'nip'}]:[],
    })})}).handler;
 }
 return {start,writes,sessions,advance:ms=>now+=ms,allow:value=>{workerAllowed=value},approve:()=>{approved=true},
  onPut:fn=>{putGate=fn},puts:()=>puts,ownerCalls:()=>ownerCalls};
}
async function login(handler,email,flow='login'){
 const ch=await handler(request('start',{email,flow}));
 const verified=await handler(request('verify',{code:'12345678'},cookie(ch)));
 assert.equal(verified.status,200);
 assert.deepEqual(await verified.json(),{status:'email-verified'});
 return cookie(verified);
}
test('a current worker OTP proof can set a password once, and password login survives a restart',async()=>{
 const f=fixture(),h=f.start(),s=await login(h,email);
 assert.equal(f.sessions.size,1);assert.ok(!Object.hasOwn([...f.sessions.values()][0],'credential'));
 assert.equal((await h(request('worker-password',{password}))).status,401);
 assert.equal((await h(request('worker-password',{password},s,'https://elsewhere.test'))).status,403);
 assert.equal((await h(request('worker-password',{password,email:owner},s))).status,400);
 assert.equal((await h(request('worker-password',{password:'too-short'},s))).status,400);
 assert.deepEqual(await (await h(request('worker-password',null,s))).json(),{state:'ready'});
 const writes=await Promise.all([h(request('worker-password',{password},s)),h(request('worker-password',{password},s))]);
 assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);assert.deepEqual(f.writes,[[email,password]]);
 assert.equal((await h(request('logout',{},s))).status,204);
 const signedIn=await h(request('password',{email,password}));
 assert.equal(signedIn.status,200);
 assert.match(signedIn.headers.getSetCookie()[0],/Max-Age=43200;/);
 const passSession=cookie(signedIn),again=f.start();
 assert.deepEqual(await (await again(request('worker-password',null,passSession))).json(),{state:'reauthentication-required'});
 assert.equal((await again(request('worker-password',{password},passSession))).status,409);
 assert.equal(f.ownerCalls(),0);
});
test('worker password setup is denied to agencies, ineligible workers, stale proof, and revoked sessions',async()=>{
 const f=fixture(),h=f.start(),a=await login(h,owner),w=await login(h,email);
 assert.equal((await h(request('worker-password',{password},a))).status,403);
 f.allow(false);assert.equal((await h(request('worker-password',{password},w))).status,403);
 f.allow(true);f.advance(300_001);
 assert.equal((await h(request('worker-password',{password},w))).status,409);
 const refreshed=await login(h,email);
 assert.equal((await h(request('logout',{},refreshed))).status,204);
 assert.equal((await h(request('worker-password',{password},refreshed))).status,401);
 assert.deepEqual(f.writes,[]);
});

test('pending workers reuse their registration email proof and can sign in with a password before approval',async()=>{
 const f=fixture({pending:true}),h=f.start(),s=await login(h,email,'registration');
 assert.equal((await (await h(request('worker-password',null,s))).json()).state,'ready');
 assert.equal((await h(request('worker-password',{password},s))).status,200);
 assert.equal((await h(request('logout',{},s))).status,204);
 const r=await h(request('password',{email,password}));
 assert.equal(r.status,200);
 assert.match(r.headers.getSetCookie()[0],/Max-Age=43200;/);
 assert.equal((await r.json()).organizationId,null);
 assert.equal(f.ownerCalls(),0);
});

test('only worker memberships or a pending worker application qualify; active nonworker roles take precedence',()=>{
 const app={id:U,organizationId:O,source:'nip',status:'pending'};
 assert.equal(hasWorkerPasswordScope({memberships:[],applications:[app]}),true);
 assert.equal(hasWorkerPasswordScope({memberships:[],applications:[{...app,source:'invitation'}]}),true);
 assert.equal(hasWorkerPasswordScope({memberships:[],applications:[{...app,status:'approved'}]}),false);
 assert.equal(hasWorkerPasswordScope({memberships:[],applications:[]}),false);
 assert.equal(hasWorkerPasswordScope({memberships:[{role:'worker'}]}),true);
 for(const role of ['agency_admin','factory_admin','team_leader','accountant'])
  assert.equal(hasWorkerPasswordScope({memberships:[{role:'worker'},{role}],applications:[app]}),false);
});

test('fresh password code is bound to the current worker session and does not log out or rotate it',async()=>{
 const f=fixture(),h=f.start(),session=await login(h,email),other=await login(h,owner);
 f.advance(300001);
 const begin={email:'',flow:'worker-password'};
 assert.equal((await h(request('start',begin))).status,401);
 assert.equal((await h(request('start',begin,other))).status,401);
 assert.equal((await h(request('start',{...begin,email:owner},session))).status,400);
 const code=await h(request('start',begin,session));assert.equal(code.status,202);
 const challenge=cookie(code);
 assert.equal((await h(request('verify',{code:'12345678'},other+'; '+challenge))).status,401);
 const ok=await h(request('verify',{code:'12345678'},session+'; '+challenge));
 assert.equal(ok.status,200);assert.ok(!ok.headers.getSetCookie().some(c=>c.startsWith('__Host-timeax-email-identity=')));
 assert.equal((await (await h(request('worker-password',null,session))).json()).state,'ready');
 assert.equal((await h(request('worker-password',{password},session))).status,200);
 assert.equal((await (await h(request('worker-password',null,session))).json()).state,'saved');
 assert.equal((await h(request('logout',{},session))).status,204);
 assert.equal((await h(request('password',{email,password}))).status,200);
});

const promote=(session,from=origin)=>new Request(origin+path+'worker-session',{method:'POST',headers:{origin:from,cookie:session,'Content-Type':'application/json'},body:'{}'});
const push=(session)=>new Request(origin+'/api/web-push',{headers:{'sec-fetch-site':'same-origin',cookie:session}});
test('approval upgrades the original worker signup session for push without another OTP or losing password proof',async()=>{
 const f=fixture({pending:true}),h=f.start(),s=await login(h,email,'registration');
 assert.equal((await h(push(s))).status,409);
 assert.equal((await h(promote(s))).status,403);
 assert.equal((await h(promote(s,'https://elsewhere.test'))).status,403);
 const ownerSession=await login(h,owner,'registration');assert.equal((await h(promote(ownerSession))).status,403);
 f.approve();f.allow(false);assert.equal((await h(promote(s))).status,403);
 f.allow(true);
 const results=await Promise.all([h(promote(s)),h(promote(s))]);
 assert.deepEqual(results.map(result=>result.status),[204,204]);
 assert.equal(f.puts(),1);assert.equal(cookie(results[0]),s);assert.match(results[0].headers.getSetCookie()[0],/Max-Age=43200; Path=\/; Secure; HttpOnly; SameSite=Strict/);
 assert.equal((await h(push(s))).status,200);
 assert.equal((await h(request('worker-password',{password},s))).status,200);
 f.advance(901_000);
 assert.equal((await f.start()(push(s))).status,200);
 assert.equal((await h(request('logout',{},s))).status,204);
 assert.equal((await h(push(s))).status,401);
});

test('sign-out during promotion and actual expiry cannot leave a revived durable worker session',async()=>{
 const f=fixture(),h=f.start(),s=await login(h,email,'registration');
 let allow,entered;const waiting=new Promise(resolve=>{entered=resolve});
 f.onPut(()=>new Promise(resolve=>{allow=resolve;entered()}));
 const upgrading=h(promote(s));await waiting;
 assert.equal((await h(request('logout',{},s))).status,204);
 allow();assert.equal((await upgrading).status,401);
 assert.equal(f.sessions.size,0);assert.equal((await h(push(s))).status,401);
 f.advance(61_000);
 const again=await login(h,email,'registration');
 f.advance(901_000);assert.equal((await h(promote(again))).status,401);
 assert.equal(f.sessions.size,0);
});
