import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {ISSUER} from '../lib/provider-adapters.mjs';

const id=n=>'12345678-1234-4123-8123-'+String(n).padStart(12,'0');
const migration=await readFile(new URL('../operator/admin-support-account.sql',import.meta.url),'utf8');

test('private owner support safely projects account data and revokes only target sessions with a reason',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`
   CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE timeax_account_admin_login;
   CREATE SCHEMA auth; CREATE SCHEMA timeax_core; CREATE SCHEMA timeax_api;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz,email_confirmed_at timestamptz,
    last_sign_in_at timestamptz,banned_until timestamptz,encrypted_password text,deleted_at timestamptz,is_anonymous boolean DEFAULT false);
   CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
   CREATE TABLE auth.refresh_tokens(id bigserial PRIMARY KEY,token text,user_id text,session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE);
   CREATE TABLE timeax_core.identities(id uuid PRIMARY KEY,issuer text,subject text,active boolean DEFAULT true);
   CREATE TABLE timeax_core.organizations(id uuid PRIMARY KEY,name text,kind text);
   CREATE TABLE timeax_core.memberships(id uuid PRIMARY KEY,organization_id uuid,identity_id uuid,role text,state text);
   CREATE TABLE timeax_core.owner_support_audit(account_id uuid,action text,object_id uuid,reason text,before_data jsonb,after_data jsonb);
   INSERT INTO auth.users(id,email,created_at,email_confirmed_at,last_sign_in_at,banned_until,encrypted_password,deleted_at)
    VALUES ('${id(1)}','owner-test@example.test','2026-01-01',now(),'2026-01-02',NULL,'dummy-private-hash',NULL),
           ('${id(2)}','other-test@example.test','2026-01-03',NULL,NULL,'2026-01-05','',NULL),
           ('${id(3)}',NULL,now(),NULL,NULL,NULL,NULL,now());
   INSERT INTO auth.sessions VALUES ('${id(10)}','${id(1)}'),('${id(20)}','${id(2)}');
   INSERT INTO auth.refresh_tokens(token,user_id,session_id)
    VALUES('dummy-private-token-a','${id(1)}','${id(10)}'),('dummy-private-legacy-token','${id(1)}',NULL),('dummy-other-token','${id(2)}','${id(20)}');
   INSERT INTO timeax_core.identities VALUES ('${id(11)}','${ISSUER}','${id(1)}',true),('${id(12)}','https://wrong.test','${id(1)}',true);
   INSERT INTO timeax_core.organizations VALUES ('${id(31)}','Agencja testowa','agency'),('${id(32)}','Unrelated org','factory');
   INSERT INTO timeax_core.memberships VALUES ('${id(41)}','${id(31)}','${id(11)}','worker','active'),('${id(42)}','${id(32)}','${id(12)}','factory_admin','active');
  `);
  await db.exec(await readFile(new URL('../operator/web-sessions.sql',import.meta.url),'utf8').then(s=>s.replace('BEGIN;','CREATE ROLE timeax_web_session_login; BEGIN;')));
  await db.exec(`INSERT INTO timeax_core.web_sessions VALUES ('${'a'.repeat(64)}','${id(1)}',now()+interval '1 hour'),
    ('${'b'.repeat(64)}','${id(1)}',now()-interval '1 hour'),('${'c'.repeat(64)}','${id(2)}',now()+interval '1 hour');`);
  await db.exec(migration);
  await db.exec('GRANT USAGE ON SCHEMA timeax_core TO timeax_account_admin_login;');
  assert.equal((await db.query("SELECT has_function_privilege('timeax_account_admin_login','timeax_core.owner_support_account(text,uuid,jsonb)','EXECUTE') AS allowed")).rows[0].allowed,false);
  for(const role of ['anon','authenticated','service_role'])
   assert.equal((await db.query("SELECT has_function_privilege($1,'timeax_core.owner_support_account(text,uuid,jsonb)','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
  const call=async(action,target=id(1),input={})=>(await db.query('SELECT timeax_core.owner_support_account($1,$2,$3) AS result',[action,target,JSON.stringify(input)])).rows[0].result;
  const ready=await call('account');
  assert.equal(ready.state,'ready');
  assert.deepEqual(ready.account,{
   id:id(1),email:'owner-test@example.test',createdAt:'2026-01-01T00:00:00+00:00',verified:true,
   lastSignInAt:'2026-01-02T00:00:00+00:00',bannedUntil:null,hasPassword:true,activeSessions:1,
   memberships:[{id:id(41),organizationId:id(31),organizationName:'Agencja testowa',kind:'agency',role:'worker',state:'active'}]
  });
  assert.equal((await call('account',id(2))).account.hasPassword,false);
  assert.deepEqual(await call('account',id(3)),{state:'missing'});
  assert.deepEqual(await call('revoke-sessions',id(3),{reason:'Test missing account'}),{state:'missing'});
  await assert.rejects(call('revoke-sessions',id(1),{reason:' '}),{code:'22023'});
  await assert.rejects(call('revoke-sessions',id(1),{reason:'test\ninvalid'}),{code:'22023'});
  await assert.rejects(call('revoke-sessions',id(1),{reason:'Valid reason',email:'unused@example.test'}),{code:'22023'});
  assert.equal((await call('account')).account.activeSessions,1);
  assert.deepEqual(await call('revoke-sessions',id(1),{reason:'  Test security follow-up  '}),{state:'revoked',id:id(1)});
  assert.equal((await call('account')).account.activeSessions,0);
  assert.equal((await call('account',id(2))).account.activeSessions,1);
  assert.deepEqual((await db.query('SELECT user_id FROM auth.sessions')).rows,[{user_id:id(2)}]);
  assert.deepEqual((await db.query('SELECT user_id FROM auth.refresh_tokens')).rows,[{user_id:id(2)}]);
  assert.deepEqual((await db.query('SELECT * FROM timeax_core.owner_support_audit')).rows,[{
   account_id:id(1),action:'revoke-sessions',object_id:null,reason:'Test security follow-up',
   before_data:{webSessions:2,authSessions:1,legacyRefreshTokens:1},after_data:{webSessions:0,authSessions:0,legacyRefreshTokens:0}
  }]);
 } finally {await db.close()}
});
