import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEnvironment,environmentLines,buffs} from '../lib/environment.mjs';
const catalog={consumables:{food:[{value:'midnight_food'}],flask:[],potion:[],augmentation:[],temporary_enchant:[{value:'midnight_oil'}]}};
test('environment rejects unknown buffs, legacy consumables and invalid timings',()=>{
  for(const request of [{buffs:{fake:true}},{buffs:{bloodlust:'false'}},{consumables:{food:'legacy_food'}},{bloodlust:{mode:'health',value:100}},{variation:-1}])assert.throws(()=>normalizeEnvironment(request,catalog));
});
test('health and end-of-fight Bloodlust do not also trigger at pull',()=>{
  const health=environmentLines(normalizeEnvironment({bloodlust:{mode:'health',value:30}},catalog));
  assert.ok(health.includes('bloodlust_time=99999'));assert.ok(health.includes('bloodlust_percent=30'));
  assert.ok(environmentLines(normalizeEnvironment({bloodlust:{mode:'remaining',value:40}},catalog)).includes('bloodlust_time=-40'));
});
test('no external buffs disables every optimal raid override and consumables can be disabled',()=>{
  const input={buffs:Object.fromEntries(buffs.map(b=>[b.id,false])),consumables:{food:'none',potion:'none'},variation:0};
  const lines=environmentLines(normalizeEnvironment(input,catalog));
  assert.ok(lines.includes('optimal_raid=0'));for(const b of buffs)assert.ok(lines.includes(`override.${b.id}=0`));
  assert.ok(lines.includes('override.allow_food=0'));assert.ok(lines.includes('potion=disabled'));assert.ok(lines.includes('vary_combat_length=0'));
});
test('weapon treatment changes preserve the explicitly imported other hand',()=>{
  const env=normalizeEnvironment({consumables:{main_hand_oil:'midnight_oil',off_hand_oil:'profile'}},catalog);
  assert.ok(environmentLines(env,'temporary_enchant=main_hand:old/off_hand:existing').includes('temporary_enchant=main_hand:midnight_oil/off_hand:existing'));
});
