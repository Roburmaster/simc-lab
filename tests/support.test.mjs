// Augmentation is ranked on the raid's damage, not its own. These checks need no engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {isSupport,rankWeaponRows,weaponSteps} from '../lib/weapons.mjs';
import {profilesetResults} from '../lib/upgrades.mjs';

test('only Augmentation is a support specialization',()=>{
  assert.ok(isSupport({class:'evoker',spec:'augmentation'}));
  for(const info of [{class:'evoker',spec:'devastation'},{class:'evoker',spec:'preservation'},{class:'priest',spec:'discipline'}])assert.equal(isSupport(info),false);
});

test('a support run reads the raid metric, and keeps the actor\'s own damage beside it',()=>{
  const report={sim:{statistics:{raid_dps:{mean:1461000,mean_std_dev:2000,count:5000}},players:[{collected_data:{dps:{mean:60000,mean_std_dev:100}}}],profilesets:{results:[
    {name:'w001',mean:1459000,mean_stddev:1500,iterations:5000,additional_metrics:[{metric:'Damage per Second',mean:57000}]}]}}};
  const {baseline,rows}=profilesetResults(report,null,{raid:true});
  assert.equal(baseline.dps,1461000);assert.equal(baseline.own,60000);
  assert.ok(Math.abs(baseline.error95-1.959963984540054*2000)<1e-6);
  assert.equal(rows[0].dps,1459000);assert.equal(rows[0].own,57000);
  // Without the flag nothing changes: the actor's own damage is the metric.
  assert.equal(profilesetResults(report,null).baseline.dps,60000);
});

test('gaps are percent of what the support adds, not of the whole raid',()=>{
  const rows=[{key:'a',status:'complete',dps:1461000,error95:1000},{key:'b',status:'complete',dps:1450000,error95:1000}];
  rankWeaponRows(rows,null,null,()=>false,220000);
  assert.ok(Math.abs(rows[1].behind-100*11000/220000)<1e-9,'5 % of the 220k it adds');
  assert.equal(rows[1].tier,'D');
  const plain=[{key:'a',status:'complete',dps:1461000,error95:1000},{key:'b',status:'complete',dps:1450000,error95:1000}];
  rankWeaponRows(plain,null,null);
  assert.equal(plain[1].tier,'A','of the whole raid the same gap would look small');
});

test('a support specialization adds one idle run per scenario',()=>{
  const plan={finalists:24,specs:[{candidates:new Array(10)},{support:true,candidates:new Array(30)}]};
  assert.equal(weaponSteps(plan,2),2*1+2*(2+1));
});
