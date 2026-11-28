import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parsePersonalHourlyRate,personalHourlyRateKey,personalPayCents,readPersonalHourlyRate} from '../src/hosted/personal-hourly-rate.ts';

test('personal hourly rates accept comma or dot, with exact grosz arithmetic',()=>{
 assert.deepEqual(parsePersonalHourlyRate(' 31,50 ','net'),{basis:'net',cents:3150});
 const gross=parsePersonalHourlyRate('38','gross');
 assert.deepEqual(gross,{basis:'gross',cents:3800});
 assert.equal(personalPayCents(gross,450),28500);
 assert.equal(personalPayCents(gross,0),0);
 assert.equal(personalPayCents(gross,-1),undefined);
 assert.equal(personalPayCents({basis:'net',cents:3001},30),1501);
 for(const amount of ['0','-2','1.234','1e3','3,1.5','100000',''])assert.equal(parsePersonalHourlyRate(amount,'gross'),undefined);
 assert.equal(parsePersonalHourlyRate('20','other'),undefined);
});
test('saved rates are isolated by actual membership and organization',()=>{
 const org='11000000-0000-4000-8000-000000000001';
 const first='11000000-0000-4000-8000-000000000002';
 const second='11000000-0000-4000-8000-000000000003';
 assert.notEqual(personalHourlyRateKey(org,first),personalHourlyRateKey(org,second));
 assert.notEqual(personalHourlyRateKey(org,first),personalHourlyRateKey(second,first));
 assert.equal(personalHourlyRateKey(org,'anonymous'),undefined);
 assert.equal(readPersonalHourlyRate('{"basis":"gross","cents":-100}'),undefined);
 assert.deepEqual(readPersonalHourlyRate('{"basis":"net","cents":3150}'),{basis:'net',cents:3150});
});
