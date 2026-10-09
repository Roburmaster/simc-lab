import test from 'node:test';
import assert from 'node:assert/strict';
import {bagCandidates,buildTankGear,jewelryPairs} from '../lib/tankgear.mjs';

const HERO=3445;
const ladder=(id,name,bonus,first)=>({id,name,levels:[0,1,2,3,4,5].map(i=>({level:i+1,max:6,bonusId:bonus+i,itemLevel:first+[0,3,6,10,13,16][i],discounts:[{currencyId:HERO,scaling:0,accountWide:false}],...(i?{cost:{currencyId:HERO,amount:20}}:{})}))});
const season={season:{name:'Test season'},tracks:[ladder(617,'Hero',12841,305)],crests:{currencies:[{id:HERO,name:'Hero Mistcrest'}],warband:{}},itemLimits:{items:new Map(),bonuses:new Map([[8960,512]]),quantities:new Map([[512,2]])}};
const catalog={items:new Map([[1,{name:'Helm',inventoryType:1}],[2,{name:'Spare Belt',inventoryType:6}],[3,{name:'Old Belt',inventoryType:6}],[4,{name:'Embellished Belt',inventoryType:6}]])};
const gear={head:{id:1,value:',id=1,bonus_id=12843,enchant_id=9'},waist:{id:3,value:',id=3,bonus_id=12843'}};
const alternatives=[
  {name:'Spare Belt (290)',text:'waist=,id=2,bonus_id=12843',slot:'waist',section:'Gear from Bags'},
  {name:'Old Belt (300)',text:'waist=,id=3,bonus_id=12843',slot:'waist',section:'Gear from Bags'},
  {name:'Saved build',text:'talents=ABC',slot:null,section:'Saved'}
];
const profile={info:{class:'druid',spec:'guardian'},gear,alternatives};
const text='druid="Test"\n# upgrade_currencies=c:3445:100';

test('bag items become candidates with their item level; what is already worn is not one',()=>{
  const {list,blocked}=bagCandidates(profile,season,catalog);
  assert.equal(blocked,0);assert.equal(list.length,1);
  const [belt]=list;
  assert.equal(belt.slot,'waist');assert.equal(belt.itemId,2);assert.equal(belt.name,'Spare Belt');assert.equal(belt.itemLevel,290);
  assert.equal(belt.line,'waist=,id=2,bonus_id=12843');
  assert.deepEqual(belt.sources,[{origin:'bags',group:'bags:Gear from Bags',groupName:'Gear from Bags',label:'Gear from Bags · item level 290'}]);
});

test('a bag item that would be a third embellishment is left out',()=>{
  const worn={...profile,gear:{head:{id:1,value:',id=1,bonus_id=8960'},waist:{id:3,value:',id=3,bonus_id=8960'}},alternatives:[{name:'Embellished Belt (300)',text:'finger1=,id=4,bonus_id=8960',slot:'finger1',section:'Bags'}]};
  const {list,blocked}=bagCandidates(worn,season,catalog);
  assert.equal(list.length,0);assert.equal(blocked,1);
});

test('crest upgrades and bag gear are merged into one list of candidates, numbered and sorted by slot',()=>{
  const gearList=buildTankGear(profile,text,{bags:{},crests:{levels:'max',affordable:false}},season,catalog,null);
  assert.deepEqual(gearList.counts,{loot:0,bags:1,crests:2});
  assert.equal(gearList.candidates.length,3);
  assert.deepEqual(gearList.candidates.map(c=>c.key),['c001','c002','c003']);
  assert.deepEqual(gearList.candidates.map(c=>c.slot),['head','waist','waist']);
  const up=gearList.candidates.find(c=>c.slot==='head');
  assert.equal(up.upgrade.to,6);assert.equal(up.sources[0].origin,'crests');assert.match(up.sources[0].label,/3\/6 to 6\/6/);
  assert.equal(up.value,',id=1,bonus_id=12846,enchant_id=9');
  assert.equal(gearList.finalists,48);assert.equal(gearList.embellished,false);
});

