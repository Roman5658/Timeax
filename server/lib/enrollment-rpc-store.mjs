// Result semantics verified against the exact delivered Frankfurt DDL.
// This source review does not approve live fingerprints, credentials or activation.
export const ENROLLMENT_DDL_SHA256='1446e8e443fb6076881e8a27c40f787adf7237cb03dc3f8f761a52f4c943ff25';
export const ENROLLMENT_RESULT_CONTRACT=Object.freeze({
 id:'timeax-enrollment-result-v2',reviewed:true,sourceSha256:ENROLLMENT_DDL_SHA256,
 booleanResult:true,takeAttempt:Object.freeze({subject:'subject',expiry:'expiry_ms',attempt:'attempt_number',expiryType:'bigint-ms'}),
 finishAttemptMeaning:'compare-and-consume-current-attempt',
});
export const ENROLLMENT_SQL=Object.freeze({
 reserve:'SELECT timeax_enrollment_rpc.reserve($1::text,$2::text,$3::bigint) AS ok',
 consume:'SELECT timeax_enrollment_rpc.consume_before($1::text,$2::bigint,$3::uuid,$4::uuid) AS ok',
 acknowledge:'SELECT timeax_enrollment_rpc.ack_provider($1::text,$2::text,$3::bigint) AS ok',
 takeAttempt:'SELECT * FROM timeax_enrollment_rpc.take_attempt($1::text,$2::text)',
 finishIdentity:'SELECT timeax_enrollment_rpc.finish_identity($1::text,$2::text,$3::uuid,$4::smallint) AS ok',
});
export const ENROLLMENT_SIGNATURES=Object.freeze({
 web:['timeax_enrollment_rpc.reserve(text,text,bigint)','timeax_enrollment_rpc.ack_provider(text,text,bigint)',
  'timeax_enrollment_rpc.take_attempt(text,text)','timeax_enrollment_rpc.finish_identity(text,text,uuid,smallint)'],
 hook:['timeax_enrollment_rpc.consume_before(text,bigint,uuid,uuid)'],
});
const UUID_V4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function expiryDate(value){
 // node-postgres preserves int8 as decimal text; PGlite returns a safe number.
 // Accept either losslessly, never guess units or round an unsafe value.
 if(typeof value==='string'&&!/^[1-9][0-9]*$/.test(value))return null;
 if(!['string','number','bigint'].includes(typeof value))return null;
 const millis=Number(value);
 if(!Number.isSafeInteger(millis)||millis<=0)return null;
 const result=new Date(millis);
 return Number.isFinite(result.getTime())?result:null;
}
export function createEnrollmentRpcStore({web,hook,contract}){
 const expected=ENROLLMENT_RESULT_CONTRACT;
 if(contract?.id!==expected.id||contract.reviewed!==true||contract.sourceSha256!==expected.sourceSha256
  ||contract.takeAttempt?.subject!=='subject'||contract.takeAttempt?.expiry!=='expiry_ms'
  ||contract.takeAttempt?.attempt!=='attempt_number'||contract.takeAttempt?.expiryType!=='bigint-ms'
  ||contract.booleanResult!==true||contract.finishAttemptMeaning!==expected.finishAttemptMeaning
  ||typeof web?.query!=='function'||typeof hook?.query!=='function')throw Error('Enrollment RPC result contract not approved');
 const once=async(db,sql,args)=>{const r=await db.query(sql,args);return r.rows?.length===1&&r.rows[0]?.ok===true};
 return Object.freeze({
  reserve:p=>once(web,ENROLLMENT_SQL.reserve,[p.id,p.routeTag,p.expiry]),
  consume:p=>once(hook,ENROLLMENT_SQL.consume,[p.id,p.expiry,p.subject,p.providerEvent]),
  acknowledge:p=>once(web,ENROLLMENT_SQL.acknowledge,[p.id,p.routeTag,p.expiry]),
  async takeAttempt(p){
   const r=await web.query(ENROLLMENT_SQL.takeAttempt,[p.id,p.routeTag]);
   if(r.rows?.length!==1)return null;
   const row=r.rows[0],expiresAt=expiryDate(row.expiry_ms);
   if(typeof row.subject!=='string'||!UUID_V4.test(row.subject)||!expiresAt
    ||!Number.isInteger(row.attempt_number)||row.attempt_number<1||row.attempt_number>5)return null;
   return {subject:row.subject,expiresAt,attempt:row.attempt_number};
  },
  finishIdentity:p=>Number.isInteger(p.attempt)&&p.attempt>=1&&p.attempt<=5
   ?once(web,ENROLLMENT_SQL.finishIdentity,[p.id,p.routeTag,p.subject,p.attempt]):Promise.resolve(false),
 });
}
