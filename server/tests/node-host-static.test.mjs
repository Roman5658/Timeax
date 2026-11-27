import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {createRuntimeServer} from '../lib/node-host.mjs';

const asset='/assets/hosted-TKpUPfXU.js';
const css='/assets/hosted-BF83a317.css';
const body=Buffer.from('console.log("repeated synthetic script content");\n'.repeat(100));
const sheet=Buffer.from('.synthetic { color: plum; }\n'.repeat(100));
const origin='https://timeax.pl';
const runtime={state:'test',handler:async ()=>new Response(JSON.stringify({state:'synthetic-session'}),{
 headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Cookie'}})};

async function fixture(t,localReload=false) {
 const publicDir=await mkdtemp(join(tmpdir(),'timeax-static-http-test-'));
 t.after(()=>rm(publicDir,{recursive:true,force:true}));
 await mkdir(join(publicDir,'assets'));
 const html='<!doctype html><body><main>Test source</main></body>';
 await Promise.all([
  writeFile(join(publicDir,'index.html'),html),
  writeFile(join(publicDir,asset.slice(1)),body),
  writeFile(join(publicDir,css.slice(1)),sheet),
  writeFile(join(publicDir,'assets','helper.js'),body),
  writeFile(join(publicDir,'assets','ticket-Aa1Bb2Cc.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>'),
 ]);
 const server=await createRuntimeServer({runtime,origin:localReload?'http://127.0.0.1:55081':origin,publicDir,localReload});
 await new Promise((resolve,reject)=>server.on('error',reject).listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const get=(path,encoding,method='GET')=>new Promise((resolve,reject)=>{
  const r=request({host:'127.0.0.1',port:server.address().port,path,method,headers:{
   host:localReload?'127.0.0.1:55081':'timeax.pl',...(encoding===undefined?{}:{'Accept-Encoding':encoding}),
  }},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,h:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);
  });
  r.on('error',reject);r.end();
 });
 return {get,html};
}

test('content-hashed text negotiates Brotli, GZip or identity and caches each representation',async t=>{
 const {get}=await fixture(t);
 const br=await get(asset,'gzip, br');
 assert.equal(br.status,200);
 assert.equal(br.h['content-type'],'text/javascript; charset=utf-8');
 assert.equal(br.h['content-encoding'],'br');
 assert.equal(br.h['cache-control'],'public, max-age=31536000, immutable');
 assert.equal(br.h.vary,'Accept-Encoding');
 assert.equal(Number(br.h['content-length']),br.body.length);
 assert.ok(br.body.length<body.length);
 assert.deepEqual(brotliDecompressSync(br.body),body);
 assert.deepEqual(brotliDecompressSync((await get(css,'br')).body),sheet);
 const gzip=await get(asset,'br;q=0.5, GZIP;q=0.9, identity;q=0.1');
 assert.equal(gzip.h['content-encoding'],'gzip');
 assert.deepEqual(gunzipSync(gzip.body),body);
 for(const encoding of [undefined,'br;q=0,gzip;q=0','identity','gzip;q=0.2,identity;q=0.7','*;q=0,identity;q=1']){
  const original=await get(asset,encoding);
  assert.equal(original.h['content-encoding'],undefined);
  assert.equal(original.h.vary,'Accept-Encoding');
  assert.deepEqual(original.body,body);
 }
 const wildcard=await get(asset,'*;q=0.7,br;q=0');
 assert.equal(wildcard.h['content-encoding'],'gzip');
 const notAcceptable=await get(asset,'*;q=0');
 assert.equal(notAcceptable.status,406);
 assert.equal(notAcceptable.h['cache-control'],'no-store');
 assert.equal(notAcceptable.h.vary,'Accept-Encoding');
 const head=await get(asset,'br','HEAD');
 assert.equal(head.body.length,0);
 for(const key of ['content-type','content-encoding','cache-control','content-length','vary']){
  assert.equal(head.h[key],br.h[key]);
 }
});

test('HTML, auth, SVG and unhashed JS preserve existing uncached and uncompressed responses',async t=>{
 const {get,html}=await fixture(t);
 for(const path of ['/','/login','/index.html','/assets/helper.js','/assets/ticket-Aa1Bb2Cc.svg','/healthz','/v1/session/timeax-email','/api/test']){
  const value=await get(path,'gzip,br');
  assert.equal(value.status,200);
  assert.match(value.h['cache-control'],/no-store/);
  assert.equal(value.h['content-encoding'],undefined);
  if(['/','/login','/index.html'].includes(path))assert.equal(value.body.toString(),html);
  if(path.startsWith('/api/')||path.startsWith('/v1/'))assert.equal(value.h.vary,'Cookie');
 }
});

test('local live reload continues to serve raw uncached assets',async t=>{
 const {get}=await fixture(t,true);
 const result=await get(asset,'br,gzip');
 assert.equal(result.status,200);
 assert.equal(result.h['content-encoding'],undefined);
 assert.equal(result.h['cache-control'],'no-store');
 assert.deepEqual(result.body,body);
});
