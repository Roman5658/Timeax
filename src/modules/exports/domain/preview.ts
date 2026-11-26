import type ExcelJS from "exceljs";
export function workbookPreview(workbook: ExcelJS.Workbook, language: string) {
 return workbook.worksheets.map(sheet=>({name:sheet.name,rows:Array.from({length:sheet.rowCount},(_,index)=>{
  const cells: Array<{text:string;span:number;bold:boolean}>=[];
  for(let col=1;col<=sheet.columnCount;col++) {
   const cell=sheet.getCell(index+1,col); if(cell.isMerged && cell.master.address!==cell.address)continue;
   let span=1;while(col+span<=sheet.columnCount && sheet.getCell(index+1,col+span).isMerged && sheet.getCell(index+1,col+span).master.address===cell.address)span++;
   let text=cell.text;const fmt=cell.numFmt;const raw=cell.value;const value=raw instanceof Date && ["[h]:mm","hh:mm","h:mm AM/PM"].includes(fmt) ? (raw.getTime()-Date.UTC(1899,11,30))/86400000 : raw;
   if(value instanceof Date)text=fmt==="yyyy-mm-dd" ? value.toISOString().slice(0,10) : fmt==="dd.mm.yyyy" ? [String(value.getUTCDate()).padStart(2,"0"),String(value.getUTCMonth()+1).padStart(2,"0"),value.getUTCFullYear()].join(".") : new Intl.DateTimeFormat(language,{timeZone:"UTC",...(fmt==="dddd, d mmmm yyyy" ? {dateStyle:"full" as const} : {year:"numeric" as const,month:"2-digit" as const,day:"2-digit" as const})}).format(value);
   else if(typeof value==="number" && (fmt==="[h]:mm" || fmt==="hh:mm" || fmt==="h:mm AM/PM")){const minutes=Math.round(value*1440);const hour=Math.floor(minutes/60);text=fmt==="h:mm AM/PM" ? `${hour%12||12}:${String(minutes%60).padStart(2,"0")} ${hour>=12?"PM":"AM"}` : `${String(hour).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;}
   cells.push({text,span,bold:Boolean(cell.font?.bold)});
  }return cells;
 })}));
}
