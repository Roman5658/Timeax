import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {createWorkingRegistrationClient,isCanonicalEmailOrigin} from '../modules/auth/registration/contract/registration-client';

const text={
 ru:{title:'Вход с паролем',intro:'Установите или смените пароль для своего личного аккаунта Timeax. Вход по коду из письма останется доступным.',password:'Новый пароль',again:'Повторите пароль',save:'Сохранить пароль',saved:'Пароль сохранён. Теперь можно входить по почте и паролю.',invalid:'Введите минимум 12 символов. Пароли должны совпадать.',recent:'Для установки пароля ещё раз подтвердите почту кодом.',code:'Подтвердить почту кодом',error:'Не удалось сохранить пароль. Подтвердите почту кодом и попробуйте ещё раз.',logoutError:'Не удалось открыть повторный вход. Попробуйте ещё раз.'},
 en:{title:'Sign in with a password',intro:'Set or change the password for your personal Timeax account. You can still sign in with an email code.',password:'New password',again:'Repeat password',save:'Save password',saved:'Password saved. You can now sign in with your email and password.',invalid:'Use at least 12 characters. Both passwords must match.',recent:'Confirm your email with a fresh code to set a password.',code:'Confirm email with a code',error:'The password could not be saved. Confirm your email with a code and try again.',logoutError:'Could not open sign-in again. Please try again.'},
 pl:{title:'Logowanie hasłem',intro:'Ustaw lub zmień hasło swojego osobistego konta Timeax. Logowanie kodem z e-maila nadal będzie dostępne.',password:'Nowe hasło',again:'Powtórz hasło',save:'Zapisz hasło',saved:'Hasło zapisano. Możesz teraz zalogować się e-mailem i hasłem.',invalid:'Wpisz co najmniej 12 znaków. Oba hasła muszą być takie same.',recent:'Aby ustawić hasło, ponownie potwierdź e-mail kodem.',code:'Potwierdź e-mail kodem',error:'Nie udało się zapisać hasła. Potwierdź e-mail kodem i spróbuj ponownie.',logoutError:'Nie udało się ponownie otworzyć logowania. Spróbuj jeszcze raz.'},
 uk:{title:'Вхід із паролем',intro:'Установіть або змініть пароль особистого облікового запису Timeax. Вхід за кодом із листа залишиться доступним.',password:'Новий пароль',again:'Повторіть пароль',save:'Зберегти пароль',saved:'Пароль збережено. Тепер можна входити за поштою і паролем.',invalid:'Введіть щонайменше 12 символів. Паролі мають збігатися.',recent:'Щоб установити пароль, ще раз підтвердьте пошту кодом.',code:'Підтвердити пошту кодом',error:'Не вдалося зберегти пароль. Підтвердьте пошту кодом і спробуйте ще раз.',logoutError:'Не вдалося знову відкрити вхід. Спробуйте ще раз.'}
};
type State='loading'|'ready'|'saved'|'reauthentication-required'|'hidden';
const path='/api/timeax/auth/public/worker-password';
const valid=(password:string)=>[...password].length>=12&&new TextEncoder().encode(password).length<=72&&!/[\u0000-\u001f\u007f]/.test(password);
async function call(signal:AbortSignal,password?:string){
 const r=await fetch(path,{signal,method:password===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
  headers:{Accept:'application/json',...(password===undefined?{}:{'Content-Type':'application/json'})},...(password===undefined?{}:{body:JSON.stringify({password})})});
 if(r.status===401||r.status===403||r.status===404)return 'hidden';
 if(r.status===409)return 'reauthentication-required';
 if(!r.ok)throw Error('unavailable');
 const v=await r.json();
 if(v?.state==='saving')return 'reauthentication-required';
 if(v?.state==='ready'||v?.state==='saved'||v?.state==='reauthentication-required')return v.state as State;
 throw Error('unavailable');
}
export function WorkerPasswordPanel({compact=false}:{compact?:boolean}){
 const {i18n}=useTranslation(),navigate=useNavigate();
 const lang=i18n.resolvedLanguage?.split('-')[0],t=text[lang==='ru'||lang==='pl'||lang==='uk'?lang:'en'];
 const [state,S]=useState<State>('loading'),[password,P]=useState(''),[again,A]=useState(''),[busy,B]=useState(false),[error,E]=useState('');
 const operation=useRef<AbortController|null>(null);
 useEffect(()=>{
  if(!isCanonicalEmailOrigin(location.origin)){S('hidden');return}
  const c=new AbortController();
  void call(c.signal).catch(()=>'hidden' as const).then(next=>{if(!c.signal.aborted)S(next)});
  return()=>{c.abort();operation.current?.abort();operation.current=null};
 },[]);
 async function change(e:FormEvent){
  e.preventDefault();if(operation.current||state!=='ready')return;
  E('');if(password!==again||!valid(password)){E(t.invalid);return}
  const c=new AbortController();operation.current=c;B(true);
  try{
   const next=await call(c.signal,password);
   if(!c.signal.aborted){S(next);if(next!=='saved')E(t.error)}
  }catch{if(!c.signal.aborted){S('reauthentication-required');E(t.error)}}
  finally{if(!c.signal.aborted){operation.current=null;P('');A('');B(false)}}
 }
 async function reauthenticate(){
  if(operation.current)return;
  const c=new AbortController();operation.current=c;B(true);E('');
  try{
   const client=createWorkingRegistrationClient(location.origin,fetch.bind(window),'existing');
   if(!await client.logout(c.signal))throw Error('unavailable');
   if(!c.signal.aborted)navigate('/login',{state:{workerPasswordReauth:true}});
  }catch{if(!c.signal.aborted)E(t.logoutError)}
  finally{if(!c.signal.aborted){operation.current=null;B(false)}}
 }
 if(state==='hidden'||state==='loading'||compact&&state==='reauthentication-required'&&!error)return null;
 const body=<><p>{t.intro}</p>{state==='saved'?<p role="status">{t.saved}</p>:state==='ready'?
   <form className="auth-form" onSubmit={change}>
    <label className="field-label">{t.password}<input type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={e=>P(e.target.value)} disabled={busy}/></label>
    <label className="field-label">{t.again}<input type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={again} onChange={e=>A(e.target.value)} disabled={busy}/></label>
    <button type="submit" className="button button--primary" disabled={busy}>{t.save}</button>
   </form>:
   <><p>{t.recent}</p><button type="button" className="button button--outline" onClick={()=>void reauthenticate()} disabled={busy}>{t.code}</button></>}
   {error&&<p role="alert">{error}</p>}</>;
 return compact?<details className="notice-box"><summary>{t.title}</summary>{body}</details>:<section className="notice-box" aria-label={t.title}><h2>{t.title}</h2>{body}</section>;
}

