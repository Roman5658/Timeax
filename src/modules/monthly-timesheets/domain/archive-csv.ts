export type ArchiveCsvInput={origin:string;agency:string;site:string;from:string;to:string;id:string;createdAt:string;rows:{id:string;worker:string;date:string;start?:string;end?:string;gross:number;breaks:number;paid:number}[]};
const cell=(v:unknown)=>{const s=String(v??"");return '"'+(/^[\s]*[=+@-]/u.test(s)?"'":"")+s.replaceAll('"','""')+'"'};
export function archiveCsv(s:ArchiveCsvInput){
 const time=(v?:string)=>v?new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Warsaw",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(v)):"";
 const rows:unknown[][]=[["Timeax - timesheet archive"],["Origin",s.origin],["Agency",s.agency],["Site",s.site],["Period",s.from,s.to],["Snapshot",s.id,s.createdAt],["Time zone","Europe/Warsaw"],
 ["Worker","Date","Start","End","Gross minutes","Break minutes","Minutes after unpaid break","Record ID"],
 ...s.rows.map(r=>[r.worker,r.date,time(r.start),time(r.end),r.gross,r.breaks,r.paid,r.id]),
 ["TOTAL","","","","","",s.rows.reduce((n,r)=>n+r.paid,0),""]];
 return "\uFEFF"+rows.map(r=>r.map(cell).join(";")).join("\r\n")+"\r\n";
}
export function downloadArchiveCsv(text:string,name:string){
 const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");
 link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
