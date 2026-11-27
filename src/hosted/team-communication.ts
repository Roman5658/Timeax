export type TeamAudience='agency'|'workers'|'production'|'leader'|'factory';
export type TeamRecipient={id:string;role:string;organizationName:string;organizationId:string;worksiteIds:string[]};
type TeamRecipientScope={organizationId:string;role:string;factoryChat?:boolean;sites:{id:string}[];recipients:TeamRecipient[]};
export const teamUuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function cleanTeamDay(raw:string|null){
 if(!raw||!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';
 const ms=Date.parse(raw+'T00:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===raw?raw:'';
}
export const warsawTeamDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function eligibleTeamRecipients(context:TeamRecipientScope,audience:TeamAudience,site:string){
 const siteAvailable=teamUuid(site)&&context.sites.some(w=>w.id===site);
 // The original RPC projects worksiteIds for workers only. Do not infer a
 // leader's assignment across sites. A singleton site proves the pairing.
 const matchesSite=(r:TeamRecipient)=>siteAvailable&&(r.worksiteIds.includes(site)||r.role==='team_leader'&&
  !r.worksiteIds.length&&context.sites.length===1);
 if(context.role==='worker'){
  if(audience==='agency')return context.recipients.filter(r=>r.role==='agency_admin'&&r.organizationId===context.organizationId);
  if(audience==='leader')return context.recipients.filter(r=>r.role==='team_leader'&&matchesSite(r));
  if(audience==='factory'&&context.factoryChat===true)return context.recipients.filter(r=>r.role==='factory_admin'&&matchesSite(r));
 }
 if(context.role==='factory_admin'&&context.factoryChat===true&&audience==='workers')
  return context.recipients.filter(r=>r.role==='worker'&&r.organizationId===context.organizationId&&matchesSite(r));
 if(context.role==='agency_admin'||context.role==='team_leader'){
  if(audience==='workers')return context.recipients.filter(r=>r.role==='worker'&&(context.role==='agency_admin'
   ?r.organizationId===context.organizationId:matchesSite(r)));
  if(audience==='production')return context.recipients.filter(r=>r.role==='worker'&&matchesSite(r)
   &&(context.role==='team_leader'||r.organizationId===context.organizationId));
  if(audience==='leader'&&context.role==='agency_admin')return context.recipients.filter(r=>r.role==='team_leader'&&matchesSite(r));
  if(audience==='agency'&&context.role==='team_leader')return context.recipients.filter(r=>r.role==='agency_admin'&&matchesSite(r));
 }
 return [];
}
