import {isMembershipLocal} from "../auth/registration/agency-registration.ts";
export type Membership = {id:string;organizationId:string;organizationName:string;role:"agency"|"worker";state:"active"};
export type WorkspaceContext = {localOnly:true;operator:boolean;memberships:Membership[];csrf:string};
export type AgencyApplication = {id:string;name:string;nip:string;state:"pending"|"approved";organizationId?:string};
export type JoinRequest = {id:string;name:string;state:"awaiting-approval"|"approved";submittedAt:string;resolvedAt?:string};
export type Placement = {employmentId:string;membershipId:string;organizationId:string;agencyName:string;worksiteId:string;worksiteName:string;startDate:string;endDate?:string;inputAccess:"self"};
export type RecordedShift = {id:string;local_date:string;start_at:string;end_at:string;gross_minutes:number;break_minutes:number;paid_minutes:number;review_state:"not-required";worker_name?:string;worksite_name?:string;comment:string};
export type InternalTimesheet = {id:string;date_from:string;date_to:string;created_at:string;snapshot:{kind:"internal-agency";agencyName:string;folderName:string;dateFrom:string;dateTo:string;timeZone:"Europe/Warsaw";rows:RecordedShift[];totals:{shifts:number;grossMinutes:number;breakMinutes:number;paidMinutes:number}}};
export type WorkspaceData = {applications?:AgencyApplication[];requests?:JoinRequest[];worksites?:{id:string;name:string}[];placements?:Placement[];shifts?:RecordedShift[];timesheets?:InternalTimesheet[]};
export class WorkspaceError extends Error {status:number; constructor(status:number){super(status===409?"conflict":status===400?"invalid":status===403?"closed":"unavailable");this.status=status}}
export function createWorkspaceClient(mode:string,origin:string,transport:typeof fetch){
 if(!isMembershipLocal(mode,origin))return;
 async function request<T>(route:string,signal:AbortSignal,input?:object,csrf?:string):Promise<T>{
  const url=origin+"/api/workspace"+route;
  const response=await transport(url,{method:input?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal,
   headers:{Accept:"application/json",...(input?{"Content-Type":"application/json","X-Workspace-CSRF":csrf??""}:{})},...(input?{body:JSON.stringify(input)}:{})});
  if(response.redirected||response.url!==url||!response.headers.get("content-type")?.startsWith("application/json")||!response.headers.get("cache-control")?.includes("no-store"))throw new WorkspaceError(503);
  if(!response.ok)throw new WorkspaceError(response.status);
  return response.json() as Promise<T>;
 }
 return {request,async context(signal:AbortSignal){
  const v=await request<WorkspaceContext>("/context",signal);
  if(v.localOnly!==true||typeof v.operator!=="boolean"||typeof v.csrf!=="string"||!Array.isArray(v.memberships)||v.memberships.some(m=>!m||!["agency","worker"].includes(m.role)||m.state!=="active"))throw new WorkspaceError(503);
  return v;
 }};
}
