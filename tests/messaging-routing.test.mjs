import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeedWorkspace} from '../src/modules/workflows/demo-data.ts';
async function isolated(name,run,fixtures=true){
 const saved=new Map([['timeax-demo-workspace-v1',JSON.stringify(createSeedWorkspace({includeFeatureFixtures:fixtures}))]]);
 globalThis.window={localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},addEventListener(){},removeEventListener(){}};
 try{await run(await import(`../src/modules/workflows/demo-store.ts?messages-${name}`),()=>JSON.parse(saved.get('timeax-demo-workspace-v1')));}finally{delete globalThis.window;}
}
test('worker direct leader conversation has one recipient, no agency or other team visibility, and scoped replies',()=>isolated('direct',(s,state)=>{
 s.setActiveMember('worker-01');
 assert.equal(s.createWorkerMessage('leader','Private QA','Only assigned leader','factory-alpha'),true);
 const thread=state().messageThreads.find(x=>x.subject==='Private QA');
 assert.deepEqual(thread.participants,['worker-01','leader-01']);
 assert.deepEqual(state().notifications.filter(n=>n.subjectId===thread.id).map(n=>n.recipientId),['leader-01']);
 for(const id of ['leader-02','agency-demo','agency-partner','worker-02']){
  s.setActiveMember(id);assert.equal(s.getVisibleMessageThreads().some(t=>t.id===thread.id),false);assert.equal(s.replyToMessage(thread.id,'intrusion'),false);
 }
 s.setActiveMember('leader-01');assert.equal(s.getVisibleMessageThreads().some(t=>t.id===thread.id),true);assert.equal(s.replyToMessage(thread.id,'Reply'),true);
 assert.deepEqual(state().notifications.filter(n=>n.subjectId===thread.id).map(n=>n.recipientId).sort(),['leader-01','worker-01']);
 s.setActiveMember('worker-01');assert.equal(s.createWorkerMessage('leader','Wrong team','No','factory-beta'),false);
 assert.equal(s.createWorkerMessage('production','No connected factory','Do not silently send to leader','factory-alpha'),false);
}));
test('same-production second leader cannot see a private worker conversation in any shared visibility selector',()=>isolated('same-site',(s,state)=>{
 s.setActiveMember('agency-demo');const other=s.createProductionLeader('factory-alpha','Other leader',false,'other-leader@example.test');assert.ok(other);
 s.setActiveMember('worker-01');assert.equal(s.createWorkerMessage('leader','Secret','Private','factory-alpha'),true);
 const thread=state().messageThreads.find(t=>t.subject==='Secret');s.setActiveMember(other.id);
 assert.equal(s.getVisibleMessageThreads().some(t=>t.id===thread.id),false);assert.equal(s.replyToMessage(thread.id,'No'),false);
}));
test('worker to connected factory reaches factory admin only, supports reply across agency scope, and isolates other agency',()=>isolated('factory',(s,state)=>{
 s.setActiveMember('agency-demo');
 const invite=s.startAgencyWorksiteAccess({companyName:'QA Factory',nip:'9876543210',email:'factory@example.test',city:'QA City',worksiteName:'QA Site',address:'QA City Test 1',productionName:'QA Production'});
 assert.equal(invite.kind,'invitation');const admin=s.registerFactoryFromInvitation(invite.invitation.token,{name:'QA Admin',email:'admin@example.test'});assert.ok(admin);
 s.setActiveMember(admin.id);const request=state().worksiteConnectionRequests.find(x=>x.invitationId===invite.invitation.id);assert.equal(s.resolveWorksiteConnectionRequest(request.id,'approve'),true);
 const factory=state().factories.find(x=>x.organizationId==='org-demo-01');
 s.setActiveMember('agency-demo');const worker=s.createAgencyWorker('QA Worker');assert.ok(worker);
 const now=new Date();const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 assert.equal(s.hireWorker(worker.id,factory.id,undefined,date),true);
 s.setActiveMember(worker.id);assert.equal(s.createWorkerMessage('production','Factory QA','Only factory admin',factory.id),true);
 const thread=state().messageThreads.find(x=>x.subject==='Factory QA');assert.deepEqual(thread.participants,[worker.id,admin.id]);
 assert.deepEqual(state().notifications.filter(x=>x.subjectId===thread.id).map(x=>[x.recipientId,x.organizationId]),[[admin.id,admin.organizationId]]);
 s.setActiveMember(admin.id);assert.equal(s.getVisibleMessageThreads().some(t=>t.id===thread.id),true);assert.equal(s.replyToMessage(thread.id,'Factory reply'),true);
 s.setActiveMember('agency-demo-b');assert.equal(s.getVisibleMessageThreads().some(t=>t.id===thread.id),false);assert.equal(s.replyToMessage(thread.id,'intrusion'),false);
 s.setActiveMember(worker.id);assert.equal(s.getVisibleMessageThreads().find(t=>t.id===thread.id).messages.length,2);
},false));
