import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {PayPublication} from './payslips';
import {downloadPayslipPdf,makePayslipPdf,payslipPdfLines} from './payslip-pdf';

/** Accepts only publications already verified by the cabinet/personal-account boundary. */
export function PayslipPdfButton({publication,disabled}:{publication:PayPublication;disabled?:boolean}){
 const {t,i18n}=useTranslation(),[failed,setFailed]=useState(false);
 const tx=(key:string,values?:Record<string,unknown>)=>t('canonicalPayslips.'+key,values??{});
 return <><button type="button" className="button button--outline" disabled={disabled} onClick={()=>{
  try{
   setFailed(false);
   const lines=payslipPdfLines(publication,tx,t('memberNames.historicalMissing'),t('memberNames.reference'),i18n.resolvedLanguage??'pl');
   // Synchronous construction preserves the user gesture on mobile Safari.
   downloadPayslipPdf(makePayslipPdf(tx('document'),lines),publication);
  }catch{setFailed(true)}
 }}>{tx('downloadPdf')}</button>{failed&&<p role="alert">{tx('pdfFailed')}</p>}</>;
}
