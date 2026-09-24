import test from 'node:test';
import assert from 'node:assert/strict';
import {readUpgradeState,trackOf,stepCost,buildCrestCandidates,redundancySlot,normalizeBudget} from '../lib/crests.mjs';
import {spendingPlan} from '../public/crestplan.js';

const HERO=3445,MYTH=3446;
const discounts=[HERO,MYTH].map(currencyId=>({currencyId,scaling:0,accountWide:false}));
const ladder=(id,name,bonus,first,currency)=>({id,name,levels:[0,1,2,3,4,5].map(i=>({level:i+1,max:6,bonusId:bonus+i,itemLevel:first+[0,3,6,10,13,16][i],discounts,...(i?{cost:{currencyId:currency,amount:20}}:{})}))});
const season={season:{name:'Test season'},tracks:[ladder(617,'Hero',12841,305,HERO),ladder(618,'Myth',12849,318,MYTH)],crests:{currencies:[{id:HERO,name:'Hero Mistcrest'},{id:MYTH,name:'Myth Mistcrest'}],warband:{[HERO]:62414,[MYTH]:62416}}};
const catalog={items:new Map([[1,{name:'Helm',inventoryType:1}],[2,{name:'Band',inventoryType:11}],[3,{name:'Old axe',inventoryType:17}]])};
const profile={info:{class:'warrior',spec:'arms'},gear:{
  head:{id:1,value:',id=1,bonus_id=6652/12843/10355,enchant_id=9'},
  finger1:{id:2,value:',id=2,bonus_id=12854,gem_id=7'},
  main_hand:{id:3,value:',id=3,bonus_id=999'}
}};
const text=`warrior="Test"
# upgrade_currencies=c:3445:45/c:3446:10/c:3008:900/i:274476:2
# slot_high_watermarks=0:311:318/9:334:334
# upgrade_achievements=62416`;

test('the addon export gives crests, slot watermarks and warband achievements',()=>{
  const state=readUpgradeState(text);
  assert.equal(state.exported,true);
  assert.deepEqual(state.owned,{3445:45,3446:10,3008:900});
  assert.deepEqual(state.watermarks[0],{character:311,account:318});
  assert.deepEqual(state.achievements,[62416]);
  const none=readUpgradeState('warrior="Test"');
  assert.equal(none.exported,false);assert.equal(none.owned,null);assert.equal(none.watermarks,null);
});

test('upgrade tracks are read from the bonus IDs, and weapons map to their redundancy slot',()=>{
  const at=trackOf(profile.gear.head.value,season.tracks);
  assert.equal(at.track.name,'Hero');assert.equal(at.level.level,3);
  assert.equal(trackOf(profile.gear.main_hand.value,season.tracks),null);
  assert.equal(redundancySlot('finger2'),9);
  assert.equal(redundancySlot('main_hand',{inventoryType:17}),12);
  assert.equal(redundancySlot('off_hand',{inventoryType:14}),16);
});

test('a slot that already held the item level upgrades without crests; the account mark needs the achievement',()=>{
  const level=season.tracks[0].levels[1];// Hero 2/6, 308
  const state={achievements:[]};
  assert.equal(stepCost(level,{character:311,account:0},state,season.crests.warband).amount,0);
  assert.equal(stepCost(level,{character:300,account:318},state,season.crests.warband).amount,20);
  assert.equal(stepCost(level,{character:300,account:318},{achievements:[62414]},season.crests.warband).amount,0);
  assert.equal(stepCost(level,null,state,season.crests.warband).amount,20);
});

test('candidates swap only the track bonus, count crests from the equipped level and skip the top',()=>{
  const plan=buildCrestCandidates(profile,text,{affordable:false},season,catalog);
  // Hero 3/6 (311) → 4, 5, 6. Hero 4/6 is 315: above the character mark 311, and the account mark is not unlocked for Hero.
  assert.deepEqual(plan.candidates.map(c=>[c.slot,c.to,c.crests,c.fullCrests]),[['head',4,20,20],['head',5,40,40],['head',6,60,60]]);
  assert.equal(plan.candidates[0].line,'head=,id=1,bonus_id=6652/12844/10355,enchant_id=9');
  assert.deepEqual(plan.items.map(i=>[i.slot,i.level]),[['head',3],['finger1',6]]);
  assert.deepEqual(plan.budget,{3445:45,3446:10,3008:900});
  assert.deepEqual(buildCrestCandidates(profile,text,{levels:'max',affordable:false},season,catalog).candidates.map(c=>c.to),[6]);
  assert.deepEqual(buildCrestCandidates(profile,text,{budget:{[HERO]:100}},season,catalog).budget,{[HERO]:100});
  assert.throws(()=>buildCrestCandidates(profile,text,{slots:['finger1']},season,catalog),/already fully upgraded/);
  assert.throws(()=>buildCrestCandidates(profile,text,{slots:['main_hand']},season,catalog),/upgrade tracks/);
  assert.throws(()=>normalizeBudget({9999:1},season),/Unknown crest/);
});

test('only upgrades the crests pay for are simulated, from the export or typed',()=>{
  // The export has 45 Hero crests: Hero 4/6 (20) and 5/6 (40) fit, 6/6 (60) does not.
  const plan=buildCrestCandidates(profile,text,{},season,catalog);
  assert.equal(plan.affordable,true);
  assert.deepEqual(plan.candidates.map(c=>[c.to,c.crests]),[[4,20],[5,40]]);
  assert.equal(plan.items[0].reach,5);assert.equal(plan.items[0].crests,60,'the cost to the top is still shown');
  assert.deepEqual(buildCrestCandidates(profile,text,{levels:'max'},season,catalog).candidates.map(c=>c.to),[5],'highest level the crests reach');
  assert.deepEqual(buildCrestCandidates(profile,text,{budget:{[HERO]:100}},season,catalog).candidates.map(c=>c.to),[4,5,6]);
  assert.throws(()=>buildCrestCandidates(profile,text,{budget:{[HERO]:10}},season,catalog),/Nothing is affordable.*20 Hero Mistcrest/);
  // Without any crest data there is no budget, so everything is simulated.
  assert.deepEqual(buildCrestCandidates(profile,'warrior="Test"',{},season,catalog).candidates.map(c=>c.to),[4,5,6]);
});

test('the spending plan takes the best gain per crest it can pay for, and may skip levels',()=>{
  const options=[
    {id:'head',to:4,gain:100,crests:20,currencyId:HERO},{id:'head',to:5,gain:180,crests:40,currencyId:HERO},{id:'head',to:6,gain:260,crests:60,currencyId:HERO},
    {id:'legs',to:2,gain:50,crests:20,currencyId:HERO},{id:'legs',to:3,gain:300,crests:40,currencyId:HERO},
    {id:'neck',to:5,gain:40,crests:0,currencyId:MYTH}
  ];
  const all=spendingPlan(options,null);
  assert.deepEqual(all.steps.map(s=>[s.option.id,s.from,s.to,s.crests]),[['neck',0,5,0],['legs',0,3,40],['head',0,4,20],['head',4,5,20],['head',5,6,20]]);
  const tight=spendingPlan(options,{[HERO]:45});
  assert.deepEqual(tight.steps.map(s=>[s.option.id,s.to]),[['neck',5],['legs',3]]);
  assert.equal(tight.left[HERO],5);assert.equal(tight.spent[HERO],40);
  assert.deepEqual(spendingPlan([{id:'a',to:2,gain:-5,crests:20,currencyId:HERO}],null).steps,[]);
});
