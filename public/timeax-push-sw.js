// Push only. Do not intercept requests or cache private workspace content.
const cabinet=/^\/workspace\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/messages$/;
const href=v=>typeof v==='string'&&cabinet.test(v)?v:'/';
self.addEventListener('push',event=>{
 let payload;try{payload=event.data?.json()}catch{}
 const path=href(payload?.path);
 const body=typeof payload?.body==='string'&&payload.body.length<=90?payload.body:'New notification in Timeax';
 event.waitUntil(self.registration.showNotification('Timeax',{
  body,icon:'/timeax-app-192.png',tag:'timeax-notification'+path,data:{path},
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL(href(event.notification.data?.path),self.location.origin).href;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const exact=windows.find(client=>client.url===target);
  if(exact)return exact.focus();
  return self.clients.openWindow(target);
 })());
});
