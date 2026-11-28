import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validTeamMessagePayload,createTeamHandler} from '../lib/team-workflow.server.mjs';

test('message accepts legacy text and optional bounded subject and reply reference, not authority fields',()=>{
 const id='12345678-1234-4123-8123-123456789012';
 assert.ok(validTeamMessagePayload({text:'Legacy message'}));
 assert.ok(validTeamMessagePayload({text:'Canonical reply',subject:'Shift hours',replyTo:id}));
 assert.ok(validTeamMessagePayload({text:'New line\nallowed'}));
 for(const input of [null,[],{}, {subject:'No text'}, {text:'bad',subject:'\nnewline'},
  {text:'bad',subject:' '.repeat(120)}, {text:'bad',replyTo:'foreign'}, {text:'bad',replyTo:null},
  {text:'bad',senderId:id}, {text:'bad',subject:'x'.repeat(121)}, {text:'x'.repeat(2001)}])assert.equal(validTeamMessagePayload(input),false);
});

import {ISSUER} from '../lib/provider-adapters.mjs';

test('absence comments are optional, bounded, trimmed and handled on create and edit',async()=>{
 const origin='https://timeax.pl',id='12345678-1234-4123-8123-123456789012',sent=[];
 const handler=createTeamHandler({origin,resolveSession:async()=>({state:'verified',issuer:ISSUER,subject:id,emailConfirmed:true,isAnonymous:false,expiresAt:Date.now()+100000,isActive:async()=>true}),
  store:{async invoke(s,action,value){sent.push({action,value});return {id,state:'active',revision:1}}}});
 const send=(action,payload)=>handler(new Request(origin+'/api/team/'+id+'/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({operationId:id,...(action==='absence'?{siteId:id}:{id,revision:1}),payload})}));
 const dates={dateFrom:'2026-11-28',dateTo:'2026-11-29'};
 assert.equal((await send('absence',dates)).status,200);
 assert.equal((await send('absence',{...dates,comment:'  Short note\nNext line  '})).status,200);
 assert.equal((await send('update-plan',{...dates,comment:'Updated'})).status,200);
 for(const comment of ['',null,{},'x'.repeat(501),'bad\tcontrol'])assert.equal((await send('absence',{...dates,comment})).status,400);
 assert.equal((await send('absence',{...dates,comment:'valid',recipient:id})).status,400);
 assert.equal(sent.length,3);
 assert.deepEqual(sent.map(x=>x.value.payload),[dates,{...dates,comment:'Short note\nNext line'},{...dates,comment:'Updated'}]);
});
