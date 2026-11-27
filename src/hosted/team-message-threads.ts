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

type DatedMessage=Message&{createdAt:string};
/** A reply chain is listed once; unrelated notices never become chat messages. */
export function groupInboxConversations<T extends DatedMessage>(entries:T[],thread:(entry:T)=>T[]){
 const seen=new Set<string>(),groups:{id:string;messages:T[]}[]=[];
 const byDate=(a:T,b:T)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
 for(const entry of entries){
  if(entry.kind!=='message'||seen.has(entry.id))continue;
  const chain=thread(entry),messages=(chain.length?[...chain]:[entry]).sort(byDate);
  messages.forEach(v=>seen.add(v.id));
  groups.push({id:messages[0].id,messages});
 }
 return groups.sort((a,b)=>byDate(b.messages.at(-1)!,a.messages.at(-1)!));
}

export function unreadInboxMessageIds(messages:{id:string;kind:string;outgoing:boolean;read:boolean}[],acknowledged:string[]){
 const alreadyRead=new Set(acknowledged);
 return messages.filter(v=>v.kind==='message'&&!v.outgoing&&!v.read&&!alreadyRead.has(v.id)).map(v=>v.id);
}
