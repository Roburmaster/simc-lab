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
  const candidates=['c001','c002','c003'].map(key=>({key,slot:'head',value:',id='+key}));
  assert.deepEqual(selectFinalists(candidates,screen,24).map(c=>c.key),['c001','c002']);
  const many=Array.from({length:10},(_,i)=>({key:'r'+i,slot:i%2?'finger1':'finger2',value:',id='+i}));
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

test('only the better placement of a ring or trinket goes to the final round',()=>{
  const candidates=[{key:'a',slot:'finger1',value:',id=7'},{key:'b',slot:'finger2',value:',id=7'},{key:'c',slot:'finger2',value:',id=8'}];
  const screen={baseline:{dps:100,error95:0},rows:[{key:'a',dps:120,error95:0},{key:'b',dps:125,error95:0},{key:'c',dps:110,error95:0}]};
  assert.deepEqual(selectFinalists(candidates,screen,24).map(c=>c.key),['b','c']);
});

test('SimC progress lines give the running step a fraction',async()=>{
  const {parseProgress,jobFraction}=await import('../lib/engine.mjs');
  assert.deepEqual(parseProgress('Generating Baseline: 1/1 [=====] 400/400 600'),{phase:'baseline',name:null,set:1,sets:1,iteration:400,iterations:400,fraction:1});
  const p=parseProgress('Generating Baseline: 1/1 [==] 10/10\rGenerating Profileset: c057 58/117 [==>..] 1000/2000 287788.1 (1m 2s)');
  assert.equal(p.name,'c057');assert.ok(Math.abs(p.fraction-57.5/117)<1e-9);
  assert.equal(parseProgress('Simulating...'),null);
  assert.equal(jobFraction({status:'running',done:1,total:3,progress:{fraction:0.5}}),0.5);
  assert.equal(jobFraction({status:'queued',done:0,total:3}),0);
});

test('embellishments come from the crafting slots, current expansion only, at their best quality',async()=>{
  const {embellishmentData,itemLimitsOf}=await import('../lib/upgrades.mjs');
  const crafting={slots:{391:{reagentSlotId:391,name:'Add Embellishment',reagentIds:[1,2,3,4]},392:{reagentSlotId:392,name:'Infuse with Power',reagentIds:[5]}},reagents:[
    {id:1,name:'Lining',expansion:11,craftingQuality:1,itemLimit:{category:512,quantity:2},craftingBonusIds:[8960,12384]},
    {id:2,name:'Lining',expansion:11,craftingQuality:2,itemLimit:{category:512,quantity:2},craftingBonusIds:[8960,12384]},
    {id:3,name:'Old patch',expansion:10,craftingQuality:3,itemLimit:{category:512,quantity:2},craftingBonusIds:[8960,9379]},
    {id:4,name:'Keychain',expansion:11,craftingBonusIds:[12715]},{id:5,name:'Spark',expansion:11,craftingBonusIds:[1]}]};
  const bonusText='  { 19326, 8960, 35,     512,       0,       0,       0,  0 },\n  { 26417, 12384, 23,  208649,       0,       0,       0,  0 },';
  const {embellishments,limits}=embellishmentData(crafting,[{id:77,itemLimit:{category:512,quantity:2}}],bonusText,11);
  assert.deepEqual(embellishments.map(e=>[e.id,e.name,e.slots]),[[2,'Lining',[391]]]);
  assert.equal(limits.quantities.get(512),2);
  assert.deepEqual([...itemLimitsOf(77,[8960],limits)],[512],'a born-embellished item counts once');
  assert.deepEqual([...itemLimitsOf(5,[8790],limits)],[]);
  assert.deepEqual(embellishmentData(null,[],bonusText,11).embellishments,[]);
});

