import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleRuntime} from './lib/runtime.mjs';
import {assembleHostedEmailAuth} from './lib/hosted-email-auth.mjs';
import {createRuntimeServer} from './lib/node-host.mjs';
import {loadHostedConfiguration,targetNode} from './lib/hosted-config.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
try{
 const config=await loadHostedConfiguration({root,configPath:process.env.TIMEAX_RUNTIME_CONFIG});
 const runtime=config.mode==='public-email-v1'?await assembleHostedEmailAuth(config):await assembleRuntime(config);
 const port=Number(process.env.PORT??10000),bind=process.env.TIMEAX_BIND??'127.0.0.1';
 if(!Number.isInteger(port)||port<0||port>65535||!['127.0.0.1','0.0.0.0'].includes(bind))throw Error('Listener configuration denied');
 const server=await createRuntimeServer({runtime,origin:config.origin,publicDir:path.join(root,'public')});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,bind,resolve)});
 console.log(JSON.stringify({state:runtime.state,port:server.address().port,targetNode:targetNode(process.versions.node),publicRegistrationEnabled:false}));
 let closing=false;for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{if(closing)return;closing=true;server.close(()=>process.exit(0));server.closeAllConnections()});
}catch{console.error(JSON.stringify({state:'closed',started:false,reason:'runtime-preflight-denied'}));process.exitCode=1}
