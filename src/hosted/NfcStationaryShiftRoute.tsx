import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {nfcShiftRequest,readChallenge,readOffer,readRecord,type NfcShiftOffer} from './nfc-stationary-shift';

type Phase='idle'|'preparing'|'tap'|'verifying'|'allowed'|'saving'|'started'|'ended'|'signIn'|'denied'|'retry'|'unknown'|'unavailable';
export type StationaryNfcReader={
 // Trusted native host only: acquire a live proof bound to challenge; never
 // resolve it from a URL, tag UID, NDEF data or caller-supplied timestamp.
 readLiveProof(challenge:string,signal:AbortSignal):Promise<string>;
};
const words={
 ru:{title:'Отметка смены',unavailable:'Отметка по NFC пока недоступна на этом устройстве.',idle:'Чтобы отметить смену, сначала приложите телефон к метке на рабочем месте.',scan:'Сканировать метку',preparing:'Готовим сканирование…',tap:'Сейчас приложите телефон к метке.',verifying:'Проверяем метку…',allowed:'Метка подтверждена. Подтвердите отметку.',start:'Начать смену',end:'Закончить смену',saving:'Записываем отметку…',started:'Начало смены записано.',ended:'Окончание смены записано.',signIn:'Сначала войдите в Timeax.',denied:'Отметка по NFC недоступна для вашего назначения.',retry:'Не удалось подтвердить отметку. Приложите телефон к метке ещё раз.',unknown:'Не удалось получить результат. Проверьте статус смены в кабинете, прежде чем пробовать снова.'},
 pl:{title:'Rejestracja zmiany',unavailable:'Rejestracja NFC jest na razie niedostępna na tym urządzeniu.',idle:'Aby zarejestrować zmianę, najpierw zbliż telefon do znacznika w miejscu pracy.',scan:'Zeskanuj znacznik',preparing:'Przygotowujemy skanowanie…',tap:'Teraz zbliż telefon do znacznika.',verifying:'Sprawdzamy znacznik…',allowed:'Znacznik zweryfikowany. Potwierdź zapis.',start:'Rozpocznij zmianę',end:'Zakończ zmianę',saving:'Zapisujemy zmianę…',started:'Rozpoczęcie zmiany zapisane.',ended:'Zakończenie zmiany zapisane.',signIn:'Najpierw zaloguj się do Timeax.',denied:'Rejestracja NFC nie jest dostępna dla Twojego przydziału.',retry:'Nie udało się potwierdzić zapisu. Ponownie zbliż telefon do znacznika.',unknown:'Nie udało się uzyskać wyniku. Przed ponowną próbą sprawdź stan zmiany w panelu.'},
 uk:{title:'Відмітка зміни',unavailable:'Відмітка через NFC поки недоступна на цьому пристрої.',idle:'Щоб відмітити зміну, спочатку прикладіть телефон до мітки на робочому місці.',scan:'Сканувати мітку',preparing:'Готуємо сканування…',tap:'Зараз прикладіть телефон до мітки.',verifying:'Перевіряємо мітку…',allowed:'Мітку підтверджено. Підтвердьте відмітку.',start:'Почати зміну',end:'Завершити зміну',saving:'Записуємо відмітку…',started:'Початок зміни записано.',ended:'Завершення зміни записано.',signIn:'Спочатку увійдіть у Timeax.',denied:'Відмітка через NFC недоступна для вашого призначення.',retry:'Не вдалося підтвердити відмітку. Ще раз прикладіть телефон до мітки.',unknown:'Не вдалося отримати результат. Перш ніж повторити, перевірте стан зміни в кабінеті.'},
 en:{title:'Clock in or out',unavailable:'NFC time recording is not yet available on this device.',idle:'To record a shift, tap the tag at your worksite.',scan:'Scan the tag',preparing:'Preparing to scan…',tap:'Tap the tag now.',verifying:'Checking the tag…',allowed:'Tag verified. Confirm to record.',start:'Start shift',end:'End shift',saving:'Recording…',started:'Shift start recorded.',ended:'Shift end recorded.',signIn:'Sign in to Timeax first.',denied:'NFC time recording is not available for your assignment.',retry:'Could not confirm the scan. Tap the tag again.',unknown:'The result is unavailable. Check your shift status in your account before trying again.'},
};
const allowedScan=new Set<Phase>(['idle','retry','started','ended']);
const cancelOnHide=new Set<Phase>(['preparing','tap','verifying','allowed','saving']);

