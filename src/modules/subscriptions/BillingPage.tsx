import {useEffect,useRef,useState,type FormEvent} from "react";
import {Link} from "react-router-dom";
import {ThemeToggle} from "../../components/ThemeToggle";
import "./billing.css";

interface Profile {name:string;nip:string;address:string;postcode:string;city:string;country:string;email:string;representative:string}
interface Doc {id:string;title:string;version:string;sha256:string;status:string}
interface Order {id:string;start_date:string;end_date:string;due_date:string;amount:number;received:number;due:number;settlement:string;overdue:boolean;periodState:string;snapshot:{buyer:Profile};acceptance:{acceptedAt:string;documents:Doc[]}}
interface Invoice {id:string;order_id:string;invoice_number:string;verification:string;original_invoice:string|null}
interface Context {mode:string;tenant:string;csrf:string;profile?:Profile;documents:Doc[];subscription:{trial_start:string;trial_end:string;status:string}|null;
 orders:Order[];payments:{id:string;kind:string;amount:number;received_on:string}[];invoices:Invoice[];candidates:{id:string}[];quote:{start:string;end:string;due:string;amount:number}|null;stopped:boolean}
const blank:Profile={name:"",nip:"",address:"",postcode:"",city:"",country:"PL",email:"",representative:""};
const amount=(v:number)=>new Intl.NumberFormat("pl-PL",{style:"currency",currency:"PLN"}).format(v/100);
const lastDay=(v:string)=>new Date(Date.parse(v+"T12:00:00Z")-86400000).toISOString().slice(0,10);
const errors:Record<string,string>={"invalid-nip":"Sprawdź NIP — wymagane 10 cyfr i poprawna suma kontrolna.","invalid-email":"Podaj poprawny adres e-mail.","invalid-address":"Podaj polski adres i kod w formacie 00-000.","agreement-required":"Potwierdź upoważnienie oraz warunki i projekt DPA.","documents-changed":"Dokumenty zmieniły się. Odśwież stronę i sprawdź nową wersję.","quote-changed":"Daty okresu zmieniły się. Odśwież stronę i potwierdź aktualne warunki.","explicit-paid-consent-required":"Potwierdź cenę i dokładny płatny okres.","billing-session-required":"Sesja lub uprawnienie do rozliczeń nie jest dostępne.","billing-not-enabled":"Rozliczenia nie zostały jeszcze uruchomione."};
export function BillingPage(){
 const [state,setState]=useState<Context|null>(null),[profile,setProfile]=useState<Profile>(blank),[loading,setLoading]=useState(true);
 const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const [authorized,setAuthorized]=useState(false),[terms,setTerms]=useState(false),[dpa,setDpa]=useState(false),[paid,setPaid]=useState(false);
 const [openDoc,setOpenDoc]=useState<{doc:Doc;text:string}|null>(null);
 const idempotency=useRef<{period:string;id:string}|null>(null);
 async function read(){const r=await fetch("/api/billing/context",{credentials:"same-origin",cache:"no-store",redirect:"error"});const body=await r.json();if(!r.ok)throw Error(body.error);setState(body);if(body.profile)setProfile(body.profile);return body as Context}
 useEffect(()=>{let alive=true;read().catch(e=>{if(alive)setError(errors[e.message]??"Rozliczenia są teraz niedostępne.")}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[]);
 const declarations=()=>({authorized,terms,dpa,documents:state?.documents.map(({id,version,sha256})=>({id,version,sha256}))});
 async function act(path:string,body:unknown,success:string){
  if(busy||!state)return;setBusy(true);setError("");setMessage("");
  try{
   const r=await fetch("/api/billing/"+path,{method:"POST",credentials:"same-origin",redirect:"error",headers:{"Content-Type":"application/json","X-Billing-CSRF":state.csrf},body:JSON.stringify(body)});
   const data=await r.json();if(!r.ok)throw Error(data.error);
   await read();setMessage(success);if(path==="orders"){idempotency.current=null;setPaid(false);setTerms(false);setDpa(false);setAuthorized(false)}
  }catch(e){setError(errors[(e as Error).message]??"Nie udało się potwierdzić wyniku. Odśwież stronę przed ponowną próbą.")}
  finally{setBusy(false)}
 }
 function saveProfile(e:FormEvent){e.preventDefault();void act("profile",profile,"Zapisano nową wersję danych nabywcy. Wcześniejsze zamówienia pozostają bez zmian.")}
 function placeOrder(){
  if(!state?.quote)return;const q=state.quote,period=q.start+"/"+q.end;
  if(idempotency.current?.period!==period)idempotency.current={period,id:crypto.randomUUID()};
  void act("orders",{...declarations(),start:q.start,end:q.end,amount:q.amount,currency:"PLN",renewal:"manual",paidPeriod:paid,idempotencyKey:idempotency.current.id},"Zapisano testowe zamówienie. Nie wystawiono faktury ani nie pobrano pieniędzy.");
 }
 async function showDocument(doc:Doc){
  try{const r=await fetch("/api/billing/documents/"+doc.id,{credentials:"same-origin",redirect:"error"});if(!r.ok)throw Error();setOpenDoc({doc,text:await r.text()})}
  catch{setError("Nie udało się otworzyć dokumentu. Nie potwierdzaj go bez przeczytania.")}
 }
 return <main className="billing-page" lang="pl">
  <header className="billing-header"><Link to="/" className="billing-brand">Timeax<span> / rozliczenia</span></Link><ThemeToggle expanded /></header>
  <div className="billing-heading"><p className="billing-eyebrow">KONTO AGENCJI</p><h1>Abonament i faktury</h1><p>Warunki, okresy i dokumenty Twojej agencji w jednym miejscu.</p></div>
  {loading?<p role="status">Sprawdzanie dostępu…</p>:!state?<section className="billing-card"><h2>Rozliczenia są zamknięte</h2><p>{error||"Brak potwierdzonego dostępu do rozliczeń."}</p><p>Nie można zamówić abonamentu ani wykonać płatności. Złożona rejestracja agencji nie nadaje tych uprawnień.</p><Link className="button button--secondary" to="/login">Wróć do logowania</Link></section>:<>
   <aside className="billing-notice"><strong>Zamknięta próba lokalna</strong><p>Wyłącznie fikcyjne dane. Zapisy nie zawierają umowy, nie przyznają dostępu i nie uruchamiają płatności. Dokumenty są projektami do weryfikacji.</p></aside>
   <div aria-live="polite">{message&&<p className="billing-feedback" role="status">{message}</p>}</div>
   {error&&<p className="billing-feedback billing-error" role="alert">{error}</p>}
   <div className="billing-layout">
    <section className="billing-card billing-plan"><p className="billing-eyebrow">JEDEN PLAN DLA AGENCJI</p><h2>Timeax miesięcznie</h2><p className="billing-price">59,00 PLN <span>/ miesiąc</span></p><p>Cena docelowa łącznie. Status VAT sprzedawcy wymaga potwierdzenia; to nie jest stawka VAT 0%.</p>
     <ul><li>7 dni próby bez pobrania pieniędzy</li><li>Każdy płatny miesiąc potwierdzasz osobno</li><li>Brak automatycznego odnowienia i podwyżek</li></ul>
     <p><strong>Przelew bankowy:</strong> ręczna weryfikacja wpływu, płatności rzeczywiste wyłączone.</p><p><strong>PayPal:</strong> subskrypcja niepodłączona.</p>
     {state.subscription&&<div className="billing-period" data-testid="trial-period"><strong>{state.subscription.status==="trial-record"?"Zapis próbny":"Próba zakończona"}</strong><p>{state.subscription.trial_start} – {lastDay(state.subscription.trial_end)}</p><small>Bez opłaty i bez automatycznego zamówienia.</small></div>}
    </section>
    <section className="billing-card"><h2>Dane do rozliczeń</h2><p>Podaj dane nabywcy i osoby upoważnionej. NIP nie potwierdza samodzielnie prawa do reprezentacji.</p>
     <form onSubmit={saveProfile} className="billing-form">
      {([["name","Nazwa prawna agencji"],["nip","NIP"],["address","Ulica i numer"],["postcode","Kod pocztowy"],["city","Miejscowość"],["email","E-mail rozliczeniowy"],["representative","Upoważniony przedstawiciel"]] as [keyof Profile,string][]).map(([key,label])=><label key={key} htmlFor={"billing-"+key}>{label}<input id={"billing-"+key} name={key} value={profile[key]} type={key==="email"?"email":"text"} required maxLength={key==="nip"?20:key==="email"?254:200} onChange={e=>setProfile({...profile,[key]:e.target.value})} /></label>)}
      <p className="billing-muted">Kraj: Polska. Dane pracowników nie należą do rozliczeń abonamentu.</p><button className="button button--secondary" disabled={busy}>Zapisz dane nabywcy</button>
     </form>
    </section>
   </div>
   <section className="billing-card" id="billing-documents"><h2>Dokumenty przed potwierdzeniem</h2><p>Otwórz i zapisz projekty. Potwierdzenie warunków nie jest zgodą na przetwarzanie wszystkich danych.</p>
    <div className="billing-doc-list">{state.documents.map(doc=><article key={doc.id}><div><strong>{doc.title}</strong><small>Projekt • {doc.version}</small></div><div className="billing-actions"><button type="button" className="button button--secondary" onClick={()=>void showDocument(doc)}>Otwórz <span className="sr-only">{doc.title}</span></button><a className="button button--secondary" href={"/api/billing/documents/"+doc.id+"?download=1"} download>Zapisz <span className="sr-only">{doc.title}</span></a></div></article>)}</div>
    {openDoc&&<section className="billing-document" aria-label={openDoc.doc.title}><div className="billing-actions"><h3>{openDoc.doc.title}</h3><button className="button button--secondary" onClick={()=>setOpenDoc(null)}>Zamknij dokument</button></div><pre>{openDoc.text}</pre><small>SHA-256: {openDoc.doc.sha256}</small></section>}
    <fieldset className="billing-consent" disabled={busy}><legend>Potwierdzenia do zapisu testowego</legend>
     <label><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)} />Działam jako upoważniony przedstawiciel tej fikcyjnej agencji.</label>
     <label><input type="checkbox" checked={terms} onChange={e=>setTerms(e.target.checked)} />Sprawdziłem Regulamin oraz warunki abonamentu w podanej wersji.</label>
     <label><input type="checkbox" checked={dpa} onChange={e=>setDpa(e.target.checked)} />Sprawdziłem osobny projekt DPA. To nie jest zgoda marketingowa.</label>
    </fieldset>
    {!state.subscription?<button className="button button--primary" disabled={busy||!state.profile||!authorized||!terms||!dpa} onClick={()=>void act("trial",declarations(),"Zapisano 7 dni próby. Nie utworzono opłaty ani dostępu.")}>Zapisz 7 dni próby — bez opłaty</button>:state.quote&&<div className="billing-order-confirm">
     <h3>Osobne zamówienie następnego miesiąca</h3><p><strong>{state.quote.start} – {lastDay(state.quote.end)}</strong> · {amount(state.quote.amount)} łącznie</p><p>Planowany termin płatności: {state.quote.due}. Ten zapis testowy nie tworzy prawdziwego zobowiązania.</p>
     <label className="billing-checkbox"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)} />Wyraźnie potwierdzam pokazane 59,00 PLN i daty wyłącznie tego okresu w próbie lokalnej.</label>
     <button className="button button--primary" disabled={busy||!authorized||!terms||!dpa||!paid} onClick={placeOrder}>Zapisz testowe zamówienie — 59,00 PLN</button>
    </div>}
   </section>
   <section className="billing-card"><h2>Zamówienia i rozliczenia</h2>{!state.orders.length?<p>Brak zamówień. Sam okres próbny nie tworzy długu.</p>:<div className="billing-orders">{state.orders.map(o=><article key={o.id} data-testid="billing-order">
    <div className="billing-actions"><h3>{o.start_date} – {lastDay(o.end_date)}</h3><strong>{amount(o.amount)}</strong></div>
    <p>{o.snapshot.buyer.name} · NIP {o.snapshot.buyer.nip}</p><p>{o.snapshot.buyer.address}, {o.snapshot.buyer.postcode} {o.snapshot.buyer.city}</p>
    <p><strong>{({unpaid:"Brak potwierdzonej wpłaty",settled:"Wpływ rozliczony — zapis testowy",partial:"Niedopłata — wymaga weryfikacji","overpaid-review":"Nadpłata — wymaga weryfikacji"} as Record<string,string>)[o.settlement]}</strong></p>
    <p>Wpływy netto: {amount(o.received)} · Należność testowa: {amount(o.due)} · Termin: {o.due_date}{o.overdue?" · Termin minął":""}</p>
    <small>Potwierdzono: {o.acceptance.acceptedAt}. Archiwum zawiera dokładne wersje dokumentów i rekwi­zytów.</small>
    <details><summary>Przyjęte dokumenty tego zamówienia</summary><p>Wersje można zachować przez eksport rozliczeń poniżej.</p>{o.acceptance.documents.map(d=><p className="billing-digest" key={d.id}>{d.title} · {d.version}<br />{d.sha256}</p>)}</details>
    <button className="button button--secondary" disabled={busy} onClick={()=>void act("transfer-notice",{orderId:o.id},"Zapisano zgłoszenie. To nie potwierdza wpływu ani nie zmienia statusu opłaty.")}>Zgłoś przelew do weryfikacji</button>
   </article>)}</div>}</section>
   <section className="billing-card"><h2>Faktury i korekty</h2><p>Rzeczywista faktura musi pochodzić z oficjalnego systemu właściciela i przejść weryfikację. PDF nie zastępuje faktury KSeF. Timeax nie wysyła dokumentów do KSeF.</p>
    {state.candidates.length>0&&<p role="status">Dokumenty oczekujące na weryfikację: {state.candidates.length}. Nie są oznaczone jako wystawione faktury.</p>}
    {!state.invoices.length?<p>Brak zweryfikowanych faktur.</p>:state.invoices.map(i=><article className="billing-invoice" key={i.id}><strong>{i.original_invoice?"Korekta testowa":"Dokument testowy"} — NIE JEST FAKTURĄ</strong><p>{i.invoice_number}</p><a className="button button--secondary" href={"/api/billing/invoices/"+i.id+"/download"} download>Pobierz oznaczony plik testowy</a></article>)}
   </section>
   <section className="billing-card"><h2>Archiwum i zakończenie</h2><p>Nie ma automatycznego przedłużenia. Zakończenie nie usuwa zamówień, dokumentów ani historii rozliczeń.</p><div className="billing-actions"><a className="button button--secondary" href="/api/billing/export" download>Zapisz archiwum rozliczeń</a><button className="button button--secondary" disabled={busy} onClick={()=>void act("stop",{},"Zapisano rezygnację z dalszego korzystania. Nie utworzono nowego zamówienia; historia pozostaje dostępna.")}>Zapisz rezygnację</button></div>{state.stopped&&<p>Rezygnacja została odnotowana.</p>}</section>
  </>}
 </main>;
}
