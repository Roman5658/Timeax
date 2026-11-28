import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('owner support SQL wrapper denies other roles and returns audit for one account only',async()=>{
 const db=new PGlite(),a='12345678-1234-4234-8234-123456789001',b='12345678-1234-4234-8234-123456789002';
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE timeax_account_admin_login;
   CREATE SCHEMA timeax_core; CREATE SCHEMA timeax_api;
   CREATE FUNCTION timeax_core.owner_support_account(text,uuid,jsonb) RETURNS jsonb LANGUAGE sql
    AS $$ SELECT jsonb_build_object('state','ready','account',jsonb_build_object('id',$2)) $$;
   CREATE FUNCTION timeax_core.owner_support_shifts(text,uuid,jsonb) RETURNS jsonb LANGUAGE sql
    AS $$ SELECT jsonb_build_object('state','ready','shifts','[]'::jsonb,'truncated',false) $$;`);
  await db.exec(await readFile(new URL('../operator/admin-support.sql',import.meta.url),'utf8'));
  const role=(await db.query("SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname='timeax_owner_support_login'")).rows[0];
  assert.deepEqual(role,{rolcanlogin:false,rolbypassrls:false});
  const guards=(await db.query(`SELECT
   has_table_privilege('timeax_owner_support_login','timeax_core.owner_support_audit','SELECT') AS audit_table,
   has_function_privilege('authenticated','timeax_api.admin_support(text,uuid,jsonb)','EXECUTE') AS authenticated_rpc,
   has_function_privilege('timeax_account_admin_login','timeax_api.admin_support(text,uuid,jsonb)','EXECUTE') AS old_admin_rpc`)).rows[0];
  assert.deepEqual(guards,{audit_table:false,authenticated_rpc:false,old_admin_rpc:false});
  await db.query(`INSERT INTO timeax_core.owner_support_audit(account_id,action,reason,before_data,after_data)
   VALUES($1,'correct-shift','Scoped audit fixture','{"start":"06:00"}','{"start":"07:00"}'),($2,'revoke-sessions','Other account','{}','{}')`,[a,b]);
  const call=(act,account,input={})=>db.query('SELECT timeax_api.admin_support($1::text,$2::uuid,$3::jsonb) AS v',[act,account,JSON.stringify(input)]).then(r=>r.rows[0].v);
  await assert.rejects(()=>call('account',a),e=>e.code==='42501');
  await db.exec('SET SESSION AUTHORIZATION timeax_owner_support_login');
  try{
   assert.equal((await call('account',a)).account.id,a);
   const audit=await call('audit',a);
   assert.equal(audit.events.length,1);
   assert.equal(audit.events[0].reason,'Scoped audit fixture');
   assert.deepEqual(audit.events[0].after,{start:'07:00'});
   await assert.rejects(()=>call('delete',a),e=>e.code==='22023');
  }finally{await db.exec('RESET SESSION AUTHORIZATION')}
 }finally{await db.close()}
});
