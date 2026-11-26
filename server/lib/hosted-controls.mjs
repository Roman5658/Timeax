import {createPublicKey,verify,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ISSUER} from './provider-adapters.mjs';
import {readBody,PERMIT_COOKIE} from './session-router.mjs';
const json=(status,value,cookie)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie',...(cookie?{'Set-Cookie':cookie}:{})}});
export function createDeploymentApproval({publicKeyPem,path,origin,recipientTag,buildSha256,contractSha256,read=readFile,now=Date.now,databaseScope='reviewed-pending-only'}){
 if(!['reviewed-pending-only','reviewed-pending-and-workspace-read','reviewed-integrated-qa'].includes(databaseScope))throw Error('Unsupported deployment scope');
 const key=createPublicKey(publicKeyPem);
 if(key.asymmetricKeyType!=='ed25519'||typeof path!=='string'||(!/^[a-f0-9]{64}$/.test(buildSha256??'')||!/^[a-f0-9]{64}$/.test(contractSha256??'')))throw Error('Deployment approval configuration missing');
 return async signal=>{
  const token=(await read(path,{encoding:'utf8',signal})).trim();
  if(token.length>8192)throw Error('Deployment approval denied');
  const parts=token.split('.');if(parts.length!==2)throw Error('Deployment approval denied');
  const raw=Buffer.from(parts[0],'base64url'),signature=Buffer.from(parts[1],'base64url');
  if(raw.toString('base64url')!==parts[0]||signature.length!==64||signature.toString('base64url')!==parts[1]||!verify(null,raw,key,signature))throw Error('Deployment approval denied');
  const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const fields=['purpose','issuer','origin','recipientTag','buildSha256','contractSha256','mail','database','instances','checkedAt','validUntil'],at=now();
  if(!v||Object.keys(v).length!==fields.length||!fields.every(k=>Object.hasOwn(v,k))||v.purpose!=='timeax/closed-hosting/v1'||v.issuer!==ISSUER||
   v.origin!==origin||v.recipientTag!==recipientTag||v.buildSha256!==buildSha256||v.contractSha256!==contractSha256||v.mail!=='operator-confirmed-ready'||v.database!==databaseScope||v.instances!==1||
   !Number.isSafeInteger(v.checkedAt)||!Number.isSafeInteger(v.validUntil)||v.checkedAt>at||v.validUntil<=at||v.validUntil-v.checkedAt>3600000)throw Error('Deployment approval expired or denied');
  return v;
 };
}
export function privateAdmission({handler,approval,origin,recipient,routeKey,now=Date.now}){
 const tag=createHmac('sha256',Buffer.from(routeKey,'base64url')).update(recipient.toLowerCase()).digest('hex');
 return async request=>{
  const u=new URL(request.url);if(u.pathname!=='/api/timeax/access/open')return handler(request);
  if(u.origin!==origin||u.search||u.hash||request.method!=='POST'||request.headers.get('origin')!==origin||
   request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin')return json(403,{error:'closed'});
  try{
   await approval.readiness({issuer:ISSUER,signal:request.signal});
   const raw=await readBody(request,8192),body=JSON.parse(raw);
   if(!body||Object.keys(body).length!==1||typeof body.permit!=='string')return json(400,{error:'invalid'});
   const permit=approval.permit(body.permit,tag);if(!permit||request.signal.aborted)return json(403,{error:'closed'});
   return json(200,{state:'private-access-open',grants:[]},PERMIT_COOKIE+'='+body.permit+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+Math.max(1,Math.floor((permit.expiresAt-now())/1000)));
  }catch{return json(503,{error:'closed'})}
 };
}
