export type PersonalHourlyRate={basis:'gross'|'net';cents:number};
export function parsePersonalHourlyRate(amount:string,basis:string):PersonalHourlyRate|undefined{
 const clean=amount.trim().replace(',','.');
 if(!/^\d{1,5}(?:\.\d{1,2})?$/.test(clean)||(basis!=='gross'&&basis!=='net'))return undefined;
 const [whole,fraction='']=clean.split('.');
 const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return cents>0?{basis,cents}:undefined;
}
export function personalPayCents(rate:PersonalHourlyRate,paidMinutes:number):number|undefined{
 if(!Number.isSafeInteger(paidMinutes)||paidMinutes<0||!Number.isSafeInteger(rate.cents)||rate.cents<1||rate.cents>9999999)return undefined;
 const product=rate.cents*paidMinutes;
 return Number.isSafeInteger(product)?Math.round(product/60):undefined;
}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function personalHourlyRateKey(org:string,worker:string){
 return uuid.test(org)&&uuid.test(worker)?'timeax:personal-hourly-rate:v1:'+org+':'+worker:undefined;
}
export function readPersonalHourlyRate(value:string|null):PersonalHourlyRate|undefined{
 if(!value)return;
 try{
  const saved=JSON.parse(value);
  if(saved&&(saved.basis==='gross'||saved.basis==='net')&&Number.isSafeInteger(saved.cents)&&saved.cents>0&&saved.cents<=9999999)return {basis:saved.basis,cents:saved.cents};
 }catch{}
}
