import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseProfile,replaceEnchant,applyOverrides,createVariants} from '../lib/profile.mjs';
import {loadCatalog} from '../lib/catalog.mjs';
import {source,prepare,resultFrom} from '../lib/engine.mjs';
import {referenceProfile} from './reference.mjs';
const catalog=await loadCatalog(source);
const example=await referenceProfile('Mage_Frost');
const profile=parseProfile(example);
test('real upstream profile: equipment aliases, all slots and current database',()=>{
  assert.equal(Object.keys(profile.gear).length,16);assert.ok(profile.gear.shoulder);assert.ok(profile.gear.wrist);
  assert.ok(catalog.items.size>100000);assert.equal(catalog.items.get(profile.gear.finger1.id).inventoryType,11);
  assert.ok(catalog.forItem(profile.gear.finger1.id,'mage').some(e=>e.id===8021));
  assert.ok(!catalog.forItem(profile.gear.finger1.id,'mage').some(e=>e.id===7987));
});
test('addon export: exact WoW version, saved talents, bag items and comments',()=>{
  const p=parseProfile('# WoW 12.1.0.69814, TOC 120100\n'+example+'\n# Saved Loadout: AoE\n# talents=ABC123\n### Gear from Bags\n# Test Ring\n# finger1=,id=251136,enchant_id=8021\n');
  assert.deepEqual(p.version,{patch:'12.1.0',build:'69814'});assert.equal(p.alternatives.length,2);assert.equal(p.alternatives[0].name,'AoE');assert.equal(p.alternatives[1].slot,'finger1');
});
test('file, network, output and multi-token directives cannot pass import',()=>{
  for(const line of ['input=private.simc','output=outside.txt','html=outside.html','armory=eu,x,y','mage=x output=outside.txt','race=tauren\tinput=secret.simc','mage="x" output=outside.txt','race="unterminated'])assert.throws(()=>parseProfile(example+'\n'+line));
  assert.throws(()=>parseProfile(example+'\nwarrior=x'));
  assert.equal(parseProfile(example.replace(/^mage="[^"]*"/m,'mage="Name With Spaces"')).info.name,'Name With Spaces');
});
test('enchant replacement preserves bonuses, gems, crafted stats and removes both old forms',()=>{
  assert.equal(replaceEnchant(',id=5,bonus_id=1/2,gem_id=3,crafted_stats=32/49,enchant_id=1,enchant=old',8021),',id=5,bonus_id=1/2,gem_id=3,crafted_stats=32/49,enchant_id=8021');
  assert.equal(replaceEnchant(',id=5,enchant_id=1',0),',id=5');
});
test('one-at-a-time and Cartesian variants preserve baseline and change exact slots',()=>{
  const request={mode:'enchants',enchants:{finger1:[8021,7965],finger2:[8021,7965]}};
  const independent=createVariants(profile,request,catalog);const combined=createVariants(profile,{...request,combine:true},catalog);
  assert.equal(independent.length,5);assert.equal(combined.length,5);assert.equal(combined[0].text,profile.text);
  assert.match(parseProfile(combined[1].text).gear.finger1.value,/enchant_id=8021/);assert.match(parseProfile(combined[1].text).gear.finger2.value,/enchant_id=8021/);
  assert.equal(parseProfile(independent[1].text).gear.finger2.value,profile.gear.finger2.value);
  assert.throws(()=>createVariants(profile,{mode:'enchants',enchants:{finger1:[7987]}},catalog));
});
test('custom variants replace values without creating duplicate gear definitions',()=>{
  const result=applyOverrides(profile.text,'finger1=,id=251136,enchant_id=8021\ntalents=ABC');
  assert.equal(result.split('\n').filter(l=>l.startsWith('finger1=')).length,1);assert.equal(parseProfile(result).info.talents,'ABC');
  assert.throws(()=>createVariants(profile,{mode:'compare',variants:[{name:'bad',text:'mage=other'}]},catalog));
});
test('version and job bounds prevent wrong-build simulations',async()=>{
  await assert.rejects(prepare({profile:'# WoW 12.0.7.68974\n'+example},catalog),/another WoW build/);
  await assert.rejects(prepare({profile:example,iterations:1},catalog),/Iterations/);
  await assert.rejects(prepare({profile:example,scenarios:[{style:'Invalid',targets:1}]},catalog),/fight style/);
  await assert.rejects(prepare({profile:example,scenarios:[{style:'Patchwerk',targets:1},{style:'Patchwerk',targets:1}]},catalog),/more than once/);
});
test('uncertainty is standard error of the mean, not iteration spread',()=>{
  const result=resultFrom({sim:{players:[{collected_data:{dps:{mean:1000,mean_std_dev:10,std_dev:500}}}],options:{iterations:100}}});
  assert.ok(Math.abs(result.error95-19.59964)<.0001);assert.throws(()=>resultFrom({sim:{players:[]}}));
});
