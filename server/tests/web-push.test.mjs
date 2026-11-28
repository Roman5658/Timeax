import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createECDH,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createPushSender,createPushService,PUSH_SQL,validatePushSubscription} from '../lib/web-push.server.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';
const id=n=>'12345678-1234-4123-8123-'+String(n).padStart(12,'0');
const auth=randomBytes(16).toString('base64url');
const key=()=>{const e=createECDH('prime256v1');const p=e.generateKeys();return {publicKey:p.toString('base64url'),privateKey:e.getPrivateKey().toString('base64url')}};
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/fixture-registration-token',keys:{p256dh:key().publicKey,auth}};
test('sends encrypted generic Web Push on a pinned provider endpoint, never follows redirects',async()=>{
 assert.equal(validatePushSubscription(sub),true);
 for(const apple of ['web.push.apple.com','fixture.push.apple.com'])
  assert.equal(validatePushSubscription({...sub,endpoint:`https://${apple}/fixture-registration-token`}),true);
 for(const outsideApple of ['push.apple.com','evil.push.apple.com.example','other.apple.com'])
  assert.equal(validatePushSubscription({...sub,endpoint:`https://${outsideApple}/fixture-registration-token`}),false);
 for(const unsafe of ['https://127.0.0.1/fcm/send/a','https://fcm.googleapis.com.evil.example/fcm/send/a','https://fcm.googleapis.com:444/fcm/send/a','https://user@fcm.googleapis.com/fcm/send/a','https://fcm.googleapis.com/fcm/send/abc?redirect=bad'])
  assert.equal(validatePushSubscription({...sub,endpoint:unsafe}),false);
 let calls=0;
 const send=createPushSender(key(),async (url,options)=>{
  calls++;assert.equal(url,sub.endpoint);assert.equal(options.redirect,'error');assert.equal(options.method,'POST');
  assert.equal(options.headers['Content-Encoding'],'aes128gcm');assert.match(options.headers.Authorization,/^vapid /i);
  assert.ok(Buffer.isBuffer(options.body));assert.equal(options.body.includes(Buffer.from('Timeax')),false);
  return new Response(null,{status:201});
 });
 assert.equal(await send({subscription:sub,language:'ru',organizationId:id(4)}),'delivered');assert.equal(calls,1);
 assert.equal(await send({subscription:{...sub,endpoint:'https://example.com/'},organizationId:id(4)}),'discard');assert.equal(calls,1);
});

