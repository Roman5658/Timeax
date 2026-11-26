// The RPC signatures and role gate originate in archived Dev07.
// The separate local SQL fixture is a proposed reproduction, not a production migration.
export const REGISTRATION_ROLE = 'timeax_staging_registration_login';
const GATE = `WITH verified_runtime AS MATERIALIZED (
 SELECT $1::text AS issuer,$2::text AS subject FROM pg_catalog.pg_roles r
 WHERE r.rolname=CURRENT_USER AND CURRENT_USER=SESSION_USER
 AND r.rolname='timeax_staging_registration_login'
 AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls
 AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolinherit
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
)`;
export const REGISTER_SQL = `${GATE}
 SELECT f.request_id,f.status,f.requested_at FROM verified_runtime v
 CROSS JOIN LATERAL timeax_api.request_agency_registration(v.issuer,v.subject,$3,$4) f`;
export const STATUS_SQL = `${GATE}
 SELECT f.request_id,f.status,f.requested_at FROM verified_runtime v
 LEFT JOIN LATERAL timeax_api.my_agency_registration(v.issuer,v.subject) f ON true`;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export function pendingStatements(role = REGISTRATION_ROLE) {
 if(!/^timeax_[a-z0-9_]+_login$/.test(role))throw Error('Invalid pending role');
 return {register:REGISTER_SQL.replace("'"+REGISTRATION_ROLE+"'", "'"+role+"'"), status:STATUS_SQL.replace("'"+REGISTRATION_ROLE+"'", "'"+role+"'")};
}
export function createPendingStore(database, {role=REGISTRATION_ROLE}={}) {
 const statements=pendingStatements(role);
 if(typeof database?.query!=='function')throw Error('Missing registration database');
 async function query(sql,params,allowAbsent) {
  const result=await database.query(sql,params);
  if(!Array.isArray(result?.rows)||result.rows.length!==1)throw Error('Registration unavailable');
  const row=result.rows[0];
  if(allowAbsent&&row?.request_id===null&&row.status===null&&row.requested_at===null)return null;
  if(typeof row?.request_id!=='string'||!uuid.test(row.request_id)||row.request_id==='00000000-0000-0000-0000-000000000000'
   ||row.status!=='pending'||!(row.requested_at instanceof Date)||!Number.isFinite(row.requested_at.getTime()))throw Error('Invalid registration receipt');
  return Object.freeze({requestId:row.request_id,status:'pending',requestedAt:row.requested_at.toISOString()});
 }
 return Object.freeze({
  get:identity=>query(statements.status,[identity.issuer,identity.subject],true),
  submit:(identity,draft)=>query(statements.register,[identity.issuer,identity.subject,draft.agencyName,draft.nip??null],false),
 });
}
