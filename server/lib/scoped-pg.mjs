import {TEAM_FUNCTION} from './team-workflow.server.mjs';
import {ACCOUNT_ADMIN_SIGNATURE} from './account-admin.mjs';
import {OWNER_FUNCTION} from './owner-qa-store.mjs';
import pg from 'pg';
import {INTEGRATED_FUNCTIONS} from './integrated.contract.mjs';
import {WORKSPACE_FUNCTIONS} from './workspace-read.contract.mjs';
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
  :(signature===TEAM_FUNCTION.signature&&owner===TEAM_FUNCTION.owner)||(signature===OWNER_FUNCTION.signature&&owner===OWNER_FUNCTION.owner)||INTEGRATED_FUNCTIONS.some(f=>f.signature===signature&&f.owner===owner)||(signature===ACCOUNT_ADMIN_SIGNATURE||PENDING_FUNCTIONS.has(signature)||WORKSPACE_READ_FUNCTIONS.has(signature))&&owner==='postgres';
}

export function createScopedPgLane({host,role,password,ca,namespace,functions,statements,Client=pg.Client}){
 if(!HOST.test(host)||!/^timeax_[a-z0-9_]+_login$/.test(role)||typeof password!=='string'||password.length<24
  ||password.length>256||/[\u0000-\u001f]/.test(password)||!['timeax_enrollment_rpc','timeax_api'].includes(namespace)
  ||!Array.isArray(functions)||!functions.length||!Array.isArray(statements)||!statements.length)throw Error('DB lane configuration denied');
 const cert=new X509Certificate(ca);
 if(!cert.ca||Date.parse(cert.validFrom)>Date.now()||Date.parse(cert.validTo)<=Date.now())throw Error('DB CA invalid');
 for(const f of functions)if(typeof f.signature!=='string'||!f.signature.startsWith(namespace+'.')
  ||!/^[0-9a-f]{64}$/.test(f.sha256)||!isApprovedRpcOwner(f.signature,f.owner))throw Error('Approved RPC fingerprint missing');
 const signatures=functions.map(f=>f.signature),allowed=new Set(statements);
 async function connectAndRun(operation){
  let tlsVerified=false;
  const client=new Client({host,port:5432,user:role+'.rohgpgogsdtiltbocdao',password,database:'postgres',
   application_name:'timeax-registration-scoped',connectionTimeoutMillis:7000,query_timeout:5000,
   sslnegotiation:'postgres',keepAlive:true,
   ssl:{ca:cert.toString(),rejectUnauthorized:true,minVersion:'TLSv1.2',servername:host,
    checkServerIdentity(name,peer){
     if(name!==host)return Error('TLS identity denied');
     const error=checkServerIdentity(host,peer);if(!error)tlsVerified=true;return error;
    }}});
  client.on('error',()=>{});
  try{
   await client.connect();if(!tlsVerified)throw Error('DB TLS identity not verified');
   const gate=await client.query(ROLE_CHECK_SQL,[role,namespace,signatures]);
   if(gate.rows?.length!==1||gate.rows[0]?.ok!==true)throw Error('DB role preflight denied');
   const result=await client.query(FUNCTION_CHECK_SQL,[signatures]);
   if(result.rows?.length!==functions.length)throw Error('RPC definition missing');
   for(const expected of functions){
    const row=result.rows.find(x=>x.signature===expected.signature);
    if(!row||row.owner!==expected.owner||row.prosecdef!==true||row.allowed!==true||row.grantable!==false
     ||JSON.stringify(row.proconfig)!==JSON.stringify(['search_path=pg_catalog, pg_temp'])
     ||typeof row.definition!=='string'||createHash('sha256').update(row.definition).digest('hex')!==expected.sha256)throw Error('RPC fingerprint preflight denied');
   }
   return await operation(client);
  }finally{await client.end().catch(()=>{})}
 }
 return Object.freeze({
  preflight:()=>connectAndRun(async()=>true),
  query(sql,args){if(!allowed.has(sql))return Promise.reject(Error('SQL statement denied'));return connectAndRun(client=>client.query(sql,args))},
 });
}
