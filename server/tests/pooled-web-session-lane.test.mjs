import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,X509Certificate} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import {ROLE_CHECK_SQL,FUNCTION_CHECK_SQL,createScopedPgLane} from '../lib/scoped-pg.mjs';
import {SESSION_ROLE,SESSION_RPC,SESSION_SQL} from '../lib/web-session-store.mjs';
import {WORKSPACE_ROLE,WORKSPACE_FUNCTIONS} from '../lib/workspace-read.contract.mjs';
import {WORKSPACE_SQL} from '../lib/workspace-read.server.mjs';

const host='aws-1-eu-central-1.pooler.supabase.com';
const ca=rootCertificates.find(pem=>{const x=new X509Certificate(pem);return x.ca&&Date.parse(x.validFrom)<Date.now()&&Date.parse(x.validTo)>Date.now()});
const original='fixture definition';
test('scoped session connections can be reused while TLS and per-operation authority checks remain mandatory',async()=>{
 let op=0,checks=0,connections=0,leases=[],definition=original,peer=host;
 class Client{
  constructor(options){this.options=options}
  async verify(){connections++;const err=this.options.ssl.checkServerIdentity(host,{subjectaltname:'DNS:'+peer});if(err)throw err}
  async query(sql){
   if(sql===ROLE_CHECK_SQL){checks++;return {rows:[{ok:true}]}}
   if(sql===FUNCTION_CHECK_SQL){checks++;return {rows:[{signature:SESSION_RPC,owner:'postgres',prosecdef:true,allowed:true,grantable:false,proconfig:['search_path=pg_catalog, pg_temp'],definition}]}}
   assert.equal(sql,SESSION_SQL);op++;return {rows:[{session:null}]}
  }
 }
 class Pool{
  constructor(options){assert.equal(options.max,4);assert.equal(options.maxLifetimeSeconds,60);this.Client=options.Client}
  on(){}
  async connect(){if(!this.c){this.c=new this.Client();try{await this.c.verify()}catch(e){this.c=null;throw e}}
   this.c.release=problem=>{leases.push(problem?.message??'ok');if(problem)this.c=null};return this.c
  }
 }
 const db=createScopedPgLane({host,role:SESSION_ROLE,password:'a'.repeat(48),ca,namespace:'timeax_api',
  functions:[{signature:SESSION_RPC,owner:'postgres',sha256:createHash('sha256').update(original).digest('hex')}],statements:[SESSION_SQL],Client,Pool});
 await db.preflight();await db.query(SESSION_SQL,[]);await db.query(SESSION_SQL,[]);
 assert.deepEqual({op,checks,connections},{op:2,checks:6,connections:1});
 definition='modified';await assert.rejects(db.query(SESSION_SQL,[]),/fingerprint/);
 assert.equal(op,2);assert.equal(leases.at(-1),'RPC fingerprint preflight denied');
 definition=original;peer='another.example';await assert.rejects(db.query(SESSION_SQL,[]),/Hostname|does not match|altnames/i);
 assert.equal(op,2);
});

test('workspace resolution has one verified pooled connection per hosted instance',async()=>{
 const calls=[];
 class MockClient {
  constructor(options){this.options=options}
  async query(sql){
   calls.push(sql);
   if(sql===ROLE_CHECK_SQL)return {rows:[{ok:true}]};
   if(sql===FUNCTION_CHECK_SQL)return {rows:WORKSPACE_FUNCTIONS.map(({signature,owner})=>({signature,owner,prosecdef:true,allowed:true,grantable:false,proconfig:['search_path=pg_catalog, pg_temp'],definition:original}))};
   return {rows:[]};
  }
 }
 class MockPool {
  constructor(opt){assert.equal(opt.max,1);this.client=new opt.Client();this.client.release=()=>{};const err=this.client.options.ssl.checkServerIdentity(host,{subjectaltname:'DNS:'+host});assert.equal(err,undefined)}
  on(){}
  async connect(){return this.client}
 }
 const sha256=createHash('sha256').update(original).digest('hex');
 const db=createScopedPgLane({host,role:WORKSPACE_ROLE,password:'b'.repeat(48),ca,namespace:'timeax_api',
  functions:WORKSPACE_FUNCTIONS.map(fn=>({...fn,sha256})),statements:[WORKSPACE_SQL],Client:MockClient,Pool:MockPool});
 await db.query(WORKSPACE_SQL,[]);await db.query(WORKSPACE_SQL,[]);
 assert.deepEqual(calls,[ROLE_CHECK_SQL,FUNCTION_CHECK_SQL,WORKSPACE_SQL,ROLE_CHECK_SQL,FUNCTION_CHECK_SQL,WORKSPACE_SQL]);
});
