import assert from 'node:assert/strict';
import test from 'node:test';
import {applicableEstimate,makeEstimateDraft,parseEstimateDraft,sameEstimateTerms,warsawEstimateMonth} from '../src/hosted/worker-pay-estimate-form.ts';

const selected='11000000-0000-4000-8000-000000000001',other='11000000-0000-4000-8000-000000000002';
const gross={basis:'gross',amount:'29,90',deductions:[{name:'  Accommodation ',amount:'185.15'},{name:'Transport',amount:'25'}]};
test('explicit gross deductions preserve order and exact PLN cents; a net estimate sends no deductions',()=>{
 const params=[selected,'2026-11',0];
 assert.deepEqual(parseEstimateDraft(...params,gross),{workerId:selected,effectiveMonth:'2026-11',basis:'gross',rateCents:2990,revision:0,deductions:[{name:'Accommodation',cents:18515},{name:'Transport',cents:2500}]});
 assert.deepEqual(parseEstimateDraft(...params,{...gross,basis:'net'}).deductions,[]);
 assert.deepEqual(parseEstimateDraft(...params,{...gross,deductions:[]}).deductions,[]);
});
test('validation matches effective month, positive hourly amount and explicit bounded deduction rows',()=>{
 const parse=(draft,month='2026-11',revision=0)=>parseEstimateDraft(selected,month,revision,draft);
 for(const value of ['22.555','0','-23','10000.01','0,00','2 000'])assert.equal(parse({...gross,amount:value}),undefined);
 for(const value of ['1999-12','2026-13','2026-1','2101-01'])assert.equal(parse(gross,value),undefined);
 for(const entries of [[{name:'x',amount:'10'}],[{name:'Transport',amount:''}],
  [{name:'Transport',amount:'10000000'},{name:'Accommodation',amount:'1'}],Array.from({length:21},()=>({name:'Transport',amount:'1'}))])
  assert.equal(parse({...gross,deductions:entries}),undefined);
 assert.equal(parse(gross,'2100-01',3).revision,3);
});
test('month selection uses Warsaw and earlier settings are worker-only; creating a new month starts at revision zero',()=>{
 assert.equal(warsawEstimateMonth(new Date('2026-11-30T23:30:00Z')),'2026-12');
 const old=parseEstimateDraft(selected,'2026-10',7,gross);
 const future=parseEstimateDraft(selected,'2026-12',1,gross);
 const notMine=parseEstimateDraft(other,'2026-11',2,{...gross,basis:'net'});
 const chosen=applicableEstimate([future,notMine,old],selected,'2026-11');
 assert.equal(chosen,old);
 const copied=parseEstimateDraft(selected,'2026-11',0,makeEstimateDraft(chosen));
 assert.equal(copied.revision,0);
 assert.equal(copied.rateCents,old.rateCents);
 assert.equal(sameEstimateTerms(copied,old),false);
 assert.equal(sameEstimateTerms(old,{...old,revision:8}),true);
});
