import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {weaponCandidates,prepareWeapons,selectTop,rankWeaponRows,loadReferenceSpecs,clearReferenceCache,weaponSteps,actorGear,dropLevels} from '../lib/weapons.mjs';

const weaponSpecs=[{itemClass:2,itemSubClass:1,specsCanUse:[71,72,73]},{itemClass:2,itemSubClass:7,specsCanUse:[72,73]},{itemClass:2,itemSubClass:15,specsCanUse:[73]}];
const items=new Map([[10,{inventoryType:17,itemClass:2}],[11,{inventoryType:13,itemClass:2}],[12,{inventoryType:14,itemClass:4}]]);
const catalog={items};
const gear=(slot,id,extra='')=>({slot,id,value:`,id=${id}${extra}`});
// Two tracks, as a season has: dungeon and delve loot stops on the lower one, only the raid reaches the top.
const hero={id:617,name:'Hero',levels:[1,2,3].map(level=>({level,max:3,bonusId:12820+level,itemLevel:317+level}))};
const myth={id:618,name:'Myth',levels:[1,2,3].map(level=>({level,max:3,bonusId:12840+level,itemLevel:330+level}))};
myth.finalDrop={bonusId:13999,itemLevel:344};
const track=myth;
const weapon=(id,name,inventoryType,itemSubClass=1,extra={})=>({id,name,itemClass:2,itemSubClass,inventoryType,stats:[{id:4}],...extra});
const craftedStats=[{bonusId:8790,name:'Critical Strike / Haste'},{bonusId:8791,name:'Critical Strike / Mastery'}];
const season={
  season:{id:2,name:'Season 2'},tracks:[hero,myth],difficulties:[{name:'Heroic',track:617},{name:'Mythic',track:618}],weaponSpecs,bonusSockets:{},craftedStats,
  entries:[
    {item:weapon(30,'Great axe',17),source:{kind:'raid',group:500,groupName:'Boss',sequence:1}},
    {item:weapon(31,'Hand axe',13),source:{kind:'mplus',group:700,groupName:'Dungeon'}},
    {item:weapon(32,'Dagger',13,15),source:{kind:'mplus',group:700,groupName:'Dungeon'}},
    {item:{id:33,name:'Bulwark',itemClass:4,itemSubClass:6,inventoryType:14,stats:[{id:4}]},source:{kind:'raid',group:500,groupName:'Boss',sequence:5}},
    {item:{id:34,name:'Tome',itemClass:4,itemSubClass:0,inventoryType:23,stats:[{id:5}]},source:{kind:'raid',group:500,groupName:'Boss',sequence:1}},
    {item:weapon(35,'Forged axe',17),source:{kind:'crafted',group:-33,groupName:'Blacksmithing'}},
    {item:weapon(36,'Deep axe',17),source:{kind:'delves',group:-88,groupName:'Delves Season 2'}}
  ]
};
const arms={specId:71,info:{class:'warrior',spec:'arms',level:90},gear:{main_hand:gear('main_hand',10,',enchant_id=5')}};
const prot={specId:73,info:{class:'warrior',spec:'protection',level:90},gear:{main_hand:gear('main_hand',11),off_hand:gear('off_hand',12)}};
const drops=(options={})=>dropLevels(season,options).of;
const all={drops:drops(),kinds:['main','offhand','shield','held'],craftedStats};

test('candidates are like-for-like, and carry the reference enchant',()=>{
  const list=weaponCandidates(arms,season,catalog,all);
  const drop=list.find(c=>c.name==='Great axe');
  assert.equal(drop.line,'main_hand=,id=30,bonus_id=12843,enchant_id=5');
  assert.deepEqual(drop.sources,['Raid · Boss']);
  assert.equal(new Set(list.map(c=>c.key)).size,list.length);
  assert.ok(list.every(c=>c.key.startsWith('w')));
});

test('a weapon is ranked at the level its own source can give it, and a delve weapon never above its track',()=>{
  const list=weaponCandidates(prot,season,catalog,all);
  const level=name=>list.find(c=>c.name===name);
  assert.equal(level('Hand axe').itemLevel,320,'dungeon loot stops at the top of the Hero track');
  assert.equal(level('Deep axe')?.itemLevel,undefined,'a two-hander is not for this profile');
  assert.equal(weaponCandidates(arms,season,catalog,all).find(c=>c.name==='Deep axe').itemLevel,320,'delve loot stops there too');
  assert.equal(level('Bulwark').itemLevel,344,'a late raid boss drops above its track');
  assert.equal(weaponCandidates(arms,season,catalog,all).find(c=>c.name==='Great axe').itemLevel,333,'an early boss reaches the top of the Myth track');
  const crafted=weaponCandidates(arms,season,catalog,all).find(c=>c.craftedStat);
  assert.equal(crafted.itemLevel,320,'crafted sits at its own level');
  assert.match(crafted.line,/ilevel=320/);
  // Equal footing is the deliberate exception: one level for everything, whatever the source could give.
  const equal=weaponCandidates(arms,season,catalog,{...all,drops:drops({equal:true,track:myth.id,level:3})});
  assert.deepEqual([...new Set(equal.map(c=>c.itemLevel))],[333]);
});

