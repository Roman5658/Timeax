import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
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
const server = await createRuntimeServer({ runtime, origin:activeOrigin, publicDir });
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
if (server.listening) console.log(`Timeax: http://${host}:${port}/ ${realAuth?"(local; real email authentication)":"(local; sign-in and signup closed)"}`);
