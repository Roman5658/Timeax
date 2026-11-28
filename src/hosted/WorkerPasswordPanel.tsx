import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {Eye,EyeOff} from 'lucide-react';
import {isCanonicalEmailOrigin} from '../modules/auth/registration/contract/registration-client';

const text={
 ru:{checking:"Проверяем настройки пароля…",unavailable:"Настройки пароля временно недоступны. По-прежнему можно войти по коду из письма.",retry:"Повторить загрузку настроек",restricted:"Настройки пароля недоступны для этого аккаунта.",passwordRule:"Пароль должен содержать не менее 12 символов и не более 72 байт UTF-8. Повторите тот же пароль.",confirmOnce:"Чтобы задать или изменить пароль, один раз подтвердите почту кодом. В следующий раз можно будет войти с паролем, не запрашивая код.",title:'Вход с паролем',intro:'Установите или смените пароль для своего личного аккаунта Timeax. Вход по коду из письма останется доступным.',password:'Новый пароль',again:'Повторите пароль',save:'Сохранить пароль',saved:'Пароль сохранён. Теперь можно входить по почте и паролю.',code:'Подтвердить почту кодом',error:'Не удалось сохранить пароль. Подтвердите почту кодом и попробуйте ещё раз.'},
 en:{checking:"Checking password settings…",unavailable:"Password settings are temporarily unavailable. You can still sign in with an email code.",retry:"Reload password settings",restricted:"Password settings are not available for this account.",passwordRule:"The password must be between 12 characters and 72 UTF-8 bytes. Both entries must match.",confirmOnce:"Confirm your email once to set or change your password. Then you can sign in with your password without requesting a code.",title:'Sign in with a password',intro:'Set or change the password for your personal Timeax account. You can still sign in with an email code.',password:'New password',again:'Repeat password',save:'Save password',saved:'Password saved. You can now sign in with your email and password.',code:'Confirm email with a code',error:'The password could not be saved. Confirm your email with a code and try again.'},
 pl:{checking:"Sprawdzamy ustawienia hasła…",unavailable:"Ustawienia hasła są chwilowo niedostępne. Nadal możesz zalogować się kodem z e-maila.",retry:"Wczytaj ustawienia hasła ponownie",restricted:"Ustawienia hasła nie są dostępne dla tego konta.",passwordRule:"Hasło musi mieć co najmniej 12 znaków i maksymalnie 72 bajty UTF-8. Oba wpisy muszą być takie same.",confirmOnce:"Potwierdź e-mail jeden raz, aby ustawić lub zmienić hasło. Później możesz logować się hasłem bez proszenia o kod.",title:'Logowanie hasłem',intro:'Ustaw lub zmień hasło swojego osobistego konta Timeax. Logowanie kodem z e-maila nadal będzie dostępne.',password:'Nowe hasło',again:'Powtórz hasło',save:'Zapisz hasło',saved:'Hasło zapisano. Możesz teraz zalogować się e-mailem i hasłem.',code:'Potwierdź e-mail kodem',error:'Nie udało się zapisać hasła. Potwierdź e-mail kodem i spróbuj ponownie.'},
 uk:{checking:"Перевіряємо налаштування пароля…",unavailable:"Налаштування пароля тимчасово недоступні. Ви й надалі можете входити за кодом із листа.",retry:"Завантажити налаштування ще раз",restricted:"Налаштування пароля недоступні для цього облікового запису.",passwordRule:"Пароль має містити щонайменше 12 символів і не більше ніж 72 байти UTF-8. Введіть однаковий пароль в обох полях.",confirmOnce:"Щоб установити чи змінити пароль, один раз підтвердьте пошту кодом. Наступного разу зможете ввійти з паролем і не запитувати код.",title:'Вхід із паролем',intro:'Установіть або змініть пароль особистого облікового запису Timeax. Вхід за кодом із листа залишиться доступним.',password:'Новий пароль',again:'Повторіть пароль',save:'Зберегти пароль',saved:'Пароль збережено. Тепер можна входити за поштою і паролем.',code:'Підтвердити пошту кодом',error:'Не вдалося зберегти пароль. Підтвердьте пошту кодом і спробуйте ще раз.'}
};
type State='loading'|'ready'|'saved'|'reauthentication-required'|'hidden'|'unavailable'|'restricted';
const path='/api/timeax/auth/public/worker-password';
const valid=(password:string)=>[...password].length>=12&&new TextEncoder().encode(password).length<=72&&!/[\u0000-\u001f\u007f]/.test(password);
async function call(signal:AbortSignal,password?:string):Promise<State>{
 const r=await fetch(path,{signal,method:password===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
  headers:{Accept:'application/json',...(password===undefined?{}:{'Content-Type':'application/json'})},...(password===undefined?{}:{body:JSON.stringify({password})})});
 if(r.status===401)return 'hidden';
 if(r.status===403)return 'restricted';
 if(r.status===404)return 'unavailable';
 if(r.status===409)return 'reauthentication-required';
 if(r.status===400&&password!==undefined)throw Error('invalid');
 if(!r.ok||r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error('unavailable');
 const v=await r.json();
 if(v?.state==='saving')return 'reauthentication-required';
 if(password===undefined&&(v?.state==='ready'||v?.state==='reauthentication-required'))return v.state;
 if(password!==undefined&&v?.state==='saved')return 'saved';
 throw Error('unavailable');
}
export function WorkerPasswordPanel({compact=false,onDismiss}:{compact?:boolean;onDismiss?:()=>void}){
 const {i18n,t:translate}=useTranslation();
 const lang=i18n.resolvedLanguage?.split('-')[0],t=text[lang==='ru'||lang==='pl'||lang==='uk'?lang:'en'];
 const skip=lang==='ru'?'Позже, продолжить в кабинет':lang==='pl'?'Później, przejdź do panelu':lang==='uk'?'Пізніше, перейти до кабінету':'Later, continue to my workspace';
 const first=lang==='ru'?'Создай пароль для следующих входов':lang==='pl'?'Ustaw hasło do kolejnych logowań':lang==='uk'?'Створи пароль для наступних входів':'Set a password for future sign-ins';
 const [attempt,retry]=useState(0);
 const [state,S]=useState<State>('loading'),[password,P]=useState(''),[again,A]=useState(''),[busy,B]=useState(false),[error,E]=useState('');
 const [showPassword,setShowPassword]=useState(false);
 const [code,C]=useState(''),[awaitingCode,setAwaitingCode]=useState(false),[codeStatus,setCodeStatus]=useState('');
 const operation=useRef<AbortController|null>(null);
 useEffect(()=>{
  if(!isCanonicalEmailOrigin(location.origin)){S('hidden');return}
  const c=new AbortController();
  void call(c.signal).catch(()=>'unavailable' as const).then(next=>{if(!c.signal.aborted)S(next)});
  return()=>{c.abort();operation.current?.abort();operation.current=null};
 },[attempt]);
 async function change(e:FormEvent){
  e.preventDefault();if(operation.current||state!=='ready')return;
  E('');if(password!==again||!valid(password)){E(t.passwordRule);return}
  const c=new AbortController();operation.current=c;B(true);
  try{
   const next=await call(c.signal,password);
   if(!c.signal.aborted){S(next==='hidden'?'reauthentication-required':next);if(next!=='saved')E(t.error)}
  }catch(e){if(!c.signal.aborted){if(e instanceof Error&&e.message==='invalid')E(t.passwordRule);else{S('reauthentication-required');E(t.error)}}}
  finally{if(!c.signal.aborted){operation.current=null;P('');A('');setShowPassword(false);B(false)}}
 }
 async function reauthenticate(verify=false){
  if(operation.current||verify&&!/^(?:\d{6}|\d{8})$/.test(code))return;
  const c=new AbortController();operation.current=c;B(true);E('');setCodeStatus('');
  const copyKey=(k:string)=>translate('existingSession.'+k);
  try{
   const r=await fetch('/api/timeax/auth/public/'+(verify?'verify':'start'),{method:'POST',signal:c.signal,credentials:'same-origin',cache:'no-store',redirect:'error',
    headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(verify?{code}:{email:'',flow:'worker-password'})});
   if(r.status===429){E(translate('selfService.try-later'));return}
   if(verify&&r.status===401){E(copyKey('invalid'));return}
   if(r.status!==(verify?200:202)||r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error();
   const receipt=await r.json();
   if(receipt?.status!==(verify?'email-verified':'accepted'))throw Error();
   if(verify){
    const next=await call(c.signal);
    if(next!=='ready')throw Error();
    if(!c.signal.aborted){S('ready');C('');setAwaitingCode(false)}
   }else if(!c.signal.aborted){setAwaitingCode(true);setCodeStatus(translate('publicSignup.accepted'))}
  }catch{if(!c.signal.aborted)E(t.unavailable)}
  finally{if(!c.signal.aborted){operation.current=null;B(false)}}
 }
 if(state==='hidden'||(compact||onDismiss)&&(['loading','restricted','unavailable'].includes(state)||state==='reauthentication-required'&&compact&&!error))return null;
 if(state==='loading'||state==='restricted'||state==='unavailable')return <section className="notice-box" aria-label={t.title}>
  <h2>{t.title}</h2><p role="status">{state==='loading'?t.checking:t[state]}</p>
  {state==='unavailable'&&<button type="button" className="button button--outline" onClick={()=>{S('loading');retry(n=>n+1)}}>{t.retry}</button>}
 </section>;
 const body=<><p>{t.intro}</p>{state==='saved'?<p role="status">{t.saved}</p>:state==='ready'?
   <form className="auth-form" onSubmit={change}>
    <label className="field-label">{t.password}<input type={showPassword?'text':'password'} autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={e=>P(e.target.value)} disabled={busy}/></label>
    <label className="field-label">{t.again}<input type={showPassword?'text':'password'} autoComplete="new-password" minLength={12} maxLength={72} required value={again} onChange={e=>A(e.target.value)} disabled={busy}/></label>
    <button type="button" className="button button--outline button--small" disabled={busy} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={16} aria-hidden="true"/>:<Eye size={16} aria-hidden="true"/>}{translate(showPassword?'publicSignup.hidePassword':'publicSignup.showPassword')}</button>
    <button type="submit" className="button button--primary" disabled={busy}>{t.save}</button>
   </form>:
   <><p>{t.confirmOnce}</p>{awaitingCode&&<form className="auth-form" onSubmit={e=>{e.preventDefault();void reauthenticate(true)}}>
    <label className="field-label">{translate('stagingSession.code')}<input autoComplete="one-time-code" inputMode="numeric" maxLength={8} value={code} disabled={busy} onChange={e=>C(e.target.value.replace(/[^0-9]/g,''))}/></label>
    <button type="submit" className="button button--primary" disabled={busy||!/^(?:\d{6}|\d{8})$/.test(code)}>{translate('existingSession.verifyAction')}</button>
   </form>}<button type="button" className="button button--outline" onClick={()=>void reauthenticate()} disabled={busy}>{awaitingCode?translate('publicSignup.resendAgencyCode'):t.code}</button>
   {codeStatus&&<p role="status">{codeStatus}</p>}</>}
   {error&&<p role="alert">{error}</p>}</>;
 if(onDismiss)return <section className="notice-box worker-password-welcome" aria-label={first}><h2>{first}</h2>{body}
  <p><button type="button" className="button button--outline" disabled={busy} onClick={onDismiss}>{state==='saved'?(lang==='ru'?'Готово':lang==='pl'?'Gotowe':lang==='uk'?'Готово':'Done'):skip}</button></p></section>;
 return compact?<details className="notice-box"><summary>{t.title}</summary>{body}</details>:<section className="notice-box" aria-label={t.title}><h2>{t.title}</h2>{body}</section>;
}

