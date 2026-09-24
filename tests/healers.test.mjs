// Healer weapons are scored, not simulated. These checks need no engine: the weights file, the damage model,
// the readout of a SimC report, and the ranking are all plain data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {healerWeights,contentWeights,damageWeights,readoutStats,readoutInput,healerRows,rankHealerRows,healerCandidates,scoreItem} from '../lib/healers.mjs';
import {normalizeHealer,weaponSteps} from '../lib/weapons.mjs';
import {tierListPage} from '../lib/tierpage.mjs';

const stats=['crit','haste','mastery','versatility'];

test('the healer weights name their source and cover the seven healing specializations',async()=>{
  const data=await healerWeights();
  assert.equal(data.source.name,'QE Live');
  assert.match(data.source.commit,/^[0-9a-f]{40}$/,'pinned to the commit they were read from');
  assert.match(data.source.readAt,/^\d{4}-\d{2}-\d{2}$/);
  const keys=data.specs.map(s=>`${s.class}-${s.spec}`).sort();
  assert.deepEqual(keys,['druid-restoration','evoker-preservation','monk-mistweaver','paladin-holy','priest-discipline','priest-holy','shaman-restoration']);
  for(const spec of data.specs)for(const content of ['dungeon','raid'])for(const set of [spec[content]].flat())
    for(const stat of stats)assert.ok(set[stat]>0&&set[stat]<2,`${spec.class}-${spec.spec} ${content} ${stat}`);
});

test('a specialization with weights per hero tree is scored on their mean',()=>{
  const entry={dungeon:[{crit:0.6,haste:0.8,mastery:1,versatility:0.4},{crit:0.8,haste:0.6,mastery:0.5,versatility:0.6}]};
  assert.deepEqual(contentWeights(entry,'dungeon'),{crit:0.7,haste:0.7,mastery:0.75,versatility:0.5});
});

test('the damage model gives mastery nothing and a rating point less than intellect',()=>{
  const reference={intellect:3000,crit:0.2,haste:0.25,versatility:0.05};
  const w=damageWeights(reference,{crit:4600,haste:4400,versatility:5400});
  assert.equal(w.mastery,0);
  // One point of crit: int × (1/4600) / (1+0.2) of damage, set against one point of intellect: 1/3000 of it.
  assert.ok(Math.abs(w.crit-3000/(4600*1.2))<1e-12);
  assert.ok(Math.abs(w.haste-3000/(4400*1.25))<1e-12);
  for(const s of ['crit','haste','versatility'])assert.ok(w[s]>0&&w[s]<1,s);
});

// A report as SimC writes it for the readout: an unarmed carrier, one carrier per weapon, and the reference.
const actor=(name,intellect,gear,extra={})=>({name,gear:gear?{main_hand:gear}:{},collected_data:{buffed_stats:{attribute:{intellect},stats:extra}}});
const report={sim:{players:[
  actor('unarmed',654,null,{crit_pct:0.05}),
  actor('x0001',1493,{ilevel:334,intellect:650,haste_rating:63,mastery_rating:138},{crit_pct:0.05,haste_pct:63/4400}),
  actor('x0002',1256,{ilevel:344,intellect:499,crit_rating:92,versatility_rating:54},{crit_pct:0.05+92/4600,damage_versatility:54/5400}),
  {name:'reference',gear:{},collected_data:{buffed_stats:{attribute:{intellect:3550},stats:{crit_pct:0.13,haste_pct:0.33,damage_versatility:0.02,crit_rating:380,haste_rating:1282,mastery_rating:1589,versatility_rating:123}}}}
]}};

test('the readout measures intellect against the unarmed carrier, not the item line',()=>{
  const out=readoutStats(report);
  // A main hand gives more intellect than its item line lists: 1493 − 654, not 650.
  assert.equal(out.items.get('x0001').intellect,839);
  assert.equal(out.items.get('x0001').mastery,138);
  assert.equal(out.items.get('x0002').intellect,602);
  assert.ok(Math.abs(out.conversion.haste-4400)<1e-6&&Math.abs(out.conversion.crit-4600)<1e-6&&Math.abs(out.conversion.versatility-5400)<1e-6);
  assert.equal(out.reference.intellect,3550);
  assert.equal(out.reference.ratings.mastery,1589);
  assert.throws(()=>readoutStats({sim:{players:report.sim.players.slice(1)}}),/unarmed carrier/);
});

