import type {SetupContext} from './factory-enrollment';

export function resolveFactoryClaim(result:unknown,scope:SetupContext,role:'team_leader'|'worker'):string|null{
 if(!result||typeof result!=='object')return null;
 const v=result as {membershipId?:unknown;worksiteId?:unknown;organizationId?:unknown};
 const id=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s);
 if(!id(v.membershipId)||!id(v.worksiteId)||(v.organizationId!==undefined&&!id(v.organizationId))||(role==='worker'&&!id(v.organizationId)))return null;
 const member=scope.memberships.find(m=>m.id===v.membershipId&&m.kind==='factory'&&m.role===role&&(v.organizationId===undefined||m.organizationId===v.organizationId));
 if(!member||!id(member.organizationId)||!scope.worksites.some(s=>s.id===v.worksiteId&&s.ownerId===member.organizationId&&s.organizationId===member.organizationId&&s.ownerKind==='factory'&&s.role===role))return null;
 return '/workspace/'+member.organizationId;
}
