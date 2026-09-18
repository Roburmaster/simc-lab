import test from 'node:test';
import assert from 'node:assert/strict';
import {isTank,normalizeTank,bossLines,survivalLines,calibrate,survivalGain,tankComparison,profilesetTank,actorTank} from '../lib/tank.mjs';
import {selectFinalists} from '../lib/upgrades.mjs';
import {inputFor} from '../lib/engine.mjs';

test('tank specs are detected and settings are validated',()=>{
  assert.ok(isTank({class:'warrior',spec:'protection'}));assert.equal(isTank({class:'warrior',spec:'fury'}),false);
  assert.equal(normalizeTank({preset:'mythic'},{class:'mage',spec:'frost'}),null);
  const t=normalizeTank({preset:'heroic',weight:70,deathTarget:30},{class:'deathknight',spec:'blood'});
  assert.equal(t.pressure,4);assert.equal(t.weight,70);assert.equal(t.deathTarget,30);
  assert.throws(()=>normalizeTank({preset:'nope'},{class:'monk',spec:'brewmaster'}),/preset/);
  assert.throws(()=>normalizeTank({weight:120},{class:'monk',spec:'brewmaster'}),/weight/);
});

test('the boss precedes the player, the healer survives Patchwerk and the tank can die',()=>{
  const boss={auto:1000,dot:200,buster:9000,healGap:5,immortal:false,health:1e6,pressure:5};
  const text=inputFor({text:'warrior="Tank"\nspec=protection'},{iterations:100,targetError:0,duration:300,threads:1,environment:null,tank:{boss}},{style:'Patchwerk',targets:1},{json:'a.json',html:'a.html'});
  assert.ok(text.indexOf('enemy=Tank_Boss')<text.indexOf('warrior='));
  assert.doesNotMatch(text,/fight_style=Patchwerk/,'Patchwerk would clear the healer raid event');
  assert.match(text,/raid_events\+=\/heal,name=tank_heal,to_pct=100,cooldown=5/);assert.match(text,/infinite_health=0/);
  assert.match(inputFor({text:''},{iterations:1,targetError:0,duration:1,threads:1,tank:{boss}},{style:'LightMovement',targets:1},{json:'a',html:'b'}),/fight_style=LightMovement/);
  assert.deepEqual(survivalLines({...boss,immortal:true,healGap:0}),[]);
  assert.equal(bossLines({auto:10,dot:0,buster:0}).length,2);
});

test('calibration scales pressure and resizes the buster toward the death target',async()=>{
  const tank=normalizeTank({preset:'mythic'},{class:'warrior',spec:'protection'});
  // Fake engine: 1/8 of raw damage lands, deaths grow with buster size.
  const simulate=async boss=>{
    const length=300,hp=1e6,deaths=boss.immortal?0:Math.min(1,boss.buster/(hp*8*0.6)*0.25/0.55*0.55);
    return {sim:{statistics:{simulation_length:{mean:length}},players:[{collected_data:{dtps:{mean:(boss.auto+boss.dot)/2/8*length},hps:{mean:0},aps:{mean:0},fight_length:{mean:length,count:300},dps:{mean:1,count:300},deaths:{count:Math.round(deaths*300)},buffed_stats:{resources:{health:hp}}}}],
      targets:[{name:'Tank_Boss',stats:[{name:'melee_main_hand_x',compound_amount:boss.auto/2/8*length},{name:'spell_dot_x',compound_amount:boss.dot/2/8*length},...(boss.buster?[{name:'melee_nuke_x',compound_amount:boss.buster/8*10,num_executes:{mean:10}}]:[])]}]}};
  };
  const boss=await calibrate(tank,simulate);
  assert.ok(Math.abs(boss.measured.sustained-5)<0.01);assert.equal(boss.healGap,5);assert.equal(boss.immortal,false);
  assert.ok(boss.measured.reached,JSON.stringify(boss.measured));
});

test('survival combines net damage and survived time; profilesets read fight length, not death times',()=>{
  const boss={health:1e6,pressure:5};const base={dtps:50000,hps:10000,alive:0.8};
  assert.equal(survivalGain({dtps:49000,hps:10000,alive:0.8},base,boss),2);
  assert.ok(Math.abs(survivalGain({dtps:50000,hps:10000,alive:0.9},base,boss)-10)<1e-9);
  const row=profilesetTank({additional_metrics:[{metric:'Damage Taken per Second',mean:100,mean_stddev:1},{metric:'Healing per Second',mean:20},{metric:'Absorb per Second',mean:5},{metric:'Deaths',mean:178},{metric:'Fight Length',mean:150}]},300);
  assert.equal(row.alive,0.5);assert.equal(row.deaths,undefined);
  const actor=actorTank({sim:{statistics:{simulation_length:{mean:300}},players:[{collected_data:{dtps:{mean:3e6},hps:{mean:1},aps:{mean:1},fight_length:{mean:240,count:100},dps:{mean:100,mean_std_dev:1,count:100},deaths:{count:40,mean:120},buffed_stats:{resources:{health:5}}}}]}});
  assert.equal(actor.alive,0.8);assert.equal(actor.deaths,0.4);assert.equal(actor.dtps,12500);
  const c=tankComparison({dps:110,error95:1,iterations:100,tank:{dtps:100,hps:0,alive:0.8}},{dps:100,error95:1,iterations:100,tank:{dtps:100,hps:0,alive:0.8}},{health:1000,pressure:10},40);
  assert.equal(c.dpsGain,10);assert.equal(c.survival,0);assert.ok(Math.abs(c.score-6)<1e-9);assert.ok(c.scoreError>0);
});

test('tank finalists are chosen by score, not DPS',()=>{
  const candidates=['a','b','c'].map(key=>({key,slot:'head'}));
  const screen={baseline:{dps:100,error95:0},rows:[{key:'a',dps:130,score:-5,scoreError:1},{key:'b',dps:90,score:4,scoreError:1},{key:'c',dps:95,score:-0.5,scoreError:1}]};
  assert.deepEqual(selectFinalists(candidates,screen,24,{boss:{}}).map(c=>c.key),['b','c']);
  assert.deepEqual(selectFinalists(candidates,screen,24).map(c=>c.key),['a']);
});
