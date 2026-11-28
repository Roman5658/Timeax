import test from 'node:test';
import assert from 'node:assert/strict';
import {createFactoryRegistrationHandler} from '../server/lib/factory-registration.server.mjs';
import {ISSUER} from '../server/lib/provider-adapters.mjs';

test('factory connection actions require verified same-origin requests and validated input',async()=>{
 const origin='https://timeax.test',calls=[];
 const session={state:'verified',issuer:ISSUER,subject:'synthetic',emailConfirmed:true,isAnonymous:false,expiresAt:Date.now()+60000,isActive:async()=>true};
 const handler=createFactoryRegistrationHandler({origin,resolveSession:async r=>r.headers.has('cookie')?session:null,store:{async invoke(actor,action,input){calls.push({actor,action,input});return {state:'new'}}}});
 const send=(action,body,headers={})=>handler(new Request(origin+'/api/factory-registration/'+action,{method:'POST',headers:{origin,cookie:'synthetic=1','content-type':'application/json',...headers},body:JSON.stringify(body)}));
 const lookup={agencyId:'00000000-0000-4000-8000-000000000001',factoryNip:'5260250274'};
 const details={...lookup,name:'Zakład testowy',address:'ul. Przykładowa 1'};
 assert.equal((await send('lookup-factory',lookup)).status,200);
 assert.equal((await send('prepare-factory',details)).status,200);
 assert.equal((await send('prepare-factory',{...details,address:' '})).status,400);
 assert.equal((await send('lookup-factory',{...lookup,factoryNip:'0000000001'})).status,400);
 assert.equal((await send('prepare-factory',{...details,role:'factory_admin'})).status,400);
 assert.equal((await send('lookup-factory',lookup,{origin:'https://other.test'})).status,403);
 assert.equal((await send('preview-factory-invitation',{code:'a'.repeat(64)})).status,200);
 assert.equal((await send('submit-invited-factory',{code:'a'.repeat(64),confirmed:false})).status,400);
 assert.equal((await send('submit-invited-factory',{code:'a'.repeat(64),confirmed:true})).status,200);
 assert.deepEqual(calls.map(c=>c.action),['lookup-factory','prepare-factory','preview-factory-invitation','submit-invited-factory']);
});
