import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {AgencyPlan,TeamContext} from './team-workflow';

const copy={
 en:{description:'View-only. The schedule shows planned shifts, not hours worked.',all:'All worksites',empty:'No planned shifts for your workers here yet.',workers:'Workers'},
 pl:{description:'Tylko podgląd. Grafik pokazuje planowane zmiany, a nie przepracowane godziny.',all:'Wszystkie miejsca pracy',empty:'Nie ma jeszcze zaplanowanych zmian dla Twoich pracowników.',workers:'Pracownicy'},
 ru:{description:'Только просмотр. Здесь запланированные смены, а не отработанные часы.',all:'Все производства',empty:'Здесь пока нет запланированных смен для ваших работников.',workers:'Работники'},
 uk:{description:'Лише перегляд. Тут заплановані зміни, а не відпрацьовані години.',all:'Усі виробництва',empty:'Тут поки немає запланованих змін для ваших працівників.',workers:'Працівники'}
};

export function AgencySchedule({context,workerLabel}:{context:TeamContext;workerLabel:(id:string)=>string}){
 const {t,i18n}=useTranslation();
 const language=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof copy;
 const strings=copy[language]??copy.en;
 const [site,setSite]=useState('');
 const sites=new Map(context.sites.map(item=>[item.id,item.name]));
 const fallback:AgencyPlan[]=context.entries.flatMap(row=>{
  if(row.kind!=='schedule'||!row.outgoing||!row.siteId)return [];
  return [{id:row.id,siteId:row.siteId,localDate:String(row.payload.localDate??''),startTime:String(row.payload.startTime??''),endTime:String(row.payload.endTime??''),state:row.state,recipients:row.recipients}];
 });
 const plans=(context.agencySchedule??fallback).filter(plan=>sites.has(plan.siteId)&&(!site||site===plan.siteId))
  .sort((a,b)=>(a.localDate+a.startTime).localeCompare(b.localDate+b.startTime));
 const format=new Intl.DateTimeFormat(language,{dateStyle:'long',timeZone:'Europe/Warsaw'});
 const date=(value:string)=>{
  const stamp=Date.parse(value+'T12:00:00Z');
  return Number.isFinite(stamp)?format.format(stamp):value;
 };

 return <section className="dashboard-panel agency-schedule" aria-label={t('team.schedule')}>
  <p className="muted-copy">{strings.description}</p>
  <label className="field-label">{t('timecards.site')}
   <select value={site} onChange={e=>setSite(e.target.value)}>
    <option value="">{strings.all}</option>
    {context.sites.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
   </select>
  </label>
  {plans.length===0?<p className="notice-box">{strings.empty}</p>:<ul className="agency-schedule-list">
   {plans.map(plan=><li className="notice-box" key={plan.id}>
    <h3>{sites.get(plan.siteId)}</h3>
    <p>{date(plan.localDate)} · <strong>{plan.startTime}–{plan.endTime}</strong> · Europe/Warsaw</p>
    {plan.state==='cancelled'&&<p>{t('team.cancelled')}</p>}
    {plan.recipients.length>0&&<><strong>{strings.workers}</strong><ul>
     {plan.recipients.map(id=><li key={id}>{workerLabel(id)}</li>)}
    </ul></>}
   </li>)}
  </ul>}
 </section>;
}
