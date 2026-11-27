import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleRuntime} from './lib/runtime.mjs';
import {assembleHostedEmailAuth} from './lib/hosted-email-auth.mjs';
import {createRuntimeServer} from './lib/node-host.mjs';
import {loadHostedConfiguration,targetNode} from './lib/hosted-config.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
let phase='config';
const safeFailures=new Map([
 ['Managed self-service secrets incomplete','self-service-environment'],
 ['Ambiguous self-service configuration','self-service-ambiguous'],
 ['Independent onboarding credentials required','self-service-credentials'],
 ['Invalid webhook configuration','webhook-format'],
 ['DB lane configuration denied','db-settings'],
 ['DB CA invalid','db-ca'],
 ['DB TLS identity not verified','db-tls'],
 ['DB role preflight denied','db-role-policy'],
 ['RPC definition missing','db-functions'],
 ['RPC fingerprint preflight denied','db-function-fingerprint'],
 ['timeout exceeded when trying to connect','db-connect-timeout'],
 ['Query read timeout','db-query-timeout'],
 ['Expected explicit canonical HTTPS email profile','public-origin'],
 ['Pinned registration database definitions required','db-fingerprints-config'],
 ['Explicit public email profile and secret mounts required','public-config-shape'],
]);
function safeStartupFailure(error){
 const files=new Set(['timeax-public-auth.json','timeax-pending-password','timeax-database-ca','timeax-webhook-secret']);
 const name=typeof error?.path==='string'?path.basename(error.path):'';
 if(error?.code==='ENOENT')return files.has(name)?'missing-'+name:'required-file-missing';
 if(error?.code==='28P01'||error?.code==='28000')return 'db-authentication';
 if(['SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','ERR_OSSL_PEM_NO_START_LINE'].includes(error?.code))return 'certificate-invalid';
 if(error instanceof SyntaxError&&phase==='config')return 'config-json';
 return safeFailures.get(error?.message)??'unclassified';
}
try{
 const config=await loadHostedConfiguration({root,configPath:process.env.TIMEAX_RUNTIME_CONFIG});
 phase='runtime';
 const runtime=config.mode==='public-email-v1'?await assembleHostedEmailAuth(config):await assembleRuntime(config);
 phase='listener';
 const port=Number(process.env.PORT??10000),bind=process.env.TIMEAX_BIND??'127.0.0.1';
 if(!Number.isInteger(port)||port<0||port>65535||!['127.0.0.1','0.0.0.0'].includes(bind))throw Error('Listener configuration denied');
 const server=await createRuntimeServer({runtime,origin:config.origin,publicDir:path.join(root,'public')});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,bind,resolve)});
 runtime.startPush?.();
 console.log(JSON.stringify({state:runtime.state,port:server.address().port,targetNode:targetNode(process.versions.node),publicRegistrationEnabled:runtime.publicRegistrationEnabled===true}));
 let closing=false;for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{if(closing)return;closing=true;runtime.stopPush?.();server.close(()=>process.exit(0));server.closeAllConnections()});
}catch(error){console.error(JSON.stringify({state:'closed',started:false,reason:'runtime-preflight-denied',phase,detail:safeStartupFailure(error)}));process.exitCode=1}
