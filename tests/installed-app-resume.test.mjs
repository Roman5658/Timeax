import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {installedAppPath,installedLaunch,checkInstalledLaunch} from '../src/hosted/pwa-launch.ts';

const origin='https://timeax.pl';
const loc=(pathname,search='',hash='')=>({pathname,search,hash});
const manifest=JSON.parse(readFileSync(new URL('../public/timeax.webmanifest',import.meta.url),'utf8'));
const serverTime='2026-11-27T12:00:00.000Z',expiresAt='2026-11-28T00:00:00.000Z';
const cap=(verified,challenge=false)=>({login:!verified,verify:challenge,agencyRegistration:verified,logout:verified});
const granted={version:1,state:'verified',verified:true,serverTime,expiresAt,grants:[],capabilities:cap(true)};
const absent={version:1,state:'anonymous',capabilities:cap(false)};
const challenge=flow=>({version:1,state:'verification-required',emailChallengeFlow:flow,capabilities:cap(false,true)});
const transport=(value,opts={})=>async(url,init)=>{
 assert.equal(url,origin+'/v1/session/timeax-email');
 assert.equal(init.method,'GET');
 assert.equal(init.credentials,'same-origin');
 assert.equal(init.cache,'no-store');
 assert.equal(init.redirect,'error');
 assert.equal(init.body,undefined);
 const r=Response.json(value,{status:opts.status??200,headers:{'Cache-Control':opts.cache??'private, no-store'}});
 Object.defineProperty(r,'url',{value:opts.url??url});
 return r;
};
const check=(body,launch='app',opts)=>checkInstalledLaunch(origin,transport(body,opts),new AbortController().signal,launch);

test('Home Screen launch starts at /app; earlier standalone shortcuts resume from root without affecting the public website',()=>{
 assert.equal(manifest.id,'/');
 assert.equal(manifest.scope,'/');
 assert.equal(manifest.start_url,installedAppPath);
 assert.equal(manifest.display,'standalone');
 assert.equal(installedLaunch(loc('/'),origin,true),'home-icon');
 assert.equal(installedLaunch(loc('/'),origin,false),undefined);
 assert.equal(installedLaunch(loc('/app'),origin,false),'app');
 assert.equal(installedLaunch(loc('/app'),'https://www.timeax.pl',true),'app');
 for(const location of [loc('/login','?method=code'),loc('/account/reauth'),loc('/register/worker'),loc('/workspace/a'),loc('/app','?next=https://untrusted.test'),loc('/','','#section')])
  assert.equal(installedLaunch(location,origin,true),undefined);
 assert.equal(installedLaunch(loc('/app'),'https://different-host.invalid',true),undefined);
});

test('verified resume always goes through current login/workspace resolution, never a cached role or organization',async()=>{
 for(const launch of ['app','home-icon']){
  assert.deepEqual(await check({...granted,next:'https://untrusted.test',workspace:'invented'},launch),{state:'login',path:'/login'});
  assert.deepEqual(await check(challenge('login'),launch),{state:'login',path:'/login?method=code'});
  assert.deepEqual(await check(challenge('registration'),launch),{state:'landing'});
 }
 assert.deepEqual(await check(absent),{state:'login',path:'/login'});
 assert.deepEqual(await check(absent,'home-icon'),{state:'landing'});
});

test('expired, malformed, untrusted, unavailable, or aborted checks never resume a session',async()=>{
 for(const [body,opts] of [[{...granted,expiresAt:serverTime}],[{...granted,verified:false}],[granted,{status:503}],[granted,{url:'https://different-host.invalid/v1/session/timeax-email'}],[granted,{cache:'public'}]]){
  assert.deepEqual(await check(body,'app',opts),{state:'unavailable'});
 }
 const signal=AbortSignal.abort();
 assert.deepEqual(await checkInstalledLaunch(origin,()=>{throw Error('should not fetch')},signal,'app'),{state:'unavailable'});
});
