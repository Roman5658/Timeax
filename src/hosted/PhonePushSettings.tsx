import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Bell,BellOff,Smartphone} from 'lucide-react';
import {AgencyBookDrawer} from './AgencyBookDrawer';
import {persistApprovedWorkerSession} from './worker-session';

const words={
 en:['Phone notifications','Enable notifications','Disable notifications','On iPhone: in Safari, choose Share → Add to Home Screen → Open as Web App. Then open Timeax from its icon and enable notifications here.','Allow notifications in your phone or browser settings, then try again.','Notifications are on for this device. The lock screen won’t show private details.','Could not change notifications. Try again.','This browser does not support Web Push.'],
 ru:['Уведомления на телефон','Включить уведомления','Отключить уведомления','На iPhone в Safari выбери «Поделиться» → «На экран Домой» → «Открывать как веб-приложение». Затем открой Timeax с иконки и включи уведомления здесь.','Разреши уведомления в настройках телефона или браузера и попробуй ещё раз.','Уведомления включены на этом устройстве. На экране блокировки нет личных данных.','Не удалось изменить настройки. Попробуй ещё раз.','В этом браузере веб-пуши недоступны.'],
 pl:['Powiadomienia na telefon','Włącz powiadomienia','Wyłącz powiadomienia','Na iPhonie w Safari wybierz Udostępnij → Do ekranu początkowego → Otwórz jako aplikację internetową. Następnie otwórz Timeax z ikony i włącz powiadomienia tutaj.','Zezwól na powiadomienia w ustawieniach telefonu lub przeglądarki i spróbuj ponownie.','Powiadomienia są włączone na tym urządzeniu. Ekran blokady nie pokaże prywatnych informacji.','Nie udało się zmienić ustawień. Spróbuj ponownie.','Ta przeglądarka nie obsługuje Web Push.'],
 uk:['Сповіщення на телефон','Увімкнути сповіщення','Вимкнути сповіщення','На iPhone у Safari вибери «Поширити» → «На початковий екран» → «Відкрити як вебпрограму». Потім відкрий Timeax з іконки й увімкни сповіщення тут.','Дозволь сповіщення в налаштуваннях телефона або браузера й спробуй знову.','Сповіщення ввімкнено на цьому пристрої. На екрані замкнення немає особистих даних.','Не вдалося змінити налаштування. Спробуй знову.','Цей браузер не підтримує Web Push.'],
};
const preparationCopy={
 en:['Preparing phone notifications…','Could not prepare notifications on this device. Try again.','Your session expired. Sign in again to set up notifications.','Phone notifications are unavailable right now. Try again later.','Sign in'],
 ru:['Готовим уведомления на телефон…','Не удалось подготовить уведомления на этом устройстве. Попробуй ещё раз.','Сеанс закончился. Войди снова, чтобы настроить уведомления.','Уведомления на телефон сейчас недоступны. Попробуй позже.','Войти'],
 pl:['Przygotowujemy powiadomienia na telefon…','Nie udało się przygotować powiadomień na tym urządzeniu. Spróbuj ponownie.','Sesja wygasła. Zaloguj się ponownie, aby ustawić powiadomienia.','Powiadomienia na telefon są teraz niedostępne. Spróbuj później.','Zaloguj się'],
 uk:['Готуємо сповіщення на телефон…','Не вдалося підготувати сповіщення на цьому пристрої. Спробуй ще раз.','Сеанс завершився. Увійди знову, щоб налаштувати сповіщення.','Сповіщення на телефон зараз недоступні. Спробуй пізніше.','Увійти'],
};
type Preparation='loading'|'ready'|'device'|'login'|'unavailable';
async function call(body?:unknown,signal?:AbortSignal){
 const r=await fetch('/api/web-push',{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
  redirect:'error',signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 if(r.status===401)throw Error('login');
 if(r.status===409&&body===undefined&&(await r.json())?.error==='registration-session')throw Error('registration-session');
 if(!r.ok||r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');
 return r.json();
}
async function preparePush(signal:AbortSignal){
 try{return await call(undefined,signal)}catch(e){
  if(!(e instanceof Error)||e.message!=='registration-session')throw e;
  const upgraded=await persistApprovedWorkerSession(signal);
  if(upgraded!=='ready')throw Error(upgraded);
  return call(undefined,signal);
 }
}
// Watch the specific registration, not the page's ready promise. Freshly
// installed WebKit apps may have an active worker but no page controller yet.
async function activePushRegistration(signal:AbortSignal){
 const root=new URL('/',location.href).href,script=new URL('/timeax-push-sw.js',root).href;
 const reg=await navigator.serviceWorker.register(script,{scope:'/',updateViaCache:'none'});
 if(signal.aborted||reg.scope!==root||!reg.pushManager)throw Error('device');
 return new Promise<ServiceWorkerRegistration>((resolve,reject)=>{
  const finish=(ok:boolean)=>{window.clearInterval(poll);signal.removeEventListener('abort',cancel);ok?resolve(reg):reject(Error('device'))};
  const cancel=()=>finish(false);
  const check=()=>{if(reg.active?.scriptURL===script&&reg.active.state==='activated')finish(true)};
  const poll=window.setInterval(check,150);
  signal.addEventListener('abort',cancel,{once:true});
  check();
 });
}
export function PhonePushSettings(){
 const {i18n,t}=useTranslation(),locale=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof words,c=words[locale]??words.en;
 const prep=preparationCopy[locale]??preparationCopy.en;
 const [key,K]=useState(''),[enabled,E]=useState(false),[busy,B]=useState(false),[notice,N]=useState(0);
 const [open,setOpen]=useState(false),[phase,setPhase]=useState<Preparation>('loading'),[revision,setRevision]=useState(0);
 const registration=useRef<ServiceWorkerRegistration>(undefined),currentSubscription=useRef<PushSubscription|null>(null);
 const ios=/iP(?:hone|ad|od)/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
 const installed=window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
 const supported=window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const usable=supported&&(!ios||installed);
 useEffect(()=>{
  if(!usable)return;
  const ctrl=new AbortController();
  let failed:Preparation='unavailable';
  const timeout=window.setTimeout(()=>{setPhase(failed);ctrl.abort()},8000);
  const service=activePushRegistration(ctrl.signal).then(reg=>({reg}),()=>({reg:undefined}));
  void (async()=>{
   const data=await preparePush(ctrl.signal);
   if(ctrl.signal.aborted)return;
   if(typeof data?.publicKey!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(data.publicKey))throw Error('unavailable');
   failed='device';
   const {reg}=await service;
   if(ctrl.signal.aborted)return;
   if(!reg)throw Error('device');
   const subscription=await reg.pushManager.getSubscription();
   if(ctrl.signal.aborted)return;
   failed='unavailable';
   const status=subscription?await call({action:'status',endpoint:subscription.endpoint},ctrl.signal):{enabled:false};
   if(typeof status?.enabled!=='boolean')throw Error('unavailable');
   if(ctrl.signal.aborted)return;
   K(data.publicKey);registration.current=reg;currentSubscription.current=subscription;E(status.enabled);setPhase('ready');
  })().catch(e=>{if(!ctrl.signal.aborted){setPhase(e?.message==='login'?'login':failed);ctrl.abort()}}).finally(()=>window.clearTimeout(timeout));
  return()=>{window.clearTimeout(timeout);ctrl.abort()};
 },[usable,revision]);
 function retry(){N(0);setPhase('loading');setRevision(v=>v+1)}
 async function toggle(){
  const reg=registration.current;if(phase!=='ready'||!reg||busy)return;
  B(true);N(0);let created:PushSubscription|undefined;
  try{
   if(!enabled&&Notification.permission==='denied'){N(4);return}
   const current=currentSubscription.current;
   if(enabled){
    if(current){
     const r=await call({action:'disable',endpoint:current.endpoint});
     if(r?.enabled!==false)throw Error();
     await current.unsubscribe().catch(()=>false);
    }
    currentSubscription.current=null;E(false);return;
   }
   const appKey=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')+'='),ch=>ch.charCodeAt(0));
   const subscription=current??(created=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:appKey}));
   const data=subscription.toJSON();
   const r=await call({action:'enable',language:words[locale]?locale:'en',subscription:{endpoint:data.endpoint,keys:data.keys}});
   if(r?.enabled!==true)throw Error();currentSubscription.current=subscription;E(true);
  }catch{await created?.unsubscribe().catch(()=>false);N(Notification.permission==='denied'?4:6)}finally{B(false)}
 }
 const detail={
  en:"Get work alerts on this device even when Timeax is closed. Turning them off does not affect the bell or in-app notifications.",
  ru:"Получайте рабочие уведомления на этом устройстве, даже когда Timeax закрыт. Если выключить пуши, уведомления в колокольчике останутся.",
  pl:"Otrzymuj powiadomienia służbowe na tym urządzeniu nawet po zamknięciu Timeax. Wyłączenie nie wpływa na dzwonek ani powiadomienia w aplikacji.",
  uk:"Отримуйте робочі сповіщення на цьому пристрої, навіть коли Timeax закрито. Вимкнення не впливає на дзвіночок і сповіщення в застосунку.",
 }[locale]??"The bell still shows work notifications when push is off.";
 const on=enabled&&supported&&Notification.permission==='granted';
 const indicator=usable&&phase!=='ready'?'-':on?'ON':'OFF';
 return <>
  <button type="button" className="button button--outline button--small phone-push-trigger" data-state={on?'on':'off'}
   aria-haspopup="dialog" aria-expanded={open} aria-label={c[0]+': '+indicator} onClick={()=>setOpen(true)}>
   <Smartphone size={13} aria-hidden="true"/><span aria-hidden="true">{indicator}</span>
  </button>
  {open&&<AgencyBookDrawer title={c[0]} closeLabel={t('common.close')} busy={busy} centered onClose={()=>setOpen(false)}>
   <div className="phone-push-options">
    <p>{detail}</p>
    {ios&&!installed?<p>{c[3]}</p>:!supported?<p>{c[7]}</p>:<>
     {phase==='ready'&&<button type="button" className="button button--outline" disabled={busy} onClick={()=>void toggle()}>
      {enabled?<BellOff size={17} aria-hidden="true"/>:<Bell size={17} aria-hidden="true"/>}{enabled?c[2]:c[1]}
     </button>}{on&&<p role="status">{c[5]}</p>}
     {phase==='loading'&&<p role="status">{prep[0]}</p>}
     {(phase==='device'||phase==='login'||phase==='unavailable')&&<p role="alert">{prep[phase==='device'?1:phase==='login'?2:3]}</p>}
     {phase==='login'&&<a className="button button--outline" href="/login">{prep[4]}</a>}
     {(phase==='device'||phase==='unavailable')&&<button type="button" className="button button--outline" onClick={retry}>{t('auth.tryAgain')}</button>}
    </>}
    {notice>0&&<p role="alert">{c[notice]}</p>}
   </div>
  </AgencyBookDrawer>}
 </>;
}
