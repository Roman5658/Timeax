export type ShiftReviewState='pending'|'approved'|'rejected';
type Review={id:string;state:ShiftReviewState;submittedAt:string};
export function groupShiftReviews<T extends Review>(requests:readonly T[]){
 const byState:{[S in ShiftReviewState]:T[]}={pending:[],approved:[],rejected:[]};
 for(const item of requests)byState[item.state].push(item);
 for(const group of Object.values(byState))group.sort((a,b)=>Date.parse(b.submittedAt)-Date.parse(a.submittedAt)||a.id.localeCompare(b.id));
 return byState;
}
