import {WORKER_PROVISIONING_SIGNATURE} from './worker-provisioning.mjs';
import {WORKER_TERMS_SIGNATURE} from './worker-terms.mjs';
import {SESSION_ROLE,SESSION_RPC} from './web-session-store.mjs';
import {AGENCY_PROFILE_SIGNATURE} from './agency-profile.mjs';
import {PUSH_SIGNATURE} from './web-push.server.mjs';
import {PAY_NOTICE_SIGNATURE} from './pay-notices.server.mjs';
import {PAY_ESTIMATE_SIGNATURE} from './pay-estimates.server.mjs';
import {INBOX_SIGNATURE} from './inbox.server.mjs';
import {TEAM_FUNCTION} from './team-workflow.server.mjs';
import {ACCOUNT_ADMIN_SIGNATURE,ACCOUNT_SUPPORT_SIGNATURE} from './account-admin.mjs';
import {OWNER_FUNCTION} from './owner-qa-store.mjs';
import pg from 'pg';
import {INTEGRATED_FUNCTIONS} from './integrated.contract.mjs';
import {WORKSPACE_FUNCTIONS,WORKSPACE_ROLE} from './workspace-read.contract.mjs';
import {createHash,X509Certificate} from 'node:crypto';
import {checkServerIdentity} from 'node:tls';
import {ENROLLMENT_SIGNATURES} from './enrollment-rpc-store.mjs';
const HOST=/^aws-[0-9]{1,4}-eu-central-1\.pooler\.supabase\.com$/;
// Exact relation-ACL predicate from delivered DDL lines 376-409.
// Only genuine inaccessible pg_stat_statements views with the exact managed ACL qualify.
export const RELATION_AUTHORITY_SQL=String.raw`NOT EXISTS (
 WITH context AS (
  SELECT (SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) AS role,
   (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='dashboard_user') AS dashboard,
   ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[] AS dashboard_privileges
 )
 SELECT 1 FROM context CROSS JOIN pg_catalog.pg_namespace n
 JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid
 WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 AND CASE
          WHEN c.relkind='v' AND n.nspname='extensions'
            AND c.relname IN ('pg_stat_statements','pg_stat_statements_info')
            AND NOT pg_catalog.has_schema_privilege(role,n.oid,'USAGE')
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid
                WHERE d.classid='pg_catalog.pg_class'::pg_catalog.regclass AND d.objid=c.oid AND d.objsubid=0
                  AND d.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass AND d.refobjsubid=0
                  AND d.deptype='e' AND e.extname='pg_stat_statements' AND e.extnamespace=n.oid)
            AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a
                         WHERE a.grantee=0 AND a.grantor=c.relowner
                           AND a.privilege_type='SELECT' AND NOT a.is_grantable)
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee<>c.relowner
                  AND NOT (a.grantor=c.relowner AND NOT a.is_grantable AND
                    ((a.grantee=0 AND a.privilege_type='SELECT') OR
                     (dashboard IS NOT NULL AND a.grantee=dashboard AND a.privilege_type=ANY(dashboard_privileges)))))
            AND (
              NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee<>c.relowner AND a.grantee<>0)
              OR (dashboard IS NOT NULL
                  AND NOT pg_catalog.pg_has_role(role,dashboard,'MEMBER')
                  AND NOT pg_catalog.pg_has_role(role,dashboard,'USAGE')
                  AND (SELECT pg_catalog.array_agg(a.privilege_type ORDER BY a.privilege_type COLLATE "C")
                       FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=dashboard) = dashboard_privileges)
            )
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute att
                              CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
                              WHERE att.attrelid=c.oid AND att.attnum>0 AND NOT att.attisdropped AND a.grantee<>c.relowner)
            AND NOT pg_catalog.has_table_privilege(role,c.oid,
                  'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN,SELECT WITH GRANT OPTION')
            THEN false
          WHEN c.relkind='S' THEN pg_catalog.has_sequence_privilege(role,c.oid,'USAGE,SELECT,UPDATE')
          WHEN c.relkind IN ('r','p','v','m','f') THEN pg_catalog.has_table_privilege(role,c.oid,
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
            pg_catalog.has_any_column_privilege(role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
          ELSE false END
)`;

