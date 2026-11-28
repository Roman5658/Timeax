const keyPrefix='timeax.nfc.practice.v1:';
const lifetime=60*60*1000;
const id=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export function workerScopes(value){
 if(value?.state!=='verified'||!Array.isArray(value.memberships))return [];
 const seen=new Set();
 return value.memberships.flatMap(m=>{
  if(m?.role!=='worker'||typeof m.membershipId!=='string'||!id.test(m.membershipId)||seen.has(m.membershipId)||
     typeof m.name!=='string'||!m.name.trim()||m.name.length>150)return [];
  seen.add(m.membershipId);return [{id:m.membershipId,name:m.name}];
 });
}
export function openPractice(storage,scope,now=Date.now()){
 const key=keyPrefix+scope;
 if(!id.test(scope))throw Error('Invalid practice scope');
 const read=()=>storage.getItem(key);
 const raw=read();
 let v;try{v=JSON.parse(raw??'null')}catch{}
 const valid=Number.isSafeInteger(v?.start)&&v.start<=now&&v.start>now-lifetime;
 const start=valid?v.start:null;
 const end=valid&&Number.isSafeInteger(v.end)&&v.end>=start&&v.end<=now?v.end:null;
 let used=false;
 return {action:start!==null&&end===null?'end':'start',start: end===null?start:null,end,
  record(at=Date.now()){
   if(used||at<now||at>now+2*60*1000||read()!==raw)return null;
   used=true;
   const result=start!==null&&end===null?{start,end:at}:{start:at};
   storage.setItem(key,JSON.stringify(result));
   return result;
  }};
}
async function account(){
 const r=await fetch('/api/worker-enrollment/context',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}});
 if(r.status===401)return {status:'login'};
 if(!r.ok||r.headers.get('content-type')?.split(';')[0]!=='application/json')return {status:'error'};
 return {status:'ok',scopes:workerScopes(await r.json())};
}
function setup(){
 const $=id=>document.getElementById('practice-'+id);
 const status=$('status'),login=$('login'),wrapper=$('scope'),picker=$('worker'),times=$('times'),action=$('action'),repeat=$('repeat');
 const clock=value=>new Intl.DateTimeFormat('pl-PL',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/Warsaw'}).format(value);
 let scopes=[],offer,offerTimer;
 const unavailable=()=>{action.hidden=true;picker.disabled=true;repeat.hidden=false;status.textContent='Nie można dokończyć próby. Otwórz link ponownie w tej samej przeglądarce.'};
 function choose(){
  const current=scopes.find(s=>s.id===picker.value);if(!current)return;
  clearTimeout(offerTimer);
  try{offer=openPractice(localStorage,current.id)}catch{unavailable();return;}
  action.textContent=offer.action==='start'?'Rozpocznij próbę zmiany':'Zakończ próbę zmiany';
  times.textContent=offer.action==='end'?'Godzina rozpoczęcia próby: '+clock(offer.start)+'.':'';
  status.textContent='Konto pracownika potwierdzone. Możesz zarejestrować jedną czynność próbną.';
  action.hidden=false;
  offerTimer=setTimeout(()=>{action.hidden=true;repeat.hidden=false;status.textContent='Czas na potwierdzenie minął. Otwórz link ponownie.'},120000);
 }
 action.addEventListener('click',async()=>{
  const scope=picker.value, pending=offer;if(action.hidden||action.disabled||!pending)return;
  action.disabled=true;picker.disabled=true;clearTimeout(offerTimer);
  try{
   const current=await account();
   if(current.status==='login'){login.hidden=false;wrapper.hidden=true;status.textContent='Sesja wygasła. Zaloguj się w Timeax, a potem otwórz link ponownie.';return;}
   if(current.status!=='ok'||!current.scopes.some(s=>s.id===scope)){unavailable();return;}
   const receipt=pending.record();if(!receipt){unavailable();return;}
   action.hidden=true;repeat.hidden=false;
   times.textContent='Początek: '+clock(receipt.start)+(receipt.end===undefined?'.':'; koniec: '+clock(receipt.end)+'.');
   status.textContent=receipt.end===undefined?'Próbny start zapisany. Otwórz link ponownie, aby zasymulować drugie przyłożenie karty.':'Próba zakończona. Nic nie trafiło do ewidencji czasu pracy.';
  }catch{unavailable();}
 });
 picker.addEventListener('change',choose);
 window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
 void account().then(res=>{
  if(res.status==='login'){login.hidden=false;status.textContent='Zaloguj się jako pracownik, a następnie otwórz ten link ponownie w tej samej przeglądarce.';return;}
  if(res.status!=='ok'){unavailable();return;}
  scopes=res.scopes;if(!scopes.length){status.textContent='Na tym koncie nie znaleziono aktywnego obszaru pracownika.';return;}
  for(const s of scopes){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;picker.append(o);}
  wrapper.hidden=false;choose();
 }).catch(unavailable);
}
if(typeof document!=='undefined')setup();