test('the readout input carries every weapon, an unarmed carrier and the reference under its own name',()=>{
  const text=readoutInput([{key:'x0001',line:'main_hand=,id=1'},{key:'x0002',line:'off_hand=,id=2'}],'priest="MID2_Priest_Shadow"\nspec=shadow\nlevel=90','C:\\runs\\000.json');
  assert.match(text,/^shaman=unarmed$/m);
  assert.match(text,/^shaman=x0001\n[\s\S]*?main_hand=,id=1$/m);
  assert.match(text,/^priest=reference$/m);
  assert.doesNotMatch(text,/MID2_Priest_Shadow/);
  assert.match(text,/^iterations=1$/m);
  assert.match(text,/^json2="C:\/runs\/000.json"$/m);
});

const candidate=(key,hand,itemId,name,extra={})=>({key,hand,itemId,name,slot:hand==='off'?'off_hand':'main_hand',kind:hand==='off'?'held':'main',itemLevel:334,sources:['Raid · Boss'],value:`,id=${itemId}`,...extra});

test('each hand is ranked on its own, crafted pairs once, and the staff is set against the best pair',()=>{
  const spec={key:'druid-restoration',weights:{dungeon:{crit:0.5,haste:0.8,mastery:0.8,versatility:0.5}},candidates:[
    candidate('h001','two',10,'Staff'),
    candidate('h002','one',20,'Mace'),
    candidate('h003','one',30,'Knife',{craftedStat:'Critical Strike / Haste'}),
    candidate('h004','one',30,'Knife',{craftedStat:'Mastery / Versatility'}),
    candidate('h005','off',40,'Orb')
  ]};
  const items=new Map([
    ['h001',{intellect:839,crit:0,haste:63,mastery:138,versatility:0}],
    ['h002',{intellect:602,crit:0,haste:104,mastery:0,versatility:0}],
    ['h003',{intellect:560,crit:50,haste:50,mastery:0,versatility:0}],
    ['h004',{intellect:560,crit:0,haste:0,mastery:50,versatility:50}],
    ['h005',{intellect:289,crit:0,haste:32,mastery:68,versatility:0}]
  ]);
  const readout={items,conversion:{crit:4600,haste:4400,versatility:5400},reference:{intellect:3550,crit:0.13,haste:0.33,versatility:0.02,ratings:{crit:380,haste:1282,mastery:1589,versatility:123}}};
  const rows=healerRows(spec,readout,{content:'dungeon',weight:70});
  assert.ok(rows.every(r=>r.status==='complete'&&r.scenario===0&&Number.isFinite(r.score)));
  for(const r of rows)assert.ok(Math.abs(r.score-(0.7*r.healing+0.3*r.damage))<1e-9,'the score is the weighted mix');
  const {hands,compare}=rankHealerRows(rows,spec.candidates);
  assert.deepEqual(hands.two.map(r=>r.key),['h001']);
  assert.deepEqual(hands.one.map(r=>r.key),['h002','h003'].sort((a,b)=>rows.find(r=>r.key===b).score-rows.find(r=>r.key===a).score));
  assert.equal(rows.filter(r=>r.variant).length,1,'the weaker stat pair of the crafted knife is a variant');
  assert.equal(hands.one[0].rank,1);assert.equal(hands.one[0].tier,'S');assert.equal(hands.one[0].behind,0);
  const pair=hands.one[0].score+hands.off[0].score;
  assert.ok(Math.abs(compare.lead-(hands.two[0].score-pair))<1e-9);
  assert.ok(compare.lead<0,'602 + 289 intellect outweighs a staff at 839');
  // Pure healing puts the mastery-heavy staff's healing first; pure damage leaves mastery worthless.
  const heal=healerRows(spec,readout,{content:'dungeon',weight:100}),dmg=healerRows(spec,readout,{content:'dungeon',weight:0});
  assert.equal(heal.find(r=>r.key==='h004').score,heal.find(r=>r.key==='h004').healing);
  assert.ok(dmg.find(r=>r.key==='h004').score<dmg.find(r=>r.key==='h003').score);
  assert.equal(healerRows(spec,{...readout,items:new Map()},{content:'dungeon',weight:70})[0].status,'failed');
});

test('a score is the weapon over the whole character scored the same way',()=>{
  assert.equal(scoreItem({intellect:100,crit:10,haste:0,mastery:0,versatility:0},{crit:0.5}),105);
});

