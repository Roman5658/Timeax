import {isMembershipLocal} from "../auth/registration/agency-registration.ts";
export type Factory={id:string;name:string;mode:"self"|"attendance";leader:boolean;agencies:{id:string;name:string}[]};
export type Assignment={id:string;factory_id:string;agency_id:string;worker_name:string;agencyName:string;factoryName:string;start_date:string;end_date?:string};
export type FactoryShift={id:string;assignment_id:string;factoryId:string;agencyId:string;factoryName:string;agencyName:string;workerName:string;local_date:string;start_at:string;end_at:string;gross_minutes:number;break_minutes:number;paid_minutes:number;break_status:"taken"|"not-taken";break_treatment:"paid"|"unpaid";comment:string;source:"self"|"leader";state:"needs-review"|"needs-confirmation"|"disputed"|"ready";revision:number;sent:boolean;decision_note:string;history:{id:string;revision:number;action:string;occurred_at:string;before_record:FactoryShift|null;after_record:FactoryShift}[]};
export type FactorySheet={id:string;factory_id:string;agency_id:string;date_from:string;date_to:string;created_at:string;snapshot:{state:"received";factoryName:string;agencyName:string;rows:FactoryShift[];totalMinutes:number}};
export type FactoryContext={localOnly:true;csrf:string;agency:boolean;factories:Factory[];assignments:Assignment[];shifts:FactoryShift[];received:FactorySheet[]};
export class FactoryError extends Error{status:number;constructor(status:number,code:string){super(["closed","invalid","conflict","hoursNotReady"].includes(code)?code:"unavailable");this.status=status}}
export function createFactoryClient(mode:string,origin:string,transport:typeof fetch){
 if(!isMembershipLocal(mode,origin))return;
 async function request<T>(route:string,signal:AbortSignal,input?:object,csrf?:string):Promise<T>{
  const url=origin+"/api/connected-factory"+route,r=await transport(url,{method:input?"POST":"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal,
   headers:{Accept:"application/json",...(input?{"Content-Type":"application/json","X-Factory-CSRF":csrf??""}:{})},...(input?{body:JSON.stringify(input)}:{})});
  if(r.redirected||r.url!==url||!r.headers.get("content-type")?.startsWith("application/json")||!r.headers.get("cache-control")?.includes("no-store"))throw new FactoryError(503,"unavailable");
  const data=await r.json();if(!r.ok)throw new FactoryError(r.status,data.error);return data as T;
 }
 return {request,async context(signal:AbortSignal){
  const v=await request<FactoryContext>("/context",signal);
  if(v.localOnly!==true||typeof v.csrf!=="string"||typeof v.agency!=="boolean"||![v.factories,v.assignments,v.shifts,v.received].every(Array.isArray)||
   v.factories.some(f=>!["self","attendance"].includes(f.mode)||typeof f.leader!=="boolean")||
   v.shifts.some(s=>!["needs-review","needs-confirmation","disputed","ready"].includes(s.state)))throw new FactoryError(503,"unavailable");
  return v;
 }};
}
