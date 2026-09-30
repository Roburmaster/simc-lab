import test from 'node:test';
import assert from 'node:assert/strict';
import {presetScenarios,scenarioPresets,markOverLimit,withoutTrinkets,levelSteps,trinketCandidates,trinketPairs,pairKey,pairLegal,pairCount,pairPool,selectPairs,tiedPairs,bestPartners,
  referenceMeta,specSteps,estimate,pairScreenSettings,resolveSettings,constructionKey} from '../lib/trinkets.mjs';
import {dropLevels} from '../lib/weapons.mjs';
import {profilesetLines} from '../lib/upgrades.mjs';
import {inputFor,reproduction,fightStyles} from '../lib/engine.mjs';

const track=(id,name,base,bonus)=>({id,name,levels:[1,2,3].map(level=>({level,max:3,bonusId:bonus+level,itemLevel:base+3*level}))});
const champion=track(616,'Champion',290,12780),hero=track(617,'Hero',305,12790),myth=track(618,'Myth',318,12800);
myth.finalDrop={bonusId:13848,itemLevel:344};
const trinket=(id,name,extra={})=>({id,name,itemClass:4,itemSubClass:0,inventoryType:12,stats:[],bonusLists:[],...extra});
const catalog={items:new Map([[70,{name:"Maze'roa"}]]),setBonuses:[{name:"Bite of Zul'jan",option:'bite_of_zuljan',pieces:2,classId:0,specId:0,items:[70,54]}]};
// Item 57 is born embellished: it uses the one-per-character category 512, as does the reference neck.
const itemLimits={items:new Map([[57,512]]),bonuses:new Map(),quantities:new Map([[512,1]])};
const season={
  season:{id:2,name:'Season 2'},tracks:[champion,hero,myth],difficulties:[{name:'Mythic',track:618}],weaponSpecs:[],bonusSockets:{},itemLimits,
  entries:[
    {item:trinket(50,'Idol',{bonusLists:[6652]}),source:{kind:'raid',group:1,groupName:'First boss',sequence:1}},
    {item:trinket(51,'Heart'),source:{kind:'raid',group:4,groupName:'Last boss',sequence:4}},
    {item:trinket(52,'Flask'),source:{kind:'mplus',group:700,groupName:'Murder Row'}},
    {item:trinket(53,'Card',{onUseTrinket:true}),source:{kind:'crafted',group:-1,groupName:'Inscription'}},
    {item:trinket(54,'Technique'),source:{kind:'raid',group:4,groupName:'Last boss',sequence:4}},
    {item:trinket(56,'Drum',{onUseTrinket:true}),source:{kind:'mplus',group:700,groupName:'Murder Row'}},
    {item:trinket(57,'Emblem'),source:{kind:'crafted',group:-1,groupName:'Inscription'}}
  ]
};
const profileText=['warrior="Ref"','spec=arms','talents=CgEAAAA','main_hand=maz,id=70','trinket1=a,id=80,bonus_id=1','trinket2=b,id=81','neck=n,id=90'].join('\n');
const reference={key:'warrior-arms',file:'MID2_Warrior_Arms.simc',season:'MID2',specId:71,info:{class:'warrior',spec:'arms'},text:profileText,gear:{main_hand:{id:70},trinket1:{id:80},trinket2:{id:81},neck:{id:90}}};
const arms=withoutTrinkets(reference);
const drops=dropLevels(season,{craftedCap:331}).of;
const steps=levelSteps(season);
const list=trinketCandidates(arms,season,catalog,{drops,steps});
const tops=list.filter(c=>c.top&&!c.setOff);
const by=name=>tops.find(c=>c.name===name);

test('every candidate records the exact item SimC is given',()=>{
  const heart=by('Heart');
  assert.deepEqual(heart.item,{id:51,itemLevel:344,bonusIds:[13848]});
  assert.deepEqual(by('Idol').item,{id:50,itemLevel:327,bonusIds:[6652,12803]},'the default bonus list comes first, then the level');
  assert.deepEqual(by('Card').item,{id:53,itemLevel:331,bonusIds:[],ilevel:331},'crafted is set by item level');
  assert.deepEqual(by('Emblem').limits,[512]);
  for(const c of list)assert.match(c.line,new RegExp(`^trinket1=,id=${c.item.id}(,bonus_id=${c.item.bonusIds.join('/')})?(,ilevel=${c.item.ilevel})?$`));
});