test('with no source asked for there is no gear search',()=>{
  assert.equal(buildTankGear(profile,text,{finalists:24},season,catalog,null),null);
  assert.equal(buildTankGear(profile,text,undefined,season,catalog,null),null);
});

test('a crest source that cannot apply is a note when another source has items, and an error when it stands alone',()=>{
  const off={...profile,gear:{head:{id:1,value:',id=1,bonus_id=1'}}};
  const both=buildTankGear(off,text,{bags:{},crests:{}},season,catalog,null);
  assert.equal(both.counts.crests,0);assert.match(both.warnings[0],/^Crest upgrades:/);
  assert.throws(()=>buildTankGear(off,text,{crests:{}},season,catalog,null),/upgrade track/);
});

test('an empty bag source says why, and a finalist size outside the list is refused',()=>{
  const none={...profile,alternatives:[]};
  assert.throws(()=>buildTankGear(none,text,{bags:{}},season,catalog,null),/lists no bag gear/);
  assert.throws(()=>buildTankGear(profile,text,{bags:{},finalists:7},season,catalog,null),/final round size/);
});

test('trinkets are paired with each other and with the two worn, never the worn pair itself or one item twice',()=>{
  const worn={info:{class:'druid',spec:'guardian'},gear:{trinket1:{id:11,value:',id=11,bonus_id=1'},trinket2:{id:12,value:',id=12,bonus_id=1'},finger1:{id:21,value:',id=21'},finger2:{id:22,value:',id=22'}},alternatives:[]};
  const names=new Map([[11,{name:'Worn A'}],[12,{name:'Worn B'}],[21,{name:'Ring A'}],[22,{name:'Ring B'}],[31,{name:'New X'}],[32,{name:'New Y'}],[41,{name:'New Ring'}]]);
  const cat={items:names};
  const cands=[{key:'c001',slot:'trinket1',itemId:31,name:'New X',itemLevel:300,value:',id=31',line:'trinket1=,id=31',sources:[]},
    {key:'c002',slot:'trinket2',itemId:32,name:'New Y',itemLevel:300,value:',id=32',line:'trinket2=,id=32',sources:[]},
    {key:'c003',slot:'finger1',itemId:41,name:'New Ring',itemLevel:300,value:',id=41',line:'finger1=,id=41',sources:[]}];
  const rows=[{key:'c001',score:3},{key:'c002',score:2},{key:'c003',score:1}];
  const pairs=jewelryPairs(cands,rows,worn,{itemLimits:season.itemLimits},cat);
  const trinkets=pairs.filter(p=>p.family==='trinket'),rings=pairs.filter(p=>p.family==='finger');
  // Four pieces in the pool: X, Y and the two worn. Six pairs, less the worn pair itself.
  assert.equal(trinkets.length,5);
  assert.ok(trinkets.every(p=>p.parts[0].slot!==p.parts[1].slot&&p.parts[0].itemId!==p.parts[1].itemId));
  assert.ok(!trinkets.some(p=>p.parts.every(x=>x.worn)));
  // A new trinket beside a worn one takes the other slot, and the line says so.
  const keep=trinkets.find(p=>p.parts.some(x=>x.itemId===11)&&p.parts.some(x=>x.itemId===31));
  assert.deepEqual(keep.parts.map(x=>x.line),['trinket1=,id=11,bonus_id=1','trinket2=,id=31']);
  const keepB=trinkets.find(p=>p.parts.some(x=>x.itemId===12)&&p.parts.some(x=>x.itemId===32));
  assert.deepEqual(keepB.parts.map(x=>x.line),['trinket2=,id=12,bonus_id=1','trinket1=,id=32']);
  // Two new ones that both prefer slot 1 share the two slots.
  const both=trinkets.find(p=>p.parts.every(x=>!x.worn));assert.deepEqual(both.parts.map(x=>x.slot).sort(),['trinket1','trinket2']);
  // Rings: the one new ring pairs with each worn ring.
  assert.equal(rings.length,2);
  assert.deepEqual(pairs.map(p=>p.key),pairs.map((p,i)=>'j'+String(i+1).padStart(3,'0')));
});
