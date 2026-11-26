import {useRef,useState,type FormEvent} from "react";
import {useTranslation} from "react-i18next";
import type {Assignment,FactoryShift} from "./factory-client";
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Warsaw",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export function FactoryEntryForm({assignments,busy,editing,onSubmit,onCancel}:{assignments:Assignment[];busy:boolean;editing?:FactoryShift;onSubmit:(input:object)=>Promise<boolean>;onCancel?:()=>void}){
 const {t}=useTranslation(),tx=(k:string)=>t("localWorkspace."+k),fx=(k:string)=>t("connectedFactory."+k);
 const time=(date?:string)=>date?new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Warsaw",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(date)):"";
 const [assignment,setAssignment]=useState(editing?.assignment_id??(assignments.length===1?assignments[0].id:""));
 const [date,setDate]=useState(editing?.local_date??today),[start,setStart]=useState(time(editing?.start_at)||"08:00"),[end,setEnd]=useState(time(editing?.end_at)||"16:00");
 const [breakStatus,setBreakStatus]=useState(editing?.break_status??"not-taken"),[minutes,setMinutes]=useState(editing?.break_minutes??0),[treatment,setTreatment]=useState(editing?.break_treatment??"unpaid"),[comment,setComment]=useState(editing?.comment??"");
 const operation=useRef<{key:string;id:string}|undefined>(undefined);
 async function submit(e:FormEvent){
  e.preventDefault();const input={assignmentId:assignment,localDate:date,startTime:start,endTime:end,breakStatus,breakMinutes:minutes,breakTreatment:treatment,comment,...(editing?{revision:editing.revision}:{})};
  const key=JSON.stringify(input);if(operation.current?.key!==key)operation.current={key,id:crypto.randomUUID()};
  await onSubmit({...input,[editing?"operationId":"submissionId"]:operation.current.id});
 }
 return <form onSubmit={submit} data-testid="factory-entry-form"><fieldset disabled={busy} className="auth-form membership-grid factory-fieldset">
  {editing&&<p className="membership-wide">{fx("correctionHint")}</p>}
  <label className="field-label membership-wide"><span>{fx("assignment")}</span><select id="factory-assignment" value={assignment} required disabled={!!editing} onChange={e=>setAssignment(e.target.value)}><option value="">{fx("selectAssignment")}</option>{assignments.map(a=><option key={a.id} value={a.id}>{a.worker_name} · {a.agencyName} · {a.start_date}</option>)}</select></label>
  <label className="field-label"><span>{tx("date")}</span><input id="factory-date" type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
  <label className="field-label"><span>{tx("start")}</span><input id="factory-start" type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label>
  <label className="field-label"><span>{tx("end")}</span><input id="factory-end" type="time" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
  <label className="field-label"><span>{tx("breakStatus")}</span><select id="factory-break-status" value={breakStatus} onChange={e=>{setBreakStatus(e.target.value as typeof breakStatus);if(e.target.value==="not-taken")setMinutes(0)}}><option value="not-taken">{tx("noBreak")}</option><option value="taken">{tx("breakTaken")}</option></select></label>
  <label className="field-label"><span>{tx("breakMinutes")}</span><input id="factory-break-minutes" type="number" required min={breakStatus==="taken"?1:0} max={1439} disabled={breakStatus==="not-taken"} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>
  <label className="field-label"><span>{tx("treatment")}</span><select id="factory-break-treatment" value={treatment} onChange={e=>setTreatment(e.target.value as typeof treatment)}><option value="unpaid">{tx("unpaid")}</option><option value="paid">{tx("paid")}</option></select></label>
  <label className="field-label membership-wide"><span>{tx("comment")}</span><textarea id="factory-comment" maxLength={500} value={comment} onChange={e=>setComment(e.target.value)}/></label>
  <button className="button button--primary membership-wide" type="submit">{editing?fx("saveCorrection"):fx("saveHours")}</button>
  {editing&&<button type="button" className="button button--outline" onClick={onCancel}>{fx("cancel")}</button>}
 </fieldset></form>;
}
