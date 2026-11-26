import {useTranslation} from "react-i18next";
import type {InternalTimesheet} from "./workspace-client";
import {duration} from "./internal-timesheet";
export function InternalTimesheetView({sheet,onDownload}:{sheet:InternalTimesheet;onDownload:()=>void}){
 const {t}=useTranslation(),tx=(key:string)=>t("localWorkspace."+key),s=sheet.snapshot;
 const time=(value:string)=>new Intl.DateTimeFormat(undefined,{timeZone:"Europe/Warsaw",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
 return <article data-testid="internal-timesheet" data-record-id={sheet.id} className="membership-record">
  <h3>{s.folderName} · {s.dateFrom} — {s.dateTo}</h3><p>{s.agencyName} · Europe/Warsaw</p>
  <p>{tx("sheetSnapshot")} {new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short",timeZone:"Europe/Warsaw"}).format(new Date(sheet.created_at))}</p>
  <div className="internal-timesheet-scroll"><table className="internal-timesheet-table"><caption>{tx("periodHours")}</caption>
   <thead><tr><th scope="col">{tx("worker")}</th><th scope="col">{tx("date")}</th><th scope="col">{tx("recordedInterval")}</th><th scope="col">{tx("paidTime")}</th></tr></thead>
   <tbody>{s.rows.map(r=><tr key={r.id} data-testid="timesheet-row"><th scope="row">{r.worker_name}</th><td>{r.local_date}</td><td>{time(r.start_at)}–{time(r.end_at)}</td><td>{duration(r.paid_minutes)}</td></tr>)}</tbody>
  </table></div>
  <p data-testid="timesheet-total">{tx("total")}: {duration(s.totals.paidMinutes)} · {s.totals.paidMinutes} min</p>
  <p>{tx("gross")}: {s.totals.grossMinutes} min · {tx("breakMinutes")}: {s.totals.breakMinutes} min · {tx("recordCount")}: {s.totals.shifts}</p>
  <button type="button" className="button button--outline" onClick={onDownload}>{tx("downloadTimesheet")}</button>
 </article>;
}
