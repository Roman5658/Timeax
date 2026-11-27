import {useTranslation} from 'react-i18next';
import {paidRateSummary} from './payroll-simple';
import type {PayCalculation} from './payslips';

export const payslipMoney=(c:number)=>(c/100).toFixed(2)+' PLN';
export function PayslipAmounts({value:v}:{value:Pick<PayCalculation,'mode'|'paidMinutes'|'rateSnapshot'|'amountCents'|'grossCents'|'netCents'|'deductions'|'deductionCents'>}){
 const {t}=useTranslation(),tx=(key:string,args?:Record<string,unknown>)=>t('canonicalPayslips.'+key,args??{});
 const minutes=(n:number)=>tx('simpleHours',{hours:Math.floor(n/60),minutes:String(n%60).padStart(2,'0')});
 const rates=paidRateSummary(v);
 return <div className="payslip-math"><dl className="pay-totals">
   <dt>{tx('approvedHours')}</dt><dd>{minutes(v.paidMinutes)}</dd>
   {rates.map(r=><div className="payslip-math-row" key={r.basis+r.cents}><dt>{tx(r.basis==='gross'?'grossRatePerHour':'netRatePerHour')}</dt>
    <dd>{payslipMoney(r.cents)} × {minutes(r.minutes)}</dd></div>)}
   <dt>{tx('gross')}</dt><dd>{payslipMoney(v.grossCents)}</dd>
   {v.deductions.map((d,i)=><div className="payslip-math-row" key={i}><dt>{d.name}</dt><dd>− {payslipMoney(d.cents)}</dd></div>)}
   <dt>{tx('net')}</dt><dd>{payslipMoney(v.netCents)}</dd>
 </dl></div>;
}
