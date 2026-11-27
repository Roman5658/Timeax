import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailIdentityRuntime} from '../lib/local-identity-runtime.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl';
const make=(options={})=>createEmailIdentityRuntime({origin,otpLength:8,
 provider:{requestCode:async()=>true,verifyCode:async()=>({issuer:ISSUER,subject:'91ab2f65-cee9-47c9-918b-a121efa2df4d',emailConfirmed:true,isAnonymous:false})},
 pendingStore:{get:async()=>null,submit:async()=>null},admitSend:()=>true,
 signupHook:{handler:async()=>new Response(null,{status:204})},...options});
const api='/api/timeax/auth/public/';
const context='/v1/session/timeax-email';
const request=(path,{body,cookie,from=origin}={})=>new Request(origin+path,{method:body===undefined?'GET':'POST',
 headers:{origin:from,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},
 ...(body===undefined?{}:{body:JSON.stringify(body)})});
test('canonical HTTPS runtime requires a hook and does not accept preview domains',()=>{
 assert.throws(()=>make({signupHook:undefined}));
 assert.throws(()=>make({origin:'https://example.test'}));
});
test('canonical HTTPS auth issues secure host cookies and grants only its own pending status',async()=>{
 const {handler}=make();
 assert.equal((await handler(request(api+'start',{body:{email:'any@example.test',flow:'registration'},from:'https://elsewhere.test'}))).status,403);
 const started=await handler(request(api+'start',{body:{email:'any@example.test',flow:'registration'}}));
 assert.equal(started.status,202);
 const challenge=started.headers.getSetCookie()[0];
 assert.match(challenge,/^__Host-timeax-email-challenge=.*; Secure; HttpOnly; SameSite=Strict$/);
 const verified=await handler(request(api+'verify',{body:{code:'12345678'},cookie:challenge.split(';')[0]}));
 assert.equal(verified.status,200);
 const session=verified.headers.getSetCookie()[0];
 assert.match(session,/^__Host-timeax-email-identity=.*; Secure; HttpOnly; SameSite=Strict$/);
 const cookie=session.split(';')[0];
 assert.deepEqual((await (await handler(request(context,{cookie}))).json()).grants,[]);
 assert.equal((await handler(request('/api/agency-registration',{cookie}))).status,200);
 assert.notEqual((await handler(request('/api/owner-qa/operations',{cookie}))).status,200);
 const logged=await handler(request(api+'logout',{cookie,body:{}}));
 assert.equal(logged.status,204);
 assert.match(logged.headers.get('set-cookie'),/^__Host-timeax-email-identity=; Max-Age=0; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
 assert.equal((await handler(request('/api/agency-registration',{cookie}))).status,401);
});

const sessionsTest = new Map();
test('ordinary login survives process restart with durable storage and logout revokes it',async()=>{
 const sessionStore={
  async get(id){return sessionsTest.get(id)??null},
  async put(id,identity){sessionsTest.set(id,{...identity,expiresAt:Date.now()+43_200_000})},
  async delete(id){sessionsTest.delete(id)}
 };
 const first=make({sessionStore});
 const challenge=(await first.handler(request(api+'start',{body:{email:'worker@example.test',flow:'login'}}))).headers.getSetCookie()[0].split(';')[0];
 const verify=await first.handler(request(api+'verify',{body:{code:'00000001'},cookie:challenge}));
 assert.equal(verify.status,200);
 const token=verify.headers.getSetCookie()[0];
 assert.match(token,/Max-Age=43200; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
 const cookie=token.split(';')[0];
 const restarted=make({sessionStore});
 assert.equal((await (await restarted.handler(request(context,{cookie}))).json()).state,'verified');
 assert.equal((await restarted.handler(request('/api/agency-registration',{cookie}))).status,200);
 assert.equal((await restarted.handler(request(api+'logout',{cookie,body:{}}))).status,204);
 const afterLogout=make({sessionStore});
 assert.equal((await (await afterLogout.handler(request(context,{cookie}))).json()).state,'anonymous');
});
test('unfinished registration remains a short-lived process proof, not a durable login',async()=>{
 let writes=0;
 const store={get:async()=>null,put:async()=>{writes++},delete:async()=>{}};
 const first=make({sessionStore:store});
 const challenge=(await first.handler(request(api+'start',{body:{email:'new@example.test',flow:'registration'}}))).headers.getSetCookie()[0].split(';')[0];
 const verified=await first.handler(request(api+'verify',{cookie:challenge,body:{code:'00000001'}}));
 assert.equal(verified.status,200);
 assert.match(verified.headers.getSetCookie()[0],/Max-Age=900;/);
 assert.equal(writes,0);
});
