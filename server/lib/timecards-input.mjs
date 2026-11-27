// Reused from app zoned-time.ts and local membership-hours shiftInput; no identity/store imports.
/** Convert a local minute in an IANA zone. Reject missing or repeated local minutes
 * rather than silently guessing an occurrence at a clock change. */
export function zonedDateTime(date, time, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return new Date(NaN);
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0,16) !== `${date}T${time}`) return new Date(NaN);
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const local = (instant) => {
      const parts=formatter.formatToParts(new Date(instant));
      const part=(type)=>parts.find(p=>p.type===type)?.value;
      return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
    };
    const offsets=new Set();
    for(const hours of [-36,-12,0,12,36]) {
      const sample=wall+hours*3600000;
      offsets.add(Date.parse(`${local(sample)}:00Z`)-sample);
    }
    const matches=[...offsets].map(offset=>wall-offset).filter(instant=>local(instant)===`${date}T${time}`);
    return new Date(matches.length===1?matches[0]:NaN);
  } catch { return new Date(NaN); }
}

export function nextLocalDate(date) {
  const value=new Date(`${date}T12:00:00Z`);
  if(!Number.isFinite(value.getTime())) return '';
  value.setUTCDate(value.getUTCDate()+1);
  return value.toISOString().slice(0,10);
}

export function elapsedShiftMinutes(date,start,end,timeZone) {
  const startAt=zonedDateTime(date,start,timeZone);
  const endAt=zonedDateTime(end<=start?nextLocalDate(date):date,end,timeZone);
  return (endAt.getTime()-startAt.getTime())/60000;
}

const id=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const control=/[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069]/u;
export function shiftInput(input){
 const keys=['employmentId','localDate','startTime','endTime','breakStatus','breakMinutes','breakTreatment','comment','submissionId'];
 if(!input||Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k))
 ||!id.test(input.employmentId??'')||!id.test(input.submissionId??'')||typeof input.localDate!=='string'
 ||typeof input.startTime!=='string'||typeof input.endTime!=='string'||input.startTime===input.endTime
 ||!['taken','not-taken','not-reported'].includes(input.breakStatus)||!['paid','unpaid'].includes(input.breakTreatment)
 ||!Number.isInteger(input.breakMinutes)||input.breakMinutes<0
 ||typeof input.comment!=='string'||input.comment.length>500||control.test(input.comment)
 ||input.breakStatus!=='taken'&&input.breakMinutes!==0||input.breakStatus==='not-reported'&&input.breakTreatment!=='unpaid'
 ||input.breakStatus==='taken'&&input.breakTreatment==='unpaid'&&input.breakMinutes===0)return;
 const start=zonedDateTime(input.localDate,input.startTime,'Europe/Warsaw'),end=zonedDateTime(input.endTime<=input.startTime?nextLocalDate(input.localDate):input.localDate,input.endTime,'Europe/Warsaw');
 const grossMinutes=(end.getTime()-start.getTime())/60000;
 if(!Number.isInteger(grossMinutes)||grossMinutes<=0||grossMinutes>1440||input.breakMinutes>=grossMinutes)return;
 return {...input,startAt:start.toISOString(),endAt:end.toISOString(),grossMinutes,paidMinutes:grossMinutes-(input.breakTreatment==='unpaid'?input.breakMinutes:0)};
}
