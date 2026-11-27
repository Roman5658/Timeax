import {workerLabelText} from './member-label';
import type {PayPublication} from './payslips';
import {escapePayslipText as esc} from '../modules/payroll/payslip-document';
import {paidRateSummary} from './payroll-simple';
export function canonicalPayslipHtml(p:PayPublication){
 const d=p.document,s=d.source,c=d.calculation,money=(n:number)=>(n/100).toFixed(2)+' PLN';
 const hrs=(n:number)=>Math.floor(n/60)+' godz. '+String(n%60).padStart(2,'0')+' min';
 const lines=[['Zatwierdzony czas',hrs(c.paidMinutes)],
  ...paidRateSummary(c).map(r=>['Stawka '+(r.basis==='gross'?'brutto':'netto')+' / godz.',money(r.cents)+' × '+hrs(r.minutes)]),
  ['Brutto',money(c.grossCents)],...c.deductions.map(v=>[v.name,'− '+money(v.cents)]),['Netto',money(c.netCents)]];
 return '<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Timeax</title><style>body{font:16px system-ui;max-width:60rem;margin:2rem;color:#18241f}table{border-collapse:collapse;width:100%}th,td{padding:.6rem;border:1px solid #8a9891;text-align:left;overflow-wrap:anywhere}p{overflow-wrap:anywhere}@media print{body{margin:0}}</style><h1>Rozliczenie wynagrodzenia – Timeax</h1><p>'+esc(s.agencyName)+' / '+esc(workerLabelText(s.workerLabel,'Brak imienia w zapisanym dokumencie','Nr'))+'</p><p>'+esc(s.siteName)+' / '+esc(s.dateFrom)+' – '+esc(s.dateTo)+'</p><p>'+esc(p.issued_at)+'</p><table>'+lines.map(([a,b])=>'<tr><th>'+esc(a)+'</th><td>'+esc(b)+'</td></tr>').join('')+'</table><p>'+esc(d.notice)+'</p></html>';
}
