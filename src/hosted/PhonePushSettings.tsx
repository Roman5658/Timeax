import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Bell,BellOff} from 'lucide-react';

const words={
 en:['Phone notifications','Enable notifications','Disable notifications','On iPhone: in Safari, choose Share → Add to Home Screen → Open as Web App. Then open Timeax from its icon and enable notifications here.','Allow notifications in your phone or browser settings, then try again.','Notifications are on for this device. The lock screen won’t show private details.','Could not change notifications. Try again.','This browser does not support Web Push.'],
 ru:['Уведомления на телефон','Включить уведомления','Отключить уведомления','На iPhone в Safari выбери «Поделиться» → «На экран Домой» → «Открывать как веб-приложение». Затем открой Timeax с иконки и включи уведомления здесь.','Разреши уведомления в настройках телефона или браузера и попробуй ещё раз.','Уведомления включены на этом устройстве. На экране блокировки нет личных данных.','Не удалось изменить настройки. Попробуй ещё раз.','В этом браузере веб-пуши недоступны.'],
 pl:['Powiadomienia na telefon','Włącz powiadomienia','Wyłącz powiadomienia','Na iPhonie w Safari wybierz Udostępnij → Do ekranu początkowego → Otwórz jako aplikację internetową. Następnie otwórz Timeax z ikony i włącz powiadomienia tutaj.','Zezwól na powiadomienia w ustawieniach telefonu lub przeglądarki i spróbuj ponownie.','Powiadomienia są włączone na tym urządzeniu. Ekran blokady nie pokaże prywatnych informacji.','Nie udało się zmienić ustawień. Spróbuj ponownie.','Ta przeglądarka nie obsługuje Web Push.'],
 uk:['Сповіщення на телефон','Увімкнути сповіщення','Вимкнути сповіщення','На iPhone у Safari вибери «Поширити» → «На початковий екран» → «Відкрити як вебпрограму». Потім відкрий Timeax з іконки й увімкни сповіщення тут.','Дозволь сповіщення в налаштуваннях телефона або браузера й спробуй знову.','Сповіщення ввімкнено на цьому пристрої. На екрані замкнення немає особистих даних.','Не вдалося змінити налаштування. Спробуй знову.','Цей браузер не підтримує Web Push.'],
};
async function call(body?:unknown,signal?:AbortSignal){
 const r=await fetch('/api/web-push',{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
  redirect:'error',signal,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
 if(!r.ok||r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error();
 return r.json();
}
export function PhonePushSettings(){
 const {i18n}=useTranslation(),locale=(i18n.resolvedLanguage??'en').split('-')[0] as keyof typeof words,c=words[locale]??words.en;
 const [key,K]=useState(''),[ready,R]=useState(false),[enabled,E]=useState(false),[busy,B]=useState(false),[notice,N]=useState(0);
 const registration=useRef<ServiceWorkerRegistration>(undefined),currentSubscription=useRef<PushSubscription|null>(null);
 const ios=/iP(?:hone|ad|od)/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
 const installed=window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
 const supported=window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 useEffect(()=>{
  const ctrl=new AbortController();
  void call(undefined,ctrl.signal).then(async data=>{
   if(ctrl.signal.aborted||typeof data?.publicKey!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(data.publicKey))return;
   K(data.publicKey);
   if(!supported||ios&&!installed)return;
   try{
    await navigator.serviceWorker.register('/timeax-push-sw.js',{scope:'/',updateViaCache:'none'});
    if(ctrl.signal.aborted)return;
    const reg=await navigator.serviceWorker.ready;
    if(ctrl.signal.aborted)return;
    registration.current=reg;
    const subscription=await reg.pushManager.getSubscription();
    if(ctrl.signal.aborted)return;
    currentSubscription.current=subscription;
    if(subscription&&Notification.permission==='granted'){
     const s=await call({action:'status',endpoint:subscription.endpoint},ctrl.signal);
     if(!ctrl.signal.aborted)E(s?.enabled===true);
    }
    if(!ctrl.signal.aborted)R(true);
   }catch{if(!ctrl.signal.aborted)N(6)}
  }).catch(()=>{});
  return()=>ctrl.abort();
 },[supported,ios,installed]);
 if(!key)return null;
 async function toggle(){
  const reg=registration.current;if(!reg||busy)return;
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
 return <section className="dashboard-panel" aria-label={c[0]}><h2>{c[0]}</h2>
  {ios&&!installed?<p>{c[3]}</p>:!supported?<p>{c[7]}</p>:<>
   <button type="button" className="button button--outline" disabled={!ready||busy} onClick={()=>void toggle()}>
    {enabled?<BellOff size={17} aria-hidden="true"/>:<Bell size={17} aria-hidden="true"/>}{enabled?c[2]:c[1]}
   </button>{enabled&&<p role="status">{c[5]}</p>}{notice>0&&<p role="alert">{c[notice]}</p>}
  </>}
 </section>;
}