test('healers wield a two-hander or a one-hander with a shield or held item, never an off-hand weapon',()=>{
  const season={weaponSpecs:[{itemClass:2,itemSubClass:10,specsCanUse:[264]},{itemClass:2,itemSubClass:4,specsCanUse:[264]}],bonusSockets:{},entries:[
    {item:{id:1,name:'Staff',itemClass:2,itemSubClass:10,inventoryType:17,stats:[{id:5}]},source:{kind:'raid',groupName:'Boss',sequence:1}},
    {item:{id:2,name:'Mace',itemClass:2,itemSubClass:4,inventoryType:13,stats:[{id:5}]},source:{kind:'mplus',groupName:'Dungeon'}},
    {item:{id:3,name:'Off mace',itemClass:2,itemSubClass:4,inventoryType:22,stats:[{id:5}]},source:{kind:'mplus',groupName:'Dungeon'}},
    {item:{id:4,name:'Shield',itemClass:4,itemSubClass:6,inventoryType:14,stats:[{id:5}]},source:{kind:'mplus',groupName:'Dungeon'}},
    {item:{id:5,name:'Orb',itemClass:4,itemSubClass:0,inventoryType:23,stats:[{id:5}]},source:{kind:'delves',groupName:'Delves'}},
    {item:{id:6,name:'Agility staff',itemClass:2,itemSubClass:10,inventoryType:17,stats:[{id:3}]},source:{kind:'mplus',groupName:'Dungeon'}}
  ]};
  const level={of:()=>({bonusId:100,itemLevel:330,label:'Hero 6/6'})};
  const drops={raid:level,mplus:level,delves:level};
  const spec={info:{class:'shaman',spec:'restoration'},specId:264};
  const list=healerCandidates(spec,season,{drops,kinds:['main','shield','held']});
  assert.deepEqual(list.map(c=>`${c.hand}:${c.name}`),['two:Staff','one:Mace','off:Orb','off:Shield']);
  assert.ok(list.every(c=>c.line.startsWith(c.hand==='off'?'off_hand=':'main_hand=')&&c.line.includes('bonus_id=100')));
  assert.deepEqual(healerCandidates(spec,season,{drops,kinds:['held']}).map(c=>c.name),['Orb']);
  assert.deepEqual(healerCandidates({info:{class:'druid',spec:'restoration'},specId:105},season,{drops,kinds:['main','shield','held']}).map(c=>c.name),['Orb'],'a druid neither holds a shield nor uses these weapons');
});

test('the healer settings are checked, and healers add one step between them',()=>{
  assert.deepEqual(normalizeHealer(),{weight:70,content:'dungeon'});
  assert.deepEqual(normalizeHealer({weight:55,content:'raid'}),{weight:55,content:'raid'});
  assert.throws(()=>normalizeHealer({weight:101}),/between 0 and 100/);
  assert.throws(()=>normalizeHealer({weight:5.5}),/whole percentage/);
  assert.throws(()=>normalizeHealer({content:'pvp'}),/Mythic\+ or Raid/);
  const plan={finalists:24,specs:[{candidates:new Array(10)},{healer:true,candidates:new Array(60)},{healer:true,candidates:new Array(40)}]};
  assert.equal(weaponSteps(plan,2),3,'two scenarios for the simulated spec, one readout for both healers');
});

test('the tier page lists a healer by hand and says it was scored, not simulated',()=>{
  const spec={key:'shaman-restoration',label:'Restoration Shaman',class:'shaman',spec:'restoration',className:'Shaman',specName:'Restoration',file:'healers/weights.json',healer:true,
    provenance:{name:'QE Live'},compare:{lead:-1.2},candidates:[candidate('h001','two',10,'Staff'),candidate('h002','one',20,'Mace'),candidate('h003','off',40,'Orb')]};
  const row=(key,score)=>({spec:spec.key,scenario:0,stage:2,key,status:'complete',healer:true,score,healing:score,damage:score,rank:1,behind:0,behindFirst:0,tier:'S'});
  const job={id:'00000000-0000-0000-0000-000000000000',created:'2026-09-25T00:00:00Z',engine:{version:'1210-01',wowVersion:'12.1.0.69933'},settings:{iterations:100,targetError:0.1,duration:300},
    scenarios:[{style:'DungeonSlice',targets:1}],weapons:{season:{name:'Midnight Season 2'},levels:{min:334,max:334},sources:{equal:true,label:'Myth 6/6'},kinds:['main','held'],healer:{weight:70,content:'dungeon'},specs:[spec]},
    results:[row('h001',17.2),row('h002',12.1),row('h003',6.2)],stages:[]};
  const html=tierListPage(job);
  for(const hand of ['Two-hand','One-hand','Off hand'])assert.match(html,new RegExp(`${hand} <span>1 weapons`));
  assert.match(html,/17\.20 % score/);
  assert.match(html,/Scored, not simulated/);
  assert.match(html,/The best one-hand and off hand lead by 1\.20 %/);
  assert.match(html,/Healing specializations are not simulated/);
});