test('pairs: each unordered pair once, never the same trinket twice',()=>{
  const pool=[by('Idol'),by('Heart'),by('Flask'),by('Technique')];
  const pairs=trinketPairs(pool);
  assert.equal(pairs.length,pairCount(4));
  assert.equal(new Set(pairs.map(p=>p.pairKey)).size,6);
  assert.equal(new Set(pairs.map(p=>p.key)).size,6);
  assert.ok(pairs.every(p=>p.parts[0].itemId!==p.parts[1].itemId));
  assert.equal(pairKey(by('Idol'),by('Heart')),pairKey(by('Heart'),by('Idol')),'order does not change the pair');
  assert.deepEqual(trinketPairs([...pool,...pool]).map(p=>p.pairKey),pairs.map(p=>p.pairKey),'a pool with repeats gives the same pairs');
  // The same item at two levels is still one item.
  const idols=list.filter(c=>c.name==='Idol');
  assert.equal(pairLegal(idols[0],idols[1]),false);
  assert.equal(trinketPairs(idols).length,0);
});

test('a pair wears one trinket in each slot, with its own options',()=>{
  const technique=list.find(c=>c.name==='Technique'&&c.top&&c.setOff);
  const [pair]=trinketPairs([by('Heart'),technique],{prefix:'p0-'});
  assert.deepEqual(pair.parts.map(p=>p.slot),['trinket1','trinket2']);
  const lines=profilesetLines([pair],arms,catalog);
  assert.deepEqual(lines,[
    `profileset."p0-0001"=trinket1=,id=51,bonus_id=13848`,
    `profileset."p0-0001"+=trinket2=,id=54,bonus_id=13848`,
    `profileset."p0-0001"+=set_bonus=bite_of_zuljan_2pc=0`
  ]);
  assert.notEqual(constructionKey(technique),constructionKey(list.find(c=>c.name==='Technique'&&c.top&&!c.setOff)),'with and without the set bonus are different constructions');
});

test('two on-use trinkets are simulated in both slot orders under one pair key',()=>{
  const pairs=trinketPairs([by('Card'),by('Drum'),by('Heart')]);
  const onUse=pairs.filter(p=>p.onUse===2);
  assert.equal(onUse.length,2);
  assert.equal(onUse[0].pairKey,onUse[1].pairKey);
  assert.deepEqual(onUse[0].parts.map(p=>p.itemId),onUse[1].parts.map(p=>p.itemId).reverse());
  assert.equal(pairs.filter(p=>p.onUse===1).length,2,'on-use beside passive, once each');
  assert.equal(pairs.filter(p=>p.onUse===0).length,0);
  const lines=profilesetLines(onUse,arms,catalog);
  assert.equal(lines.filter(l=>/=trinket1=/.test(l)).length,2);assert.equal(lines.filter(l=>/\+=trinket2=/.test(l)).length,2);
});

test('equip limits count the rest of the gear',()=>{
  const legal={equipped:{neck:new Set([512])},itemLimits};
  assert.equal(pairLegal(by('Emblem'),by('Heart'),legal),false,'the neck already holds the only embellishment');
  assert.equal(pairLegal(by('Emblem'),by('Heart'),{equipped:{},itemLimits}),true);
  const twice={...by('Heart'),itemId:99,limits:[512]};
  assert.equal(pairLegal(by('Emblem'),twice,{equipped:{},itemLimits}),false,'two in one pair');
});

test('the pair pool keeps the best, the near misses and the best on-use trinkets',()=>{
  const rows=tops.map((c,i)=>({key:c.key,rank:i+1,percent:{Idol:5,Heart:4.9,Flask:4.6,Card:1,Technique:4.2,Drum:3,Emblem:0.5}[c.name]}));
  const names=pool=>pool.map(c=>c.name).sort();
  assert.deepEqual(names(pairPool(list,rows,{size:2,margin:0.5,onUse:0})),['Flask','Heart','Idol'],'Flask is within 0.5 of the cutoff');
  assert.deepEqual(names(pairPool(list,rows,{size:2,margin:0.5,onUse:1})),['Drum','Flask','Heart','Idol'],'and the best on-use trinket');
  assert.deepEqual(names(pairPool(list,rows,{size:2,margin:0.5,onUse:2})),['Card','Drum','Flask','Heart','Idol']);
  assert.equal(pairPool(list,rows,{size:0}).length,tops.length,'0 takes every trinket');
  const noset=list.find(c=>c.setOff&&c.top);
  assert.ok(!pairPool(list,[...rows,{key:noset.key,rank:9,percent:9}],{size:0}).includes(noset),'the variant without its set bonus is only a diagnostic');
});

