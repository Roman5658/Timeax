import { parseArgs } from 'node:util';
import { existsSync, watch } from 'node:fs';
import { buildSite, publicDir } from './build-site.mjs';
import { createRuntimeServer } from './lib/node-host.mjs';
import { assembleRuntime } from './lib/runtime.mjs';
import { assembleLocalIdentityRuntime } from './lib/local-identity-runtime.mjs';

const { values } = parseArgs({
  options: { port: { type: 'string', default: '5173' }, strictPort: { type: 'boolean' }, 'real-auth': {type:'boolean'} },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Choose a local port from 1024 to 65535.');
}
const host = '127.0.0.1';

// The HTTP listener is loopback-only. Its closed router uses the same authority
// with the HTTPS scheme required by the hosted code; no cookies are issued.
const origin = `https://${host}:${port}`;
const realAuth=values['real-auth']===true||existsSync('.timeax-auth.local');
if(realAuth){
  try{process.loadEnvFile('.timeax-auth.local')}catch{throw Error('Missing or unreadable .timeax-auth.local; see LOCAL-AUTH.md')}
  try{process.loadEnvFile('.env.local')}catch{/* The explicit server key can be used instead. */}
}
const activeOrigin=realAuth?origin.replace(/^https:/,'http:'):origin;
const runtime = realAuth?await assembleLocalIdentityRuntime({origin:activeOrigin}):await assembleRuntime({ mode: 'closed', origin });
await buildSite();
const server = await createRuntimeServer({ runtime, origin:activeOrigin, publicDir, localReload:true });
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
} catch (error) {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`Port ${port} is in use. Stop the old Timeax server or pass --port 5177.`);
  process.exitCode = 1;
}
if(server.listening){
 let timer,building=false,pending=false;
 function rebuild(){
  clearTimeout(timer);
  timer=setTimeout(async()=>{
   if(building){pending=true;return;}
   building=true;
   try{await buildSite();await server.reloadAssets();console.log('Timeax: source changes rebuilt.');}
   catch{console.error('Timeax: rebuild failed; serving the last successful build.');}
   finally{building=false;if(pending){pending=false;rebuild();}}
  },220);
 }
 const watchers=['src','public'].map(relative=>watch(new URL('../'+relative,import.meta.url),{recursive:true},rebuild));
 watchers.push(watch(new URL('../',import.meta.url),(_event,name)=>{
  if(name==='hosted.html'||name==='vite.hosted.config.ts')rebuild();
 }));
 for(const watcher of watchers)watcher.on('error',()=>console.error('Timeax: source watcher stopped. Restart npm run dev.'));
 server.once('close',()=>{clearTimeout(timer);for(const watcher of watchers)watcher.close();});
}
if (server.listening) console.log(`Timeax: http://${host}:${port}/ ${realAuth?"(local; real email authentication)":"(local; sign-in and signup closed)"}`);