test('Web Push settings allow only the current verified browser and drain bounded claimed jobs',async()=>{
 const origin='https://timeax.pl',session='7'.repeat(64),args=[],out=[];
 const lane={async query(sql,a){assert.equal(sql,PUSH_SQL);args.push(a);const b=JSON.parse(a[3]);
  if(a[2]==='claim')return {rows:[{value:args.filter(v=>v[2]==='claim').length===1?[{id:id(9)}]:[]}]};
  if(a[2]==='finish')out.push(b);
  if(a[2]==='enable')assert.equal(b.session,session);
  return {rows:[{value:{enabled:a[2]==='enable'}}]};
 }};
 const service=createPushService({origin,lane,publicKey:key().publicKey,send:async()=> 'delivered',interval:8});
 let verified=true;
 const route=service.routes(async()=>({issuer:ISSUER,subject:id(1),state:verified?'verified':'anonymous',pushSessionKey:session,isActive:async()=>true}));
 const req=(body,from=origin)=>new Request(origin+'/api/web-push',{method:'POST',headers:{origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data={action:'enable',language:'ru',subscription:sub};
 assert.equal((await route(req(data,'https://elsewhere.invalid'))).status,403);
 verified=false;assert.equal((await route(req(data))).status,401);verified=true;
 assert.equal((await route(req({...data,user:id(2)}))).status,400);
 assert.deepEqual(await (await route(req(data))).json(),{enabled:true});
 try{
  service.start();for(let i=0;i<80&&!out.length;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(out[0]?.outcome,'delivered');assert.equal(out[0]?.id,id(9));
 }finally{service.stop()}
});

test('Apple delivery diagnostics distinguish provider acceptance, rejection, expiry, retry and network failure without private values',async()=>{
 const events=[],apple={...sub,endpoint:'https://web.push.apple.com/private-fixture-registration-token'},workspace=id(4);
 const secret='fixture-secret';
 let status=201;
 const send=createPushSender({...key(),report:event=>events.push(event)},async()=>{
  if(status===null)throw Error(apple.endpoint+' '+workspace+' '+secret);
  return new Response(secret,{status});
 });
 const job={subscription:apple,language:'pl',organizationId:workspace};
 assert.equal(await send(job),'delivered');
 for(const [http,expected] of [[403,'discard'],[410,'expired'],[429,'retry']]){
  status=http;assert.equal(await send(job),expected);
 }
 status=null;await assert.rejects(()=>send(job));
 assert.deepEqual(events.map(({at,...fields})=>{
  assert.equal(new Date(at).toISOString(),at);return fields;
 }),[
  {phase:'delivery',provider:'apple',status:201,outcome:'provider-accepted'},
  {phase:'delivery',provider:'apple',status:403,outcome:'discard'},
  {phase:'delivery',provider:'apple',status:410,outcome:'expired'},
  {phase:'delivery',provider:'apple',status:429,outcome:'retry'},
  {phase:'delivery',provider:'apple',outcome:'transport-error'},
 ]);
 for(const privateValue of [apple.endpoint,workspace,secret,sub.keys.auth,sub.keys.p256dh])assert.equal(JSON.stringify(events).includes(privateValue),false);
});

test('push queue diagnostics report failed claims and finishes without logging payloads or repeated errors',async()=>{
 const events=[],origin='https://timeax.pl';let claim=0;
 const service=createPushService({origin,publicKey:key().publicKey,interval:8,report:e=>events.push(e),send:async()=> 'delivered',lane:{
  async query(_sql,args){
   if(args[2]==='claim'&&++claim>2)return {rows:[{value:[{id:id(9)}]}]};
   throw Error('fixture-secret '+id(9));
  },
 }});
 try{
  service.start();for(let i=0;i<80&&claim<5;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(claim>=5);
  assert.deepEqual(events.map(({at,...fields})=>fields),[{phase:'claim',outcome:'queue-error'},{phase:'finish',outcome:'queue-error'}]);
 }finally{service.stop()}
});

test('SQL queues a generic push for enrolled recipients even without a worksite, preserves it on normal expiry, and revokes it on sign-out',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE timeax_team_owner;
   CREATE SCHEMA timeax_core; CREATE SCHEMA timeax_team; CREATE SCHEMA timeax_api;
   CREATE TABLE timeax_core.identities(id uuid PRIMARY KEY,issuer text,subject text,active boolean);
   CREATE TABLE timeax_core.identity_issuers(issuer text PRIMARY KEY,active boolean);
   CREATE TABLE timeax_core.organizations(id uuid PRIMARY KEY,kind text,state text);
   CREATE TABLE timeax_core.memberships(id uuid PRIMARY KEY,organization_id uuid,identity_id uuid,role text,state text);
   CREATE TABLE timeax_core.web_sessions(token_digest text PRIMARY KEY,subject uuid,expires_at timestamptz);
   CREATE TABLE timeax_core.agency_worker_join_events(agency_id uuid);
   CREATE TABLE timeax_core.agency_worker_applications(agency_id uuid,approved_at timestamptz);
   CREATE TABLE timeax_core.backdated_shift_notices(agency_id uuid);
   CREATE TABLE timeax_core.earlier_shift_requests(agency_id uuid);
   CREATE TABLE timeax_team.deliveries(recipient uuid,read_at timestamptz);
   INSERT INTO timeax_core.identity_issuers VALUES('fixture',true);
   INSERT INTO timeax_core.organizations VALUES('${id(1)}','agency','active'),('${id(2)}','agency','active');
   INSERT INTO timeax_core.identities VALUES('${id(3)}','fixture','${id(4)}',true),('${id(5)}','fixture','${id(6)}',true);
   INSERT INTO timeax_core.memberships VALUES('${id(7)}','${id(1)}','${id(3)}','worker','active'),
      ('${id(8)}','${id(2)}','${id(5)}','agency_admin','active');
   INSERT INTO timeax_core.web_sessions VALUES('${'a'.repeat(64)}','${id(4)}',now()+interval '1 hour'),
      ('${'b'.repeat(64)}','${id(6)}',now()+interval '1 hour');
  `);
  const migration=await readFile(new URL('../operator/web-push.sql',import.meta.url),'utf8');
  const guard="session_user<>'timeax_web_push_login'";
  assert.ok(migration.includes(guard));
  // PGlite does not restore session_user after a SET LOCAL SESSION AUTHORIZATION.
  // Run the RPC as owner in this fixture only and independently assert its grants.
  await db.exec(migration.replace(guard,"session_user<>'postgres'"));
  await db.exec(await readFile(new URL('../operator/web-push-worker-application.sql',import.meta.url),'utf8'));
  const acl=(await db.query("SELECT has_function_privilege('anon','timeax_api.web_push(text,text,text,jsonb)','execute') anon, has_function_privilege('timeax_web_push_login','timeax_api.web_push(text,text,text,jsonb)','execute') lane")).rows[0];
  assert.deepEqual(acl,{anon:false,lane:true});
  const run=async(action,input,subj=null)=>{
   return (await db.query(PUSH_SQL,[subj?'fixture':null,subj,action,JSON.stringify(input)])).rows[0].value;
  };
  await assert.rejects(()=>run('enable',{session:'c'.repeat(64),language:'ru',...sub},id(4)),e=>e.code==='42501');
  await run('enable',{session:'a'.repeat(64),language:'ru',...sub},id(4));
  await db.exec(`INSERT INTO timeax_team.deliveries VALUES('${id(7)}',NULL),('${id(7)}',NULL),('${id(8)}',NULL)`);
  const one=await run('claim',{lease:id(10)});assert.equal(one.length,1);assert.equal(one[0].organizationId,id(1));
  assert.deepEqual(one[0].subscription,sub);
  assert.deepEqual(await run('claim',{lease:id(11)}),[]);
  await run('finish',{lease:id(11),id:one[0].id,outcome:'delivered'});
  assert.equal((await db.query('SELECT count(*)::int n FROM timeax_push.jobs')).rows[0].n,1);
  await run('finish',{lease:id(10),id:one[0].id,outcome:'delivered'});
  assert.equal((await db.query('SELECT count(*)::int n FROM timeax_push.jobs')).rows[0].n,0);
  const agencySub={...sub,endpoint:'https://fcm.googleapis.com/fcm/send/fixture-agency-registration-token'};
  await run('enable',{session:'b'.repeat(64),language:'pl',...agencySub},id(6));
  await db.exec(`INSERT INTO timeax_core.agency_worker_applications VALUES('${id(2)}',now()),('${id(1)}',NULL)`);
  assert.deepEqual(await run('claim',{lease:id(19)}),[]);
  for(const [i,source] of ['agency_worker_join_events','backdated_shift_notices','earlier_shift_requests','agency_worker_applications'].entries()){
   await db.exec(`INSERT INTO timeax_core.${source}(agency_id) VALUES('${id(2)}')`);
   const lease=id(20+i),hits=await run('claim',{lease});
   assert.equal(hits.length,1,source);
   assert.equal(hits[0].organizationId,id(2),source);
   assert.deepEqual(hits[0].subscription,agencySub,source);
   await run('finish',{lease,id:hits[0].id,outcome:'delivered'});
  }
  await run('disable',{session:'b'.repeat(64),endpoint:agencySub.endpoint},id(6));
  await db.exec(`UPDATE timeax_core.web_sessions SET expires_at=now()-interval '1 minute' WHERE token_digest='${'a'.repeat(64)}';
   DELETE FROM timeax_core.web_sessions WHERE token_digest='${'a'.repeat(64)}';
   INSERT INTO timeax_team.deliveries VALUES('${id(7)}',NULL)`);
  assert.equal((await run('claim',{lease:id(12)})).length,1);
  await db.exec(`INSERT INTO timeax_core.web_sessions VALUES('${'d'.repeat(64)}','${id(4)}',now()+interval '1 hour')`);
  assert.deepEqual(await run('status',{session:'d'.repeat(64),endpoint:sub.endpoint},id(4)),{enabled:true});
  await db.exec(`DELETE FROM timeax_core.web_sessions WHERE token_digest='${'d'.repeat(64)}'`);
  assert.equal((await db.query('SELECT count(*)::int n FROM timeax_push.subscriptions')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM timeax_push.jobs')).rows[0].n,0);
 }finally{await db.close()}
});
