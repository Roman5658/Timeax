const workspace=/^\/workspace\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const nil='/workspace/00000000-0000-0000-0000-000000000000';
type Membership={organizationId:string;state:string};

/** Non-authoritative same-origin navigation hint. The cabinet always rechecks membership. */
export function workerWorkspaceHint(value:unknown):string|undefined{
 return typeof value==='string'&&value.length===47&&workspace.test(value)&&value!==nil?value:undefined;
}

export function workerWorkspaceReturn(hint:unknown,memberships?:readonly Membership[]){
 const candidate=workerWorkspaceHint(hint);
 if(!memberships)return candidate;
 const active=[...new Set(memberships.filter(m=>m.state==='active')
  .map(m=>workerWorkspaceHint('/workspace/'+m.organizationId)).filter((v):v is string=>v!==undefined))];
 if(candidate&&active.includes(candidate))return candidate;
 // With multiple choices and no known origin, keep the choices visible on the
 // profile rather than guessing an employer to redirect to.
 return active.length===1?active[0]:undefined;
}

type ActiveConnection={organizationId:string;membershipId:string;role:string;kind:string};
export function shouldOfferAgencyJoin(connections:readonly ActiveConnection[]|undefined):boolean{
 return !!connections&&!connections.some(c=>c.kind==='agency'&&c.role==='worker');
}
export function hasCurrentWorkerWorkspace(connections:readonly ActiveConnection[],organizationId:string,membershipId:string):boolean{
 return connections.some(c=>c.role==='worker'&&c.organizationId===organizationId&&c.membershipId===membershipId);
}
