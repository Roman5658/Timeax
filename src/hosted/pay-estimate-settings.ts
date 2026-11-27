export type PayEstimateSetting={workerId:string;effectiveMonth:string;basis:'gross'|'net';rateCents:number;deductions:{name:string;cents:number}[];revision:number};
const id=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const amount=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min&&x<=max;
const valid=(v:PayEstimateSetting)=>v&&id(v.workerId)&&typeof v.effectiveMonth==='string'&&/^(20\d\d|2100)-(0[1-9]|1[0-2])$/.test(v.effectiveMonth)&&
 ['gross','net'].includes(v.basis)&&amount(v.rateCents,1,1000000)&&amount(v.revision,1,999999999)&&Array.isArray(v.deductions)&&v.deductions.length<=(v.basis==='gross'?20:0)&&
 v.deductions.every(r=>r&&typeof r.name==='string'&&r.name.trim()===r.name&&[...r.name].length>=2&&[...r.name].length<=80&&amount(r.cents,1,1000000000))&&
 v.deductions.reduce((n,d)=>n+d.cents,0)<=1000000000;
async function call(org:string,signal?:AbortSignal,body?:PayEstimateSetting){
 if(!id(org))throw Error('invalid');
 const r=await fetch('/api/pay-estimates/'+org+(body?'/set':'/context'),{
  method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
  ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
 });
 if(!r.ok||r.headers.get('content-type')?.split(';')[0]!=='application/json')throw Error(r.status===409?'conflict':r.status===400?'invalid':r.status===401?'login':r.status===403?'denied':'unavailable');
 return r.json();
}
export async function loadPayEstimateSettings(org:string,signal?:AbortSignal):Promise<PayEstimateSetting[]>{
 const result=await call(org,signal) as {organizationId:string;settings:PayEstimateSetting[]};
 if(result?.organizationId!==org||!Array.isArray(result.settings)||!result.settings.every(valid))throw Error('unavailable');
 return result.settings;
}
export async function savePayEstimateSetting(org:string,setting:PayEstimateSetting,signal?:AbortSignal):Promise<PayEstimateSetting>{
 const result=await call(org,signal,setting) as PayEstimateSetting;
 if(!valid(result)||result.workerId!==setting.workerId||result.effectiveMonth!==setting.effectiveMonth||result.revision!==setting.revision+1||
  result.rateCents!==setting.rateCents||result.basis!==setting.basis||result.deductions.length!==setting.deductions.length||
  result.deductions.some((x,i)=>x.name!==setting.deductions[i].name||x.cents!==setting.deductions[i].cents))throw Error('unavailable');
 return result;
}
