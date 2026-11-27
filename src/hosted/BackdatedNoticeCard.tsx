import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useMemberNames} from './MemberNames';
import {timecardCall} from './timecards';
import type {Notice} from './AgencyBackdatedShifts';

const labels={
 en:['Backdated shift','The worker entered hours for an earlier date. Please review.'],
 ru:['Смена задним числом','Работник указал часы задним числом. Обратите внимание.'],
 pl:['Zmiana wpisana wstecz','Pracownik wpisał godziny wstecz. Sprawdź wpis.'],
 uk:['Зміна заднім числом','Працівник вказав години заднім числом. Зверніть увагу.']
};
export function useBackdatedCards(org:string|undefined,refresh:()=>void){
 const {t,i18n}=useTranslation(),[busy,B]=useState<string>(),[failure,F]=useState(false);
 const {label}=useMemberNames(org);
 const c=labels[(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof labels]??labels.en;
 async function read(n:Notice){
  if(!org||busy)return;B(n.id);F(false);
  try{const v=await timecardCall(org,'backdated-read',{id:n.id,source:n.source}) as {read?:boolean};if(v.read!==true)throw Error();refresh()}
  catch{F(true)}finally{B(undefined)}
 }
 return {failure,card:(n:Notice)=><><h3>{c[0]}</h3><strong>{label(n.workerId)}</strong><p>{c[1]} · {n.day}</p>
  {!n.read&&<button type="button" className="button button--outline button--small" disabled={!!busy} onClick={()=>void read(n)}>{t('workflow.notifications.markRead')}</button>}</>};
}
