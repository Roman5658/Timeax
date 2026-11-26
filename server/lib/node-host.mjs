import http from 'node:http';
import {Readable} from 'node:stream';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
export async function createRuntimeServer({runtime,origin,publicDir}){
 const assets=new Map(),base=new URL(origin);
 async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Static symlink denied');if(e.isDirectory())await scan(p);else if(e.isFile())assets.set('/'+path.relative(publicDir,p).split(path.sep).join('/'),await readFile(p))}}
 await scan(publicDir);
 const server=http.createServer(async(req,res)=>{
  const safe={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
   'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"};
  const send=(status,body,headers={})=>{res.writeHead(status,{...safe,...headers});res.end(body)};
  if(!req.url?.startsWith('/')||req.url.startsWith('//'))return send(400,'Invalid request');
  if(req.url==='/readyz'){
   if(!['GET','HEAD'].includes(req.method))return send(405,'Method not allowed');
   try{if(typeof runtime.preflight!=='function')throw Error();await runtime.preflight();return send(200,JSON.stringify({state:'private-preflight-ready',publicRegistrationEnabled:false}),{'Content-Type':'application/json'})}
   catch{return send(503,JSON.stringify({state:'closed',publicRegistrationEnabled:false}),{'Content-Type':'application/json'})}
  }
  if(req.url==='/healthz')return send(200,JSON.stringify({status:runtime.state,publicRegistrationEnabled:false}),{'Content-Type':'application/json'});
  const target=new URL(req.url,base);
  if(['GET','HEAD'].includes(req.method)&&(req.headers['transfer-encoding']||Number(req.headers['content-length']??0)!==0))return send(400,'Unexpected request body');
  if(target.pathname.startsWith('/api/')||target.pathname.startsWith('/v1/')||target.pathname.startsWith('/hooks/')){
   // Fixed configured authority. Never construct an origin from proxy headers.
   if(req.headers.host!==base.host)return send(403,'Not permitted');
   if(target.pathname.startsWith('/api/billing/')&&runtime.billingEnabled!==true)return send(503,JSON.stringify({error:'billing-not-enabled',commercialEnabled:false}),{'Content-Type':'application/json'});
   const headers=new Headers();
   for(const[k,v]of Object.entries(req.headers)){
    // TLS ingress metadata is not an application identity or authority input.
    if(k==='forwarded'||k.startsWith('x-forwarded-'))continue;
    if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(', '):v);
   }
   const abort=new AbortController();req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableFinished)abort.abort()});
   try{
    const request=new Request(target,{method:req.method,headers,signal:abort.signal,
     ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
    const response=await runtime.handler(request);const out={...safe};
    for(const[k,v]of response.headers)if(k!=='set-cookie')out[k]=v;
    const cookies=response.headers.getSetCookie();if(cookies.length)out['Set-Cookie']=cookies;
    res.writeHead(response.status,out);res.end(Buffer.from(await response.arrayBuffer()));
   }catch{if(!res.headersSent)send(503,'Service unavailable');else res.destroy()}
   return;
  }
  if(!['GET','HEAD'].includes(req.method))return send(405,'Method not allowed');
  let key=target.pathname;
  if(!assets.has(key)){if(!/^\/(?:[a-z0-9-]+\/?)*$/.test(key))return send(404,'Not found');key='/index.html'}
  const value=assets.get(key);if(!value)return send(404,'Not found');
  send(200,req.method==='HEAD'?undefined:value,{'Content-Type':types[path.extname(key)]??'application/octet-stream'});
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.on('clientError',(_e,socket)=>socket.destroy());
 return server;
}
