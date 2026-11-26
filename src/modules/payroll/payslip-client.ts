import {isMembershipLocal} from "../auth/registration/agency-registration.ts";
export type PaySource={kind:"internal"|"factory";sourceId:string;agencyId:string;siteId:string;dateFrom:string;dateTo:string;agencyName:string;siteName:string;workerName:string;workerKey:string;paidMinutes:number;rows:{id:string;local_date:string;start_at:string;end_at:string;paid_minutes:number}[]};
export type PayValues={nightMinutes:number;dayRate:number;nightRate:number;additions:number;deductions:number;note:string};
export type Calculation=PayValues&{paidMinutes:number;grossCents:number;netCents:number;currency:"PLN";method:string};
export type PayDraft={id:string;kind:PaySource["kind"];agency_id:string;source:PaySource;source_sha256:string;calculation:Calculation|null;state:"draft"|"checked";revision:number;assignee_id:string|null;owner:boolean};
export type Publication={id:string;sha256:string;issued_at:string;delivery:"cabinet";notification:"disabled";document:{id:string;version:1;type:"timeax-payslip";source:PaySource;sourceSha256:string;calculation:Calculation;checkedAt:string;issuedAt:string;notice:string}};
export type PayScope={kind:PaySource["kind"];agencyId:string;name:string};
export type PayContext={localOnly:true;csrf:string;notification:"disabled";scopes:PayScope[];workerScopes:PayScope[];accountant:boolean;sources:PaySource[];accountants:(PayScope&{id:string})[];drafts:PayDraft[];published:Publication[];requests:{id:string;kind:string;agency_id:string;month:string;note:string;state:"requested"|"issued"}[]};
export class PayslipError extends Error{status:number;constructor(status:number,code:string){super(["closed","invalid","conflict"].includes(code)?code:"unavailable");this.status=status}}
export function createPayslipClient(mode:string,origin:string,transport:typeof fetch){
 if(!isMembershipLocal(mode,origin))return;
 async function request<T>(route:string,signal:AbortSignal,input?:object,csrf?:string):Promise<T>{
  const url=origin+"/api/workspace/payslips"+route,r=await transport(url,{method:input?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal,
   headers:{Accept:"application/json",...(input?{"Content-Type":"application/json","X-Payslip-CSRF":csrf??""}:{})},...(input?{body:JSON.stringify(input)}:{})});
  if(r.redirected||r.url!==url||!r.headers.get("content-type")?.startsWith("application/json")||!r.headers.get("cache-control")?.includes("no-store"))throw new PayslipError(503,"unavailable");
  const v=await r.json();if(!r.ok)throw new PayslipError(r.status,v.error);return v as T;
 }
 return {request,async context(signal:AbortSignal){
  const v=await request<PayContext>("/context",signal);
  if(v.localOnly!==true||v.notification!=="disabled"||typeof v.csrf!=="string"||typeof v.accountant!=="boolean"||![v.scopes,v.workerScopes,v.sources,v.accountants,v.drafts,v.published,v.requests].every(Array.isArray))throw new PayslipError(503,"unavailable");
  return v;
 }};
}
