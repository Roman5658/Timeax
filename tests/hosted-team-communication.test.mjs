import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanTeamDay,eligibleTeamRecipients} from '../src/hosted/team-communication.ts';

const id=n=>'12345678-1234-4123-8123-'+String(n).padStart(12,'0');
const org=id(1),other=id(2),site=id(3),site2=id(4),own=id(5),foreign=id(6),leader=id(7),admin=id(8);
const recipients=[
 {id:own,role:'worker',organizationId:org,worksiteIds:[site]},
 {id:foreign,role:'worker',organizationId:other,worksiteIds:[site]},
 {id:leader,role:'team_leader',organizationId:other,worksiteIds:[]},
 {id:admin,role:'agency_admin',organizationId:org,worksiteIds:[]}
];
const context=(role,sites)=>({role,organizationId:org,sites:sites.map(id=>({id})),recipients});
test('worker recipient options are scoped to own agency and an evidenced leader at an assigned site',()=>{
 const worker=context('worker',[site]);
 assert.deepEqual(eligibleTeamRecipients(worker,'agency','').map(r=>r.id),[admin]);
 assert.deepEqual(eligibleTeamRecipients(worker,'leader',site).map(r=>r.id),[leader]);
 assert.deepEqual(eligibleTeamRecipients(worker,'leader',site2),[]);
 assert.deepEqual(eligibleTeamRecipients(context('worker',[site,site2]),'leader',site),[]);
 assert.deepEqual(eligibleTeamRecipients(worker,'workers',''),[]);
});
test('agency list and production group do not include workers from another agency',()=>{
 const agency=context('agency_admin',[site,site2]);
 assert.deepEqual(eligibleTeamRecipients(agency,'workers','').map(r=>r.id),[own]);
 assert.deepEqual(eligibleTeamRecipients(agency,'production',site).map(r=>r.id),[own]);
 assert.deepEqual(eligibleTeamRecipients(agency,'production',site2),[]);
 assert.deepEqual(eligibleTeamRecipients(agency,'production','bad'),[]);
});
test('selected absence date must be exact, real and passed without offset',()=>{
 assert.equal(cleanTeamDay('2026-11-27'),'2026-11-27');
 assert.equal(cleanTeamDay('2024-02-29'),'2024-02-29');
 for(const value of [null,'2026-02-29','2026-11-32','2026-11-27T09:00:00Z','2026-4-10','blah'])assert.equal(cleanTeamDay(value),'');
});

test('thread grouping resolves only locally authorized entries',async()=>{
 const {indexMessageThreads}=await import('../src/hosted/team-message-threads.ts');
 const root={id:own,kind:'message',payload:{text:'root'}},reply={id:other,kind:'message',payload:{text:'reply',replyTo:own}},
 second={id:leader,kind:'message',payload:{text:'nested',replyTo:other}},
 disconnected={id:admin,kind:'message',payload:{text:'unresolved',replyTo:foreign}};
 const threads=indexMessageThreads([second,reply,root,disconnected]);
 assert.deepEqual(threads(root).map(x=>x.id),[leader,other,own]);
 assert.deepEqual(threads(disconnected),[disconnected]);
});