test('screening keeps the best pairs and those it cannot tell from them',()=>{
  const pairs=trinketPairs([by('Idol'),by('Heart'),by('Flask'),by('Card'),by('Technique')]);
  const dps=[100,99,98,97.5,90,80,70,60,50,40,30];
  const screen={rows:pairs.map((p,i)=>({key:p.key,dps:dps[i]??10,error95:1}))};
  const kept=selectPairs(pairs,screen,2);
  assert.deepEqual(kept.map(p=>p.key),pairs.slice(0,3).map(p=>p.key),'98 is inside the uncertainty of 99, 97.5 is not');
  assert.equal(selectPairs(pairs,screen,0).length,pairs.length);
  const tied=tiedPairs(pairs,screen.rows,null);
  assert.deepEqual(tied.map(p=>p.key),pairs.slice(0,2).map(p=>p.key),'within √2 of the leader');
  assert.deepEqual(tiedPairs(pairs,screen.rows.map((r,i)=>({...r,dps:1000-100*i})),null),[],'a clear leader needs no resolution');
});

test('each trinket names its best partner',()=>{
  const pairs=trinketPairs([by('Idol'),by('Heart'),by('Flask')]);
  const ranked=[{key:pairs[2].key,rank:1},{key:pairs[0].key,rank:2,tied:true},{key:pairs[1].key,rank:3}];
  const partners=new Map(bestPartners(ranked,pairs).map(p=>[p.key,p]));
  const [a,b]=pairs[2].keys;
  assert.equal(partners.get(a).partner,b);assert.equal(partners.get(b).partner,a);
  assert.equal(partners.size,3);
  const third=[...partners.values()].find(p=>p.rank===2);
  assert.ok(third.tied);
});

test('the job states what it will simulate before it starts',()=>{
  const spec={...arms,candidates:list,support:false,tank:null};
  assert.equal(specSteps(spec,64,2,'pairs'),2*(1+3));
  assert.equal(specSteps(spec,64,2,'statstick'),2);
  assert.equal(specSteps({...spec,tank:{}},2,1,'pairs'),2+3+1);
  const plan={specs:[spec],finalists:64,model:'pairs',pool:4,pairFinalists:3};
  const e=estimate(plan,3);
  assert.equal(e.specs[0].pool,4);assert.equal(e.specs[0].pairs,6);assert.equal(e.specs[0].finals,3);
  assert.equal(e.specs[0].profilesets,3*(list.length+6+3));
  assert.equal(e.runs,3*4);
  assert.equal(estimate({...plan,model:'statstick'},1).pairs,0);
});

test('reference metadata names the profile and hashes what SimC is given',()=>{
  const meta=referenceMeta(reference,arms);
  assert.deepEqual({...meta,hash:undefined},{source:'simulationcraft',file:'MID2_Warrior_Arms.simc',season:'MID2',profileType:'raid',hash:undefined,talents:'CgEAAAA'});
  assert.match(meta.hash,/^[0-9a-f]{16}$/);
  assert.equal(referenceMeta(reference,arms).hash,meta.hash,'stable');
  assert.notEqual(referenceMeta(reference,{text:arms.text+'\nx'}).hash,meta.hash);
  assert.equal(referenceMeta({...reference,ours:true},arms).source,'simc-lab');
});

test('pair rounds are more precise than isolated screening, and resolution more than the final',()=>{
  assert.deepEqual(pairScreenSettings({iterations:20000,targetError:0.1}),{iterations:5000,targetError:0.3});
  assert.deepEqual(resolveSettings({iterations:20000,targetError:0.1}),{iterations:100000,targetError:0.05});
  assert.deepEqual(resolveSettings({iterations:10000,targetError:0}),{iterations:100000,targetError:0.05});
  assert.deepEqual(resolveSettings({iterations:10000,targetError:0.02}),{iterations:100000,targetError:0.02});
});

