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

test('factory recipients are capability-gated and clean composition selects only directly employed workers at its owned site',()=>{
 const adminCtx={...context('factory_admin',[site]),factoryChat:true};
 assert.deepEqual(eligibleTeamRecipients(adminCtx,'workers',site).map(r=>r.id),[own]);
 assert.deepEqual(eligibleTeamRecipients(adminCtx,'workers',site2),[]);
 assert.deepEqual(eligibleTeamRecipients({...adminCtx,factoryChat:false},'workers',site),[]);
 const workerCtx={...context('worker',[site,site2]),factoryChat:true,recipients:[{id:admin,role:'factory_admin',organizationId:other,worksiteIds:[site]}]};
 assert.deepEqual(eligibleTeamRecipients(workerCtx,'factory',site).map(r=>r.id),[admin]);
 assert.deepEqual(eligibleTeamRecipients(workerCtx,'factory',site2),[]);
 assert.deepEqual(eligibleTeamRecipients({...workerCtx,factoryChat:false},'factory',site),[]);
});

test('inbox shows a reply chain once, newest conversations first, and only reads unacknowledged incoming messages',async()=>{
 const {groupInboxConversations,indexMessageThreads,unreadInboxMessageIds}=await import('../src/hosted/team-message-threads.ts');
 const entry=(id,day,outgoing=false,read=false,replyTo)=>({id,kind:'message',createdAt:`2026-11-${day}T12:00:00Z`,outgoing,read,payload:{text:id,...(replyTo?{replyTo}:{})}});
 const first=entry('first',21,false,true),sent=entry('sent',22,true,false,'first'),
  incoming=entry('incoming',25,false,false,'sent'),ack=entry('ack',26,false,false,'incoming'),
  other=entry('other',24),notice={...entry('notice',27),kind:'absence'};
 const input=[notice,ack,incoming,other,sent,first];
 const groups=groupInboxConversations(input,indexMessageThreads(input));
 assert.deepEqual(groups.map(g=>g.id),['first','other']);
 assert.deepEqual(groups[0].messages.map(v=>v.id),['first','sent','incoming','ack']);
 assert.deepEqual(unreadInboxMessageIds(groups[0].messages,['ack']),['incoming']);
 assert.deepEqual(unreadInboxMessageIds([notice,sent,first],[]),[]);
});

test('bell previews prioritize unread events and accept only known exact anchor types',async()=>{
 const {bellTarget,latestBellPreviews,previewText}=await import('../src/hosted/notification-navigation.ts');
 const dates='2026-11-',base={title:'Notification',summary:'Summary'};
 const sample=(type,uuid,day,unread)=>({...base,anchor:type+'-'+uuid,at:dates+day+'T12:00:00Z',unread});
 const entries=[sample('team-message',own,27,false),sample('agency-join',other,26,true),sample('backdated-factory',admin,25,true),sample('team-notice',leader,24,false),sample('wrong',foreign,27,true)];
 assert.deepEqual(latestBellPreviews(entries,3).map(e=>e.anchor),entries.slice(1,3).map(e=>e.anchor).concat(entries[0].anchor));
 assert.equal(bellTarget('#'+entries[1].anchor),entries[1].anchor);
 assert.equal(bellTarget('#'+entries[1].anchor+'%20'),undefined);
 assert.equal(previewText(' First  paragraph\n Next ').length,'First paragraph Next'.length);
 assert.equal(previewText('a'.repeat(240)).length,130);
});
