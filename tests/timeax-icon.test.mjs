import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Timeax browser and installed app have a plain name and correctly sized branded icons',()=>{
 const html=read('hosted.html').toString();
 assert.match(html,/<title>Timeax<\/title>/);
 assert.match(html,/<meta name="apple-mobile-web-app-title" content="Timeax"\/>/);
 assert.doesNotMatch(read('src/hosted/HostedApp.tsx').toString(),/document\.title/);
 const m=JSON.parse(read('public/timeax.webmanifest'));
 assert.equal(m.name,'Timeax');assert.equal(m.short_name,'Timeax');
 assert.equal(m.id,'/');assert.equal(m.start_url,'/app');
 assert.ok(m.icons.some(x=>x.purpose==='maskable'&&x.sizes==='512x512'));
 for(const [rel,size] of [['icon',48],['apple-touch-icon',180]]){
  const path=html.match(new RegExp('<link rel="'+rel+'"[^>]+href="([^"]+)"'))?.[1];
  assert.ok(path);
  const png=read('public'+path);
  assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[size,size]);
 }
});
