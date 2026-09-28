import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutTrinkets,levelSteps,trinketCandidates,selectTopTrinkets,gainOf,specSteps,trinketCount,topRows} from '../lib/trinkets.mjs';
import {dropLevels,rankWeaponRows} from '../lib/weapons.mjs';

const track=(id,name,base,bonus)=>({id,name,levels:[1,2,3].map(level=>({level,max:3,bonusId:bonus+level,itemLevel:base+3*level}))});
const champion=track(616,'Champion',290,12780),hero=track(617,'Hero',305,12790),myth=track(618,'Myth',318,12800);
myth.finalDrop={bonusId:13848,itemLevel:344};
const trinket=(id,name,extra={})=>({id,name,itemClass:4,itemSubClass:0,inventoryType:12,stats:[],...extra});
// A set that the trinket completes with the reference weapon, as Zul'jin's Guillotine Technique does with Maze'roa.
const catalog={items:new Map([[70,{name:"Maze'roa"}]]),setBonuses:[{name:"Bite of Zul'jan",pieces:2,classId:0,specId:0,items:[70,54]}]};
const season={
  season:{id:2,name:'Season 2'},tracks:[champion,hero,myth],difficulties:[{name:'Mythic',track:618}],weaponSpecs:[],bonusSockets:{},
  entries:[
    {item:trinket(50,'Idol'),source:{kind:'raid',group:1,groupName:'First boss',sequence:1}},
    {item:trinket(51,'Heart'),source:{kind:'raid',group:4,groupName:'Last boss',sequence:4}},
    {item:trinket(52,'Flask'),source:{kind:'mplus',group:700,groupName:'Murder Row'}},
    {item:trinket(52,'Flask'),source:{kind:'delves',group:-88,groupName:'Delves'}},
    {item:trinket(53,'Card',{onUseTrinket:true}),source:{kind:'crafted',group:-1,groupName:'Inscription'}},
    {item:trinket(54,'Technique'),source:{kind:'raid',group:4,groupName:'Last boss',sequence:4}},
    {item:trinket(55,'Healer charm',{specs:[65]}),source:{kind:'mplus',group:700,groupName:'Murder Row'}},
    {item:{id:56,name:'Ring',itemClass:4,inventoryType:11,stats:[]},source:{kind:'mplus',group:700,groupName:'Murder Row'}}
  ]
};
const profileText=['warrior="Ref"','spec=arms','main_hand=maz,id=70','trinket1=a,id=80,bonus_id=1','trinket2=b,id=81','neck=n,id=90'].join('\n');
const arms=withoutTrinkets({key:'warrior-arms',specId:71,info:{class:'warrior',spec:'arms'},text:profileText,gear:{main_hand:{id:70},trinket1:{id:80},trinket2:{id:81},neck:{id:90}}});
const drops=dropLevels(season,{craftedCap:331}).of;
const steps=levelSteps(season);

test('the reference character loses both trinkets and nothing else',()=>{
  assert.equal(arms.text.includes('trinket'),false);
  assert.match(arms.text,/main_hand=maz/);assert.match(arms.text,/neck=n/);
  assert.deepEqual(Object.keys(arms.gear).sort(),['main_hand','neck']);
  assert.deepEqual(arms.worn,[80,81]);
});

test('item level steps are the top of each chosen track, lowest first',()=>{
  assert.deepEqual(steps.map(s=>s.itemLevel),[299,314,327]);
  assert.deepEqual(levelSteps(season,[618,616]).map(s=>s.label),['Champion 3/3','Myth 3/3']);
  assert.throws(()=>levelSteps(season,[]),/at least one/);
  assert.throws(()=>levelSteps(season,[999]),/Unknown upgrade track/);
});

