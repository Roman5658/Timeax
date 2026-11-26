/** Convert a local minute in an IANA zone. Reject missing or repeated local minutes
 * rather than silently guessing an occurrence at a clock change. */
export function zonedDateTime(date: string, time: string, timeZone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return new Date(NaN);
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0,16) !== `${date}T${time}`) return new Date(NaN);
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const local = (instant: number) => {
      const parts=formatter.formatToParts(new Date(instant));
      const part=(type: string)=>parts.find(p=>p.type===type)?.value;
      return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
    };
    const offsets=new Set<number>();
    for(const hours of [-36,-12,0,12,36]) {
      const sample=wall+hours*3600000;
      offsets.add(Date.parse(`${local(sample)}:00Z`)-sample);
    }
    const matches=[...offsets].map(offset=>wall-offset).filter(instant=>local(instant)===`${date}T${time}`);
    return new Date(matches.length===1?matches[0]:NaN);
  } catch { return new Date(NaN); }
}

export function nextLocalDate(date: string): string {
  const value=new Date(`${date}T12:00:00Z`);
  if(!Number.isFinite(value.getTime())) return '';
  value.setUTCDate(value.getUTCDate()+1);
  return value.toISOString().slice(0,10);
}

export function elapsedShiftMinutes(date: string,start: string,end: string,timeZone: string): number {
  const startAt=zonedDateTime(date,start,timeZone);
  const endAt=zonedDateTime(end<=start?nextLocalDate(date):date,end,timeZone);
  return (endAt.getTime()-startAt.getTime())/60000;
}
