import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveFactoryClaim} from '../src/hosted/factory-claim.ts';
const org='11111111-1111-1111-1111-111111111111', other='22222222-2222-2222-2222-222222222222';
const membershipId='33333333-3333-3333-3333-333333333333', worksiteId='44444444-4444-4444-4444-444444444444';
const reply={membershipId,worksiteId};
const fixture=(role='team_leader',sitePatch={},memberPatch={})=>({
 memberships:[{id:membershipId,organizationId:org,kind:'factory',role,...memberPatch}],
 worksites:[{id:worksiteId,organizationId:org,ownerId:org,ownerKind:'factory',role,...sitePatch}],
});
test('leader claim uses verified membership and matching factory site to route',()=>{
 assert.equal(resolveFactoryClaim(reply,fixture(),'team_leader'),'/workspace/'+org);
 assert.equal(resolveFactoryClaim({...reply,organizationId:other},fixture(),'team_leader'),null);
 assert.equal(resolveFactoryClaim(reply,fixture('team_leader',{ownerId:other}),'team_leader'),null);
 assert.equal(resolveFactoryClaim(reply,fixture('team_leader',{role:'worker'}),'team_leader'),null);
 assert.equal(resolveFactoryClaim(reply,fixture('team_leader',{}, {kind:'agency'}),'team_leader'),null);
 assert.equal(resolveFactoryClaim({...reply,worksiteId:other},fixture(),'team_leader'),null);
 assert.equal(resolveFactoryClaim(reply,{memberships:fixture().memberships,worksites:[]},'team_leader'),null);
});
test('factory worker requires a matching organization in the claim result',()=>{
 assert.equal(resolveFactoryClaim({...reply,organizationId:org},fixture('worker'),'worker'),'/workspace/'+org);
 assert.equal(resolveFactoryClaim(reply,fixture('worker'),'worker'),null);
 assert.equal(resolveFactoryClaim({...reply,organizationId:org},fixture(),'worker'),null);
});