test('a crafted weapon is offered once per chosen stat pair, and never without one',()=>{
  const list=weaponCandidates(arms,season,catalog,all);
  const forged=list.filter(c=>c.name==='Forged axe');
  assert.deepEqual(forged.map(c=>c.craftedStat),['Critical Strike / Haste','Critical Strike / Mastery']);
  // The pair sits in the bonus list next to the item's own bonuses; crafted takes its level directly.
  assert.equal(forged[0].line,'main_hand=,id=35,bonus_id=8790,ilevel=320,enchant_id=5');
  assert.equal(forged[1].line,'main_hand=,id=35,bonus_id=8791,ilevel=320,enchant_id=5');
  assert.equal(weaponCandidates(arms,season,catalog,{...all,craftedStats:[craftedStats[1]]}).filter(c=>c.name==='Forged axe').length,1);
  assert.equal(weaponCandidates(arms,season,catalog,{...all,craftedStats:[]}).some(c=>c.name==='Forged axe'),false,'no pair, no crafted candidate');
  assert.ok(list.filter(c=>c.name==='Great axe').every(c=>c.craftedStat===undefined),'a drop has no stat pair');
});

test('a shield spec ranks one-handers and shields, and never a held item it cannot wield',()=>{
  const list=weaponCandidates(prot,season,catalog,all);
  assert.deepEqual(list.map(c=>`${c.kind}:${c.name}`).sort(),['main:Dagger','main:Hand axe','shield:Bulwark']);
  assert.deepEqual(weaponCandidates(prot,season,catalog,{...all,kinds:['shield']}).map(c=>c.name),['Bulwark']);
});

test('every candidate of one specialization has its own profileset key',()=>{
  const list=weaponCandidates(prot,season,catalog,all);
  assert.equal(new Set(list.map(c=>c.key)).size,list.length);
});

test('the final round takes the best of the screening run, not only what beats the reference gear',()=>{
  const list=weaponCandidates(prot,season,catalog,{...all,craftedStats:[]});
  const screen={baseline:{dps:1000},rows:list.map((c,i)=>({key:c.key,dps:900+i}))};
  assert.deepEqual(selectTop(list,screen,2,null).map(c=>c.key),[list.at(-1).key,list.at(-2).key],'ranked by DPS although all are below the baseline');
  const tank={baseline:{dps:1000},rows:list.map((c,i)=>({key:c.key,dps:900,score:-i}))};
  assert.deepEqual(selectTop(list,tank,1,{boss:{}}).map(c=>c.key),[list[0].key],'tanks rank on the weighted score');
});

test('both hands get a share of the final round, even when one of them screens higher throughout',()=>{
  // A profile whose off hand is the weaker piece: every off-hand swap screens above every main-hand swap.
  const candidates=[
    ...Array.from({length:8},(_,i)=>({key:`m${i}`,slot:'main_hand',itemId:100+i,name:`Main ${i}`})),
    ...Array.from({length:8},(_,i)=>({key:`o${i}`,slot:'off_hand',itemId:200+i,name:`Off ${i}`}))
  ];
  const screen={baseline:{dps:1000},rows:candidates.map(c=>({key:c.key,dps:c.slot==='off_hand'?2000+Number(c.key.slice(1)):1000+Number(c.key.slice(1))}))};
  const chosen=selectTop(candidates,screen,6,null);
  assert.equal(chosen.length,6);
  assert.equal(chosen.filter(c=>c.slot==='main_hand').length,3);
  assert.equal(chosen.filter(c=>c.slot==='off_hand').length,3);
  // A hand with fewer candidates than its share leaves the rest to the other hand.
  const lopsided=[candidates[0],...candidates.slice(8)];
  const few=selectTop(lopsided,screen,6,null);
  assert.equal(few.length,6);
  assert.equal(few.filter(c=>c.slot==='main_hand').length,1);
});

