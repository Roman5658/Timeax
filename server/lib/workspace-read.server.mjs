import {ISSUER} from './provider-adapters.mjs';
export const WORKSPACE_SQL=`WITH own AS MATERIALIZED (
 SELECT membership_id,organization_id,organization_kind,role
 FROM timeax_api.my_membership($1::text,$2::text,$3::uuid)
)
SELECT own.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.worksite_id,'name',w.name) ORDER BY w.worksite_id)
 FROM (SELECT worksite_id,name FROM timeax_api.my_worksites($1::text,$2::text,$3::uuid) LIMIT 501) w),'[]'::jsonb) AS worksites
FROM own`;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)&&v!=='00000000-0000-0000-0000-000000000000';
const roles=new Set(['agency_admin','factory_admin','worker','team_leader','accountant']);
const validRole=(role,kind)=>roles.has(role)&&['agency','factory'].includes(kind)&&(!['agency_admin','accountant'].includes(role)||kind==='agency')&&(role!=='factory_admin'||kind==='factory');
const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
export function createWorkspaceReadStore(database){
 if(typeof database?.query!=='function')throw Error('Read-only workspace lane missing');
 return Object.freeze({async get(identity,organizationId){
  const result=await database.query(WORKSPACE_SQL,[identity.issuer,identity.subject,organizationId]);
  if(!Array.isArray(result?.rows)||result.rows.length>1)throw Error('Invalid membership response');
  if(!result.rows.length)return null;
  const r=result.rows[0];
  if(!uuid(r.membership_id)||r.organization_id!==organizationId||!validRole(r.role,r.organization_kind)||!Array.isArray(r.worksites)||r.worksites.length>500)throw Error('Invalid workspace response');
  const seen=new Set();
  for(const site of r.worksites){if(!site||Object.keys(site).length!==2||!uuid(site.id)||seen.has(site.id)||typeof site.name!=='string'||site.name.trim().length<1||site.name.trim().length>120)throw Error('Invalid worksite');seen.add(site.id)}
  return {version:1,state:'ready',organization:{id:organizationId,kind:r.organization_kind},membership:{id:r.membership_id,role:r.role},worksites:r.worksites};
 }});
}
export function createWorkspaceReadHandler({origin,store,resolveSession,now=Date.now}){
 const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:'||!store||typeof resolveSession!=='function')throw Error('Guarded workspace dependencies required');
 return async request=>{
  try{
   const url=new URL(request.url),match=url.pathname.match(/^\/api\/workspace-access\/([0-9a-f-]+)$/);
   if(url.origin!==origin||url.search||url.hash||!match||!uuid(match[1]))return json(404,{error:'not-found'});
   if(request.method!=='GET')return json(405,{error:'read-only'});
   const session=await resolveSession(request);
   if(session?.state==='unavailable')return json(503,{error:'workspace-unavailable'});
   const active=async()=>!request.signal.aborted&&session?.state==='verified'&&session.issuer===ISSUER&&typeof session.subject==='string'&&session.subject.length>0&&session.subject.length<=255&&session.emailConfirmed===true&&session.isAnonymous===false&&Number.isSafeInteger(session.expiresAt)&&session.expiresAt>now()&&typeof session.isActive==='function'&&await session.isActive()===true;
   if(!await active())return json(401,{error:'valid-session-required'});
   const result=await store.get({issuer:session.issuer,subject:session.subject},match[1]);
   if(!await active())return json(401,{error:'valid-session-required'});
   return result?json(200,result):json(403,{error:'workspace-not-authorized'});
  }catch{return json(503,{error:'workspace-unavailable'})}
 };
}
