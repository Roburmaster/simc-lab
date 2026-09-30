import test from 'node:test';
import assert from 'node:assert/strict';
import {siteReport,mergeSiteReport,scenarioId} from '../lib/sitereport.mjs';

// A small finished Trinket Lab job: one class, one spec, one scenario, two trinkets and one pair.
const candidate=(key,itemId,name,itemLevel,extra={})=>({key,itemId,name,itemLevel,levelLabel:itemLevel===308?'Champion 6/6':'Myth 6/6',value:`,id=${itemId},bonus_id=1`,sources:['Raid · Boss'],top:itemLevel===334,group:String(itemId),...extra});
const job={id:'j1',created:'2026-09-30T10:00:00Z',finished:'2026-09-30T11:00:00Z',engine:{version:'1210-01',commit:'abc',wowVersion:'12.1.0.1'},settings:{duration:300,iterations:10000,targetError:0.1},
  scenarios:[{preset:'raid_st',label:'Raid · single target',style:'Patchwerk',targets:1}],
  stages:[{spec:'warrior-fury',scenario:0,stage:2,status:'complete',baseline:{dps:100000}}],
  trinkets:{season:{name:'Season 2'},model:'pairs',repro:{simcSha:'abc'},specs:[{key:'warrior-fury',class:'warrior',className:'Warrior',specName:'Fury',file:'MID2_Warrior_Fury.simc',
    candidates:[candidate('t1',1,'Heart',308),candidate('t2',1,'Heart',334,{onUse:true}),candidate('t3',2,'Core',334,{freed:{slot:'wrist',item:'Bracers',embellishment:'Lining'}})],
    pairs:[{scenario:0,pool:['t2','t3'],pairs:[{key:'p0-0001',pairKey:'x',keys:['t2','t3']}],partners:[]}]}]},
  results:[
    {spec:'warrior-fury',scenario:0,stage:2,key:'t1',dps:105000,gain:5000,percent:5,status:'complete'},
    {spec:'warrior-fury',scenario:0,stage:2,key:'t2',dps:108000,gain:8000,percent:8,rank:1,tier:'S',behind:0,status:'complete'},
    {spec:'warrior-fury',scenario:0,stage:2,key:'t3',dps:106000,gain:6000,percent:6,rank:2,tier:'B',behind:1.85,tied:false,status:'complete'},
    {spec:'warrior-fury',scenario:0,stage:7,key:'p0-0001',pair:true,dps:115000,gain:15000,percent:15,rank:1,behind:0,status:'complete'}]};

test('a job becomes the website report: tiers, curves, pairs and level names',()=>{
  const r=siteReport(job);
  assert.equal(r.schemaVersion,2);assert.equal(r.kind,'trinket-lab');assert.equal(r.date,'2026-09-30');
  assert.deepEqual(r.scenarios.map(s=>[s.id,s.name]),[['raid_st','Raid · single target']]);
  assert.deepEqual(r.levels.map(l=>[l.itemLevel,l.label]),[[308,'Champion 6/6'],[334,'Myth 6/6']]);
  const res=r.classes[0].specs[0].scenarios[0];
  assert.equal(r.classes[0].slug,'warrior');assert.equal(r.classes[0].specs[0].slug,'fury');
  const [s,b]=res.tiers;
  assert.equal(s.tier,'S');assert.equal(s.items[0].name,'Heart');
  assert.deepEqual(s.items[0].levels.map(l=>l.itemLevel),[308,334],'the curve');
  assert.match(s.items[0].meta,/on use/);assert.equal(s.items[0].value,'+8.00 % · +8,000 DPS');
  assert.match(b.items[0].meta,/worn in place of the Lining on Bracers/);
  assert.deepEqual(res.pairs.map(p=>[p.rank,p.items.map(i=>i.name),p.value,p.gap]),[['1',['Heart','Core'],'+15.00 % · +15,000 DPS','best pair']]);
  assert.match(res.meta,/100,000 DPS with no trinket/);
});

test('publishing class by class merges into what is already there',()=>{
  const one=siteReport(job);
  const other=structuredClone(one);other.classes[0]={...other.classes[0],name:'Death Knight',slug:'death-knight',specs:[{...other.classes[0].specs[0],name:'Blood',slug:'blood'}]};
  const both=mergeSiteReport(one,other);
  assert.deepEqual(both.classes.map(c=>c.slug),['death-knight','warrior'],'alphabetical');
  const moved=structuredClone(one);moved.scenarios=[{...moved.scenarios[0],id:'mplus_small',name:'Mythic+ · small pull'}];
  const two=mergeSiteReport(both,moved);
  assert.deepEqual(two.scenarios.map(s=>s.id),['raid_st','mplus_small']);
  assert.equal(two.classes.find(c=>c.slug==='death-knight').specs[0].scenarios.length,2,'every spec has a slot per scenario');
  assert.deepEqual(two.classes.find(c=>c.slug==='death-knight').specs[0].scenarios[1].tiers,[],'not simulated there yet');
  assert.equal(two.classes.find(c=>c.slug==='warrior').specs[0].scenarios[1].tiers.length,2);
  // Publishing the same class and scenario again replaces it rather than adding a copy.
  assert.deepEqual(mergeSiteReport(two,moved).scenarios.map(s=>s.id),['raid_st','mplus_small']);
  assert.equal(mergeSiteReport(null,one).classes.length,1);
  assert.equal(scenarioId({style:'Patchwerk',targets:3}),'Patchwerk-3');
});