test('the stat pairs of one crafted weapon compete for a single place in the final round',()=>{
  const list=weaponCandidates(arms,season,catalog,all);
  const forged=list.filter(c=>c.name==='Forged axe');
  assert.equal(forged.length,2);
  // Both pairs screen above everything else; only the better one may take a place.
  const screen={baseline:{dps:1000},rows:list.map(c=>({key:c.key,dps:forged.includes(c)?(c===forged[1]?1200:1100):900}))};
  const chosen=selectTop(list,screen,3,null);
  assert.equal(chosen[0].key,forged[1].key);
  assert.equal(chosen.filter(c=>c.name==='Forged axe').length,1);
});

test('ranking marks the distance behind the best weapon, its tier and a tie',()=>{
  const rows=[
    {key:'a',status:'complete',dps:1000,error95:5},
    {key:'b',status:'complete',dps:998,error95:5},
    {key:'c',status:'complete',dps:980,error95:5},
    {key:'d',status:'complete',dps:900,error95:5},
    {key:'e',status:'failed'}
  ];
  const ranked=rankWeaponRows(rows,null);
  assert.deepEqual(ranked.map(r=>r.key),['a','b','c','d']);
  assert.deepEqual(ranked.map(r=>r.tier),['S','S','B','D']);
  assert.equal(ranked[1].tied,true,'two DPS apart is inside the combined uncertainty');
  assert.equal(ranked[2].tied,false);
  assert.equal(ranked[2].behind.toFixed(2),'2.00');
  assert.equal(rows[4].rank,undefined,'a failed run is not ranked');
  const tanks=rankWeaponRows([{key:'a',status:'complete',score:3,scoreError:0.1},{key:'b',status:'complete',score:1,scoreError:0.1}],{boss:{}});
  assert.deepEqual(tanks.map(r=>[r.tier,Number(r.behind.toFixed(2))]),[['S',0],['B',2]],'tank tiers use score points');
});

test('a crafted weapon is ranked once, at the stat pair that served it best',()=>{
  const rows=[
    {key:'crit',status:'complete',dps:980,error95:1},
    {key:'mastery',status:'complete',dps:1000,error95:1},
    {key:'drop',status:'complete',dps:990,error95:1}
  ];
  const group=row=>row.key==='drop'?'drop':'forged';
  const ranked=rankWeaponRows(rows,null,group);
  assert.deepEqual(ranked.map(r=>r.key),['mastery','drop'],'the weaker pair leaves the list');
  assert.equal(rows[0].variant,true);
  assert.equal(rows[1].variant,false);
  assert.equal(rows[0].rank,undefined,'a variant carries no rank of its own');
});

test('the reference character’s own item level is read from the report',()=>{
  const report={sim:{players:[{gear:{head:{ilevel:334},chest:{ilevel:344},tabard:{},main_hand:{ilevel:344}}}]}};
  assert.deepEqual(actorGear(report),{pieces:3,itemLevel:340.7,min:334,max:344});
  assert.equal(actorGear({sim:{players:[{gear:{}}]}}),null);
  assert.equal(actorGear({}),null);
});

// The reference profiles are SimC's own; only the engine folder layout is faked here.
async function engineFolder(files){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-weapons-'));
  await fs.mkdir(path.join(dir,'profiles','MID1'),{recursive:true});
  await fs.mkdir(path.join(dir,'profiles','MID2'),{recursive:true});
  for(const [file,text] of Object.entries(files))await fs.writeFile(path.join(dir,'profiles',file),text);
  return dir;
}
const profileText=(actor,spec,extra='')=>`# comment\n${actor}\nspec=${spec}\nlevel=90\nrace=orc\nmain_hand=axe,id=10,enchant_id=5\n${extra}actions=auto_attack\nactions+=/slam\n`;
const talentData={find(info){
  const trees={'warrior-arms':{specId:71,className:'Warrior',specName:'Arms'},'warrior-protection':{specId:73,className:'Warrior',specName:'Protection'}};
  const tree=trees[`${info.class}-${info.spec}`];if(!tree)throw new Error('no tree');return tree;
}};

