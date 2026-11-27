import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
test('installed Timeax has app icons; the worker displays push without a tab and opens only an inbox',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/timeax.webmanifest',import.meta.url),'utf8'));
 assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons){
  const bytes=await readFile(new URL('../public'+icon.src,import.meta.url)),[w,h]=icon.sizes.split('x').map(Number);
  assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[w,h]);
 }
 const events={},shown=[],opened=[];
 const self={location:{origin:'https://timeax.pl'},addEventListener:(k,v)=>{events[k]=v},
  registration:{async showNotification(title,options){shown.push({title,options})}},
  clients:{async matchAll(){return []},async openWindow(url){opened.push(url)}}};
 runInNewContext(await readFile(new URL('../public/timeax-push-sw.js',import.meta.url),'utf8'),{self,URL});
 assert.deepEqual(Object.keys(events),['push','notificationclick']);
 const path='/workspace/12345678-1234-4123-8123-000000000001/messages';
 let pending,closed=false;
 events.push({data:{json:()=>({body:'New notification in Timeax',path})},waitUntil:p=>{pending=p}});
 await pending;assert.equal(shown[0].title,'Timeax');assert.equal(shown[0].options.data.path,path);
 for(const value of [path,'https://example.com/workspace','//elsewhere.com','/workspace/%2fexample']){
  events.notificationclick({notification:{data:{path:value},close:()=>{closed=true}},waitUntil:p=>{pending=p}});
  await pending;
 }
 assert.equal(closed,true);assert.deepEqual(opened,['https://timeax.pl'+path,'https://timeax.pl/','https://timeax.pl/','https://timeax.pl/']);
});
