import test from 'node:test';
import assert from 'node:assert/strict';
import {readVaultChoices,buildVaultCandidates} from '../lib/vault.mjs';
import {profilesetLines} from '../lib/upgrades.mjs';

const ladder=(id,name,bonus,first)=>({id,name,levels:[0,1,2,3,4,5].map(i=>({level:i+1,max:6,bonusId:bonus+i,itemLevel:first+[0,3,6,10,13,16][i]}))});
const season={tracks:[ladder(617,'Hero',12841,305),ladder(618,'Myth',12849,318)],bonusSockets:{},entries:[]};
const catalog={items:new Map([[1,{name:'Helm',inventoryType:1,itemClass:4}],[2,{name:'Band',inventoryType:11,itemClass:4}],[3,{name:'Sword',inventoryType:13,itemClass:2}],[4,{name:'Shield',inventoryType:14,itemClass:4}],
  [10,{name:'Vault Band',inventoryType:11,itemClass:4}],[11,{name:'Vault Greataxe',inventoryType:17,itemClass:2}],[12,{name:'Vault Helm',inventoryType:1,itemClass:4}],[13,{name:'Vault Buckler',inventoryType:14,itemClass:4}]])};
const profile={info:{class:'warrior',spec:'protection',level:90},gear:{
  head:{id:1,value:',id=1,bonus_id=12843,enchant_id=9'},
  finger1:{id:2,value:',id=2,bonus_id=12854,enchant_id=77,gem_id=7'},
  finger2:{id:2,value:',id=2,bonus_id=12855,enchant_id=78'},
  main_hand:{id:3,value:',id=3,bonus_id=12850'},
  off_hand:{id:4,value:',id=4,bonus_id=12850'}
}};
const text=`warrior="Test"
### Gear from Bags
#
# Old Helm (300)
# head=,id=1,bonus_id=12841
#
### Weekly Reward Choices
#
# Vault Band (321)
# finger1=,id=10,bonus_id=12850/6652
#
# Vault Greataxe (318)
# main_hand=,id=11,bonus_id=12849
#
# Vault Helm (334)
# head=,id=12,bonus_id=12854
#
### End of Weekly Reward Choices
`;

test('the vault section is read on its own, with names and item levels',()=>{
  const choices=readVaultChoices(text);
  assert.deepEqual(choices.map(c=>[c.slot,c.itemId,c.name,c.itemLevel]),[['finger1',10,'Vault Band',321],['main_hand',11,'Vault Greataxe',318],['head',12,'Vault Helm',334]]);
  assert.equal(choices[0].value,',id=10,bonus_id=12850/6652');
  assert.deepEqual(readVaultChoices('warrior="Test"\n### Gear from Bags\n# head=,id=1'),[]);
});

test('each choice goes in every legal slot, carries the enchant over, and a two-hander clears the off-hand',()=>{
  const plan=buildVaultCandidates(profile,text,{},season,catalog);
  assert.deepEqual(plan.candidates.map(c=>[c.slot,c.itemId,c.upgraded]),[['finger1',10,false],['finger2',10,false],['main_hand',11,false],['head',12,false]]);
  assert.equal(plan.candidates[0].line,'finger1=,id=10,bonus_id=12850/6652,enchant_id=77');
  assert.equal(plan.candidates[3].line,'head=,id=12,bonus_id=12854,enchant_id=9');
  assert.deepEqual(plan.items.map(i=>i.slots),[['finger1','finger2'],['main_hand'],['head']]);
  const lines=profilesetLines(plan.candidates.filter(c=>c.itemId===11),profile,catalog);
  assert.deepEqual(lines,['profileset."v003"=main_hand=,id=11,bonus_id=12849','profileset."v003"+=off_hand=']);
});

test('fully upgraded adds the top of the track for choices below it',()=>{
  const plan=buildVaultCandidates(profile,text,{upgraded:true},season,catalog);
  const up=plan.candidates.filter(c=>c.upgraded);
  assert.deepEqual(up.map(c=>[c.slot,c.itemLevel,c.track.level]),[['finger1',334,6],['finger2',334,6],['main_hand',334,6]]);
  assert.equal(plan.items[2].track.level,6,'the helm is already at the top');
  assert.equal(up[0].line,'finger1=,id=10,bonus_id=12854/6652,enchant_id=77');
});

test('an off-hand with a two-hander wielded is skipped, and an empty vault says how to export it',()=>{
  const twoHander={...profile,gear:{...profile.gear,main_hand:{id:11,value:',id=11,bonus_id=12849'}}};delete twoHander.gear.off_hand;
  const buckler='warrior="T"\n### Weekly Reward Choices\n#\n# Vault Buckler (318)\n# off_hand=,id=13,bonus_id=12849\n#\n# Vault Helm (334)\n# head=,id=12,bonus_id=12854\n### End of Weekly Reward Choices';
  const plan=buildVaultCandidates(twoHander,buckler,{},season,catalog);
  assert.deepEqual(plan.skipped.map(s=>s.itemId),[13]);
  assert.deepEqual(plan.candidates.map(c=>c.itemId),[12]);
  assert.throws(()=>buildVaultCandidates(profile,'warrior="T"',{},season,catalog),/open the Great Vault/);
});
