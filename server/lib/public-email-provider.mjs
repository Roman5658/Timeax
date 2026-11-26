import {Buffer} from 'node:buffer';
import {createIdentityVerifier} from '../wire/frozen-dev09-identity.server.mjs';
import {ISSUER,createProviderTransport} from './provider-adapters.mjs';

const PROJECT_REF=new URL(ISSUER).hostname.split('.')[0];
const emailPattern=/^[^@\s\p{Cc}\p{Cf}]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu;
export const normalizePublicEmail=value=>typeof value==='string'&&value.length<=254&&emailPattern.test(value.trim())?value.trim().toLowerCase():null;
const maxResponse=64*1024;
async function readJson(response){
 if(!response.body||response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw Error('Invalid provider response');
 const reader=response.body.getReader();const chunks=[];let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;if(size>maxResponse)throw Error('Provider response too large');
   chunks.push(value);
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
 }finally{void reader.cancel().catch(()=>{});reader.releaseLock()}
}

// Provider-only boundary. The HTTP layer must first authorize the requested flow,
// reserve a short-lived browser-bound challenge and enforce send/attempt limits.
// This module grants neither a Timeax session nor any workspace access.
export function createPublicEmailProvider({publishableKey,otpLength},{fetchImpl=globalThis.fetch,now=Date.now}={}){
 if(!/^sb_publishable_[A-Za-z0-9_-]{20,160}$/.test(publishableKey??'')||![6,8].includes(otpLength))throw Error('Invalid email provider configuration');
 const send=createProviderTransport({fetchImpl});
 const pattern=new RegExp('^[0-9]{'+otpLength+'}$');
 const post=async(path,payload)=>send(ISSUER+path,{method:'POST',body:JSON.stringify(payload),
  headers:{accept:'application/json','content-type':'application/json',apikey:publishableKey},
  redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(3500)});
 return Object.freeze({
  async requestCode(rawEmail,flow){
   const email=normalizePublicEmail(rawEmail);
   if(!email||!['login','registration'].includes(flow))return false;
   try{
    const response=await post('/otp',{email,create_user:flow==='registration'});
    void response.body?.cancel().catch(()=>{});
    return response.status===200;
   }catch{return false}
  },
  async verifyCode(rawEmail,code){
   const email=normalizePublicEmail(rawEmail);
   if(!email||typeof code!=='string'||!pattern.test(code))return null;
   try{
    const response=await post('/verify',{email,token:code,type:'email'});
    if(response.status!==200){void response.body?.cancel().catch(()=>{});return null}
    const {access_token:accessToken}=await readJson(response);
    if(typeof accessToken!=='string'||accessToken.length>8100||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(accessToken))return null;
    let verifiedEmail;
    const verifier=createIdentityVerifier({projectRef:PROJECT_REF,publishableKey,timeoutMs:3500},{now,transport:async (url,init)=>{
     const result=await send(url,{...init,redirect:'error',credentials:'omit',cache:'no-store'});
     if(result.status!==200)return result;
     const user=await readJson(result);
     verifiedEmail=normalizePublicEmail(user?.email);
     return Response.json(user);
    }});
    const result=await verifier.verify({headers:new Headers({authorization:'Bearer '+accessToken})});
    if(!result.ok||verifiedEmail!==email)return null;
    return Object.freeze({issuer:result.identity.issuer,subject:result.identity.subject,emailConfirmed:true,isAnonymous:false});
   }catch{return null}
  }
 });
}
