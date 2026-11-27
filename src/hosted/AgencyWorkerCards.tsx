import {useEffect,useState,type FormEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {workerCall} from './worker-enrollment';

const copy={
 ru:['Имя','Фамилия','Почта работника','Производство агентства','Без назначения','Создать аккаунт работника','Сохранено. Работник может войти по коду на эту почту.','Ожидают первого входа','Отправить приглашение','Письмо принято к отправке','Почта для приглашений ещё не подключена. Можно передать работнику ссылку на вход.','Не удалось выполнить действие. Попробуй ещё раз.','Скрыть агентство из поиска по NIP','При скрытии работники по-прежнему могут подключаться по приглашению.','Открыть карточку','Не удалось загрузить настройки поиска.','Вход в Timeax'],
 en:['First name','Last name','Worker email','Agency worksite','No assignment','Create worker account','Saved. The worker can sign in with a code sent to this address.','Waiting for first sign-in','Send invitation','Email accepted for sending','Invitation email is not yet connected. You can share the sign-in link directly.','Could not complete the action. Try again.','Hide agency from NIP search','Workers can still join by invitation when your agency is hidden.','Open card','Search settings could not be loaded.','Timeax sign-in'],
 pl:['Imię','Nazwisko','E-mail pracownika','Zakład agencji','Bez przypisania','Utwórz konto pracownika','Zapisano. Pracownik może się zalogować kodem wysłanym na ten adres.','Oczekują na pierwsze logowanie','Wyślij zaproszenie','E-mail przyjęty do wysłania','Wysyłka zaproszeń nie jest jeszcze podłączona. Możesz udostępnić link do logowania.','Nie udało się wykonać czynności. Spróbuj ponownie.','Ukryj agencję w wyszukiwaniu po NIP-ie','Po ukryciu agencji pracownicy nadal mogą dołączyć przez zaproszenie.','Otwórz kartę','Nie udało się wczytać ustawień wyszukiwania.','Logowanie do Timeax'],
 uk:['Ім’я','Прізвище','Пошта працівника','Виробництво агенції','Без призначення','Створити акаунт працівника','Збережено. Працівник може увійти за кодом, надісланим на цю адресу.','Очікують першого входу','Надіслати запрошення','Лист прийнято до надсилання','Пошту для запрошень ще не підключено. Можна передати посилання на вхід.','Не вдалося виконати дію. Спробуй ще раз.','Приховати агенцію з пошуку за NIP','Приховану агенцію все одно можна підключити за запрошенням.','Відкрити картку','Не вдалося завантажити налаштування пошуку.','Вхід до Timeax'],
};
function useCopy(){const {i18n}=useTranslation();const l=(i18n.resolvedLanguage??'en').split('-')[0];const language=l==='pl'||l==='uk'||l==='ru'?l:'en';return {c:copy[language],language};}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export type PendingWorkerCard={id:string;firstName:string;lastName:string;email:string;worksiteName:string|null;submittedAt:string|null};
export type WorkerCards={cards:PendingWorkerCard[];mailEnabled:boolean};
export function readWorkerCards(v:unknown):WorkerCards{
 const d=v as WorkerCards;
 if(!d||typeof d.mailEnabled!=='boolean'||!Array.isArray(d.cards)||d.cards.length>250||d.cards.some(card=>!uuid(card?.id)||typeof card.firstName!=='string'||typeof card.lastName!=='string'||typeof card.email!=='string'||!(card.worksiteName===null||typeof card.worksiteName==='string')||!(card.submittedAt===null||typeof card.submittedAt==='string')))throw Error('unavailable');
 return d;
}
export function PendingWorkerList({value,onOpen,error}:{value?:WorkerCards;onOpen:(id:string)=>void;error:boolean}){
 const {c}=useCopy();
 if(error)return <p role="alert">{c[11]}</p>;
 if(!value?.cards.length)return null;
 return <section className="dashboard-panel agency-worker-group"><h3>{c[7]}</h3><ul>{value.cards.map(card=><li key={card.id}>
  <div><strong>{card.firstName} {card.lastName}</strong><p className="muted-copy">{card.worksiteName??c[4]}</p></div>
  <button type="button" className="button button--outline" onClick={()=>onOpen(card.id)}>{c[14]}</button>
 </li>)}</ul></section>;
}
export function AgencyWorkerCardForm({organizationId,sites,onSaved,card,mailEnabled}:{organizationId:string;sites:{id:string;name:string}[];onSaved:(id:string)=>void;card?:PendingWorkerCard;mailEnabled:boolean}){
 const {c,language}=useCopy();
 const [first,F]=useState(''),[last,L]=useState(''),[email,E]=useState(''),[site,S]=useState(''),[busy,B]=useState(false),[error,X]=useState(false);
 const [sent,T]=useState(false);
 useEffect(()=>{T(Boolean(card?.submittedAt));X(false)},[card?.id,card?.submittedAt]);
 async function save(e:FormEvent){
  e.preventDefault();if(busy)return;B(true);X(false);
  try{const result=await workerCall('agency/'+organizationId+'/cards',{firstName:first.trim(),lastName:last.trim(),email:email.trim(),worksiteId:site||null}) as {state?:string;cardId?:unknown};
   if(result.state!=='prepared'||!uuid(result.cardId))throw Error();onSaved(result.cardId);
  }catch{X(true)}finally{B(false)}
 }
 async function send(){
  if(!card||!mailEnabled||busy||sent)return;B(true);X(false);
  try{const result=await workerCall('agency/'+organizationId+'/send-invitation',{cardId:card.id,language}) as {state?:string};
   if(result.state!=='submitted')throw Error();T(true);
  }catch{X(true)}finally{B(false)}
 }
 return <section className="agency-book-section" aria-busy={busy}>
  {card?<><h3>{card.firstName} {card.lastName}</h3><p>{card.email}</p><p>{card.worksiteName??c[4]}</p><p role="status">{c[6]}</p>
   {sent?<p role="status">{c[9]}</p>:mailEnabled?<button type="button" className="button button--primary" disabled={busy} onClick={()=>void send()}>{c[8]}</button>:<p>{c[10]} <a href="/login?method=code">{c[16]}</a></p>}
  </>:<form className="auth-form" onSubmit={e=>void save(e)}>
   <label className="field-label">{c[0]}<input required maxLength={59} value={first} disabled={busy} onChange={e=>F(e.target.value)}/></label>
   <label className="field-label">{c[1]}<input required maxLength={60} value={last} disabled={busy} onChange={e=>L(e.target.value)}/></label>
   <label className="field-label">{c[2]}<input required type="email" maxLength={254} value={email} disabled={busy} onChange={e=>E(e.target.value)}/></label>
   <label className="field-label">{c[3]}<select value={site} disabled={busy} onChange={e=>S(e.target.value)}><option value="">{c[4]}</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <button className="button button--primary" disabled={busy}>{c[5]}</button>
  </form>}
  {error&&<p role="alert">{c[11]}</p>}
 </section>;
}
export function AgencyNipVisibility({organizationId}:{organizationId:string}){
 const {c}=useCopy();const path='agency/'+organizationId+'/directory';
 const [v,V]=useState<{enabled:boolean;available:boolean}>(),[busy,B]=useState(false),[error,X]=useState(false);
 useEffect(()=>{const a=new AbortController();V(undefined);X(false);void workerCall(path,undefined,a.signal).then(d=>{
  const res=d as typeof v;if(!res||typeof res.enabled!=='boolean'||typeof res.available!=='boolean')throw Error();if(!a.signal.aborted)V(res);
 }).catch(()=>{if(!a.signal.aborted)X(true)});return()=>a.abort()},[path]);
 async function update(hide:boolean){if(!v||busy)return;B(true);X(false);try{const res=await workerCall(path,{enabled:!hide}) as typeof v;if(!res||res.enabled===hide||typeof res.available!=='boolean')throw Error();V(res)}catch{X(true)}finally{B(false)}}
 if(!v?.available&&!error)return null;
 return <section className="dashboard-panel agency-book-section">
 {v?.available&&<><label className="agency-worker-confirm"><input type="checkbox" checked={!v.enabled} disabled={busy} onChange={e=>void update(e.target.checked)}/>{c[12]}</label><p>{c[13]}</p></>}
 {error&&<p role="alert">{v?c[11]:c[15]}</p>}
 </section>;
}