const embSeason=()=>{
  const limits={bonuses:new Map([[8960,512]]),items:new Map([[41,512]]),quantities:new Map([[512,2]])};
  const craft={optionalCraftingSlots:[{id:391}]};
  return {...season,itemLimits:limits,embellishments:[{id:2,name:'Lining',bonusIds:[8960,12384],category:512,slots:[391]}],entries:[
    {item:{id:40,name:'Crafted bracers',itemClass:4,itemSubClass:4,inventoryType:9,profession:craft},source:{kind:'crafted',group:-33,groupName:'Blacksmithing'}},
    {item:{id:42,name:'Crafted boots',itemClass:4,itemSubClass:4,inventoryType:8,profession:craft},source:{kind:'crafted',group:-33,groupName:'Blacksmithing'}},
    {item:{id:41,name:'Born band',itemClass:4,itemSubClass:0,inventoryType:11},source:{kind:'crafted',group:-37,groupName:'Jewelcrafting'}}]};
};
for(const id of [40,41,42,50,51])items.set(id,{inventoryType:1,itemClass:4,name:'Item '+id});

test('crafted pieces are tried with each embellishment, and nothing breaks the equip limit',()=>{
  const data=embSeason(),request={crafted:{enabled:true,itemLevel:321,stats:8791}};
  const free=buildCandidates(profile,request,data,catalog,71);
  assert.ok(free.candidates.some(c=>c.line==='wrist=,id=40,bonus_id=8791,ilevel=321'));
  const lined=free.candidates.find(c=>c.line==='wrist=,id=40,bonus_id=8791/8960/12384,ilevel=321');
  assert.equal(lined.embellishment,'Lining');assert.deepEqual(lined.limits,[512]);assert.match(lined.sources[0].label,/Lining$/);
  assert.ok(free.embellished);assert.equal(free.blocked,0);
  assert.equal(buildCandidates(profile,{crafted:{...request.crafted,embellishments:[]}},data,catalog,71).candidates.filter(c=>c.embellishment).length,0,'an empty choice means plain only');
  assert.throws(()=>buildCandidates(profile,{crafted:{...request.crafted,embellishments:[9]}},data,catalog,71),/unknown selection/);
  // Two embellished items already worn: only the slots that hold one can take another.
  const full={...profile,gear:{...profile.gear,wrist:gear('wrist',50,',bonus_id=8790/8960/12693'),finger2:gear('finger2',41)}};
  const capped=buildCandidates(full,request,data,catalog,71);
  assert.ok(capped.candidates.some(c=>c.slot==='wrist'&&c.embellishment),'replacing an embellished piece stays legal');
  assert.ok(!capped.candidates.some(c=>c.slot==='feet'&&c.embellishment),'a third embellishment is never offered');
  assert.ok(capped.candidates.some(c=>c.slot==='feet'&&!c.embellishment));
  assert.ok(capped.candidates.some(c=>c.slot==='finger2'&&c.itemId===41)&&!capped.candidates.some(c=>c.slot==='finger1'&&c.itemId===41),'a born-embellished band only replaces an embellished ring');
  assert.ok(capped.blocked>0);assert.deepEqual(capped.limitsUsed.map(h=>h.slot).sort(),['finger2','wrist']);
});

test('embellishment pairs are the best embellished upgrades that can be worn together',async()=>{
  const {embellishmentPairs,profilesetLines:lines,upgradeSteps}=await import('../lib/upgrades.mjs');
  const data=embSeason();
  const one={...profile,gear:{...profile.gear,wrist:gear('wrist',50,',bonus_id=8790/8960/12693')}};
  const {candidates}=buildCandidates(one,{crafted:{enabled:true,itemLevel:321,stats:8791}},data,catalog,71);
  assert.equal(upgradeSteps({embellished:true},2),6);assert.equal(upgradeSteps({embellished:false},2),4);
  const rows=candidates.map((c,i)=>({key:c.key,dps:1100-i}));
  const pairs=embellishmentPairs(candidates,rows,{dps:1000},one,data,catalog);
  assert.ok(pairs.length>0);
  for(const p of pairs){
    const slots=p.parts.map(c=>c.slot);
    assert.ok(slots.includes('wrist'),'with one embellishment kept on the wrists, every pair must replace it: '+slots);
    assert.equal(new Set(slots).size,2);
  }
  const text=lines(pairs.slice(0,1),one,catalog);
  assert.equal(text.length,2);assert.match(text[0],/^profileset\."p001"=/);assert.match(text[1],/^profileset\."p001"\+=/);
  assert.deepEqual(embellishmentPairs(candidates,rows.map(r=>({...r,dps:900})),{dps:1000},one,data,catalog),[],'nothing that lost is paired');
});
