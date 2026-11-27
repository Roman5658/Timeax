import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerInvitationMailer} from '../lib/worker-invitation-mail.mjs';

const env={
 TIMEAX_WORKER_INVITE_MAIL_ENABLED:'1',
 TIMEAX_WORKER_INVITE_RESEND_API_KEY:'re_synthetic_not_a_real_key',
 TIMEAX_WORKER_INVITE_MAIL_FROM:'no-reply@timeax.pl',
};
const invitation={email:'worker@example.test',deliveryId:'fb2974d0-2eed-48f1-a396-2631865c61a6',language:'uk'};
const make=fetchImpl=>createWorkerInvitationMailer({env,fetchImpl});

test('worker invitation mail requires explicit activation, scoped sender and syntactically valid server-only key',()=>{
 const fetchImpl=()=>assert.fail('never contacts the provider during setup');
 for(const config of [{}, {...env,TIMEAX_WORKER_INVITE_MAIL_ENABLED:'true'},
  {...env,TIMEAX_WORKER_INVITE_RESEND_API_KEY:''}, {...env,TIMEAX_WORKER_INVITE_MAIL_FROM:'spoof@timeax.pl.example.test'},
  {...env,TIMEAX_WORKER_INVITE_MAIL_FROM:'Sender <valid@timeax.pl>'},
  {...env,TIMEAX_WORKER_INVITE_MAIL_FROM:'no-reply@timeax.pl\r\nBcc:someone@example.test'}]){
  assert.equal(createWorkerInvitationMailer({env:config,fetchImpl}),null);
 }
});

test('worker invitation sends minimal localized transaction with a fixed public login link and stable idempotency',async()=>{
 const calls=[];
 const mailer=make(async(url,init)=>{
  calls.push({url,init});
  return Response.json({id:'provider-response-not-returned'});
 });
 for(const deliveryId of [invitation.deliveryId,invitation.deliveryId.toUpperCase()]){
  assert.deepEqual(await mailer.send({...invitation,deliveryId,agencyName:'Do not disclose',workerName:'Do not disclose',code:'Do not disclose',link:'https://wrong.example.test'}),{status:'submitted'});
 }
 const [{url,init}]=calls;
 assert.equal(url,'https://api.resend.com/emails');
 assert.equal(init.method,'POST');
 assert.equal(init.redirect,'error');
 assert.equal(init.credentials,'omit');
 assert.ok(init.signal instanceof AbortSignal);
 assert.equal(init.headers.authorization,'Bearer re_synthetic_not_a_real_key');
 assert.equal(init.headers['idempotency-key'],'timeax/worker-invitation/'+invitation.deliveryId);
 assert.equal(init.headers['idempotency-key'],calls[1].init.headers['idempotency-key']);
 assert.equal(init.body,calls[1].init.body);
 const body=JSON.parse(init.body);
 assert.deepEqual(Object.keys(body).sort(),['from','subject','text','to']);
 assert.deepEqual(body.to,['worker@example.test']);
 assert.equal(body.from,'Timeax <no-reply@timeax.pl>');
 assert.equal(body.subject,'Запрошення до Timeax');
 assert.deepEqual(body.text.match(/https:\S+/g),['https://timeax.pl/login?method=code']);
 assert.doesNotMatch(body.text,/wrong|disclose|@/i);
});

test('worker invitation rejects malformed or multiple recipients and non-UUID delivery keys without any network call',async()=>{
 const mailer=make(()=>assert.fail('no provider call'));
 for(const changes of [{email:'plain'}, {email:'user@example.test,bcc@example.test'}, {email:'Worker <worker@example.test>'},
   {email:'user@example.test\nBcc:other@example.test'}, {deliveryId:'invalid'}, {email:['a@b.test','b@b.test']}])
  assert.deepEqual(await mailer.send({...invitation,...changes}),{status:'rejected'});
});

test('worker invitation treats retryables and rejections distinctly without leaking provider payloads',async()=>{
 for(const status of [400,401,403,422,408,409,429,500,503]){
  const mailer=make(async()=>new Response('provider payload or address',{status}));
  const expected=[408,409,429,500,503].includes(status)?'retry':'rejected';
  assert.deepEqual(await mailer.send(invitation),{status:expected});
 }
 const disconnected=make(async()=>{throw Error('secret transport diagnostic')});
 assert.deepEqual(await disconnected.send(invitation),{status:'retry'});
});
