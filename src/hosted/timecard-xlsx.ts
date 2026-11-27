import ExcelJS from 'exceljs';
import {snapshotExportRows,timecardBreakLabel,timecardTotals,timecardWorkerGroups,type AgencyTimecardSnapshot} from './timecard-document.ts';
export {snapshotExportRows,type AgencyTimecardSnapshot} from './timecard-document.ts';

export type WorkbookCopy={
 source:string;site:string;factory:string;timeZone:string;worker:string;date:string;start:string;end:string;gross:string;break:string;paid:string;
 comment:string;total:string;worksheet:string;missingName:string;reference:string;internal:string;factorySource:string;locale:string;
 scope:string;workerExtract:string;breakState:string;breakUnreported:string;breakNotTaken:string;breakPaid:string;breakUnpaid:string;
 weekday:string;agency:string;shifts:string;status:string;archived:string;received:string;absences:string;notInSnapshot:string;shiftLabel:string;
};
export const timecardFileName=(s:AgencyTimecardSnapshot,membershipId?:string)=>
 'Timeax-'+(s.source==='internal-agency'?'agency':'factory')+'-'+s.dateFrom+'-'+s.dateTo+'-'+s.worksiteId.slice(0,8)
 +(membershipId?'-worker-'+membershipId.replaceAll('-','').slice(0,12):'')+'.xlsx';

