const providerURL = 'https://api.resend.com/emails';
const loginURL = 'https://timeax.pl/login?method=code';
const senderPattern = /^[a-z0-9][a-z0-9._-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*timeax\.pl$/i;
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const messages = Object.freeze({
 pl: ['Zaproszenie do Timeax', 'Zaproszono Cię do Timeax. Otwórz poniższą stronę i zaloguj się lub utwórz konto przy użyciu adresu e-mail, na który przyszło to zaproszenie.', 'Jeśli nie spodziewasz się tego zaproszenia, możesz zignorować tę wiadomość.'],
 uk: ['Запрошення до Timeax', 'Вас запросили до Timeax. Відкрийте сторінку нижче й увійдіть або створіть обліковий запис за електронною адресою, на яку надійшло запрошення.', 'Якщо ви не очікували запрошення, можете проігнорувати цей лист.'],
 ru: ['Приглашение в Timeax', 'Вас пригласили в Timeax. Откройте страницу ниже и войдите или создайте аккаунт с адресом электронной почты, на который пришло приглашение.', 'Если вы не ожидали приглашения, можете проигнорировать это письмо.'],
 en: ['Invitation to Timeax', 'You have been invited to Timeax. Open the page below and sign in or create an account using the email address that received this invitation.', 'If you were not expecting this invitation, you can ignore this message.'],
});
const submitted = Object.freeze({status:'submitted'});
const retry = Object.freeze({status:'retry'});
const rejected = Object.freeze({status:'rejected'});

// The database/caller must supply an authorized recipient from the saved card,
// not a browser-provided address, and durably prevent duplicate submission.
// Resend idempotency is only 24 hours. Enable only with a verified sender and
// both link and open tracking disabled in the domain configuration.
export function createWorkerInvitationMailer({env = process.env, fetchImpl = globalThis.fetch} = {}) {
 const key = env.TIMEAX_WORKER_INVITE_RESEND_API_KEY;
 const from = env.TIMEAX_WORKER_INVITE_MAIL_FROM;
 if (env.TIMEAX_WORKER_INVITE_MAIL_ENABLED !== '1' ||
     typeof key !== 'string' || !/^re_[A-Za-z0-9_-]{12,190}$/.test(key) ||
     typeof from !== 'string' || from.length > 254 || !senderPattern.test(from) ||
     typeof fetchImpl !== 'function') return null;

 return Object.freeze({
  async send(input) {
   if (!input || typeof input !== 'object') return rejected;
   const {email,deliveryId,language} = input;
   if (typeof email !== 'string' || email.length > 254 || !emailPattern.test(email) ||
       typeof deliveryId !== 'string' || !uuidPattern.test(deliveryId)) return rejected;
   const [subject, intro, unexpected] = typeof language==='string' && Object.hasOwn(messages,language) ? messages[language] : messages.pl;
   try {
    const response = await fetchImpl(providerURL, {
     method:'POST',
     headers:{authorization:'Bearer '+key,'content-type':'application/json',accept:'application/json',
      'idempotency-key':'timeax/worker-invitation/'+deliveryId.toLowerCase()},
     body:JSON.stringify({from:'Timeax <'+from+'>',to:[email],subject,text:intro+'\n\n'+loginURL+'\n\n'+unexpected}),
     redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(4500),
    });
    // Don't read or surface provider IDs, payloads or addresses. Success means
    // provider acceptance of the send request, not delivery into the mailbox.
    void response.body?.cancel().catch(()=>{});
    if (response.ok) return submitted;
    if (response.status===408 || response.status===409 || response.status===429 || response.status>=500) return retry;
    return rejected;
   } catch {
    return retry;
   }
  },
 });
}
