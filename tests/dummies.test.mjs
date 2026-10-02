import test from 'node:test';
import assert from 'node:assert/strict';
import {inputFor,fightStyles,playerActorIndex,scenarioLines} from '../lib/engine.mjs';
import {silvermoon,dummyLines,dummyScenario,isDummyStyle,bands,fallTimeline,calibrate,needsCalibration,normalizeDummyHealth} from '../lib/dummies.mjs';

const settings={iterations:10000,targetError:0.1,duration:300,threads:4,environment:null,tank:null};
const paths={json:'C:\\runs\\000.json',html:'C:\\runs\\000.html'};
const profile='warrior="Me"\nspec=fury\nlevel=90';

test('the Silvermoon dummies are the five measured in the city: level 90, never dying, passive',()=>{
  assert.ok(fightStyles.includes('SilvermoonDummies'));assert.ok(!isDummyStyle('Patchwerk'));
  assert.equal(silvermoon.count,5);assert.equal(silvermoon.health,3537050);
  const lines=dummyLines('SilvermoonDummies');
  assert.equal(lines[0],'target_level+=0','same level as the player, not a +3 boss');
  assert.equal(lines.filter(l=>l.startsWith('enemy=')).length,5,'every dummy declared, so each gets the options');
  assert.equal(lines.filter(l=>l==='enemy_fixed_health_percentage=1').length,5,'held at 1% unless told otherwise');
  assert.ok(!lines.some(l=>l.startsWith('enemy_health')),'a fixed health would end the fight when the first dummy reached 0');
  assert.equal(lines.filter(l=>l==='actions=wait,sec=10').length,5,'city dummies never attack');
  assert.deepEqual(dummyLines('Patchwerk'),[]);
});

test('dummy input: enemies before the player, no fight style, five targets, buffs left to the environment',()=>{
  const scenario={style:'SilvermoonDummies',...dummyScenario};
  const input=inputFor({text:profile},settings,scenario,paths);
  assert.equal(scenarioLines(scenario),'','the scenario forces nothing off');
  const env={buffs:{arcane_intellect:false,battle_shout:false,power_word_fortitude:false,mark_of_the_wild:false,skyfury:false,blessing_of_the_bronze:false,chaos_brand:false,mystic_touch:false,hunters_mark:true,bleeding:false,mortal_wounds:false,bloodlust:true},variation:20,bloodlust:{mode:'pull',value:0},consumables:{potion:'none'}};
  const chosen=inputFor({text:profile},{...settings,environment:env},scenario,paths);
  assert.match(chosen,/override\.hunters_mark=1\n/);assert.match(chosen,/override\.bloodlust=1\n/);assert.match(chosen,/override\.mystic_touch=0\n/);assert.match(chosen,/potion=disabled\n/);
  assert.ok(input.startsWith('target_level+=0\nenemy=Cleave_Training_Dummy_1\n'));
  assert.ok(input.indexOf('enemy=Cleave_Training_Dummy_5')<input.indexOf('warrior="Me"'),'player options after the dummies belong to the player');
  assert.doesNotMatch(input,/fight_style=/);
  assert.match(input,/desired_targets=5\n/);
  assert.equal(playerActorIndex(settings,scenario),5,'profilesets must measure the player, actor 5');
  assert.equal(playerActorIndex(settings,{style:'Patchwerk'}),0);
  assert.equal(playerActorIndex({...settings,tank:{boss:{}}},{style:'Patchwerk'}),1);
});

test('falling health: each dummy follows the pace the player’s own damage gave it, then stays at 1%',()=>{
  assert.deepEqual(normalizeDummyHealth(undefined),{mode:'held'});
  assert.throws(()=>normalizeDummyHealth({mode:'sometimes'}),/health/);
  assert.equal(needsCalibration({style:'SilvermoonDummies',dummyHealth:{mode:'falling'}}),true);
  assert.equal(needsCalibration({style:'SilvermoonDummies',dummyHealth:{mode:'held'}}),false);
  // 35,370.5 damage per second takes 1% of a dummy per second, in every band.
  const pace=silvermoon.health/100;
  const even=fallTimeline([pace,pace,pace,pace],300);
  assert.equal(even.timeline,'100:0/80:0.0667/35:0.2167/20:0.2667/1:0.33/1:1');assert.equal(even.reached,99);
  // Faster in execute: the last band takes half as long.
  assert.equal(fallTimeline([pace,pace,pace,2*pace],300).reached,89.5);
  // Too slow for the fight: it ends partway, with no point after 1.0.
  const slow=fallTimeline([pace/4,pace/4,pace/4,pace/4],300);
  assert.equal(slow.reached,null);assert.equal(slow.timeline,'100:0/80:0.2667/35:0.8667/25:1');
  // Calibration reports: damage taken per iteration and fight length per dummy, one report per band.
  const report=rate=>({sim:{targets:Array.from({length:5},(_,i)=>({collected_data:{dtps:{mean:rate*(i?1:2)*100},fight_length:{mean:100}}}))}});
  const result=calibrate(bands.map(()=>report(pace)),300);
  assert.equal(result.mode,'falling');assert.equal(result.timelines.length,5);
  assert.deepEqual(result.reached,[49.5,99,99,99,99],'the main target takes twice the damage and gets there first');
  const input=inputFor({text:profile},settings,{style:'SilvermoonDummies',...dummyScenario,dummyHealth:result},paths);
  assert.equal(input.split('enemy_custom_health_timeline=').length-1,5);assert.doesNotMatch(input,/enemy_fixed_health_percentage/);
  // A calibration run holds the dummies in one band and reports their damage taken.
  const probe=inputFor({text:profile},settings,{style:'SilvermoonDummies',...dummyScenario,dummyHealth:{calibrate:50}},paths);
  assert.equal(probe.split('enemy_fixed_health_percentage=50\nrole=tank').length-1,5);
});
