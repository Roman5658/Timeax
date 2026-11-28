import {once} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRuntimeServer} from '../lib/node-host.mjs';

test('the NFC card link serves a read-only standalone page with no attendance or session calls',async t=>{
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
 assert.doesNotMatch(page,/<(?:form|script|iframe|a)\b|\b(?:src|action)=/i);
 assert.equal((await fetch(url,{method:'POST'})).status,405);
});
