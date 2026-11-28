import {useId} from 'react';
import {useTranslation} from 'react-i18next';

export function ApplicationNameFields({first,last,onFirst,onLast,disabled}:{first:string;last:string;onFirst:(v:string)=>void;onLast:(v:string)=>void;disabled:boolean}){
 const {t}=useTranslation(), hint=useId();
 return <fieldset disabled={disabled} aria-describedby={hint} className="auth-form">
  <legend>{t('workerEnrollment.applicantDetails')}</legend>
  <p className="muted-copy" id={hint}>{t('workerEnrollment.applicantSharing')}</p>
  <label className="field-label">{t('workerEnrollment.applicantFirst')}<input autoComplete="given-name" required maxLength={80} value={first} onChange={e=>onFirst(e.target.value)}/></label>
  <label className="field-label">{t('workerEnrollment.applicantLast')}<input autoComplete="family-name" required maxLength={80} value={last} onChange={e=>onLast(e.target.value)}/></label>
 </fieldset>;
}