// The SimC input of a pair run, fixed: any change to it shows here.
test('the generated SimC input is stable',()=>{
  assert.ok(fightStyles.includes('CastingPatchwerk'));
  const settings={iterations:20000,targetError:0.1,duration:300,threads:4,environment:null,tank:null};
  const pairs=trinketPairs([by('Idol'),by('Heart')],{prefix:'p0-'});
  const input=inputFor({text:arms.text},settings,{style:'CastingPatchwerk',targets:1},{json:'C:\\runs\\000.json',html:'C:\\runs\\000.html'})+profilesetLines(pairs,arms,catalog).join('\n')+'\n';
  assert.equal(input,`warrior="Ref"
spec=arms
talents=CgEAAAA
main_hand=maz,id=70
neck=n,id=90

# Controlled by SimC Lab
ptr=0
item_db_source=local
iterations=20000
target_error=0.1
max_time=300
vary_combat_length=0.2
threads=4
fight_style=CastingPatchwerk
desired_targets=1
calculate_scale_factors=0

json2="C:/runs/000.json"
html="C:/runs/000.html"
profileset."p0-0001"=trinket1=,id=51,bonus_id=13848
profileset."p0-0001"+=trinket2=,id=50,bonus_id=6652/12803
`);
});

test('a job records the SimC commit, build and every setting of the fight',()=>{
  const plan={engine:{commit:'a69b069',branch:'midnight',version:'1210-01',wowVersion:'12.1.0.69933',hotfix:'x'},settings:{iterations:20000,targetError:0.1,duration:300,environment:{variation:20}},
    scenarios:[{style:'Patchwerk',targets:1},{preset:'mplus_large',label:'Mythic+ · large pull',style:'Patchwerk',targets:5,duration:60}],trinkets:{model:'pairs',pool:16,pairFinalists:20}};
  assert.deepEqual(reproduction(plan),{simcSha:'a69b069',simcBranch:'midnight',simcVersion:'1210-01',wowBuild:'12.1.0.69933',hotfix:'x',ptr:0,
    scenarios:[{fightStyle:'Patchwerk',targets:1,duration:300},{preset:'mplus_large',label:'Mythic+ · large pull',fightStyle:'Patchwerk',targets:5,duration:60}],duration:300,variation:0.2,iterations:20000,targetError:0.1,model:'pairs',pool:16,pairFinalists:20});
});

test('a trinket the reference gear leaves no room for is marked and never paired',()=>{
  const marked=markOverLimit(list.map(c=>({...c})),{neck:new Set([512])},itemLimits);
  const emblem=marked.filter(c=>c.name==='Emblem');
  assert.ok(emblem.length&&emblem.every(c=>c.overLimit?.[0]==='Embellished'));
  assert.ok(marked.filter(c=>c.name!=='Emblem').every(c=>!c.overLimit));
  const rows=marked.filter(c=>c.top&&!c.setOff).map((c,i)=>({key:c.key,rank:i+1,percent:c.name==='Emblem'?99:10-i}));
  assert.ok(!pairPool(marked,rows,{size:3}).some(c=>c.name==='Emblem'),'it takes no place in the pool');
  assert.equal(markOverLimit(list.map(c=>({...c})),{},itemLimits).some(c=>c.overLimit),false,'with room left it is worn');
});

test('scenario presets: raid and Mythic+ fights, pulls at their own length',()=>{
  const list=presetScenarios(['raid_st','mplus_small','dungeon']);
  assert.deepEqual(list,[{preset:'raid_st',label:'Raid · single target',style:'Patchwerk',targets:1},{preset:'mplus_small',label:'Mythic+ · small pull',style:'Patchwerk',targets:3,duration:40,bloodlust:false,potion:false},{preset:'dungeon',label:'Mythic+ · dungeon route',style:'DungeonSlice',targets:1}]);
  assert.throws(()=>presetScenarios(['nope']),/Unknown scenario/);
  assert.throws(()=>presetScenarios([]),/at least one/);
  assert.ok(scenarioPresets.every(p=>fightStyles.includes(p.style)));
  const input=inputFor({text:'warrior="x"'},{iterations:100,targetError:0,duration:300,threads:1},list[1],{json:'a',html:'b'});
  assert.match(input,/^max_time=40$/m);assert.match(input,/^desired_targets=3$/m);
  assert.ok(input.includes('\noverride.bloodlust=0\npotion=disabled\noverride.allow_potions=0\n'),'a small pull has no Bloodlust and no potion');
  assert.equal(/potion=disabled/.test(inputFor({text:'warrior="x"'},{iterations:100,targetError:0,duration:300,threads:1},presetScenarios(['mplus_large'])[0],{json:'a',html:'b'})),false,'a large pull keeps them');
  assert.match(inputFor({text:'warrior="x"'},{iterations:100,targetError:0,duration:300,threads:1},list[0],{json:'a',html:'b'}),/^max_time=300$/m);
});

