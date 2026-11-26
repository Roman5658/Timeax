import type {InternalTimesheet} from "./workspace-client.ts";
const cell=(value:unknown)=>{const text=String(value??"");return '"'+(/^[\s]*[=+@-]/u.test(text)?"'":"")+text.replaceAll('"','""')+'"'};
export const duration=(minutes:number)=>Math.floor(minutes/60).toString().padStart(2,"0")+":"+String(minutes%60).padStart(2,"0");
export function internalTimesheetCsv(sheet:InternalTimesheet){
 const s=sheet.snapshot,time=(value:string)=>new Intl.DateTimeFormat("en-GB",{timeZone:s.timeZone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
 const rows:unknown[][]=[
  ["Timeax — ewidencja godzin; wewnętrzna organizacja pracy agencji"],
  ["Agencja",s.agencyName],["Folder",s.folderName],["Okres",s.dateFrom,s.dateTo],["Strefa czasu",s.timeZone],["Zapis tablicy",sheet.id,sheet.created_at],
  ["Pracownik","Data","Od","Do","Minuty brutto","Przerwa (min)","Minuty po przerwie niepłatnej","ID zapisu"],
  ...s.rows.map(r=>[r.worker_name,r.local_date,time(r.start_at),time(r.end_at),r.gross_minutes,r.break_minutes,r.paid_minutes,r.id]),
  ["SUMA","","","",s.totals.grossMinutes,s.totals.breakMinutes,s.totals.paidMinutes,""]
 ];
 return "\uFEFF"+rows.map(row=>row.map(cell).join(";")).join("\r\n")+"\r\n";
}
