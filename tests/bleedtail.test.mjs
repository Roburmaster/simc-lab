import test from 'node:test';
import assert from 'node:assert/strict';
import {inputFor,bleedTailLines} from '../lib/engine.mjs';

const settings={iterations:1000,targetError:0.1,duration:150,threads:4,environment:{buffs:{},variation:20,bloodlust:{mode:'pull',value:0},consumables:{}},tank:null};
const paths={json:'C:\\runs\\000.json',html:'C:\\runs\\000.html'};

test('stopping at the end: a players-only stun from the set duration, a longer fight, no length variation',()=>{
  assert.equal(bleedTailLines({},150),'');
  const input=inputFor({text:'warrior="Me"'},settings,{style:'SilvermoonDummies',targets:5,bleedTail:20},paths);
  assert.match(input,/max_time=170\n/,'the fight runs on while the bleeds tick');
  assert.match(input,/raid_events\+=\/stun,first=150,duration=50,cooldown=9999,players_only=1\n/);
  // After the environment's variation, so the stop lands where it is set.
  assert.ok(input.lastIndexOf('vary_combat_length=0')>input.indexOf('vary_combat_length=0.2'));
  // Patchwerk would clear the raid event, so the style is left unset (the same fight).
  const patchwerk=inputFor({text:'warrior="Me"'},settings,{style:'Patchwerk',targets:1,bleedTail:15},paths);
  assert.doesNotMatch(patchwerk,/fight_style=/);assert.match(patchwerk,/max_time=165\n/);
  assert.match(inputFor({text:'warrior="Me"'},settings,{style:'HecticAddCleave',targets:1,bleedTail:15},paths),/fight_style=HecticAddCleave\n/);
});
