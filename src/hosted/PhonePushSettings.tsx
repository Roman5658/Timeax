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
const activationCopy={
 en:["Waiting for this device to enable notifications…", "Saving notification settings…", "The phone did not respond in time. If it asks for permission, tap Allow, then try again.", "Timeax did not confirm the change in time. Check the current setting and try again."],
 ru:["Ждём разрешения от телефона…", "Сохраняем настройки уведомлений…", "Телефон не ответил вовремя. Если он запрашивает разрешение, нажми «Разрешить», затем попробуй ещё раз.", "Timeax не успел подтвердить изменение. Проверь текущую настройку и попробуй ещё раз."],
 pl:["Czekamy na zgodę na telefonie…", "Zapisujemy ustawienia powiadomień…", "Telefon nie odpowiedział na czas. Jeśli prosi o zgodę, wybierz „Zezwól”, a potem spróbuj ponownie.", "Timeax nie potwierdził zmiany na czas. Sprawdź ustawienie i spróbuj ponownie."],
 uk:["Чекаємо дозволу від телефона…", "Зберігаємо налаштування сповіщень…", "Телефон не відповів вчасно. Якщо він запитує дозвіл, натисни «Дозволити», а потім спробуй ще раз.", "Timeax не встиг підтвердити зміну. Перевір поточне налаштування й спробуй ще раз."],
};
async function timed<T>(promise:Promise<T>,timeout:number,error:string){
 let timer:number|undefined;
 try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=window.setTimeout(()=>reject(Error(error)),timeout)})])}
 finally{window.clearTimeout(timer)}
}
async function changeRemote(body:unknown){
 const c=new AbortController();
 try{return await timed(call(body,c.signal),7000,'save-timeout')}
 finally{c.abort()}
}
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
 const current=await navigator.serviceWorker.getRegistration(root);
 if(signal.aborted)throw Error('device');
 const reg=current?.scope===root&&current.active?.scriptURL===script&&current.active.state==='activated'?current:
  await navigator.serviceWorker.register(script,{scope:'/',updateViaCache:'none'});
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
 const prep=preparationCopy[locale]??preparationCopy.en,activation=activationCopy[locale]??activationCopy.en;
 const [key,K]=useState(''),[enabled,E]=useState(false),[busy,B]=useState(false),[notice,N]=useState(0);
 const [open,setOpen]=useState(false),[phase,setPhase]=useState<Preparation>('loading'),[revision,setRevision]=useState(0);
 const [step,setStep]=useState<'device'|'saving'>();
 const [activationError,setActivationError]=useState<'device'|'saving'>();
 const nativeEnrollment=useRef<Promise<PushSubscription>>(undefined),updating=useRef(false);
 const registration=useRef<ServiceWorkerRegistration>(undefined),currentSubscription=useRef<PushSubscription|null>(null);
 const ios=/iP(?:hone|ad|od)/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
 const installed=window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
 const supported=window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const usable=supported&&(!ios||installed);
 const [permission,setPermission]=useState<NotificationPermission>(()=>supported?Notification.permission:'default');
 useEffect(()=>{
  if(!usable)return;
  const observe=()=>{if(!document.hidden)setPermission(Notification.permission)};
  window.addEventListener('focus',observe);document.addEventListener('visibilitychange',observe);
  return()=>{window.removeEventListener('focus',observe);document.removeEventListener('visibilitychange',observe)};
 },[usable]);
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
 function retry(){N(0);setActivationError(undefined);setPhase('loading');setRevision(v=>v+1)}
 async function toggle(){
  const reg=registration.current;if(phase!=='ready'||!reg||updating.current)return;
  updating.current=true;B(true);N(0);setActivationError(undefined);
  try{
   if(!enabled&&Notification.permission==='denied'){N(4);return}
   const current=currentSubscription.current;
   if(enabled){
    setStep('saving');
    if(current){
     const r=await changeRemote({action:'disable',endpoint:current.endpoint});
     if(r?.enabled!==false)throw Error();
     currentSubscription.current=null;E(false);
     await timed(current.unsubscribe(),3000,'device-timeout').catch(()=>false);
    }else E(false);
    return;
   }
   const appKey=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')+'='),ch=>ch.charCodeAt(0));
   let subscription=current;
   if(!subscription){
    setStep('device');
    if(!nativeEnrollment.current){
     // Call directly from the click so Safari can display the permission prompt.
     const subscribing=reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:appKey});
     nativeEnrollment.current=subscribing;
     void subscribing.then(value=>{currentSubscription.current=value},()=>{}).finally(()=>{
      if(nativeEnrollment.current===subscribing)nativeEnrollment.current=undefined;
     });
    }
    subscription=await timed(nativeEnrollment.current,20000,'device-timeout');
   }
   const data=subscription.toJSON();
   setStep('saving');
   const r=await changeRemote({action:'enable',language:words[locale]?locale:'en',subscription:{endpoint:data.endpoint,keys:data.keys}});
   if(r?.enabled!==true)throw Error();
   currentSubscription.current=subscription;E(true);
  }catch(error){
   const reason=error instanceof Error?error.message:'';
   if(reason==='device-timeout')setActivationError('device');
   else if(reason==='save-timeout')setActivationError('saving');
   else if(reason==='login')setPhase('login');
   else N(Notification.permission==='denied'?4:6);
  }finally{setPermission(Notification.permission);updating.current=false;B(false);setStep(undefined)}
 }
 const detail={
  en:"Get work alerts on this device even when Timeax is closed. Turning them off does not affect the bell or in-app notifications.",
  ru:"Получайте рабочие уведомления на этом устройстве, даже когда Timeax закрыт. Если выключить пуши, уведомления в колокольчике останутся.",
  pl:"Otrzymuj powiadomienia służbowe na tym urządzeniu nawet po zamknięciu Timeax. Wyłączenie nie wpływa na dzwonek ani powiadomienia w aplikacji.",
  uk:"Отримуйте робочі сповіщення на цьому пристрої, навіть коли Timeax закрито. Вимкнення не впливає на дзвіночок і сповіщення в застосунку.",
 }[locale]??"The bell still shows work notifications when push is off.";
 const on=enabled&&supported&&permission==='granted';
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
    {step&&<p role="status">{activation[step==='device'?0:1]}</p>}
    {activationError&&<p role="alert">{activation[activationError==='device'?2:3]}</p>}
    {notice>0&&<p role="alert">{c[notice]}</p>}
   </div>
  </AgencyBookDrawer>}
 </>;
}
