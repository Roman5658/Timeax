import ExcelJS from 'exceljs';
import {estimatesForRows,type PayEstimates} from './agency-pay-estimate.ts';
import type {PayEstimateCopy} from './pay-estimate-copy.ts';
import {snapshotExportRows,timecardBreakLabel,timecardTotals,timecardWorkerGroups,type TimecardReport} from './timecard-document.ts';
export {snapshotExportRows,type AgencyTimecardSnapshot,type TimecardReport} from './timecard-document.ts';

export type WorkbookCopy={
 source:string;site:string;factory:string;timeZone:string;worker:string;date:string;start:string;end:string;gross:string;break:string;paid:string;
 comment:string;total:string;worksheet:string;missingName:string;reference:string;internal:string;factorySource:string;locale:string;
 scope:string;workerExtract:string;breakState:string;breakUnreported:string;breakNotTaken:string;breakPaid:string;breakUnpaid:string;
 weekday:string;agency:string;shifts:string;status:string;archived:string;received:string;absences:string;notInSnapshot:string;shiftLabel:string;preview?:{status:string;source:string;notice:string;total:string;recorded:string;absences?:string;absenceNote?:string;absenceUnavailable?:string};
 wages?:PayEstimateCopy;
};
export const timecardFileName=(s:TimecardReport,membershipId?:string)=>
 'Timeax-'+(s.source==='internal-live'?'preview':s.source==='internal-agency'?'agency':'factory')+'-'+s.dateFrom+'-'+s.dateTo+'-'+(s.worksiteId.slice(0,8)||'all')
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

