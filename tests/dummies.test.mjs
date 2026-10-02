import test from 'node:test';
import assert from 'node:assert/strict';
import {inputFor,fightStyles,playerActorIndex,scenarioLines} from '../lib/engine.mjs';
import {silvermoon,dummyLines,dummyScenario,isDummyStyle} from '../lib/dummies.mjs';

const settings={iterations:10000,targetError:0.1,duration:300,threads:4,environment:null,tank:null};
const paths={json:'C:\\runs\\000.json',html:'C:\\runs\\000.html'};
const profile='warrior="Me"\nspec=fury\nlevel=90';

test('the Silvermoon dummies are the five measured in the city: level 90, never dying, held in execute range',()=>{
  assert.ok(fightStyles.includes('SilvermoonDummies'));assert.ok(!isDummyStyle('Patchwerk'));
  assert.equal(silvermoon.count,5);assert.equal(silvermoon.health,3537050);
  const lines=dummyLines('SilvermoonDummies');
  assert.equal(lines[0],'target_level+=0','same level as the player, not a +3 boss');
  assert.equal(lines.filter(l=>l.startsWith('enemy=')).length,5,'every dummy declared, so each gets the options');
  assert.equal(lines.filter(l=>l==='enemy_fixed_health_percentage=1').length,5,'held at about 1%');
  assert.ok(!lines.some(l=>l.startsWith('enemy_health')),'a fixed health would end the fight when the first dummy reached 0');
  assert.equal(lines.filter(l=>l==='actions=wait,sec=10').length,5,'city dummies never attack');
  assert.deepEqual(dummyLines('Patchwerk'),[]);
});

test('dummy input: enemies before the player, no fight style, five targets, buffs left to the environment',()=>{
  const scenario={style:'SilvermoonDummies',...dummyScenario};
  const input=inputFor({text:profile},settings,scenario,paths);
  // The page starts the dummies with everything off; whatever the user turns back on must reach SimC.
  assert.equal(scenarioLines(scenario),'','the scenario forces nothing off');
  const env={buffs:{arcane_intellect:false,battle_shout:false,power_word_fortitude:false,mark_of_the_wild:false,skyfury:false,blessing_of_the_bronze:false,chaos_brand:false,mystic_touch:false,hunters_mark:true,bleeding:false,mortal_wounds:false,bloodlust:true},variation:20,bloodlust:{mode:'pull',value:0},consumables:{potion:'none'}};
  const chosen=inputFor({text:profile},{...settings,environment:env},scenario,paths);
  assert.match(chosen,/override\.hunters_mark=1\n/);assert.match(chosen,/override\.bloodlust=1\n/);assert.match(chosen,/override\.mystic_touch=0\n/);assert.match(chosen,/potion=disabled\n/);
  assert.doesNotMatch(chosen,/override\.bloodlust=0/);
  assert.ok(input.startsWith('target_level+=0\nenemy=Cleave_Training_Dummy_1\n'));
  assert.ok(input.indexOf('enemy=Cleave_Training_Dummy_5')<input.indexOf('warrior="Me"'),'player options after the dummies belong to the player');
  assert.doesNotMatch(input,/fight_style=/);
  assert.match(input,/desired_targets=5\n/);
  assert.equal(playerActorIndex(settings,scenario),5,'profilesets must measure the player, actor 5');
  assert.equal(playerActorIndex(settings,{style:'Patchwerk'}),0);
  assert.equal(playerActorIndex({...settings,tank:{boss:{}}},{style:'Patchwerk'}),1);
});
