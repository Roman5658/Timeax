export type WorkerLabel={name:string|null;reference:string|null;revision:number|null;source:string};
export function workerLabelText(label:WorkerLabel|undefined,missing:string,referenceWord:string):string{
 const name=typeof label?.name==='string'&&label.name.trim().length>=2?label.name.trim():missing;
 const ref=typeof label?.reference==='string'&&/^[1-9][0-9]*$/.test(label.reference)?' · '+referenceWord+' '+label.reference:'';
 return name+ref;
}
