import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createNfcProvisioningHandler} from '../lib/nfc-provisioning-http.mjs';

const origin='https://timeax.pl';
const id=n=>'12345678-1234-4123-8123-'+String(n).padStart(12,'0');
const [agency,worksite,admin,worker,foreign,grant]=[1,2,3,4,5,6].map(id);
function fixture({role='agency_admin',active=true,native=true}={}){
 const calls=[];
 const gate={
  issue:async(scope,purpose)=>{calls.push(['issue',scope,purpose]);return {grantId:grant,kind:purpose.kind};},
  claim:async(token,proof)=>{calls.push(['claim',token,proof]);return {state:'provisioned',bindingId:grant};},
  revokeGrant:async(scope,g)=>{calls.push(['revokeGrant',scope,g]);return true;},
  revokeDevice:async(scope,g)=>{calls.push(['revokeDevice',scope,g]);return true;}
 };
 const handler=createNfcProvisioningHandler({origin,gate,resolveAgencySite:async()=>({role,agencyId:agency,worksiteId:worksite,adminMembershipId:admin,isActive:async()=>active}),allowClaim:async()=>native});
 return {calls,handler};
}
function request(action,body,headers={}){
 return new Request(origin+'/api/nfc/setup/'+action,{method:'POST',body:JSON.stringify(body),headers:{Origin:origin,'Content-Type':'application/json',...headers}});
}

test('agency setup is exact-site-only and never accepts client authorization claims',async()=>{
 const {handler,calls}=fixture(),input={agencyId:agency,worksiteId:worksite,kind:'personal_card',membershipId:worker};
 const r=await handler(request('issue',input));
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.deepEqual(calls,[['issue',{agencyId:agency,worksiteId:worksite,adminMembershipId:admin},{kind:'personal_card',membershipId:worker}]]);
 for(const [p,h,status] of [[{...input,worksiteId:foreign},{},403],[{...input,agencyId:foreign},{},403],[{...input,role:'agency_admin'},{},400],[input,{'x-role':'agency_admin'},403],[input,{Origin:'https://unrelated.example'},403]]){
  assert.equal((await handler(request('issue',p,h))).status,status);
 }
 assert.equal(calls.length,1);
 const expired=fixture({active:false});
 assert.equal((await expired.handler(request('issue',input))).status,403);assert.equal(expired.calls.length,0);
});

test('setup token claim is a protected POST and never acts as an attendance or HTTP route token',async()=>{
 const {handler,calls}=fixture();
 const token='nsetup1_'+'a'.repeat(43),proof='b'.repeat(32),body={token,nativeProof:proof};
 assert.equal((await handler(request('claim',body))).status,200);
 assert.equal((await handler(request('claim',{...body,token:'a'.repeat(43)}))).status,400);
 assert.equal((await handler(request('claim?token='+token,body))).status,404);
 assert.equal((await handler(request('claim',{...body,nativeProof:'b'.repeat(11_000)}))).status,400);
 assert.equal((await handler(request('record',body))).status,404);
 assert.equal(calls.length,1);
 const blocked=fixture({native:false});
 assert.equal((await blocked.handler(request('claim',body))).status,403);
 assert.equal(blocked.calls.length,0);
 assert.equal((await handler(request('revoke-device',{agencyId:agency,worksiteId:worksite,id:grant}))).status,200);
});
