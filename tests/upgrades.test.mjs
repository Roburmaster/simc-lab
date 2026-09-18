import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible,placements,buildCandidates,profilesetLines,profilesetResults,selectFinalists,raidDrop} from '../lib/upgrades.mjs';

const weaponSpecs=[{itemClass:2,itemSubClass:1,specsCanUse:[71,72,73]},{itemClass:2,itemSubClass:7,specsCanUse:[72,73,63]}];
const items=new Map([[10,{inventoryType:17,itemClass:2}],[11,{inventoryType:13,itemClass:2}],[12,{inventoryType:14,itemClass:4}],[13,{inventoryType:11,itemClass:4}]]);
const catalog={items};
const gear=(slot,id,extra='')=>({slot,id,value:`,id=${id}${extra}`});
const arms={info:{class:'warrior',spec:'arms',level:90},gear:{main_hand:gear('main_hand',10,',enchant_id=5'),finger1:gear('finger1',13,',gem_id=7/8'),finger2:gear('finger2',99)}};

test('eligibility follows class, loot spec, armor type, weapon use and primary stat',()=>{
  assert.ok(eligible({itemClass:4,itemSubClass:4,inventoryType:1,stats:[{id:74}]},arms.info,71,weaponSpecs));
  assert.equal(eligible({itemClass:4,itemSubClass:2,inventoryType:1,stats:[{id:72}]},arms.info,71,weaponSpecs),false);
  assert.equal(eligible({itemClass:4,itemSubClass:0,inventoryType:2,stats:[{id:5}]},arms.info,71,weaponSpecs),false);
  assert.equal(eligible({itemClass:4,itemSubClass:0,inventoryType:12,specs:[62]},arms.info,71,weaponSpecs),false);
  assert.equal(eligible({itemClass:4,itemSubClass:4,inventoryType:3,allowableClasses:[2]},arms.info,71,weaponSpecs),false);
  assert.equal(eligible({itemClass:2,itemSubClass:7,inventoryType:13,stats:[{id:72}]},arms.info,71,weaponSpecs),false);
  assert.ok(eligible({itemClass:4,itemSubClass:1,inventoryType:16,stats:[{id:71}]},{class:'warrior'},71,weaponSpecs),'cloaks are cloth for every class');
  assert.equal(eligible({itemClass:4,itemSubClass:6,inventoryType:14,stats:[{id:74}]},{class:'mage'},63,weaponSpecs),false);
});

test('weapons are placed like for like and unique rings avoid their twin',()=>{
  assert.deepEqual(placements({id:1,inventoryType:17,itemClass:2},arms,catalog),['main_hand']);
  assert.deepEqual(placements({id:2,inventoryType:13,itemClass:2},arms,catalog),[]);
  const fury={...arms,info:{...arms.info,spec:'fury'},gear:{...arms.gear,off_hand:gear('off_hand',10)}};
  assert.deepEqual(placements({id:1,inventoryType:17,itemClass:2},fury,catalog),['main_hand','off_hand']);
  assert.deepEqual(placements({id:2,inventoryType:13,itemClass:2},fury,catalog),['main_hand','off_hand']);
  const prot={info:{class:'warrior',spec:'protection',level:90},gear:{main_hand:gear('main_hand',11),off_hand:gear('off_hand',12)}};
  assert.deepEqual(placements({id:3,inventoryType:14,itemClass:4},prot,catalog),['off_hand']);
  assert.deepEqual(placements({id:4,inventoryType:17,itemClass:2},prot,catalog),[]);
  assert.deepEqual(placements({id:99,inventoryType:11,itemClass:4,uniqueEquipped:true},arms,catalog),['finger2']);
  assert.deepEqual(placements({id:98,inventoryType:11,itemClass:4},arms,catalog),['finger1','finger2']);
});

const season={
  tracks:[{id:617,name:'Hero',levels:[1,2,3,4,5,6].map(level=>({level,max:6,bonusId:12840+level,itemLevel:302+3*level})),finalDrop:null}],difficulties:[{name:'Heroic',track:617}],
  raids:[{id:1,name:'Raid',encounters:[{id:500,name:'Boss'},{id:-97,name:'Trash Drop'}]}],dungeons:[{id:700,name:'Old dungeon'}],delves:null,crafted:{id:-88,name:'Crafted'},
  craftedStats:[{bonusId:8791,name:'Critical Strike / Mastery'}],weaponSpecs,bonusSockets:{13668:1},
  entries:[
    {item:{id:20,name:'Ring',itemClass:4,itemSubClass:0,inventoryType:11,socketInfo:{sockets:[{}]}},source:{kind:'raid',group:500,groupName:'Boss',sequence:2}},
    {item:{id:20,name:'Ring',itemClass:4,itemSubClass:0,inventoryType:11,socketInfo:{sockets:[{}]}},source:{kind:'raid',group:-97,groupName:'Trash Drop',sequence:1}},
    {item:{id:21,name:'Old helm',itemClass:4,itemSubClass:4,inventoryType:1,expansion:7},source:{kind:'mplus',group:700,groupName:'Old dungeon'}},
    {item:{id:23,name:'Cursed band',itemClass:4,itemSubClass:0,inventoryType:11,bonusLists:[13708,13668]},source:{kind:'raid',group:500,groupName:'Boss',sequence:2}},
    {item:{id:22,name:'Crafted helm',itemClass:4,itemSubClass:4,inventoryType:1},source:{kind:'crafted',group:-33,groupName:'Blacksmithing'}}
  ]
};
const profile={info:{class:'warrior',spec:'arms',level:90},gear:{head:gear('head',30,',enchant_id=9'),finger1:gear('finger1',31,',enchant_id=4,gem_id=7/8'),finger2:gear('finger2',32)}};
for(const id of [20,21,22,23,30,31,32])items.set(id,{inventoryType:1,itemClass:4});

