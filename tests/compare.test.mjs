import test from 'node:test';
import assert from 'node:assert/strict';
import {align,simCasts,logCasts,fightSetup} from '../lib/analysis/compare.mjs';

test('SimC and the log set side by side: same casts, shifts, and differences that repeat',()=>{
  const sim=simCasts([{t:0,name:'auto_attack'},{t:0,name:'charge',spell:'Charge'},{t:1,name:'rampage',spell:'Rampage',rage:80},{t:2,name:'raging_blow',spell:'Raging Blow'},{t:3,name:'raging_blow',spell:'Raging Blow'},{t:4,name:'raging_blow',spell:'Raging Blow'},{t:9,name:'rampage',spell:'Rampage'}]);
  const log=logCasts([{t:0,name:'Charge'},{t:0.1,name:'Charge'},{t:1.4,name:'Rampage'},{t:2,name:'Bloodthirst'},{t:3,name:'Bloodthirst'},{t:4,name:'Bloodthirst'},{t:14,name:'Rampage'}]);
  assert.equal(log.length,6,'Charge logs twice for one press');
  const r=align(sim,log);
  const kinds=r.rows.map(x=>x.kind);
  assert.equal(kinds.filter(k=>k==='same').length,2,'Charge and the first Rampage');
  assert.ok(r.rows.some(x=>x.kind==='late'&&x.size==='large'&&/5\.0 s later/.test(x.note)),'the second Rampage, 5 s late');
  const missed=r.rows.filter(x=>x.kind==='missed');assert.equal(missed.length,3);assert.ok(missed.every(x=>x.size==='large'),'three times is a pattern');
  assert.match(missed[0].note,/SimC used Raging Blow here/);
  assert.deepEqual(r.summary.extra,[['bloodthirst',3]]);
});

test('the simulation that matches a fight',()=>{
  const targets=new Map([['a',{name:'Cleave Training Dummy',hits:100}],['b',{name:'Cleave Training Dummy',hits:90}]]);
  assert.deepEqual(fightSetup({kind:'activity'},{targets},{length:170.6,tail:{seconds:20.1}}),{style:'SilvermoonDummies',targets:5,duration:151,bleedTail:20,dummyHealth:{mode:'held'},label:'Silvermoon dummies'});
  const boss=fightSetup({kind:'encounter',name:'Nek’zali'},{targets:new Map([['x',{name:'Boss',hits:300}],['y',{name:'Add',hits:2}]])},{length:300,tail:{seconds:1}});
  assert.equal(boss.style,'Patchwerk');assert.equal(boss.targets,1);assert.equal(boss.duration,299);assert.equal(boss.bleedTail,undefined);
});
