import test from 'node:test';
import assert from 'node:assert/strict';
import {hasCurrentWorkerWorkspace,shouldOfferAgencyJoin,workerWorkspaceHint,workerWorkspaceReturn} from '../src/hosted/worker-account-navigation.ts';

const org=n=>'51000000-0000-4000-8000-'+String(n).padStart(12,'0');
const destination=n=>'/workspace/'+org(n);
const active=n=>({organizationId:org(n),state:'active'});
const closed=n=>({organizationId:org(n),state:'ended'});

test('profile return hint is only a local cabinet root, not navigation history or an arbitrary URL',()=>{
 assert.equal(workerWorkspaceReturn(destination(1)),destination(1));
 for(const invalid of [destination(1)+'\n',destination(1)+'?some=filter',destination(1)+'/hours','/register','//example.test','https://timeax.pl'+destination(1),
   '/workspace/00000000-0000-0000-0000-000000000000',{path:destination(1)}])
  assert.equal(workerWorkspaceHint(invalid),undefined);
});
test('profile retains the correct cabinet for multiple workers without overriding known ended membership',()=>{
 assert.equal(workerWorkspaceReturn(destination(2),[active(1),active(2)]),destination(2));
 assert.equal(workerWorkspaceReturn(undefined,[active(1),active(2)]),undefined);
 assert.equal(workerWorkspaceReturn(undefined,[active(1),active(1)]),destination(1));
 assert.equal(workerWorkspaceReturn(destination(2),[active(1),closed(2)]),destination(1));
 assert.equal(workerWorkspaceReturn(destination(2),[closed(2)]),undefined);
});

test('only verified absence of an active agency worker membership unlocks Join agency',()=>{
 const agency={organizationId:org(1),membershipId:org(10),kind:'agency',role:'worker'};
 const factory={organizationId:org(2),membershipId:org(20),kind:'factory',role:'worker'};
 assert.equal(shouldOfferAgencyJoin(undefined),false);
 assert.equal(shouldOfferAgencyJoin([]),true);
 assert.equal(shouldOfferAgencyJoin([factory]),true);
 assert.equal(shouldOfferAgencyJoin([factory,agency]),false);
 assert.equal(hasCurrentWorkerWorkspace([factory,agency],agency.organizationId,agency.membershipId),true);
 assert.equal(hasCurrentWorkerWorkspace([factory,agency],agency.organizationId,factory.membershipId),false);
 assert.equal(hasCurrentWorkerWorkspace([factory],agency.organizationId,agency.membershipId),false);
});
