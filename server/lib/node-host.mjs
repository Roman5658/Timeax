import http from 'node:http';
import {Readable} from 'node:stream';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {brotliCompress,gzip,constants} from 'node:zlib';
const zipped=promisify(gzip);
const brotli=promisify(brotliCompress);
const hashedText=/^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,32}\.(?:js|css)$/;
const immutable='public, max-age=31536000, immutable';
const brotliOptions={params:{[constants.BROTLI_PARAM_QUALITY]:5}};

function preferredEncoding(header) {
 const weights=new Map();
 for(const token of String(header??'').split(',')){
  const [coding,...params]=token.split(';');
  const name=coding.trim().toLowerCase();
  if(!['br','gzip','identity','*'].includes(name))continue;
  const q=params.find(p=>/^\s*q\s*=/i.test(p));
  const value=q?.split('=')[1]?.trim();
  const weight=q===undefined?1:/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value??'')?Number(value):0;
  weights.set(name,Math.max(weight,weights.get(name)??0));
 }
 const wildcard=weights.get('*');
 const identity=weights.has('identity')?weights.get('identity'):wildcard===0?0:undefined;
 const choices=['br','gzip'].map(name=>[name,weights.get(name)??wildcard??0]);
 choices.push(['identity',identity??Number.EPSILON]);
 return choices.filter(([,q])=>q>0).sort((a,b)=>b[1]-a[1])[0]?.[0];
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
export async function createRuntimeServer({runtime,origin,publicDir,localReload=false}){
 let assets=new Map(),compressed=new Map(),revision=0;
 const base=new URL(origin);
 if(localReload&&(base.hostname!=='127.0.0.1'||!base.port))throw Error('Live reload is local only');
 async function scan(dir,next){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Static symlink denied');if(e.isDirectory())await scan(p,next);else if(e.isFile())next.set('/'+path.relative(publicDir,p).split(path.sep).join('/'),await readFile(p))}}
 async function reloadAssets(){
  const next=new Map();await scan(publicDir,next);
  if(localReload&&!next.has('/index.html'))throw Error('Application HTML missing');
  if(localReload){
   const html=next.get('/index.html').toString('utf8');
   next.set('/index.html',Buffer.from(html.replace('</body>', '<script src="/__timeax-reload.js" defer></script></body>')));
   next.set('/__timeax-reload.js',Buffer.from("let rev;setInterval(async()=>{try{const r=await fetch('/__timeax-revision',{cache:'no-store'});if(!r.ok)return;const next=await r.text();if(rev!==undefined&&rev!==next)location.reload();rev=next}catch{}},1000);"));
  }
  const variants=new Map();
  // Only build-produced content-addressed JS/CSS is public and reusable.
  // Do the CPU work at load time, not on the event loop for every response.
  if(!localReload)await Promise.all([...next].filter(([key])=>hashedText.test(key)).map(async([key,value])=>{
   const [br,gz]=await Promise.all([brotli(value,brotliOptions),zipped(value)]);
   variants.set(key,{br,gzip:gz});
  }));
  assets=next;compressed=variants;revision++;
 }
 await reloadAssets();
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
  if(req.url==='/healthz')return send(200,JSON.stringify({status:runtime.state,publicRegistrationEnabled:runtime.publicRegistrationEnabled===true}),{'Content-Type':'application/json'});
  const target=new URL(req.url,base);
  if(localReload&&target.pathname==='/__timeax-revision'){
   if(req.headers.host!==base.host||req.method!=='GET')return send(403,'Not permitted');
   return send(200,String(revision),{'Content-Type':'text/plain; charset=utf-8'});
  }
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
  const responseHeaders={'Content-Type':types[path.extname(key)]??'application/octet-stream'};
  const variants=compressed.get(key);
  let body=value;
  if(variants){
   const encoding=preferredEncoding(req.headers['accept-encoding']);
   if(!encoding)return send(406,'No acceptable asset encoding',{'Vary':'Accept-Encoding'});
   responseHeaders['Vary']='Accept-Encoding';
   responseHeaders['Cache-Control']=immutable;
   if(encoding!=='identity'){body=variants[encoding];responseHeaders['Content-Encoding']=encoding}
   responseHeaders['Content-Length']=body.length;
  }
  send(200,req.method==='HEAD'?undefined:body,responseHeaders);
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.on('clientError',(_e,socket)=>socket.destroy());
 if(localReload)server.reloadAssets=reloadAssets;
 return server;
}
