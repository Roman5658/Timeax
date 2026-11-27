import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validTeamMessagePayload} from '../lib/team-workflow.server.mjs';

test('message accepts legacy text and optional bounded subject and reply reference, not authority fields',()=>{
 const id='12345678-1234-4123-8123-123456789012';
 assert.ok(validTeamMessagePayload({text:'Legacy message'}));
 assert.ok(validTeamMessagePayload({text:'Canonical reply',subject:'Shift hours',replyTo:id}));
 assert.ok(validTeamMessagePayload({text:'New line\nallowed'}));
 for(const input of [null,[],{}, {subject:'No text'}, {text:'bad',subject:'\nnewline'},
  {text:'bad',subject:' '.repeat(120)}, {text:'bad',replyTo:'foreign'}, {text:'bad',replyTo:null},
  {text:'bad',senderId:id}, {text:'bad',subject:'x'.repeat(121)}, {text:'x'.repeat(2001)}])assert.equal(validTeamMessagePayload(input),false);
});