const xp={head:'FF385A48',shift:'FFDDF1DF',weekendShift:'FFD5EBE9',total:'FFDCE7F2',confirmed:'FFBDE6C4',border:'FFD5DDD7',primary:'FF263B30'};
const duration=(minutes:number)=>minutes/1440;
const dateValue=(d:string)=>new Date(d+'T00:00:00.000Z');
const excelTime=(time:string)=>{const [h,m]=time.split(':').map(Number);return (60*h+m)/1440;};
function sheetName(proposed:string,used:Set<string>){
 const safe=proposed.replace(/[\\/*?:\[\]\p{Cc}]/gu,' ').replace(/^\s*'+|'+\s*$/g,'').trim()||'Timeax';
 const base=safe.toLowerCase()==='history'?safe+' - Timeax':safe;
 let name=base.slice(0,31).replace(/'+$/g,'').trimEnd(),n=1;
 while(used.has(name.toLowerCase())){
  const suffix=' ('+(++n)+')';name=base.slice(0,31-suffix.length)+suffix;
 }
 used.add(name.toLowerCase());return name;
}
function fill(row:ExcelJS.Row,color:string,width:number){
 for(let i=1;i<=width;i++){
  const cell=row.getCell(i);
  cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:color}};
  cell.alignment={vertical:'middle',wrapText:true};
  cell.border={bottom:{style:'thin',color:{argb:xp.border}},right:{style:'thin',color:{argb:xp.border}}};
 }
}
function banner(sheet:ExcelJS.Worksheet,value:string,width:number,kind:'title'|'sub'){
 const row=sheet.addRow([value]);sheet.mergeCells(row.number,1,row.number,width);
 row.height=kind==='title'?28:22;
 row.font={bold:kind==='title',italic:kind==='sub',size:kind==='title'?16:10,color:{argb:xp.primary}};
 row.alignment={vertical:'middle',wrapText:true};
 return row;
}
function headers(sheet:ExcelJS.Worksheet,copy:string[]){
 const row=sheet.addRow(copy);fill(row,xp.head,copy.length);row.font={bold:true,color:{argb:'FFFFFFFF'}};
 row.height=32;row.alignment={horizontal:'center',vertical:'middle',wrapText:true};
 sheet.views=[{state:'frozen',ySplit:row.number,zoomScale:90,activeCell:'A'+(row.number+1)}];return row.number;
}
function total(row:ExcelJS.Row,width:number){fill(row,xp.total,width);row.font={bold:true,color:{argb:'FF1F3B57'}};}
function formatted(row:ExcelJS.Row,columns:number[],numFmt:string){for(const i of columns)row.getCell(i).numFmt=numFmt;}
function setup(sheet:ExcelJS.Worksheet,widths:number[]){
 sheet.columns=widths.map(width=>({width}));sheet.properties.defaultRowHeight=21;
 sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.25,right:.25,top:.5,bottom:.5,header:.2,footer:.2}};
}

export function buildAgencyTimecardWorkbook(snapshot:AgencyTimecardSnapshot,c:WorkbookCopy,membershipId?:string){
 const picked=snapshotExportRows(snapshot,membershipId);
 const group=timecardWorkerGroups(picked.rows,c.missingName,c.reference,c.locale),totals=timecardTotals(picked.rows);
 const localeDate=new Intl.DateTimeFormat(c.locale,{weekday:'long',timeZone:'UTC'});
 const received=snapshot.source==='connected-factory';
 const from=received?c.factorySource:c.internal,status=received?c.received:c.archived;
 const period=[snapshot.worksiteName,snapshot.dateFrom+' – '+snapshot.dateTo,snapshot.timeZone].join(' · ');
 const wb=new ExcelJS.Workbook();wb.creator='Timeax';wb.subject=c.worksheet;wb.title=c.worksheet+' – '+snapshot.worksiteName;
 const used=new Set<string>(),summary=wb.addWorksheet(sheetName(c.total,used));
 setup(summary,[27,34,12,18,18,18,22]);
 banner(summary,c.worksheet,7,'title');
 banner(summary,period,7,'sub');
 summary.addRow([c.source,from,c.status,status]);
 if(received)summary.addRow([c.factory,snapshot.factoryName,c.agency,snapshot.agencyName]);
 if(membershipId)summary.addRow([c.scope,c.workerExtract,group[0]?.name]);
 banner(summary,c.notInSnapshot,7,'sub');
 const top=headers(summary,[c.site,c.worker,c.shifts,c.gross,c.break,c.paid,c.absences]);
 for(const person of group){
  const {shiftCount,grossMinutes,breakMinutes,paidMinutes}=person.totals;
  const row=summary.addRow([snapshot.worksiteName,person.name,shiftCount,duration(grossMinutes),duration(breakMinutes),duration(paidMinutes),'—']);
  fill(row,xp.shift,7);formatted(row,[4,5,6],'[h]:mm');
 }
 if(group.length)summary.autoFilter={from:'A'+top,to:'G'+summary.rowCount};
 const sums=summary.addRow([c.total,'',totals.shiftCount,duration(totals.grossMinutes),duration(totals.breakMinutes),duration(picked.paidMinutes),'—']);
 total(sums,7);formatted(sums,[4,5,6],'[h]:mm');
 for(const person of group){
  const sheet=wb.addWorksheet(sheetName(person.name,used));
  const widths=[26,23,23,15,17,13,13,18,19,18,21,23,37];
  setup(sheet,widths);
  banner(sheet,c.worksheet,13,'title');banner(sheet,person.name,13,'sub');
  banner(sheet,period,13,'sub');
  const rowHeader=headers(sheet,[c.worker,c.agency,c.site,c.date,c.weekday,c.start,c.end,c.gross,c.break,c.paid,c.breakState,c.status,c.comment]);
  for(const row of person.rows){
   const d=row.data,when=dateValue(d.localDate),weekday=when.getUTCDay();
   const breakValue=d.breakStatus==='not-reported'?c.breakUnreported:d.breakStatus==='not-taken'?c.breakNotTaken:duration(d.breakMinutes);
   const record=sheet.addRow([person.name,received?snapshot.agencyName:'',snapshot.worksiteName,when,localeDate.format(when),
    excelTime(d.startTime),excelTime(d.endTime),duration(d.grossMinutes),breakValue,duration(d.paidMinutes),timecardBreakLabel(d,c),status,d.comment]);
   fill(record,weekday===0||weekday===6?xp.weekendShift:xp.shift,13);
   record.height=Math.min(95,Math.max(22,Math.ceil(d.comment.length/36)*15+6));
   record.getCell(12).fill={type:'pattern',pattern:'solid',fgColor:{argb:xp.confirmed}};
   formatted(record,[4],'dd.mm.yyyy');formatted(record,[6,7],'hh:mm');formatted(record,[8,10],'[h]:mm');
   if(typeof breakValue==='number')formatted(record,[9],'[h]:mm');
  }
  if(person.rows.length)sheet.autoFilter={from:'A'+rowHeader,to:'M'+sheet.rowCount};
  const {grossMinutes,breakMinutes,paidMinutes}=person.totals;
  const sums=sheet.addRow([c.total,null,null,null,null,null,null,duration(grossMinutes),duration(breakMinutes),duration(paidMinutes)]);
  total(sums,13);formatted(sums,[8,9,10],'[h]:mm');
 }
 return wb;
}
export async function downloadAgencyTimecardWorkbook(snapshot:AgencyTimecardSnapshot,copy:WorkbookCopy,membershipId?:string){
 const bytes=await buildAgencyTimecardWorkbook(snapshot,copy,membershipId).xlsx.writeBuffer();
 const blob=new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download=timecardFileName(snapshot,membershipId);
 document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
