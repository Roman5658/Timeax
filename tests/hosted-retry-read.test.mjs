import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readWithRetry,retryableStatus,TemporaryReadError} from '../src/hosted/retry-read.ts';

test('one transient read failure recovers automatically',async()=>{
 let calls=0;
 const value=await readWithRetry(async signal=>{
  assert.equal(signal.aborted,false);
  if(++calls===1)throw new TemporaryReadError();
  return 'loaded';
 },new AbortController().signal,1);
 assert.equal(value,'loaded');assert.equal(calls,2);
 assert.equal(retryableStatus(503),true);assert.equal(retryableStatus(401),false);
});
test('session and access denials are not retried',async()=>{
 let calls=0;
 await assert.rejects(readWithRetry(async()=>{calls++;throw Error('denied')},new AbortController().signal),/denied/);
 assert.equal(calls,1);
});
test('leaving the cabinet aborts the request and prevents a retry',async()=>{
 const controller=new AbortController();
 let calls=0;
 const promise=readWithRetry(signal=>new Promise((_resolve,reject)=>{
  calls++;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 }),controller.signal);
 controller.abort(Error('left'));
 await assert.rejects(promise,/left/);assert.equal(calls,1);
});