export const ROLE_CHECK_SQL=String.raw`
SELECT (
 current_database()='postgres' AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
 AND current_user::text=$1 AND session_user::text=$1
 AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=current_user AND r.rolcanlogin
  AND NOT(r.rolsuper OR r.rolbypassrls OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
  AND NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid))
 AND NOT has_database_privilege(current_user,current_database(),'CREATE')
 AND has_schema_privilege(current_user,$2,'USAGE')
 AND NOT has_schema_privilege(current_user,$2,'CREATE, USAGE WITH GRANT OPTION')
 AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE (n.nspname IN('timeax_enrollment_private','timeax_core') OR n.nspname IN('timeax_api','timeax_enrollment_rpc') AND n.nspname<>$2)
  AND has_schema_privilege(current_user,n.oid,'USAGE,CREATE'))
 AND NOT EXISTS(SELECT 1 FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid
  WHERE n.nspname IN('timeax_api','timeax_enrollment_rpc') AND has_function_privilege(current_user,p.oid,'EXECUTE')
  AND NOT (n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')'=ANY($3::text[])))
 AND ${RELATION_AUTHORITY_SQL}
) AS ok`;

export const FUNCTION_CHECK_SQL=String.raw`
SELECT n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')' AS signature,
 pg_get_functiondef(p.oid) AS definition,pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef,p.proconfig,has_function_privilege(current_user,p.oid,'EXECUTE') AS allowed,
 has_function_privilege(current_user,p.oid,'EXECUTE WITH GRANT OPTION') AS grantable
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')'=ANY($1::text[])`;

const ENROLLMENT_FUNCTIONS=new Set([...ENROLLMENT_SIGNATURES.web,...ENROLLMENT_SIGNATURES.hook]);
const WORKSPACE_READ_FUNCTIONS=new Set(WORKSPACE_FUNCTIONS.map(f=>f.signature));
const PENDING_FUNCTIONS=new Set(['timeax_api.self_service_agency(text,text,text,text)','timeax_api.request_agency_registration(text,text,text,text)','timeax_api.my_agency_registration(text,text)']);
export function isApprovedRpcOwner(signature,owner){
 return ENROLLMENT_FUNCTIONS.has(signature)?owner==='timeax_enrollment_owner'
  :(signature===TEAM_FUNCTION.signature&&owner===TEAM_FUNCTION.owner)||(signature===OWNER_FUNCTION.signature&&owner===OWNER_FUNCTION.owner)||INTEGRATED_FUNCTIONS.some(f=>f.signature===signature&&f.owner===owner)||(signature===PAY_NOTICE_SIGNATURE||signature===PAY_ESTIMATE_SIGNATURE||signature===INBOX_SIGNATURE||signature===PUSH_SIGNATURE||signature===WORKER_PROVISIONING_SIGNATURE||signature===WORKER_TERMS_SIGNATURE||signature===SESSION_RPC||signature===AGENCY_PROFILE_SIGNATURE||signature===ACCOUNT_ADMIN_SIGNATURE||signature===ACCOUNT_SUPPORT_SIGNATURE||PENDING_FUNCTIONS.has(signature)||WORKSPACE_READ_FUNCTIONS.has(signature))&&owner==='postgres';
}

/* One reviewed Team definition transition, so old records remain available
 * while the additive comment migration is activated after the app deploy. */