// Wire-ready only; do not register the route or navigator link until the server
// and a trusted native reader are available. The URL is never a proof source.
export function NfcStationaryShiftRoute({serverAvailable=false,reader}:{
 serverAvailable?:boolean;
 reader?:StationaryNfcReader;
}){
 const {t,i18n}=useTranslation(),language=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof words,copy=words[language]??words.en;
 const ready=serverAvailable&&typeof reader?.readLiveProof==='function';
 const [phase,setPhase]=useState<Phase>('idle'),[offeredAction,setOfferedAction]=useState<NfcShiftOffer['action']>();
 const currentPhase=useRef<Phase>('idle');
 const grant=useRef<NfcShiftOffer|null>(null),operation=useRef<AbortController|null>(null);
 const expiry=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 function update(value:Phase){currentPhase.current=value;setPhase(value)}
 function clearGrant(){clearTimeout(expiry.current);grant.current=null;setOfferedAction(undefined)}
 function fail(status:number,saving:boolean){
  update(status===401?'signIn':status===403?'denied':status===409?'retry':saving?'unknown':'unavailable');
 }
 useEffect(()=>{
  currentPhase.current='idle';setPhase('idle');setOfferedAction(undefined);
  function onHide(event:Event){
   if(event.type==='visibilitychange'&&document.visibilityState==='visible'||!cancelOnHide.has(currentPhase.current))return;
   const saving=currentPhase.current==='saving';
   operation.current?.abort();operation.current=null;clearGrant();update(saving?'unknown':'retry');
  }
  document.addEventListener('visibilitychange',onHide);
  window.addEventListener('pagehide',onHide);
  return()=>{
   document.removeEventListener('visibilitychange',onHide);
   window.removeEventListener('pagehide',onHide);
   operation.current?.abort();operation.current=null;
   clearTimeout(expiry.current);grant.current=null;
  };
 },[ready,reader]);

 async function scan(){
  if(!ready||!reader||document.visibilityState!=='visible'||operation.current||!allowedScan.has(currentPhase.current))return;
  const task=new AbortController();operation.current=task;clearGrant();update('preparing');
  const timer=setTimeout(()=>{if(operation.current===task){task.abort();operation.current=null;update('retry')}},35_000);
  try{
   const prepared=await nfcShiftRequest('prepare',{},task.signal);
   if(task.signal.aborted)return;
   if(!prepared.ok){fail(prepared.status,false);return}
   const challenge=readChallenge(prepared.data);
   if(!challenge){update('retry');return}
   update('tap');
   const proof=await reader.readLiveProof(challenge.challenge,task.signal);
   if(task.signal.aborted)return;
   update('verifying');
   const result=await nfcShiftRequest('proof',{challenge:challenge.challenge,deviceProof:proof},task.signal);
   if(task.signal.aborted)return;
   if(!result.ok){fail(result.status,false);return}
   const offer=readOffer(result.data);
   if(!offer){update('retry');return}
   const remaining=Math.min(15_000,Date.parse(offer.expiresAt)-Date.now());
   if(remaining<=0){update('retry');return}
   grant.current=offer;setOfferedAction(offer.action);update('allowed');
   expiry.current=setTimeout(()=>{if(grant.current===offer){clearGrant();update('retry')}},remaining);
  }catch{if(!task.signal.aborted)update('retry')}
  finally{clearTimeout(timer);if(operation.current===task)operation.current=null}
 }

 async function record(){
  if(!ready||document.visibilityState!=='visible'||operation.current||currentPhase.current!=='allowed'||!grant.current)return;
  const offer=grant.current;clearGrant();
  if(Date.parse(offer.expiresAt)<=Date.now()){update('retry');return}
  const task=new AbortController();operation.current=task;update('saving');
  const timer=setTimeout(()=>{if(operation.current===task){task.abort();operation.current=null;update('unknown')}},15_000);
  try{
   const saved=await nfcShiftRequest('record',{token:offer.token,action:offer.action},task.signal);
   if(task.signal.aborted)return;
   if(!saved.ok){fail(saved.status,true);return}
   update(readRecord(saved.data,offer.action)??'unknown');
  }catch{if(!task.signal.aborted)update('unknown')}
  finally{clearTimeout(timer);if(operation.current===task)operation.current=null}
 }

 const visiblePhase=ready?phase:'unavailable';
 return <main className="route-page"><section className="notice-box" aria-labelledby="nfc-shift-title">
  <h1 id="nfc-shift-title">{copy.title}</h1>
  <p role="status">{copy[visiblePhase]}</p>
  {visiblePhase==='signIn'&&<a className="button button--primary" href="/login">{t('common.login')}</a>}
  {allowedScan.has(visiblePhase)&&<button type="button" className="button button--primary" onClick={()=>void scan()}>{copy.scan}</button>}
  {visiblePhase==='allowed'&&offeredAction&&<button type="button" className="button button--primary" onClick={()=>void record()}>{copy[offeredAction]}</button>}
 </section></main>;
}