test('a trinket that rolls a stat or has a mode is one entry per choice',async()=>{
  const {trinketVariants,trinketOverrides}=await import('../lib/trinketoverrides.mjs');
  assert.deepEqual(trinketVariants(1,[5,6]),[{bonuses:[5,6],options:[]}],'no override, one variant');
  const drum=trinketVariants(248583,[13183,12838]);
  assert.deepEqual(drum.map(v=>[v.label,v.bonuses]),[['Crit',[13183,12838]],['Haste',[13184,12838]],['Mastery',[13185,12838]],['Versatility',[13186,12838]]],'the rolled stat is replaced in place');
  assert.deepEqual(trinketVariants(250462,[]).map(v=>v.bonuses),[[606],[604],[605],[607]]);
  const crucible=trinketVariants(264507,[1]);
  assert.equal(crucible.length,4);assert.deepEqual(crucible[0].options,['midnight.crucible_of_erratic_energies_violence=1']);
  assert.ok([...trinketOverrides.values()].every(o=>o.variants.length>1));
  const s={...season,entries:[{item:trinket(248583,'Drum',{bonusLists:[13183],onUseTrinket:true}),source:{kind:'mplus',group:700,groupName:'Murder Row'}},{item:trinket(264507,'Crucible'),source:{kind:'raid',group:1,groupName:'First boss',sequence:1}}]};
  const rows=trinketCandidates(arms,s,catalog,{drops,steps});
  const tops=rows.filter(c=>c.top);
  assert.deepEqual(tops.map(c=>c.name),['Crucible (Violence)','Crucible (Sustenance)','Crucible (Predation)','Crucible (All three)','Drum (Crit)','Drum (Haste)','Drum (Mastery)','Drum (Versatility)']);
  assert.equal(new Set(tops.map(c=>c.group)).size,8,'each choice is its own entry');
  assert.deepEqual(tops[0].extra,['midnight.crucible_of_erratic_energies_violence=1']);
  assert.match(tops.find(c=>c.choice==='Haste').line,/bonus_id=13184\/12793$/);
  const lines=profilesetLines(trinketPairs([tops[0],tops[5]],{prefix:'p0-'}),arms,catalog);
  assert.ok(lines.includes('profileset."p0-0001"+=midnight.crucible_of_erratic_energies_violence=1'),lines.join('\n'));
  const ranked=tops.map((c,i)=>({key:c.key,rank:i+1,percent:10-i}));
  assert.deepEqual(pairPool(rows,ranked,{size:0}).map(c=>c.name),['Crucible (Violence)','Drum (Crit)'],'only the best choice of each trinket is paired');
});

test('Bloodmallet parity builds the same input Bloodmallet does',async()=>{
  const {parityProfile,primaryStat,statSticks}=await import('../lib/trinkets.mjs');
  assert.equal(primaryStat({class:'warrior',spec:'fury'}),'strength');
  assert.equal(primaryStat({class:'deathknight',spec:'blood'}),'strength');
  assert.equal(primaryStat({class:'paladin',spec:'holy'}),'intellect');
  assert.equal(primaryStat({class:'monk',spec:'windwalker'}),'agility');
  assert.equal(primaryStat({class:'shaman',spec:'elemental'}),'intellect');
  assert.deepEqual(statSticks,{agility:142506,intellect:142507,strength:142508});
  const p=parityProfile(arms,299);
  assert.ok(p.text.endsWith('\ntrinket2=,id=142508,bonus_id=607,ilevel=299\npotion=lights_potential_2'));
  const rows=trinketCandidates(arms,season,catalog,{drops,steps,parity:true});
  for(const c of rows)assert.match(c.line,/^trinket1=,id=\d+,ilevel=\d+$/,'item ID and item level only');
  assert.deepEqual(rows.filter(c=>c.name==='Heart').map(c=>c.itemLevel),[299,314,327],'every step, whatever the source');
  assert.equal(rows.filter(c=>c.setOff).length,0,'no set variant');
});

