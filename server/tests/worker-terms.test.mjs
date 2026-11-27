import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createWorkerTerms,WORKER_TERMS_VERSION,WORKER_TERMS_SHA256,WORKER_TERMS_SQL,WORKER_TERMS_METHOD} from '../lib/worker-terms.mjs';
import {createWorkerEnrollmentHandler} from '../lib/worker-enrollment.server.mjs';
import {createAccountAdminHandler} from '../lib/account-admin.mjs';
import {ISSUER} from '../lib/provider-adapters.mjs';

const origin='https://timeax.pl',root=origin+'/api/worker-enrollment/terms',subject='22345678-1234-4123-8123-123456789013';
const acceptedAt='2026-11-27T12:00:00Z';
const req=(body)=>new Request(root,body===undefined?{}:{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const projection=accepted=>({accepted,acceptedAt:accepted?acceptedAt:null,version:WORKER_TERMS_VERSION,documentSha256:WORKER_TERMS_SHA256});

test('the archived legal pages, server receipt and both private SQL pins describe the same frozen document',async()=>{
 const archived=JSON.parse(await readFile(new URL('../../src/shared/legal/hosted-terms-2026-11-27.json',import.meta.url),'utf8'));
 const sql=await readFile(new URL('../operator/worker-terms.sql',import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(JSON.stringify(archived.document)).digest('hex'),WORKER_TERMS_SHA256);
 assert.equal(archived.sha256,WORKER_TERMS_SHA256);
 assert.equal(archived.document.version,WORKER_TERMS_VERSION);
 assert.equal(sql.split(WORKER_TERMS_SHA256).length-1,2);
 for(const language of ['pl','uk','ru','en']){
  assert.ok(archived.document.locales[language]?.title);
  assert.equal(archived.document.locales[language].sections.length,5);
 }
});

test('a verified session enters worker terms; explicit current checkbox records only its actor, repeats are idempotent',async()=>{
 const calls=[];
 let accepted=false,active=false;
 const workerTerms=createWorkerTerms({async query(sql,input){
  assert.equal(sql,WORKER_TERMS_SQL);calls.push(input);
  if(input[0]==='accept')accepted=true;
  return {rows:[{value:projection(accepted)}]};
 }});
 const handler=createWorkerEnrollmentHandler({origin,store:{},workerTerms,requireWorkerTerms:true,now:()=>1,
  resolveSession:async()=>active?{state:'verified',issuer:ISSUER,subject,emailConfirmed:true,isAnonymous:false,expiresAt:10,isActive:async()=>active}:{state:'anonymous'}});
 assert.equal((await handler(req())).status,401);
 assert.deepEqual(calls,[]);
 active=true;
 assert.deepEqual(await (await handler(req())).json(),projection(false));
 assert.equal((await handler(req({version:WORKER_TERMS_VERSION,accepted:false}))).status,400);
 assert.equal((await handler(req({version:'2026-11-01',accepted:true}))).status,409);
 const send=()=>handler(req({version:WORKER_TERMS_VERSION,accepted:true}));
 assert.deepEqual(await (await send()).json(),projection(true));
 const next=await send();
 assert.match(next.headers.get('cache-control'),/no-store/);
 assert.deepEqual(await next.json(),projection(true));
 assert.deepEqual(calls,[['status',ISSUER,subject,null],['accept',ISSUER,subject,WORKER_TERMS_VERSION],['accept',ISSUER,subject,WORKER_TERMS_VERSION]]);
});

test('owner list alone projects the version, evidence and time without unrelated data',async()=>{
 const token='a'.repeat(43);let calls=0;
 const h=createAccountAdminHandler({origin,keySha:createHash('sha256').update(token).digest('hex'),revoked:()=>{},lane:{async query(){calls++;
  return {rows:[{result:{accounts:[{id:subject,email:null,createdAt:acceptedAt,verified:true,
   workerTermsReceipts:[{...projection(true),method:WORKER_TERMS_METHOD,unexpected:'do-not-show'}]}]}}]};
 }}});
 const send=key=>h(new Request(origin+'/api/timeax/account-admin',{method:'POST',headers:{origin,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({action:'list',after:null})}));
 assert.equal((await send('unavailable')).status,401);
 assert.equal(calls,0);
 const results=await (await send(token)).json();
 assert.deepEqual(results.accounts[0].workerTermsReceipts,[{version:WORKER_TERMS_VERSION,documentSha256:WORKER_TERMS_SHA256,acceptedAt,method:WORKER_TERMS_METHOD}]);
});
