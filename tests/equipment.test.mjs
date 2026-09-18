import test from 'node:test';
import assert from 'node:assert/strict';
import {fitsSlot,expandWeaponAlternatives} from '../lib/equipment.mjs';
const fury={class:'warrior',spec:'fury',level:90};
const twoHand={id:1,inventoryType:17,itemClass:2};
test('two-handed off-hand eligibility is specific to Fury with Titans Grip',()=>{
  assert.ok(fitsSlot(twoHand,'off_hand',fury));
  for(const info of [{...fury,spec:'arms'},{...fury,spec:'protection'},{class:'mage',spec:'frost'},{...fury,level:10}])assert.equal(fitsSlot(twoHand,'off_hand',info),false);
  assert.ok(fitsSlot(twoHand,'main_hand',fury));
});
test('Fury bag weapons appear in both hands preserving bonuses and without duplicates',()=>{
  const value=',id=1,bonus_id=5/6,enchant_id=9,gem_id=10,ilevel=300';
  const main={slot:'main_hand',text:'main_hand='+value,name:'Bag sword',section:'Gear from Bags'};
  const profile={info:fury,alternatives:[main]};const catalog={items:new Map([[1,twoHand]])};
  const result=expandWeaponAlternatives(profile,catalog);assert.equal(result.length,2);assert.equal(result[1].text,'off_hand='+value);
  assert.equal(expandWeaponAlternatives({...profile,alternatives:result},catalog).length,2);
  assert.equal(expandWeaponAlternatives({...profile,info:{...fury,spec:'arms'}},catalog).length,1);
});
