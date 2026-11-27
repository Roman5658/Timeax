import {useId,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,CircleAlert} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {minutesLabel} from './timecards';
import type {CalendarShift} from './worker-calendar-data';
import '../styles/worker-shift-rows.css';

const copy={
 en:{day:'Day',time:'Start – end',duration:'Worked',details:'Shift details',nextDay:'Next day'},
 pl:{day:'Dzień',time:'Początek – koniec',duration:'Przepracowano',details:'Szczegóły zmiany',nextDay:'Następny dzień'},
 ru:{day:'День',time:'Начало – конец',duration:'Отработано',details:'Детали смены',nextDay:'На следующий день'},
 uk:{day:'День',time:'Початок – кінець',duration:'Відпрацьовано',details:'Деталі зміни',nextDay:'Наступного дня'},
} as const;

type DayGroup={day:string;shifts:CalendarShift[];notes?:ReactNode};
export function WorkerShiftRows({groups,focusDay,focusRef,revisionDetails}:{
 groups:DayGroup[];focusDay?:string;focusRef?:(element:HTMLTableSectionElement|null)=>void;revisionDetails?:(row:CalendarShift)=>ReactNode;
}){
 const {t,i18n}=useTranslation(),language=i18n.resolvedLanguage||'pl';
 const c=copy[language.split('-')[0] as keyof typeof copy]??copy.en;
 const [expanded,setExpanded]=useState<string>(),prefix=useId();
 const day=new Intl.DateTimeFormat(language,{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
 const dayCell=(value:string)=><th scope="row"><time dateTime={value}>{day.format(new Date(value+'T12:00:00Z'))}</time></th>;
 if(!groups.length)return null;
 return <table className="worker-shift-rows" aria-label={t('dashboard.statShifts')}>
  <thead><tr><th scope="col">{c.day}</th><th scope="col">{c.time}</th><th scope="col">{c.duration}</th></tr></thead>
  {groups.map(group=><tbody key={group.day} ref={group.day===focusDay?focusRef:undefined} tabIndex={group.day===focusDay?-1:undefined}>
   {group.shifts.map(row=>{
    const {localDate,startTime,endTime,paidMinutes,breakStatus,breakTreatment,breakMinutes,comment}=row.data;
    const status=t((row.source==='internal'?'timecards.':'factoryHours.')+row.status);
    const needsAttention=['needs-review','needs-confirmation','disputed'].includes(row.status);
    const overnight=endTime<startTime,key=row.source+'-'+row.id,isOpen=expanded===key;
    const moreLabel=[c.details,day.format(new Date(localDate+'T12:00:00Z')),startTime+'–'+endTime,needsAttention?status:''].filter(Boolean).join(', ');
    return <WorkerShiftTableRow key={key} row={
     <tr>
      {dayCell(localDate)}
      <td className="worker-shift-rows__time">{startTime}–{endTime}{overnight&&<small title={c.nextDay} aria-label={c.nextDay}> +1</small>}</td>
      <td className="worker-shift-rows__duration"><span>{minutesLabel(paidMinutes)}</span><button type="button" className="worker-shift-rows__toggle" title={moreLabel} aria-label={moreLabel} aria-expanded={isOpen} aria-controls={prefix+key} onClick={()=>setExpanded(isOpen?undefined:key)}>
       {needsAttention&&<CircleAlert size={14} aria-hidden="true"/>}{isOpen?<ChevronUp size={15} aria-hidden="true"/>:<ChevronDown size={15} aria-hidden="true"/>}
      </button></td>
     </tr>
    } details={<tr id={prefix+key} hidden={!isOpen} className="worker-shift-rows__detail"><td colSpan={3}><div className="worker-shift-rows__content">
     <p>{[row.site,status].filter(Boolean).join(' · ')}</p>
     <p>{t('timecards.break')}: {breakStatus==='not-reported'?t('workflow.breakReport.notReported'):breakStatus==='not-taken'?t('breaks.notTaken'):[t(breakTreatment==='paid'?'workflow.breakReport.paidChoice':'workflow.breakReport.unpaidChoice'),minutesLabel(breakMinutes)].join(' · ')}</p>
     {comment&&<p>{comment}</p>}
     {isOpen&&revisionDetails?.(row)}
    </div></td></tr>}/>;
   })}
   {group.notes&&<tr>{dayCell(group.day)}<td colSpan={2}><div className="worker-shift-rows__notes">{group.notes}</div></td></tr>}
  </tbody>)}
 </table>;
}

function WorkerShiftTableRow({row,details}:{row:ReactNode;details:ReactNode}){
 return <>{row}{details}</>;
}