function rpcFingerprintMatches(expected,definition){
 if(typeof definition!=='string')return false;
 const digest=createHash('sha256').update(definition).digest('hex');
 if(digest===expected.sha256)return true;
 const transitions={
  [INBOX_SIGNATURE]:['e69f5e968803ecf74e5a1c2748603e42a8ccce73e6562839d2f01ff3d5ac425a','1d3cf474b619e7205682c6211313d43c998068f9da7cf4f322a27c6dcbdd4923'],
  [WORKER_PROVISIONING_SIGNATURE]:['60e0d2a0cf091e454f8baa60777895c4de14a81d19ea97d837de5e8902f7a878','27ecd91ddddf38cebcde7f1bd1ead78a834582f37b43f1275779dc6ec78b0f56'],
  'timeax_api.team_workflow(text,text,text,jsonb,jsonb)':['bc946a1d445103b82b39512e08afaf73545fe3d29b7b30ad671bc418a54f9fa2','c8d09a03067adccecffc7bfd1ff41eb10d1a80553ec2a637ca831664b053d721'],
  'timeax_api.account_lifecycle(text,text,text,jsonb)':['185ca20355303ae01801381d4e5a41e255991120625bf92debf17050e293326f','32b4f1d0453723efc0da00786e95447317e22ee4099b8a0716fad85834d0f065'],
  'timeax_api.admin_accounts(text,uuid,text)':['cf35ca8dbd41a359faf6a21e6213561f2db5034da95fdc6a549858c1fcaf687d','a7e7dbc7082807254586c8d2d12d1db31a685b00fd769e3c127be937ec18e203'],
 };
 const transition=transitions[expected.signature];
 if(expected.signature===ACCOUNT_ADMIN_SIGNATURE
    &&['cf35ca8dbd41a359faf6a21e6213561f2db5034da95fdc6a549858c1fcaf687d','a7e7dbc7082807254586c8d2d12d1db31a685b00fd769e3c127be937ec18e203'].includes(expected.sha256)
    &&digest==='a8c1d03771645b0bfe6ea13d0b67360aa614011aaab63f17d2e0610582eb9d81')return true;
 return transition!==undefined&&expected.sha256===transition[0]&&digest===transition[1];
}
export function createScopedPgLane({host,role,password,ca,namespace,functions,statements,Client=pg.Client,Pool=pg.Pool}){
 if(!HOST.test(host)||!/^timeax_[a-z0-9_]+_login$/.test(role)||typeof password!=='string'||password.length<24
  ||password.length>256||/[\u0000-\u001f]/.test(password)||!['timeax_enrollment_rpc','timeax_api'].includes(namespace)
  ||!Array.isArray(functions)||!functions.length||!Array.isArray(statements)||!statements.length)throw Error('DB lane configuration denied');
 const cert=new X509Certificate(ca);
 if(!cert.ca||Date.parse(cert.validFrom)>Date.now()||Date.parse(cert.validTo)<=Date.now())throw Error('DB CA invalid');
 for(const f of functions)if(typeof f.signature!=='string'||!f.signature.startsWith(namespace+'.')
  ||!/^[0-9a-f]{64}$/.test(f.sha256)||!isApprovedRpcOwner(f.signature,f.owner))throw Error('Approved RPC fingerprint missing');
 const signatures=functions.map(f=>f.signature),allowed=new Set(statements);
 const options=(markVerified)=>({host,port:5432,user:role+'.rohgpgogsdtiltbocdao',password,database:'postgres',
   application_name:'timeax-registration-scoped',connectionTimeoutMillis:7000,query_timeout:5000,
   sslnegotiation:'postgres',keepAlive:true,
   ssl:{ca:cert.toString(),rejectUnauthorized:true,minVersion:'TLSv1.2',servername:host,
    checkServerIdentity(name,peer){
     if(name!==host)return Error('TLS identity denied');
     const error=checkServerIdentity(host,peer);if(!error)markVerified();return error;
    }}});
 async function guardedOperation(client,operation){
   const gate=await client.query(ROLE_CHECK_SQL,[role,namespace,signatures]);
   if(gate.rows?.length!==1||gate.rows[0]?.ok!==true)throw Error('DB role preflight denied');
   const result=await client.query(FUNCTION_CHECK_SQL,[signatures]);
   if(result.rows?.length!==functions.length)throw Error('RPC definition missing');
   for(const expected of functions){
    const row=result.rows.find(x=>x.signature===expected.signature);
    if(!row||row.owner!==expected.owner||row.prosecdef!==true||row.allowed!==true||row.grantable!==false
     ||JSON.stringify(row.proconfig)!==JSON.stringify(['search_path=pg_catalog, pg_temp'])
     ||!rpcFingerprintMatches(expected,row.definition))throw Error('RPC fingerprint preflight denied');
   }
   return operation(client);
 }
 // Reuse verified connections, never identity results or ACLs. The shared
 // workspace lane allows one connection per process; the DB cap is two, so
 // an overlapping Render deploy still has capacity.
 const verified=new WeakSet();
 class ScopedSessionClient extends Client{
  constructor(){let instance;super(options(()=>verified.add(instance)));instance=this;}
 }
 const maxPool=role===SESSION_ROLE?4:role===WORKSPACE_ROLE?1:0;
 const pool=maxPool?new Pool({...options(()=>{}),Client:ScopedSessionClient,max:maxPool,idleTimeoutMillis:5000,maxLifetimeSeconds:60,allowExitOnIdle:true}):null;
 pool?.on('error',()=>{});
 async function connectAndRun(operation){
  if(pool){
   const client=await pool.connect();
   let failure;
   try{
    if(!verified.has(client))throw Error('DB TLS identity not verified');
    return await guardedOperation(client,operation);
   }catch(error){failure=error;throw error;}finally{client.release(failure);}
  }
  let tlsVerified=false;
  const client=new Client(options(()=>{tlsVerified=true}));
  client.on('error',()=>{});
  try{
   await client.connect();if(!tlsVerified)throw Error('DB TLS identity not verified');
   return await guardedOperation(client,operation);
  }finally{await client.end().catch(()=>{})}
 }
 return Object.freeze({
  preflight:()=>connectAndRun(async()=>true),
  query(sql,args){if(!allowed.has(sql))return Promise.reject(Error('SQL statement denied'));return connectAndRun(client=>client.query(sql,args))},
 });
}
