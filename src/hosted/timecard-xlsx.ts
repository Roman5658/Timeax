import ExcelJS from 'exceljs';
import type {Snapshot} from './timecards.ts';
import type {FactorySnapshot} from './factory-timecards.ts';
import {workerLabelText} from './member-label.ts';

export type AgencyTimecardSnapshot = Snapshot | FactorySnapshot;
export type WorkbookCopy = {
  source:string; site:string; factory:string; timeZone:string; worker:string; date:string; start:string; end:string;
  gross:string; break:string; paid:string; comment:string; total:string; worksheet:string;
  missingName:string; reference:string; internal:string; factorySource:string;
};
export const timecardFileName = (s:AgencyTimecardSnapshot) =>
  'Timeax-' + (s.source==='internal-agency'?'agency':'factory') + '-' +
  s.dateFrom + '-' + s.dateTo + '-' + s.worksiteId.slice(0,8) + '.xlsx';

export function buildAgencyTimecardWorkbook(snapshot:AgencyTimecardSnapshot, c:WorkbookCopy){
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(c.worksheet,{views:[{state:'frozen',ySplit:7}]});
  const fromFactory=snapshot.source==='connected-factory';
  const fill=(row:ExcelJS.Row,color:string)=>row.eachCell({includeEmpty:true},cell=>{
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:color}};
  });
  sheet.columns=[{width:34},{width:15},{width:12},{width:12},{width:16},{width:16},{width:16},{width:46}];
  sheet.addRow([c.source,fromFactory?c.factorySource:c.internal]);
  sheet.addRow([c.site,snapshot.worksiteName]);
  sheet.addRow([c.factory,fromFactory?snapshot.factoryName:'']);
  sheet.addRow([c.date,snapshot.dateFrom,snapshot.dateTo]);
  sheet.addRow([c.timeZone,snapshot.timeZone]);
  sheet.addRow([]);
  const columns=sheet.addRow([c.worker,c.date,c.start,c.end,c.gross,c.break,c.paid,c.comment]);
  columns.font={bold:true,color:{argb:'FFFFFFFF'}};
  fill(columns,'FF16415A');
  const rows=[...snapshot.rows].sort((a,b)=>a.data.localDate.localeCompare(b.data.localDate)||a.data.startTime.localeCompare(b.data.startTime)||a.id.localeCompare(b.id));
  for (const {workerLabel,data} of rows){
    // User-entered fields are Excel string cells, not formula objects.
    const row=sheet.addRow([workerLabelText(workerLabel,c.missingName,c.reference),data.localDate,data.startTime,data.endTime,data.grossMinutes,data.breakMinutes,data.paidMinutes,data.comment]);
    const day=new Date(data.localDate+'T00:00:00Z').getUTCDay();
    if(day===0||day===6)fill(row,'FFE8EDF4');
    else if(row.number%2===0)fill(row,'FFE9F7F2');
  }
  if(rows.length)sheet.autoFilter={from:'A7',to:'H'+sheet.rowCount};
  const total=sheet.addRow([c.total,null,null,null,null,null,snapshot.paidMinutes]);
  total.font={bold:true,color:{argb:'FF16415A'}};
  fill(total,'FFB9E7D7');
  for (const i of [5,6,7]) sheet.getColumn(i).numFmt='0';
  return workbook;
}
export async function downloadAgencyTimecardWorkbook(snapshot:AgencyTimecardSnapshot,copy:WorkbookCopy){
  const bytes=await buildAgencyTimecardWorkbook(snapshot,copy).xlsx.writeBuffer();
  const blob=new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=timecardFileName(snapshot);
  document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