test('candidates carry enchants and fitting gems, merge sources and respect filters',()=>{
  const {candidates}=buildCandidates(profile,{raid:{enabled:true,difficulty:617},mplus:{enabled:true,track:617,level:1},crafted:{enabled:true,itemLevel:318,stats:8791}},season,catalog,71);
  const rings=candidates.filter(c=>c.slot==='finger1'&&c.itemId===20);
  assert.deepEqual(rings.map(c=>[c.line,c.itemLevel]),[['finger1=,id=20,bonus_id=12842,enchant_id=4,gem_id=7',308],['finger1=,id=20,bonus_id=12841,enchant_id=4,gem_id=7',305]],'boss and trash drop at their own levels');
  assert.ok(candidates.some(c=>c.line==='head=,id=21,bonus_id=12841,enchant_id=9'));
  assert.ok(candidates.some(c=>c.line==='finger1=,id=23,bonus_id=13708/13668/12842,enchant_id=4,gem_id=7'),'default bonuses and a bonus socket are kept');
  assert.ok(candidates.some(c=>c.line==='head=,id=22,bonus_id=8791,ilevel=318,enchant_id=9'));
  assert.deepEqual(candidates.map(c=>c.key),candidates.map((c,i)=>'c'+String(i+1).padStart(3,'0')));
  const bosses=buildCandidates(profile,{raid:{enabled:true,difficulty:617,encounters:[500]},slots:['finger2']},season,catalog,71).candidates;
  assert.deepEqual(bosses.map(c=>[c.slot,c.itemId,c.sources.length]).sort(),[['finger2',20,1],['finger2',23,1]]);
  const vault=buildCandidates(profile,{vault:{enabled:true,raid:{enabled:true,track:617,level:1}}},season,catalog,71).candidates;
  assert.ok(vault.every(c=>c.sources.every(s=>s.groupName!=='Trash Drop')));
  assert.throws(()=>buildCandidates(profile,{},season,catalog,71),/at least one gear source/);
  assert.throws(()=>buildCandidates(profile,{raid:{enabled:true,difficulty:1}},season,catalog,71),/difficulty/);
  assert.throws(()=>buildCandidates(profile,{vault:{enabled:true,raid:{enabled:true,track:1,level:1}}},season,catalog,71),/upgrade track/);
  assert.throws(()=>buildCandidates(profile,{raid:{enabled:true,difficulty:617,encounters:[1]}},season,catalog,71),/unknown selection/);
  assert.throws(()=>buildCandidates(profile,{crafted:{enabled:true,itemLevel:318,stats:1}},season,catalog,71),/secondary stats/);
});

test('a two-hander clears the off-hand for single-wield specs only',()=>{
  const p={info:{class:'warrior',spec:'arms',level:90},gear:{off_hand:gear('off_hand',12)}};
  const c={key:'c001',slot:'main_hand',itemId:10,line:'main_hand=,id=10,bonus_id=1'};
  assert.deepEqual(profilesetLines([c],p,catalog),['profileset."c001"=main_hand=,id=10,bonus_id=1','profileset."c001"+=off_hand=']);
  assert.deepEqual(profilesetLines([c],{...p,info:{...p.info,spec:'fury'}},catalog),['profileset."c001"=main_hand=,id=10,bonus_id=1']);
});

test('profileset results and finalist selection use both uncertainties',()=>{
  const report={sim:{players:[{collected_data:{dps:{mean:1000,mean_std_dev:5}}}],profilesets:{results:[{name:'c001',mean:1010,mean_stddev:5},{name:'c002',mean:995,mean_stddev:5},{name:'c003',mean:950,mean_stddev:5}]}}};
  const screen=profilesetResults(report);
  assert.ok(screen.baseline.error95>9.7&&screen.baseline.error95<9.9);
  const candidates=['c001','c002','c003'].map(key=>({key,slot:'head'}));
  assert.deepEqual(selectFinalists(candidates,screen,24).map(c=>c.key),['c001','c002']);
  const many=Array.from({length:10},(_,i)=>({key:'r'+i,slot:i%2?'finger1':'finger2'}));
  const rows={baseline:{dps:1,error95:0},rows:many.map((c,i)=>({key:c.key,dps:100-i,error95:0}))};
  assert.equal(selectFinalists(many,rows,24).length,4,'rings in both slots share one per-slot quota');
});

test('raid drops follow boss order, the final-boss level and optional upgrades',()=>{
  const myth={name:'Myth',levels:[1,2,3,4,5,6].map(level=>({level,max:6,bonusId:12848+level,itemLevel:[318,321,324,328,331,334][level-1]})),finalDrop:{bonusId:13848,itemLevel:344}};
  assert.deepEqual([1,2,3,4].map(n=>raidDrop(myth,n).itemLevel),[318,321,324,344]);
  assert.equal(raidDrop(myth,1,6).itemLevel,334);assert.equal(raidDrop(myth,3,2).itemLevel,324,'an upgrade never lowers a drop');
  assert.equal(raidDrop(myth,4,6).bonusId,13848,'final-boss drops already exceed the track');
  assert.equal(raidDrop({...myth,finalDrop:null},4).itemLevel,328);
});