test('the stat stick model keeps a neutral second trinket in the baseline and beside every candidate',async()=>{
  const {statStickProfile,parityProfile,models}=await import('../lib/trinkets.mjs');
  assert.equal(models.statstick,'Stat stick tier list only');assert.equal(models.pairs,'Stat stick tier list and best pairs');
  const p=statStickProfile(arms,299);
  assert.ok(p.text.endsWith('\ntrinket2=,id=142508,bonus_id=607,ilevel=299'),'strength stick for Arms, at the lowest step');
  assert.equal(/potion=/.test(p.text.split('trinket2=')[1]),false,'no forced potion outside parity');
  assert.deepEqual(p.statStick,{trinket2:',id=142508,bonus_id=607,ilevel=299',stick:142508,itemLevel:299});
  // Realistic candidates are unchanged: bonus IDs and source levels, in the first slot only.
  const rows=trinketCandidates(arms,season,catalog,{drops,steps});
  const lines=profilesetLines(rows.filter(c=>c.top).slice(0,2),p,catalog);
  assert.ok(lines.every(l=>/^profileset\."t\d{4}"(=trinket1=|\+=)/.test(l)));
  assert.ok(parityProfile(arms,299).text.includes('\ntrinket2=,id=142508,bonus_id=607,ilevel=299\npotion=lights_potential_2'),'parity still adds the potion');
  assert.equal(specSteps({candidates:rows,support:false,tank:null},64,2,'statstick'),2,'no pair rounds');
});

test('an embellished trinket is worn in place of an embellishment the gear can give up',async()=>{
  const {freeableSlots,resolveOverLimit}=await import('../lib/trinkets.mjs');
  // Two crafted pieces carry the Embellished marker 8960 with an embellishment's effect bonus; one piece is born embellished.
  const limits={items:new Map([[300,512]]),bonuses:new Map([[8960,512]]),quantities:new Map([[512,2]])};
  const s={itemLimits:limits,embellishments:[{name:'Arcanoweave Lining',bonusIds:[8960,12384]},{name:"Hunter's Ritual Stone",bonusIds:[13771,8960]}]};
  const gear={wrist:{id:100,value:'bracers,id=100,bonus_id=8793/8960/12384/13750,ilevel=331'},off_hand:{id:200,value:'impetus,id=200,bonus_id=8960/13771/13836'},neck:{id:300,value:'band,id=300,bonus_id=1'},head:{id:400,value:'helm,id=400,bonus_id=5'}};
  const spec={gear};
  const free=freeableSlots(spec,s,{items:new Map([[100,{name:"Spellbreaker's Bracers"}]])});
  assert.deepEqual(free.map(f=>[f.slot,f.embellishment,f.line]),[
    ['wrist','Arcanoweave Lining','wrist=bracers,id=100,bonus_id=8793/13750,ilevel=331'],
    ['off_hand',"Hunter's Ritual Stone",'off_hand=impetus,id=200,bonus_id=13836']
  ],'the born embellished neck cannot be freed');
  assert.equal(free[0].item,"Spellbreaker's Bracers");
  // The gear wears two; an embellished trinket goes in once per piece that can give its embellishment up.
  const equipped={wrist:new Set([512]),off_hand:new Set([512])};
  const cands=[{key:'a',itemId:1,name:'Dominion',group:'1',limits:[512],extra:['x=1']},{key:'b',itemId:2,name:'Heart',group:'2'}];
  const out=resolveOverLimit(cands,{equipped,itemLimits:limits,free});
  assert.deepEqual(out.map(c=>[c.name,c.freed?.slot??null,c.extra]),[['Dominion','wrist',['x=1',free[0].line]],['Dominion','off_hand',['x=1',free[1].line]],['Heart',null,undefined]]);
  assert.deepEqual(out.map(c=>c.key),['t0001','t0002','t0003']);
  // With nothing to give up, it stays marked as over the limit.
  const stuck=resolveOverLimit(cands,{equipped,itemLimits:limits,free:[]});
  assert.deepEqual(stuck[0].overLimit,['Embellished']);
  // With room to spare nothing changes.
  assert.equal(resolveOverLimit(cands,{equipped:{wrist:new Set([512])},itemLimits:limits,free}).length,2);
  // Pairs: two embellished trinkets need two pieces freed; freeing the same piece twice is not enough.
  const [dw,doff]=out,other={key:'c',itemId:3,name:'Stone',group:'3',limits:[512],freed:{slot:'wrist'}};
  assert.equal(pairLegal(dw,out[2],{equipped,itemLimits:limits}),true);
  assert.equal(pairLegal(dw,other,{equipped,itemLimits:limits}),false,'both give up the bracers');
  assert.equal(pairLegal(doff,other,{equipped,itemLimits:limits}),true,'one gives up the bracers, the other the off-hand');
});

test('the other slot is never left empty: only stat stick models are offered',async()=>{
  const {models}=await import('../lib/trinkets.mjs');
  assert.deepEqual(Object.keys(models),['pairs','statstick']);
});