test('each trinket runs up to the level its own source can give, and no further',()=>{
  const list=trinketCandidates(arms,season,catalog,{drops,steps});
  const of=name=>list.filter(c=>c.name===name).map(c=>c.itemLevel);
  assert.deepEqual(of('Idol'),[299,314,327],'a raid trinket reaches the top of the Myth track');
  assert.deepEqual(of('Heart'),[299,314,327,344],'a last boss drops above it');
  assert.deepEqual(of('Flask'),[299,314],'dungeon and delve loot stops at the top of the Hero track');
  assert.deepEqual(of('Card'),[299,314,327,331],'crafted stops at its own cap');
  assert.equal(of('Healer charm').length,0,'a trinket for other specializations is left out');
  assert.equal(of('Ring').length,0,'only trinkets');
  // One row per trinket is its top, the one the tier is read from.
  assert.equal(list.filter(c=>c.top).length,5);
  assert.ok(list.filter(c=>c.top).every(c=>c.itemLevel===Math.max(...list.filter(x=>x.itemId===c.itemId).map(x=>x.itemLevel))));
  const flask=list.filter(c=>c.name==='Flask');
  assert.deepEqual(flask[0].sources,['Mythic+ · Murder Row','Delves · Delves'],'both sources are named');
  const card=list.filter(c=>c.name==='Card');
  assert.match(card.at(-1).line,/^trinket1=,id=53,ilevel=331$/,'crafted levels are set directly');
  assert.ok(card.every(c=>c.onUse));
  assert.match(list.find(c=>c.name==='Heart'&&c.itemLevel===344).line,/bonus_id=13848/);
  assert.match(list.find(c=>c.name==='Idol'&&c.itemLevel===314).line,/^trinket1=,id=50,bonus_id=12793$/);
  assert.equal(new Set(list.map(c=>c.key)).size,list.length);
});

test('a trinket that completes a set with the reference gear is marked',()=>{
  const list=trinketCandidates(arms,season,catalog,{drops,steps});
  assert.equal(list.find(c=>c.name==='Technique').set.name,"Bite of Zul'jan");
  assert.equal(list.find(c=>c.name==='Idol').set,undefined);
});

test('equal footing shows every trinket at every step',()=>{
  const list=trinketCandidates(arms,season,catalog,{drops,steps,equal:true});
  for(const id of [50,51,52,53,54])assert.deepEqual(list.filter(c=>c.itemId===id).map(c=>c.itemLevel),[299,314,327]);
});

test('screening keeps the best trinkets with every one of their levels',()=>{
  const list=trinketCandidates(arms,season,catalog,{drops,steps});
  const tops=topRows({candidates:list});
  const dps={Idol:100,Heart:300,Flask:200,Card:50,Technique:250};
  const screen={rows:tops.map(c=>({key:c.key,dps:dps[c.name]}))};
  const kept=selectTopTrinkets(list,screen,2);
  assert.deepEqual([...new Set(kept.map(c=>c.name))].sort(),['Heart','Technique']);
  assert.equal(kept.length,8,'all levels of both');
  assert.equal(specSteps({candidates:list,support:false,tank:null},2,1),2,'screened, then a final round');
  assert.equal(specSteps({candidates:list,support:true,tank:{}},16,2),5,'one round, an idle run, per scenario, plus the boss');
  assert.equal(trinketCount({candidates:list}),5);
});

test('gain is measured against the character with no trinket',()=>{
  assert.deepEqual(gainOf({dps:110000},{dps:100000}),{gain:10000,percent:10});
  assert.deepEqual(gainOf({dps:110000},{dps:100000},{share:50000}),{gain:10000,percent:20},'a support spec reads percent of its share');
  assert.deepEqual(gainOf({score:1.5},{dps:1},{tank:{boss:{}}}),{gain:1.5,percent:1.5});
  assert.equal(gainOf({dps:NaN},{dps:1}),null);
});

test('the tier list ranks one top row per trinket',()=>{
  const rows=[{key:'a',dps:120,status:'complete'},{key:'b',dps:119,status:'complete'},{key:'c',dps:110,status:'complete'}];
  const ranked=rankWeaponRows(rows,null,null);
  assert.deepEqual(ranked.map(r=>r.tier),['S','A','D']);
});
