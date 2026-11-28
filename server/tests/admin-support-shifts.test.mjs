import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {ISSUER} from '../lib/provider-adapters.mjs';

const id=n=>'33880000-1111-4222-8333-'+String(n).padStart(12,'0');
const signature='timeax_core.owner_support_shifts(text,uuid,jsonb)';
test('support sees only the selected worker; internal corrections use verified operator, canonical history and audit',async()=>{
 const db=new PGlite();
 try{
  await db.exec(String.raw`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE timeax_owner_support_login;
   CREATE SCHEMA auth; CREATE SCHEMA timeax_core;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean DEFAULT false);
   CREATE TABLE timeax_core.identity_issuers(issuer text PRIMARY KEY,active boolean NOT NULL);
   CREATE TABLE timeax_core.identities(id uuid PRIMARY KEY,issuer text,subject text,active boolean NOT NULL);
   CREATE TABLE timeax_core.organizations(id uuid PRIMARY KEY,name text,kind text,state text);
   CREATE TABLE timeax_core.worksites(id uuid PRIMARY KEY,owner_organization_id uuid,name text,active boolean);
   CREATE TABLE timeax_core.memberships(id uuid PRIMARY KEY,organization_id uuid,identity_id uuid,role text,state text);
   CREATE TABLE timeax_core.timecard_shifts(id uuid PRIMARY KEY,organization_id uuid,worksite_id uuid,membership_id uuid,
    local_date date,start_at timestamptz,end_at timestamptz,revision integer DEFAULT 1,data jsonb,updated_at timestamptz);
   CREATE TABLE timeax_core.factory_timecard_shifts(id uuid PRIMARY KEY,agency_id uuid,worksite_id uuid,membership_id uuid,
    local_date date,start_at timestamptz,end_at timestamptz,revision integer DEFAULT 1,state text);
   CREATE TABLE timeax_core.internal_timecards(organization_id uuid,worksite_id uuid,date_from date,date_to date);
   CREATE TABLE timeax_core.received_factory_timecards(agency_id uuid,worksite_id uuid,date_from date,date_to date);
   CREATE TABLE timeax_core.payroll_sources(agency_id uuid,member_id uuid,payload jsonb);
   CREATE TABLE timeax_core.agency_worksite_preferences(organization_id uuid,worksite_id uuid,planned_time_mode text);
   CREATE TABLE timeax_core.worksite_membership_grants(organization_id uuid,worksite_id uuid,membership_id uuid,state text,valid_from timestamptz,valid_until timestamptz);
   CREATE TABLE timeax_core.timecard_revisions(shift_id uuid,revision integer,actor_identity uuid REFERENCES timeax_core.identities(id),operation_id uuid,input jsonb,data jsonb,reason text,PRIMARY KEY(shift_id,revision));
   CREATE TABLE timeax_core.owner_support_audit(account_id uuid,action text,object_id uuid,reason text,before_data jsonb,after_data jsonb);
   GRANT USAGE ON SCHEMA timeax_core TO timeax_owner_support_login;
   ALTER DEFAULT PRIVILEGES IN SCHEMA timeax_core GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role,timeax_owner_support_login;
   ALTER DEFAULT PRIVILEGES IN SCHEMA timeax_core GRANT SELECT ON TABLES TO anon,authenticated,service_role,timeax_owner_support_login;
   INSERT INTO auth.users(id,email_confirmed_at,deleted_at) VALUES('${id(1)}',now(),NULL),('${id(2)}',now(),NULL),('${id(3)}',now(),NULL);
   INSERT INTO timeax_core.identity_issuers VALUES('${ISSUER}',true);
   INSERT INTO timeax_core.identities VALUES('${id(4)}','${ISSUER}','${id(1)}',true),('${id(5)}','${ISSUER}','${id(2)}',true),('${id(6)}','${ISSUER}','${id(3)}',true);
   INSERT INTO timeax_core.organizations VALUES('${id(7)}','Agency A','agency','active');
   INSERT INTO timeax_core.worksites VALUES('${id(8)}','${id(7)}','Hub A',true);
   INSERT INTO timeax_core.memberships VALUES('${id(9)}','${id(7)}','${id(4)}','worker','active'),('${id(10)}','${id(7)}','${id(5)}','worker','active');
   INSERT INTO timeax_core.worksite_membership_grants VALUES('${id(7)}','${id(8)}','${id(9)}','active','2024-01-01',NULL);
   INSERT INTO timeax_core.agency_worksite_preferences VALUES('${id(7)}','${id(8)}','manual');
   INSERT INTO timeax_core.internal_timecards VALUES('${id(7)}','${id(8)}','2024-03-30','2024-03-30');
   INSERT INTO timeax_core.received_factory_timecards VALUES('${id(7)}','${id(8)}','2024-03-27','2024-03-27');
   INSERT INTO timeax_core.factory_timecard_shifts VALUES('${id(25)}','${id(7)}','${id(8)}','${id(9)}','2024-03-27','2024-03-27T05:00:00Z','2024-03-27T13:00:00Z',1,'ready');`);
  const addShift=async(n,day,worker=id(9),start='06:00',end='14:00')=>db.query(
   "INSERT INTO timeax_core.timecard_shifts VALUES($1,$2,$3,$4,$5,($5::date+$6::time) AT TIME ZONE 'Europe/Warsaw',($5::date+$7::time) AT TIME ZONE 'Europe/Warsaw',1,$8,clock_timestamp())",
   [id(n),id(7),id(8),worker,day,start,end,{localDate:day,startTime:start,endTime:end,timeZone:'Europe/Warsaw',breakStatus:'taken',breakTreatment:'unpaid',breakMinutes:30,grossMinutes:480,paidMinutes:450,comment:'Keep this'}]);
  await addShift(20,'2024-03-29'); // open
  await addShift(21,'2024-03-30'); // archived
  await addShift(22,'2024-03-31'); // DST transition
  await addShift(23,'2024-04-01'); // payroll
  await addShift(26,'2024-10-27'); // repeated local clock hour
  await addShift(24,'2024-03-29',id(10)); // different worker, same employer/site
  await db.query('INSERT INTO timeax_core.payroll_sources VALUES($1,$2,$3)',[id(7),id(9),{rows:[{id:id(23)}]}]);
  await db.exec(await readFile(new URL('../operator/admin-support-shifts.sql',import.meta.url),'utf8'));
  const acl=(await db.query("SELECT has_function_privilege('timeax_owner_support_login',$1,'execute') as lane,has_function_privilege('anon',$1,'execute') as anon,has_table_privilege('authenticated','timeax_core.owner_support_shift_config','select') as config",[signature])).rows[0];
  assert.deepEqual(acl,{lane:false,anon:false,config:false});
  const call=async(action,input,account=id(1))=>(await db.query('SELECT timeax_core.owner_support_shifts($1,$2,$3) AS value',[action,account,input])).rows[0].value;
  const shifts=(account=id(1))=>call('shifts',{from:'2024-03-25',to:'2024-04-02'},account);
  const correct=(n,extra={},account=id(1))=>call('correct-shift',{id:id(n),source:'agency',revision:1,start:'06:00',end:'15:00',reason:'Approved correction',...extra},account);
  assert.deepEqual((await shifts()).shifts.map(x=>x.id),[23,22,21,20,25].map(id));
  assert.deepEqual((await shifts(id(2))).shifts.map(x=>x.id),[id(24)]);
  const initial=(await shifts()).shifts;
  assert.equal(initial.every(x=>x.editable===false),true);
  assert.equal(initial.find(x=>x.id===id(21)).state,'archived');
  assert.equal(initial.find(x=>x.id===id(25)).state,'sent');
  assert.equal(initial.find(x=>x.id===id(20)).start,'06:00');
  assert.deepEqual(await correct(20),{state:'blocked'});
  assert.deepEqual(await correct(24),{state:'missing'});
  await assert.rejects(()=>call('shifts',{from:'2024-02-01',to:'2024-03-03'}),e=>e.code==='22023');
  await assert.rejects(()=>call('shifts',{from:'2024-02-30',to:'2024-03-01'}),e=>e.code==='22023');
  await db.query('INSERT INTO timeax_core.owner_support_shift_config(actor_identity) VALUES($1)',[id(6)]);
  const ready=(await shifts()).shifts;
  assert.equal(ready.find(x=>x.id===id(20)).editable,true);
  assert.equal(ready.find(x=>x.id===id(21)).editable,false);
  assert.equal(ready.find(x=>x.id===id(23)).editable,false);
  assert.deepEqual(await correct(25,{source:'factory'}),{state:'blocked'});
  assert.deepEqual(await correct(21),{state:'blocked'});
  assert.deepEqual(await correct(23),{state:'blocked'});
  assert.deepEqual(await correct(22,{start:'02:30'}),{state:'blocked'});
  assert.deepEqual(await correct(26,{start:'02:30'}),{state:'blocked'});
  await addShift(27,'2024-03-29',id(9),'15:00','16:00');
  assert.deepEqual(await correct(20,{end:'15:30'}),{state:'blocked'});
  await db.exec("ALTER TABLE timeax_core.owner_support_audit ADD CHECK (reason <> 'Fixture audit reject')");
  await assert.rejects(()=>correct(20,{reason:'Fixture audit reject'}),e=>e.code==='23514');
  assert.equal((await db.query('SELECT revision FROM timeax_core.timecard_shifts WHERE id=$1',[id(20)])).rows[0].revision,1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM timeax_core.timecard_revisions')).rows[0].count,0);
  assert.deepEqual(await correct(20),{state:'corrected',id:id(20)});
  assert.deepEqual(await correct(20),{state:'changed'});
  const dbRow=(await db.query('SELECT data,revision FROM timeax_core.timecard_shifts WHERE id=$1',[id(20)])).rows[0];
  assert.equal(dbRow.revision,2);assert.equal(dbRow.data.startAt,'2024-03-29T05:00:00Z');
  assert.equal(dbRow.data.endAt,'2024-03-29T14:00:00Z');assert.equal(dbRow.data.grossMinutes,540);
  assert.equal(dbRow.data.paidMinutes,510);assert.equal(dbRow.data.comment,'Keep this');
  const revision=(await db.query('SELECT actor_identity,reason,revision FROM timeax_core.timecard_revisions')).rows[0];
  assert.deepEqual(revision,{actor_identity:id(6),reason:'Approved correction',revision:2});
  const audit=(await db.query('SELECT * FROM timeax_core.owner_support_audit')).rows[0];
  assert.equal(audit.account_id,id(1));assert.equal(audit.before_data.paidMinutes,450);assert.equal(audit.after_data.paidMinutes,510);
  assert.equal(audit.before_data.endTime,'14:00');assert.equal(audit.after_data.endTime,'15:00');
  await db.query('UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1',[id(3)]);
  assert.deepEqual(await correct(20,{revision:2,end:'13:00'}),{state:'blocked'});
  assert.equal((await db.query('SELECT count(*)::int AS count FROM timeax_core.owner_support_audit')).rows[0].count,1);
 }finally{await db.close()}
});
