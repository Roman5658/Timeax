import {useEffect,useRef,useState} from "react";
import {Link,useLocation} from "react-router-dom";
import {useTranslation} from "react-i18next";

const copy={
 ru:["Забыли пароль?","Восстановление пароля","Почта аккаунта","Получить код","Если у этой почты есть аккаунт, придёт код. Проверьте также папку «Спам».","Код из письма","Подтвердить код","Изменить адрес","Выслать ещё раз","Новый пароль","Повторите пароль","Сохранить новый пароль","Пароль изменён. Войдите с новым паролем.","Вернуться ко входу","Код неверен или истёк. Запросите новый.","Пароли должны совпадать и содержать не менее 12 символов.","Не удалось подтвердить смену пароля. Попробуйте войти с новым паролем или запросите новый код.","Попробуйте ещё раз чуть позже."],
 pl:["Nie pamiętasz hasła?","Odzyskiwanie hasła","Adres e-mail konta","Wyślij kod","Jeśli ten adres jest przypisany do konta, otrzymasz kod. Sprawdź też folder Spam.","Kod z wiadomości","Potwierdź kod","Zmień adres","Wyślij ponownie","Nowe hasło","Powtórz hasło","Zapisz nowe hasło","Hasło zostało zmienione. Zaloguj się nowym hasłem.","Wróć do logowania","Kod jest nieprawidłowy lub wygasł. Poproś o nowy.","Hasła muszą być identyczne i mieć co najmniej 12 znaków.","Nie udało się potwierdzić zmiany hasła. Spróbuj zalogować się nowym hasłem lub poproś o nowy kod.","Spróbuj ponownie za chwilę."],
 uk:["Забули пароль?","Відновлення пароля","Пошта облікового запису","Отримати код","Якщо ця адреса пов’язана з обліковим записом, надійде код. Перевірте також папку «Спам».","Код із листа","Підтвердити код","Змінити адресу","Надіслати ще раз","Новий пароль","Повторіть пароль","Зберегти новий пароль","Пароль змінено. Увійдіть із новим паролем.","Назад до входу","Код неправильний або прострочений. Отримайте новий.","Паролі мають збігатися й містити щонайменше 12 символів.","Не вдалося підтвердити зміну пароля. Спробуйте увійти з новим паролем або отримайте новий код.","Спробуйте ще раз трохи пізніше."],
 en:["Forgot your password?","Reset your password","Account email","Send code","If an account uses this address, you’ll receive a code. Check your spam folder, too.","Code from the email","Verify code","Change email","Resend code","New password","Repeat password","Save new password","Password changed. Sign in with your new password.","Back to sign in","The code is invalid or has expired. Request a new one.","Passwords must match and be at least 12 characters.","We could not confirm the change. Try signing in with the new password or request another code.","Try again in a moment."],
};
export const PASSWORD_RESET_PATH="/account/reset-password";
export function passwordResetHeading(language:string,title=false){const k=language.split("-")[0] as keyof typeof copy;return (copy[k]??copy.en)[title?1:0]}
const prefix="/api/timeax/auth/public/password-reset/";
const validPass=(p:string)=>[...p].length>=12&&new TextEncoder().encode(p).length<=72&&!/[\u0000-\u001f\u007f]/.test(p);
export function PasswordResetForm(){
 const {i18n}=useTranslation(),lang=(i18n.resolvedLanguage??"en").split("-")[0] as keyof typeof copy;
 const [,,emailLabel,sendLabel,sent,codeLabel,verifyLabel,changeEmail,resend,newPassword,repeat,saveLabel,success,back,badCode,badPassword,saveError,retry]=copy[lang]??copy.en;
 const state=useLocation().state as {email?:unknown}|null;
 const [email,setEmail]=useState(()=>typeof state?.email==="string"?state.email.slice(0,254):"");
 const [stage,setStage]=useState<"email"|"code"|"password"|"done">("email"),[cool,setCool]=useState(0);
 const [code,setCode]=useState(""),[password,setPassword]=useState(""),[confirmation,setConfirmation]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const pending=useRef<AbortController|undefined>(undefined),focus=useRef<HTMLInputElement>(null);
 useEffect(()=>()=>pending.current?.abort(),[]);
 useEffect(()=>{if(stage!=="email")focus.current?.focus()},[stage]);
 useEffect(()=>{if(cool<=0)return;const id=window.setTimeout(()=>setCool(n=>n-1),1000);return()=>window.clearTimeout(id)},[cool]);
 async function request(action:string,body:object,expected:string,next:()=>void,fail:string){
  if(pending.current)return;
  const c=new AbortController();pending.current=c;setBusy(true);setError("");
  try{
   const response=await fetch(prefix+action,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",
    signal:c.signal,headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(body)});
   const result=await response.json();
   if(c.signal.aborted)return;
   if(!response.ok||result?.status!==expected){setError(response.status===429||response.status>=500?retry:fail);return}
   next();
  }catch{if(!c.signal.aborted)setError(fail)}
  finally{if(pending.current===c)pending.current=undefined;if(!c.signal.aborted)setBusy(false)}
 }
 function start(){void request("start",{email:email.trim()},"accepted",()=>{setStage("code");setCode("");setCool(60)},retry)}
 function cancel(){
  void request("cancel",{},"cancelled",()=>{setCode("");setPassword("");setConfirmation("");setStage("email")},retry);
 }
 return <div className="auth-form" aria-busy={busy}>
  {stage==="email"&&<form className="auth-form" onSubmit={e=>{e.preventDefault();start()}}>
   <label className="field-label">{emailLabel}<input type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={e=>setEmail(e.target.value)}/></label>
   <button className="button button--primary button--full" disabled={busy}>{sendLabel}</button>
  </form>}
  {stage==="code"&&<><p role="status">{sent}</p><form className="auth-form" onSubmit={e=>{e.preventDefault();
   void request("verify",{code},"email-verified",()=>{setCode("");setStage("password")},badCode);
  }}>
   <label className="field-label">{codeLabel}<input ref={focus} inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,8}" minLength={6} maxLength={8} value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,""))}/></label>
   <button className="button button--primary button--full" disabled={busy||!(code.length===6||code.length===8)}>{verifyLabel}</button>
  </form><div className="form-actions">
   <button type="button" className="button button--outline" disabled={busy||cool>0} onClick={start}>{resend}{cool>0?" ("+cool+")":""}</button>
   <button type="button" className="button button--outline" disabled={busy} onClick={cancel}>{changeEmail}</button>
  </div></>}
  {stage==="password"&&<><form className="auth-form" onSubmit={e=>{e.preventDefault();
   if(!validPass(password)||password!==confirmation){setError(badPassword);return}
   void request("complete",{password},"password-reset",()=>{setPassword("");setConfirmation("");setStage("done")},saveError);
  }}>
   <label className="field-label">{newPassword}<input ref={focus} type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
   <label className="field-label">{repeat}<input type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>
   <button className="button button--primary button--full" disabled={busy}>{saveLabel}</button>
  </form><button type="button" className="button button--outline" disabled={busy} onClick={cancel}>{changeEmail}</button></>}
  {stage==="done"&&<p role="status">{success}</p>}
  {error&&<p className="registration-error" role="alert">{error}</p>}
  <Link className={stage==="done"?"button button--primary":"text-button"} to="/login">{back}</Link>
 </div>;
}
