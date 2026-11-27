import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {LegalLink} from '../components/PublicExperience';
import {HOSTED_TERMS_SHA256,HOSTED_TERMS_VERSION} from './HostedTermsPage';

const copy={
 pl:{title:'Regulamin konta pracownika',intro:'Aby korzystać z konta pracownika w Timeax, zaakceptuj aktualny regulamin. Polityka prywatności wyjaśnia zasady przetwarzania danych.',checking:'Sprawdzamy akceptację regulaminu…',confirm:'Zaakceptuj i przejdź dalej',retry:'Spróbuj ponownie',unavailable:'Nie można teraz sprawdzić ani zapisać akceptacji regulaminu.',expired:'Sesja wygasła. Zaloguj się ponownie.',changed:'Regulamin uległ zmianie. Odśwież stronę i przeczytaj jego aktualną wersję.'},
 uk:{title:'Умови облікового запису працівника',intro:'Щоб користуватися обліковим записом працівника в Timeax, прийміть чинні умови. Політика конфіденційності пояснює, як обробляються дані.',checking:'Перевіряємо, чи прийнято умови…',confirm:'Прийняти й продовжити',retry:'Спробувати ще раз',unavailable:'Зараз неможливо перевірити або зберегти прийняття умов.',expired:'Сеанс закінчився. Увійдіть знову.',changed:'Умови змінилися. Оновіть сторінку й прочитайте чинну версію.'},
 ru:{title:'Условия аккаунта работника',intro:'Чтобы пользоваться аккаунтом работника в Timeax, прими действующие условия. В политике конфиденциальности указано, как обрабатываются данные.',checking:'Проверяем принятие условий…',confirm:'Принять и продолжить',retry:'Повторить',unavailable:'Сейчас не удалось проверить или сохранить принятие условий.',expired:'Сессия закончилась. Войди снова.',changed:'Условия изменились. Обнови страницу и прочитай действующую версию.'},
 en:{title:'Worker account terms',intro:'To use your Timeax worker account, accept the current terms. The privacy notice explains how data is processed.',checking:'Checking terms acceptance…',confirm:'Accept and continue',retry:'Try again',unavailable:'Terms acceptance could not be checked or saved right now.',expired:'Your session has expired. Sign in again.',changed:'The terms have changed. Refresh the page and read the current version.'},
};
type Status='loading'|'required'|'accepted'|'unavailable'|'expired'|'changed';

async function termsState(signal:AbortSignal,accept=false):Promise<Status>{
 const r=await fetch('/api/worker-enrollment/terms',{signal,credentials:'same-origin',cache:'no-store',
  headers:{Accept:'application/json',...(accept?{'Content-Type':'application/json'}:{})},
  ...(accept?{method:'POST',body:JSON.stringify({version:HOSTED_TERMS_VERSION,accepted:true})}:{})});
 if(r.status===401)return 'expired';
 if(r.status===409)return 'changed';
 if(!r.ok)return 'unavailable';
 const value=await r.json();
 if(value?.version!==HOSTED_TERMS_VERSION||value?.documentSha256!==HOSTED_TERMS_SHA256)return 'changed';
 if(value.accepted===true&&typeof value.acceptedAt==='string'&&Number.isFinite(Date.parse(value.acceptedAt)))return 'accepted';
 return !accept&&value.accepted===false&&value.acceptedAt===null?'required':'unavailable';
}

export function WorkerTermsGate({children,onSessionExpired}:{children:ReactNode;onSessionExpired?:()=>void}){
 const {t,i18n}=useTranslation(),lang=i18n.resolvedLanguage?.split('-')[0];
 const c=copy[lang==='pl'||lang==='uk'||lang==='ru'?lang:'en'];
 const [state,S]=useState<Status>('loading'),[checked,C]=useState(false),[busy,B]=useState(false),[error,E]=useState(false),[revision,R]=useState(0);
 const operation=useRef<AbortController|null>(null),expired=useRef(onSessionExpired);expired.current=onSessionExpired;
 useEffect(()=>{
  const controller=new AbortController();operation.current=controller;S('loading');C(false);E(false);
  void termsState(controller.signal).catch(()=>'unavailable' as const).then(next=>{
   if(controller.signal.aborted)return;
   S(next);if(next==='expired')expired.current?.();if(operation.current===controller)operation.current=null;
  });
  return()=>{controller.abort();operation.current?.abort();operation.current=null};
 },[revision]);
 async function submit(e:FormEvent){
  e.preventDefault();if(!checked||operation.current||state!=='required')return;
  const controller=new AbortController();operation.current=controller;B(true);E(false);
  const next=await termsState(controller.signal,true).catch(()=>'unavailable' as const);
  if(controller.signal.aborted)return;
  operation.current=null;B(false);
  if(next==='unavailable'){E(true);return}
  S(next);if(next==='expired')expired.current?.();
 }
 if(state==='accepted')return <>{children}</>;
 if(state==='loading')return <p role="status">{c.checking}</p>;
 const legal=<p className="muted-copy"><LegalLink kind="terms" to={'/terms/'+HOSTED_TERMS_VERSION}/> · <LegalLink kind="privacy" to="/privacy"/></p>;
 return <section className="notice-box" aria-label={c.title}>
  <h2>{c.title}</h2>
  {state==='required'?<><p>{c.intro}</p>{legal}<form className="auth-form" onSubmit={e=>void submit(e)}>
   <label className="public-agreement"><input type="checkbox" checked={checked} onChange={e=>C(e.target.checked)} required disabled={busy}/>{t('hostedLegal.accept')}</label>
   <button type="submit" className="button button--primary" disabled={!checked||busy}>{c.confirm}</button>
  </form>{error&&<p role="alert">{c.unavailable}</p>}</>:<><p role="alert">{c[state]}</p>{legal}
   {state==='unavailable'&&<button type="button" className="button button--outline" onClick={()=>R(n=>n+1)}>{c.retry}</button>}
  </>}
 </section>;
}
