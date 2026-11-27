import {useEffect,useId,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {loadPayEstimateSettings,savePayEstimateSetting,type PayEstimateSetting} from './pay-estimate-settings';
import {applicableEstimate,makeEstimateDraft,MAX_ESTIMATE_NAME_LENGTH,MAX_ESTIMATE_ROWS,parseEstimateDraft,sameEstimateTerms,validEstimateMonth,warsawEstimateMonth,type EstimateDraft} from './worker-pay-estimate-form';
import './worker-pay-estimate-settings.css';

const copy={
 en:{grossOnly:"Without deductions, only the gross estimate is shown.",title:'Pay estimate',guide:'Used for estimates only. These settings do not issue or change payslips and do not calculate tax or social insurance.',month:'Effective from month',basis:'How to estimate pay',gross:'Hourly gross rate',net:'Hourly net rate',rate:'Hourly rate (PLN)',deductions:'Fixed monthly deductions (optional)',hint:'Each deduction is applied once per month, not per shift. Enter only amounts you have already determined.',label:'Deduction name',amount:'Amount (PLN per month)',add:'Add deduction',remove:'Remove deduction',save:'Save estimate settings',saved:'Estimate settings saved.',pending:'Loading estimate settings…',unavailable:'Could not load estimate settings.',retry:'Reload settings',unsafe:'Could not confirm the save. Reload settings before trying again.',conflict:'This month’s settings changed. Reload before saving again.',existing:'This month uses the settings from {{month}}. Saving here starts a new rate from the selected month.',future:'Changes apply from the selected month until newer settings take effect.',invalid:'Enter a valid hourly rate and fill in both fields on each deduction row.'},
 pl:{grossOnly:"Bez potr\u0105ce\u0144 wy\u015bwietla si\u0119 tylko szacunek brutto.",title:'Szacunek wynagrodzenia',guide:'Służy tylko do szacowania. Te ustawienia nie wystawiają ani nie zmieniają pasków płacowych i nie obliczają podatków ani składek.',month:'Obowiązuje od miesiąca',basis:'Sposób szacowania',gross:'Stawka godzinowa brutto',net:'Stawka godzinowa netto',rate:'Stawka za godzinę (PLN)',deductions:'Stałe potrącenia miesięczne (opcjonalnie)',hint:'Każde potrącenie jest naliczane raz w miesiącu, nie od każdej zmiany. Wpisz tylko kwoty, które już ustalono.',label:'Nazwa potrącenia',amount:'Kwota (PLN na miesiąc)',add:'Dodaj potrącenie',remove:'Usuń potrącenie',save:'Zapisz ustawienia szacunku',saved:'Ustawienia szacunku zapisane.',pending:'Wczytywanie ustawień…',unavailable:'Nie udało się wczytać ustawień szacunku.',retry:'Wczytaj ustawienia ponownie',unsafe:'Nie udało się potwierdzić zapisu. Wczytaj ustawienia przed kolejną próbą.',conflict:'Ustawienia na ten miesiąc się zmieniły. Wczytaj je przed zapisem.',existing:'W tym miesiącu obowiązują ustawienia z {{month}}. Zapis wprowadzi nową stawkę od wybranego miesiąca.',future:'Zmiany obowiązują od wybranego miesiąca do czasu wejścia w życie nowszych ustawień.',invalid:'Podaj poprawną stawkę godzinową i wypełnij oba pola w każdym wierszu potrącenia.'},
 ru:{grossOnly:"\u0411\u0435\u0437 \u0432\u044b\u0447\u0435\u0442\u043e\u0432 \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0430\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u043e\u0446\u0435\u043d\u043a\u0430 \u0431\u0440\u0443\u0442\u0442\u043e.",title:'Оценка выплаты',guide:'Только для ориентировочного расчёта. Эти настройки не создают и не меняют расчётные листки и не рассчитывают налоги и взносы.',month:'Действует с месяца',basis:'Как считать выплату',gross:'Почасовая ставка брутто',net:'Почасовая ставка нетто',rate:'Ставка за час (PLN)',deductions:'Фиксированные вычеты за месяц (необязательно)',hint:'Каждый вычет применяется один раз за месяц, а не за каждую смену. Введите только уже известные суммы.',label:'Название вычета',amount:'Сумма (PLN в месяц)',add:'Добавить вычет',remove:'Удалить вычет',save:'Сохранить настройки оценки',saved:'Настройки оценки сохранены.',pending:'Загружаем настройки…',unavailable:'Не удалось загрузить настройки оценки.',retry:'Загрузить настройки заново',unsafe:'Не удалось подтвердить сохранение. Загрузите настройки заново перед повторной попыткой.',conflict:'Настройки на этот месяц изменились. Загрузите их заново перед сохранением.',existing:'В этом месяце действуют настройки с {{month}}. Сохранение задаст новую ставку с выбранного месяца.',future:'Изменения действуют с выбранного месяца, пока не вступят в силу более новые настройки.',invalid:'Укажите корректную ставку за час и заполните оба поля в каждом вычете.'},
 uk:{grossOnly:"\u0411\u0435\u0437 \u0432\u0456\u0434\u0440\u0430\u0445\u0443\u0432\u0430\u043d\u044c \u0432\u0456\u0434\u043e\u0431\u0440\u0430\u0436\u0430\u0454\u0442\u044c\u0441\u044f \u043b\u0438\u0448\u0435 \u043e\u0446\u0456\u043d\u043a\u0430 \u0431\u0440\u0443\u0442\u0442\u043e.",title:'Оцінка виплати',guide:'Лише для орієнтовного розрахунку. Ці налаштування не створюють і не змінюють розрахункові листки та не розраховують податки й внески.',month:'Діє з місяця',basis:'Як розрахувати виплату',gross:'Погодинна ставка брутто',net:'Погодинна ставка нетто',rate:'Ставка за годину (PLN)',deductions:'Фіксовані відрахування за місяць (необов’язково)',hint:'Кожне відрахування застосовується один раз за місяць, а не за кожну зміну. Введіть лише вже відомі суми.',label:'Назва відрахування',amount:'Сума (PLN на місяць)',add:'Додати відрахування',remove:'Видалити відрахування',save:'Зберегти налаштування оцінки',saved:'Налаштування оцінки збережено.',pending:'Завантажуємо налаштування…',unavailable:'Не вдалося завантажити налаштування оцінки.',retry:'Завантажити налаштування знову',unsafe:'Не вдалося підтвердити збереження. Завантажте налаштування знову перед повторною спробою.',conflict:'Налаштування на цей місяць змінилися. Завантажте їх знову перед збереженням.',existing:'У цьому місяці діють налаштування з {{month}}. Збереження задасть нову ставку з вибраного місяця.',future:'Зміни діють із вибраного місяця, доки не набудуть чинності новіші налаштування.',invalid:'Укажіть коректну ставку за годину й заповніть обидва поля в кожному відрахуванні.'},
};
type Status='loading'|'ready'|'saved'|'unavailable'|'conflict'|'unsafe';
type Props={organizationId:string;workerId:string;disabled?:boolean;onSaving:(value:boolean)=>void};

export function WorkerPayEstimateSettings({organizationId,workerId,disabled=false,onSaving}:Props){
 const {i18n}=useTranslation(),lang=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof copy,c=copy[lang]??copy.en;
 const heading=useId();
 const [rows,setRows]=useState<PayEstimateSetting[]>([]),[month,setMonth]=useState(warsawEstimateMonth);
 const monthRef=useRef(month);
 const [draft,setDraft]=useState<EstimateDraft>(()=>makeEstimateDraft(undefined)),[status,setStatus]=useState<Status>('loading');
 const [attempt,retry]=useState(0),[saving,setSaving]=useState(false),[edited,setEdited]=useState(false);
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  setStatus('loading');setRows([]);setEdited(false);
  void loadPayEstimateSettings(organizationId,controller.signal).then(result=>{
   if(controller.signal.aborted)return;
   const scoped=result.filter(r=>r.workerId===workerId);
   setRows(scoped);setDraft(makeEstimateDraft(applicableEstimate(scoped,workerId,monthRef.current)));setStatus('ready');
  }).catch(()=>{if(!controller.signal.aborted)setStatus('unavailable')});
  return()=>controller.abort();
 },[organizationId,workerId,attempt]);
 useEffect(()=>()=>{if(pending.current){pending.current.abort();pending.current=null;onSaving(false)}},[onSaving]);
 const selected=applicableEstimate(rows,workerId,month);
 const exact=selected?.effectiveMonth===month?selected:undefined;
 const candidate=parseEstimateDraft(workerId,month,exact?.revision??0,draft);
 const blocked=disabled||saving,available=status==='ready'||status==='saved';
 const dirty=Boolean(candidate&&(!exact||!sameEstimateTerms(candidate,exact)));

 function chooseMonth(value:string){
  monthRef.current=value;setMonth(value);setDraft(makeEstimateDraft(applicableEstimate(rows,workerId,value)));setEdited(false);setStatus('ready');
 }
 function updateDraft(edit:(value:EstimateDraft)=>EstimateDraft){
  setDraft(edit);setEdited(true);setStatus('ready');
 }
 async function save(){
  if(!available||blocked||!candidate||!dirty||pending.current)return;
  const controller=new AbortController();
  pending.current=controller;setSaving(true);onSaving(true);
  try{
   const response=await savePayEstimateSetting(organizationId,candidate,controller.signal);
   if(controller.signal.aborted)return;
   if(!sameEstimateTerms(candidate,response)||response.revision!==candidate.revision+1)throw Error('uncertain');
   setRows(list=>[...list.filter(r=>r.effectiveMonth!==response.effectiveMonth),response]);
   setDraft(makeEstimateDraft(response));setEdited(false);setStatus('saved');
   window.dispatchEvent(new Event('timeax-pay-estimate-settings-changed'));
  }catch(e){
   if(!controller.signal.aborted)setStatus(e instanceof Error&&e.message==='conflict'?'conflict':'unsafe');
  }finally{
   if(pending.current===controller){pending.current=null;setSaving(false);onSaving(false)}
  }
 }
 const originalMonth=selected&&!exact?selected.effectiveMonth:undefined;
 const effectiveHint=originalMonth
  ?c.existing.replace('{{month}}',new Intl.DateTimeFormat(lang,{timeZone:'UTC',year:'numeric',month:'long'}).format(new Date(originalMonth+'-01T00:00:00Z')))
  :c.future;
 return <section className="agency-book-section worker-pay-estimate" aria-labelledby={heading} aria-busy={saving||status==='loading'}>
  <h3 id={heading}>{c.title}</h3><p className="muted-copy">{c.guide}</p>
  {status==='loading'?<p role="status">{c.pending}</p>:!available?<div className="worker-pay-estimate__error">
   <p role="alert">{c[status]}</p><button type="button" className="button button--outline button--small" disabled={blocked} onClick={()=>retry(n=>n+1)}>{c.retry}</button>
  </div>:<form className="auth-form" onSubmit={event=>{event.preventDefault();void save()}}>
   <div className="worker-pay-estimate__grid">
    <label className="field-label">{c.month}<input type="month" required min="2000-01" max="2100-12" placeholder="YYYY-MM" value={month} disabled={blocked} onChange={event=>chooseMonth(event.target.value)}/></label>
    <label className="field-label">{c.basis}<select value={draft.basis} disabled={blocked}
      onChange={event=>updateDraft(value=>({...value,basis:event.target.value==='net'?'net':'gross'}))}><option value="gross">{c.gross}</option><option value="net">{c.net}</option></select></label>
   </div>
   {validEstimateMonth(month)&&<p className="muted-copy">{effectiveHint}</p>}
   <label className="field-label">{c.rate}<input type="text" inputMode="decimal" required maxLength={12} value={draft.amount} disabled={blocked} onChange={event=>updateDraft(value=>({...value,amount:event.target.value}))}/></label>
   {draft.basis==='gross'&&<fieldset className="worker-pay-estimate__deductions">
    <legend>{c.deductions}</legend><p className="muted-copy">{c.hint} {c.grossOnly}</p>
    {draft.deductions.map((row,index)=><div className="worker-pay-estimate__line" key={index}>
     <label className="field-label">{c.label}<input required minLength={2} maxLength={MAX_ESTIMATE_NAME_LENGTH*2} value={row.name} disabled={blocked} onChange={event=>updateDraft(value=>({...value,deductions:value.deductions.map((item,i)=>i===index?{...item,name:event.target.value}:item)}))}/></label>
     <label className="field-label">{c.amount}<input type="text" inputMode="decimal" required maxLength={12} value={row.amount} disabled={blocked} onChange={event=>updateDraft(value=>({...value,deductions:value.deductions.map((item,i)=>i===index?{...item,amount:event.target.value}:item)}))}/></label>
     <button type="button" className="button button--outline button--small" disabled={blocked} aria-label={c.remove+' '+(index+1)} onClick={()=>updateDraft(value=>({...value,deductions:value.deductions.filter((_,i)=>i!==index)}))}>×</button>
    </div>)}
    <button type="button" className="button button--outline button--small" disabled={blocked||draft.deductions.length>=MAX_ESTIMATE_ROWS} onClick={()=>updateDraft(value=>({...value,deductions:[...value.deductions,{name:'',amount:''}]}))}>+ {c.add}</button>
   </fieldset>}
   {edited&&!candidate&&<p className="muted-copy">{c.invalid}</p>}
   <button type="submit" className="button button--outline" disabled={blocked||!dirty}>{c.save}</button>
   {status==='saved'&&<p role="status">{c.saved}</p>}
  </form>}
 </section>;
}
