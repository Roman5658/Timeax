import {once} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRuntimeServer} from '../lib/node-host.mjs';
import {openPractice,workerScopes} from '../../public/nfc/practice.js';

test('the NFC card link serves a read-only standalone page without write forms or attendance calls',async t=>{
 const server=await createRuntimeServer({
  runtime:{async handler(){assert.fail('the test page must not reach the API');}},
  origin:'https://timeax.pl',
  publicDir:fileURLToPath(new URL('../../public/',import.meta.url)),
 });
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const url='http://127.0.0.1:'+server.address().port+'/nfc/check.html';
 const response=await fetch(url);
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/^text\/html/);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 assert.equal(response.headers.has('set-cookie'),false);
 const page=await response.text();
 assert.match(page,/TIMEAX · NFC/);
 assert.match(page,/Godziny pracy nie są zapisywane/);
 assert.match(page,/noindex, nofollow/);
 assert.doesNotMatch(page,/<(?:form|iframe)\b|\baction=/i);
 assert.match(page,/src="\/nfc\/practice\.js"/);
 const js=await (await fetch(new URL('/nfc/practice.js',url))).text();
 assert.match(js,/\/api\/worker-enrollment\/context/);
 assert.doesNotMatch(js,/['"]POST['"]|\/api\/nfc\/shift|\/api\/timecards/);
 assert.equal((await fetch(url,{method:'POST'})).status,405);
});

test('only verified worker memberships can be selected',()=>{
 const w={role:'worker',membershipId:'00000000-0000-4000-8000-000000000001',name:'Worker agency'};
 const admin={role:'agency_admin',membershipId:'00000000-0000-4000-8000-000000000002',name:'Agency'};
 assert.deepEqual(workerScopes({state:'anonymous',memberships:[w]}),[]);
 assert.deepEqual(workerScopes({state:'verified',memberships:[admin,w,w]}),[{id:w.membershipId,name:w.name}]);
});

test('local rehearsal needs a second opening, isolates two worker memberships, and expires',()=>{
 const scope='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
 const map=new Map(), storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const now=1764000000000, first=openPractice(storage,scope,now), stale=openPractice(storage,scope,now);
 assert.equal(first.action,'start');
 assert.deepEqual(first.record(now+1),{start:now+1});
 assert.equal(first.record(now+2),null);
 assert.equal(stale.record(now+2),null);
 assert.equal(openPractice(storage,other,now+2).action,'start');
 const second=openPractice(storage,scope,now+3);
 assert.equal(second.action,'end');
 assert.deepEqual(second.record(now+4),{start:now+1,end:now+4});
 assert.equal(openPractice(storage,scope,now+5).action,'start');
 const overdue=openPractice(storage,scope,now+3_600_002);
 assert.equal(overdue.action,'start');
 assert.equal(overdue.record(now+3_720_003),null);
});
