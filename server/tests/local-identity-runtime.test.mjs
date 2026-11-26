import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createLocalIdentityRuntime} from '../lib/local-identity-runtime.mjs';
import {createRuntimeServer} from '../lib/node-host.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const subject='1c556e2f-a8fc-4bb5-a02b-6c5566b38daa',mail='owner@example.test';
test('browser URL goes through HTTP: signup, saved pending agency, logout and existing sign-in',async t=>{
 const origin='http://127.0.0.1:55173',sends=[],records=new Map();let at=Date.now();
 const runtime=createLocalIdentityRuntime({origin,otpLength:8,provider:{
  async requestCode(address,flow){sends.push({address,flow});return true},
  async verifyCode(address,code){const other='67207522-4f73-4506-a23c-917baf14d399';
   return address===mail&&code==='34567812'||address==='another@example.test'&&code==='98765432'
    ?{subject:address===mail?subject:other,issuer:ISSUER,emailConfirmed:true,isAnonymous:false}:null}
 },pendingStore:{
  async get(identity){return records.get(identity.subject)??null},
  async submit(identity,draft){
   assert.equal(draft.agencyName,'Timeax Test Agency');
   const receipt={requestId:'738b9367-982c-4e9d-914b-6b6bb60991fa',status:'pending',requestedAt:'2026-11-26T07:00:00.000Z'};
   records.set(identity.subject,receipt);return receipt;
  }
 },now:()=>at});
 const server=await createRuntimeServer({runtime,origin,publicDir:fileURLToPath(new URL('../../public/',import.meta.url))});
 await new Promise((ok,reject)=>{server.once('error',reject);server.listen(55173,'127.0.0.1',ok)});
 t.after(()=>{server.closeAllConnections();server.close()});
 const api='/api/timeax/auth/public/',context='/v1/session/timeax-email',agency='/api/agency-registration';
 const call=(path,{body,cookie,host=origin}={})=>fetch(origin+path,{method:body?'POST':'GET',
  headers:{origin:host,'sec-fetch-site':'same-origin',...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await call(context)).status,200);
 assert.equal((await call(agency)).status,401);
 assert.equal((await call(api+'start',{body:{email:mail,flow:'registration'},host:'https://example.test'})).status,403);
 const sent=await call(api+'start',{body:{email:mail,flow:'registration'}});
 assert.equal(sent.status,202);
 const challenge=sent.headers.getSetCookie()[0].split(';')[0];
 const verified=await call(api+'verify',{body:{code:'34567812'},cookie:challenge});
 assert.equal(verified.status,200);
 const session=verified.headers.getSetCookie()[0].split(';')[0];
 assert.deepEqual((await (await call(context,{cookie:session})).json()).grants,[]);
 assert.equal((await call(agency,{cookie:session,body:{agencyName:'Timeax Test Agency'}})).status,202);
 assert.equal((await call(api+'logout',{cookie:session,body:{}})).status,204);
 assert.equal((await call(agency,{cookie:session})).status,401);
 at+=61_000;
 const login=await call(api+'start',{body:{email:mail,flow:'login'}});
 assert.equal(login.status,202);
 const second=await call(api+'verify',{body:{code:'34567812'},cookie:login.headers.getSetCookie()[0].split(';')[0]});
 assert.equal(second.status,200);
 const saved=await call(agency,{cookie:second.headers.getSetCookie()[0].split(';')[0]});
 assert.equal((await saved.json()).registration.status,'pending');
 const another=await call(api+'start',{body:{email:'another@example.test',flow:'registration'}});
 assert.equal(another.status,202);
 const anotherVerified=await call(api+'verify',{body:{code:'98765432'},cookie:another.headers.getSetCookie()[0].split(';')[0]});
 assert.equal(anotherVerified.status,200);
 const anotherSession=anotherVerified.headers.getSetCookie()[0].split(';')[0];
 const anotherStatus=await call(agency,{cookie:anotherSession});
 assert.equal((await anotherStatus.json()).registration,null);
 assert.deepEqual(sends.map(v=>v.flow),['registration','login','registration']);
});