test('one reference profile per spec: the newest season, and the base build over a hero variant',async()=>{
  const dir=await engineFolder({
    'MID1/MID1_Warrior_Arms.simc':profileText('warrior="MID1_Warrior_Arms"','arms'),
    'MID1/MID1_Warrior_Protection.simc':profileText('warrior="MID1_Warrior_Protection"','protection'),
    'MID2/MID2_Warrior_Arms.simc':profileText('warrior="MID2_Warrior_Arms"','arms'),
    'MID2/MID2_Warrior_Arms_Colossus.simc':profileText('warrior="MID2_Warrior_Arms_Colossus"','arms'),
    'MID2/MID2_Warrior_Arms_Raid.simc':profileText('warrior="MID2_Warrior_Arms_Raid"','arms'),
    'MID2/MID2_Priest_Holy.simc':profileText('priest="MID2_Priest_Holy"','holy')
  });
  clearReferenceCache();
  const specs=await loadReferenceSpecs(dir,talentData);
  assert.deepEqual(specs.map(s=>[s.key,s.season,s.file]),[['warrior-arms','MID2','MID2_Warrior_Arms.simc'],['warrior-protection','MID1','MID1_Warrior_Protection.simc']],'no holy priest: it has no talent tree here');
  // Protection has no profile for the newest season, so it is carrying an older character and says so.
  assert.deepEqual(specs.map(s=>s.stale),[false,true]);
  assert.ok(specs[1].tank,'protection is a tank');
  assert.equal(specs[0].text.includes('actions'),false,'the stored action list is dropped for SimC’s own default');
  assert.equal(specs[0].info.name,'MID2_Warrior_Arms');
  await fs.rm(dir,{recursive:true,force:true});
});

test('engine options in a reference profile are accepted, but never in a pasted import',async()=>{
  const dir=await engineFolder({'MID2/MID2_Warrior_Arms.simc':profileText('warrior="MID2_Warrior_Arms"','arms','timeofday=night\nwarlock.soul_shards=3\n')});
  clearReferenceCache();
  const specs=await loadReferenceSpecs(dir,talentData);
  assert.match(specs[0].text,/timeofday=night/);
  const {parseProfile}=await import('../lib/profile.mjs');
  assert.throws(()=>parseProfile(profileText('warrior="Mine"','arms','timeofday=night\n')),/timeofday/);
  await fs.rm(dir,{recursive:true,force:true});
});

test('a plan counts its runs and refuses a selection that cannot be simulated',async()=>{
  const dir=await engineFolder({
    'MID2/MID2_Warrior_Arms.simc':profileText('warrior="MID2_Warrior_Arms"','arms'),
    'MID2/MID2_Warrior_Protection.simc':`# comment\nwarrior="MID2_Warrior_Protection"\nspec=protection\nlevel=90\nrace=orc\nmain_hand=mace,id=11\noff_hand=shield,id=12\n`
  });
  clearReferenceCache();
  const request={tank:{preset:'mythic'},weapons:{finalists:12}};
  const plan=await prepareWeapons(request,catalog,season,talentData,dir,1);
  // Arms: two dropped two-handers and the crafted one in both stat pairs. Protection: two one-handers and a shield.
  assert.deepEqual(plan.specs.map(s=>[s.key,s.candidates.length]),[['warrior-arms',4],['warrior-protection',3]]);
  assert.equal(plan.candidates,7);
  assert.deepEqual(plan.craftedStats.map(s=>s.bonusId),[8790,8791]);
  // Without a choice each source keeps to what it can give: the raid to the Myth track, the rest to Hero.
  assert.equal(plan.sources.equal,false);
  assert.equal(plan.sources.raid.name,'Mythic');
  assert.equal(plan.sources.delves.itemLevel,320);
  assert.equal(plan.sources.mplus.itemLevel,320);
  assert.deepEqual(plan.levels,{min:320,max:344});
  assert.ok(plan.specs[1].tank,'a tank specialization gets tank settings');
  assert.equal(plan.specs[0].tank,null);
  // One profileset run per spec, plus one calibration for the tank: nothing is screened at this size.
  assert.equal(weaponSteps(plan,1),3);
  assert.equal(weaponSteps({...plan,finalists:1},2),9,'screening and a final round for both specs in both scenarios, plus one calibration');
  await assert.rejects(prepareWeapons({weapons:{specs:['warrior-arms'],kinds:['held']}},catalog,season,talentData,dir,1),/No selected specialization/);
  await assert.rejects(prepareWeapons({weapons:{kinds:['nonsense']}},catalog,season,talentData,dir,1),/weapon category/);
  await assert.rejects(prepareWeapons({weapons:{equal:true,track:track.id,level:9}},catalog,season,talentData,dir,1),/upgrade track and level/);
  await assert.rejects(prepareWeapons({weapons:{sources:{crafted:{itemLevel:0}}}},catalog,season,talentData,dir,1),/Crafted item level/);
  await assert.rejects(prepareWeapons({weapons:{specs:['warrior-arms']}},catalog,season,talentData,dir,3000),/Narrow it/);
  await fs.rm(dir,{recursive:true,force:true});
});
