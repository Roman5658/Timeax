// Server-only canonical QA lane. No provider administration or role provisioning.
export const OWNER_ROLE='timeax_owner_qa_login';
export const OWNER_FUNCTION={signature:'timeax_api.owner_qa(text,text,text,jsonb)',owner:'timeax_owner_qa_owner'};
export const OWNER_SQL='SELECT timeax_api.owner_qa($1::text,$2::text,$3::text,$4::jsonb) AS result';
export function createOwnerQaService(lane){
 if(!lane||typeof lane.query!=='function')throw Error('Owner lane unavailable');
 return Object.freeze({version:'reviewed-owner-qa-v2',async execute(actor,action,input={}){
  if(!['context','preview','cleanup'].includes(action))throw Error('Owner action unavailable');
  const r=await lane.query(OWNER_SQL,[actor.issuer,actor.subject,action,JSON.stringify(input)]);
  return r.rows[0]?.result;
 }});
}
export function createOwnerQaLane(config,{laneFactory,common,usedPasswords}){
 if(config.owner===undefined)return null;
 const c=config.contract?.owner;
 if(config.owner?.mode!=='reviewed-scoped-qa-v1'||Object.keys(config.owner).length!==1
  ||config.operations?.mode!=='reviewed-canonical-v1'||!c||c.version!==1||c.reviewed!==true
  ||!c.function||c.function.signature!==OWNER_FUNCTION.signature||c.function.owner!==OWNER_FUNCTION.owner
  ||!/^[a-f0-9]{64}$/.test(c.function.sha256??'')||!/^[a-f0-9]{64}$/.test(c.sqlManifestSha256??''))
  throw Error('Reviewed owner contract required');
 const password=config.secrets?.ownerPassword;
 if(typeof password!=='string'||password.length<24||password.length>256||/[\u0000-\u0020]/.test(password)||usedPasswords.includes(password))throw Error('Separate owner credential required');
 const lane=laneFactory({...common,role:OWNER_ROLE,password,namespace:'timeax_api',functions:[c.function],statements:[OWNER_SQL]});
 return {service:createOwnerQaService(lane),preflight:()=>lane.preflight()};
}
