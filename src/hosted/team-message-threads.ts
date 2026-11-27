type Message={id:string;kind:string;payload:Record<string,string|number>};
/** Resolve only among entries the server returned for this membership. */
export function indexMessageThreads<T extends Message>(entries:T[]){
 const messages=entries.filter(e=>e.kind==='message'),byId=new Map(messages.map(e=>[e.id,e]));
 const roots=new Map<string,string>(),groups=new Map<string,T[]>();
 for(const entry of messages){
  const path=[],seen=new Set();let current=entry;
  while(!roots.has(current.id)&&!seen.has(current.id)&&typeof current.payload.replyTo==='string'){
   const previous=byId.get(current.payload.replyTo);
   if(!previous)break;
   path.push(current.id);seen.add(current.id);current=previous;
  }
  const root=roots.get(current.id)??current.id;
  for(const id of path)roots.set(id,root);
  roots.set(entry.id,root);
  const group=groups.get(root);
  if(group)group.push(entry);else groups.set(root,[entry]);
 }
 return (entry:T)=>groups.get(roots.get(entry.id)??'')??[];
}
