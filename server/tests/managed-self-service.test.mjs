import {test} from 'node:test';
import assert from 'node:assert/strict';
import {managedSelfService} from '../lib/hosted-config.mjs';

test('managed self-service stays off until the two dedicated credentials and fingerprint are present',()=>{
 const config={TIMEAX_SELF_SERVICE_FUNCTION_SHA256:'a'.repeat(64),TIMEAX_AGENCY_ONBOARDING_DB:'x'.repeat(64),TIMEAX_WORKSPACE_READ_DB:'y'.repeat(64)};
 assert.equal(managedSelfService({}),null);
 for(const key of Object.keys(config))assert.throws(()=>managedSelfService({...config,[key]:undefined}));
 assert.throws(()=>managedSelfService({...config,TIMEAX_WORKSPACE_READ_DB:config.TIMEAX_AGENCY_ONBOARDING_DB}));
 assert.deepEqual(managedSelfService(config).selfService,{mode:'verified-email-agency-v1',functionSha:'a'.repeat(64)});
});
