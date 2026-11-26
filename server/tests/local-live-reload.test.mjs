import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRuntimeServer} from '../lib/node-host.mjs';

test('local reload swaps a successful build without disconnecting the server',async t=>{
 const publicDir=await mkdtemp(path.join(tmpdir(),'timeax-reload-'));
 const html=path.join(publicDir,'index.html');
 t.after(()=>rm(publicDir,{recursive:true,force:true}));
 await writeFile(html,'<body>first</body>');
 const runtime={state:'test',async handler(){return new Response('same runtime')}};
 const server=await createRuntimeServer({runtime,origin:'http://127.0.0.1:55179',publicDir,localReload:true});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(55179,'127.0.0.1',resolve)});
 t.after(()=>{server.closeAllConnections();server.close()});
 const get=async p=>await (await fetch('http://127.0.0.1:55179'+p)).text();
 assert.match(await get('/'),/first.*__timeax-reload.js/);
 assert.equal(await get('/__timeax-revision'),'1');
 await writeFile(html,'<body>second</body>');
 assert.match(await get('/login'),/first/);
 await server.reloadAssets();
 assert.match(await get('/login'),/second/);
 assert.equal(await get('/__timeax-revision'),'2');
 assert.equal(await get('/api/check'),'same runtime');
 await assert.rejects(createRuntimeServer({runtime,origin:'https://timeax.pl',publicDir,localReload:true}),/local only/);
});