export function buildAgencyTimecardWorkbook(snapshot:TimecardReport,c:WorkbookCopy,membershipId?:string,estimates?:PayEstimates){
 const picked=snapshotExportRows(snapshot,membershipId);
 const group=timecardWorkerGroups(picked.rows,c.missingName,c.reference,c.locale),totals=timecardTotals(picked.rows);
 const localeDate=new Intl.DateTimeFormat(c.locale,{weekday:'long',timeZone:'UTC'});
 const received=snapshot.source==='connected-factory';
 const preview=snapshot.source==='internal-live';
 if(preview&&!c.preview)throw Error('Missing preview labels');
 const from=preview?c.preview!.source:received?c.factorySource:c.internal,status=preview?c.preview!.status:received?c.received:c.archived;
 const totalLabel=preview?c.preview!.total:c.total;
 const absences=preview?snapshot.absences?.filter(a=>!membershipId||a.membershipId===membershipId):undefined;
 const period=[snapshot.worksiteName,snapshot.dateFrom+' – '+snapshot.dateTo,snapshot.timeZone].join(' · ');
 const wb=new ExcelJS.Workbook();wb.creator='Timeax';wb.subject=c.worksheet;wb.title=c.worksheet+' – '+snapshot.worksiteName;
 const used=new Set<string>(),summary=wb.addWorksheet(sheetName(totalLabel,used));
 setup(summary,[27,34,12,18,18,18,22]);
 banner(summary,c.worksheet,7,'title');
 banner(summary,period,7,'sub');
 summary.addRow([c.source,from,c.status,status]);
 if(received)summary.addRow([c.factory,snapshot.factoryName,c.agency,snapshot.agencyName]);
 if(membershipId)summary.addRow([c.scope,c.workerExtract,group[0]?.name]);
 banner(summary,preview?c.preview!.notice:c.notInSnapshot,7,'sub');
 if(preview&&absences===undefined&&c.preview!.absenceUnavailable)banner(summary,c.preview!.absenceUnavailable,7,'sub');
 const top=headers(summary,[c.site,c.worker,c.shifts,c.gross,c.break,c.paid,preview?c.preview!.absences??c.absences:c.absences]);
 const remaining=new Map<string,NonNullable<typeof absences>>();
 for(const row of absences??[]){const key=row.membershipId+'|'+row.worksiteId;if(!remaining.has(key))remaining.set(key,[]);remaining.get(key)!.push(row)}
 for(const person of group){
  const sites=new Map<string,typeof person.rows>();
  for(const row of person.rows){
   const key=row.worksiteId??snapshot.worksiteId,prior=sites.get(key);
   if(prior)prior.push(row);else sites.set(key,[row]);
  }
  for(const rows of sites.values()){
   const {shiftCount,grossMinutes,breakMinutes,paidMinutes}=timecardTotals(rows);
   const key=person.id+'|'+(rows[0]?.worksiteId??snapshot.worksiteId),absencesAtSite=absences?(remaining.get(key)?.length??0):'—';
   remaining.delete(key);
   const row=summary.addRow([rows[0]?.worksiteName??snapshot.worksiteName,person.name,shiftCount,duration(grossMinutes),duration(breakMinutes),duration(paidMinutes),absencesAtSite]);
   fill(row,xp.shift,7);formatted(row,[4,5,6],'[h]:mm');
  }
 }
 for(const rows of remaining.values()){
  const row=summary.addRow([rows[0].worksiteName,rows[0].name,0,0,0,0,rows.length]);
  fill(row,'FFE8DEFF',7);formatted(row,[4,5,6],'[h]:mm');
 }
 if(summary.rowCount>top)summary.autoFilter={from:'A'+top,to:'G'+summary.rowCount};
 const sums=summary.addRow([totalLabel,'',totals.shiftCount,duration(totals.grossMinutes),duration(totals.breakMinutes),duration(picked.paidMinutes),absences?.length??'—']);
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
   const record=sheet.addRow([person.name,received?snapshot.agencyName:'',row.worksiteName??snapshot.worksiteName,when,localeDate.format(when),
    excelTime(d.startTime),excelTime(d.endTime),duration(d.grossMinutes),breakValue,duration(d.paidMinutes),timecardBreakLabel(d,c),preview?(row.liveState==='archived'?c.archived:c.preview!.recorded):status,d.comment]);
   fill(record,weekday===0||weekday===6?xp.weekendShift:xp.shift,13);
   record.height=Math.min(95,Math.max(22,Math.ceil(d.comment.length/36)*15+6));
   if(!preview||row.liveState==='archived')record.getCell(12).fill={type:'pattern',pattern:'solid',fgColor:{argb:xp.confirmed}};
   formatted(record,[4],'dd.mm.yyyy');formatted(record,[6,7],'hh:mm');formatted(record,[8,10],'[h]:mm');
   if(typeof breakValue==='number')formatted(record,[9],'[h]:mm');
  }
  if(person.rows.length)sheet.autoFilter={from:'A'+rowHeader,to:'M'+sheet.rowCount};
  const {grossMinutes,breakMinutes,paidMinutes}=person.totals;
  const sums=sheet.addRow([totalLabel,null,null,null,null,null,null,duration(grossMinutes),duration(breakMinutes),duration(paidMinutes)]);
  total(sums,13);formatted(sums,[8,9,10],'[h]:mm');
 }
 if(absences?.length){
  const label=c.preview!.absences??c.absences,sheet=wb.addWorksheet(sheetName(label,used));setup(sheet,[28,28,17,17]);
  banner(sheet,label,4,'title');banner(sheet,c.preview!.absenceNote??c.preview!.notice,4,'sub');
  const head=headers(sheet,[c.worker,c.site,c.date+' ('+c.start+')',c.date+' ('+c.end+')']);
  for(const a of absences)for(const range of a.ranges){const row=sheet.addRow([a.name,a.worksiteName,dateValue(range.from),dateValue(range.to)]);fill(row,'FFE8DEFF',4);formatted(row,[3,4],'dd.mm.yyyy');}
  sheet.autoFilter={from:'A'+head,to:'D'+sheet.rowCount};
 }
 // Wages must never be serialized into an archived, received or factory-shared timecard.
 if(snapshot.source==='internal-live'&&c.wages&&estimates){
  const labels=c.wages,allowed=estimatesForRows(picked.rows,estimates,membershipId);
  if(allowed.length){
   const names=new Map(group.map(person=>[person.id,person.name]));
   const sheet=wb.addWorksheet(sheetName(labels.title,used));setup(sheet,[29,15,18,18,20,20,34,20,46]);
   banner(sheet,labels.title,9,'title');banner(sheet,labels.private,9,'sub');
   const header=headers(sheet,[labels.worker,labels.month,labels.hours,labels.rate,labels.gross,labels.netRate,labels.deductions,labels.net,labels.status]);
   const amount=(cents:number|undefined)=>cents===undefined?'—':cents/100;
   const currency='#,##0.00 "PLN"',formatMoney=new Intl.NumberFormat(c.locale,{style:'currency',currency:'PLN'});
   for(const item of allowed){
    for(const m of item.months){
     const entry=sheet.addRow([names.get(item.workerId)??c.missingName,m.month,duration(m.paidMinutes),amount(m.rateCents),
      m.basis==='gross'?amount(m.hourlyBaseCents):'—',m.basis==='net'?amount(m.hourlyBaseCents):'—',
      m.deductions.map(d=>d.name+': '+formatMoney.format(d.cents/100)).join('; ')||'—',amount(m.netCents),labels[m.status]]);
     fill(entry,xp.shift,9);formatted(entry,[3],'[h]:mm');formatted(entry,[4,5,6,8],currency);
    }
    if(item.months.length>1){
     const summary=sheet.addRow([names.get(item.workerId)??c.missingName,'',null,null,null,null,null,amount(item.netCents),
      item.netCents===undefined?labels.incomplete:labels.net]);
     total(summary,9);formatted(summary,[8],currency);
    }
   }
   sheet.autoFilter={from:'A'+header,to:'I'+sheet.rowCount};
  }
 }
 return wb;
}
export async function downloadAgencyTimecardWorkbook(snapshot:TimecardReport,copy:WorkbookCopy,membershipId?:string,signal?:AbortSignal,estimates?:PayEstimates){
 const bytes=await buildAgencyTimecardWorkbook(snapshot,copy,membershipId,estimates).xlsx.writeBuffer();
 if(signal?.aborted)return;
 const blob=new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download=timecardFileName(snapshot,membershipId);
 document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
