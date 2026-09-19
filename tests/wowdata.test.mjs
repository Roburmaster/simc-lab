import test from 'node:test';
import assert from 'node:assert/strict';
import luaparse from 'luaparse';
import {LuaFactory} from 'wasmoon';
import {normalizeKey,characterKey,itemFromValue,identity,trackTable,simEntry,addSim,removeSim,dataFile,schemaVersion,limits} from '../lib/wowdata.mjs';
import {parseLua} from '../lib/lua.mjs';
import {season,profile,talentData,upgradeJob,request} from './addon/fixture.mjs';

const factory=new LuaFactory();
const tracks=trackTable(season);
const who=()=>identity(profile,talentData);
const entry=(job=upgradeJob())=>simEntry(job,request,{season,tracks});

test('character keys agree across the export, GetRealmName and odd names',()=>{
  assert.equal(characterKey('Temulan','ravencrest'),'temulan-ravencrest');
  assert.equal(normalizeKey("Twilight's Hammer"),'twilightshammer');
  assert.equal(normalizeKey('twilights_hammer'),'twilightshammer');
  assert.equal(normalizeKey('Ævar'),'Ævar','non-ASCII is kept as is, like Lua keeps its bytes');
  assert.equal(normalizeKey('Aggra (Português)'),'aggraportuguês');
});

test('gear lines give item, bonus IDs, enchant, gems and explicit item level',()=>{
  assert.deepEqual(itemFromValue(',id=240001,enchant_id=8016,bonus_id=12831/6652,content_tuning=4240'),{itemId:240001,bonusIds:[12831,6652],enchant:8016});
  assert.deepEqual(itemFromValue(',id=5,gem_id=1/0/2,ilevel=300'),{itemId:5,bonusIds:[],gems:[1,2],itemLevel:300});
  assert.equal(itemFromValue('none'),null);
  assert.equal(itemFromValue(',bonus_id=1'),null);
});

test('identity needs a realm and a known specialization',()=>{
  const w=who();
  assert.equal(w.key,'temulan-ravencrest');assert.equal(w.specId,250);assert.equal(w.classId,6);assert.equal(w.region,'eu');
  assert.deepEqual(w.gear.head,{itemId:240001,bonusIds:[12831,6652],enchant:8016});
  assert.throws(()=>identity(profile.replace(/^server=.*$/m,''),talentData),/realm/);
  assert.throws(()=>identity(profile,{find:()=>null}),/specialization/);
});

test('an Upgrade Finder job becomes ranked item results with journal IDs',()=>{
  const e=entry();
  assert.equal(e.mode,'upgrades');assert.equal(e.simc,'1210-01');assert.equal(e.wow,'12.1.0.69875');
  assert.equal(e.settings.season,'Midnight Season 2');
  const [single,multi]=e.scenarios;
  assert.deepEqual(single.baseline,{dps:100000,error:100});
  assert.deepEqual(single.results.map(r=>[r.itemId,r.slot,r.gain,r.screening]),[[250002,'trinket1',3,undefined],[250001,'head',2,undefined],[250005,'feet',0.8,true],[250003,'neck',-0.5,undefined]],'one placement per trinket, screening-only gains flagged, final-round losses kept');
  const head=single.results[1];
  assert.deepEqual(head.bonusIds,[6652,12830]);assert.equal(head.track,12830);assert.equal(head.itemLevel,279);
  assert.equal(head.error,0.141);
  assert.deepEqual(head.sources[0],{kind:'raid',name:"Ula'tek",label:"Raid · Ula'tek · Heroic · Hero 1/6",instanceId:1320,instance:'The Venomous Abyss',encounterId:2895,difficulty:'Heroic'});
  assert.deepEqual(head.sources[1],{kind:'vault',name:"Ula'tek",label:"Great Vault · Raid · Ula'tek · Myth 1/6",instanceId:1320,instance:'The Venomous Abyss',encounterId:2895,row:'Raid'});
  assert.deepEqual(single.results[0].sources[0],{kind:'mplus',name:'Altar of Fangs',label:'Mythic+ · Altar of Fangs · Myth 1/6',instanceId:1322});
  assert.equal(multi.results[0].itemId,250001,'each scenario ranks on its own');
  assert.equal(tracks[13848].final,true);assert.equal(tracks[12845].level,6);
});

test('tank jobs keep the DPS change and rank on the score',()=>{
  const job=upgradeJob();
  job.settings.tank={preset:'mythic',weight:50};
  for(const r of job.results)Object.assign(r,{dpsGain:1,survival:r.key==='c003'?4:-1,score:r.key==='c003'?2.5:0.1,scoreError:0.2});
  const [single]=entry(job).scenarios;
  assert.equal(single.metric,'score');assert.equal(single.results[0].itemId,250003);assert.equal(single.results[0].score,2.5);assert.equal(single.results[0].gain,1);
});

test('Talent Search and Gear Compare jobs send their variants; one-item variants double as items',()=>{
  const base={id:'aaaaaaaa-2222-3333-4444-555555555555',status:'complete',created:'2026-09-19T10:00:00Z',engine:{},settings:{},scenarios:[{style:'Patchwerk',targets:1}]};
  const talents=simEntry({...base,mode:'talents',results:[{name:'Current talents',baseline:true,scenario:0,status:'complete',dps:1000,error95:5},{name:'Build 1',scenario:0,status:'complete',dps:1010,error95:5,talents:'ABC'},{name:'Build 2',scenario:0,status:'failed'}]},{},{season,tracks});
  assert.deepEqual(talents.scenarios[0].results.map(r=>[r.name,r.gain,r.talents]),[['Build 1',1,'ABC']]);
  const compare=simEntry({...base,mode:'compare',results:[{name:'Current gear',baseline:true,scenario:0,status:'complete',dps:1000},{name:'Ring',scenario:0,status:'complete',dps:990},{name:'Set',scenario:0,status:'complete',dps:1020}]},{variants:[{name:'Ring',text:'finger1=,id=77,bonus_id=1/2'},{name:'Set',text:'head=,id=5\nhands=,id=6\nflask=x'}]},{season,tracks});
  const [set,ring]=compare.scenarios[0].results;
  assert.equal(set.name,'Set');assert.equal(set.items.length,2);assert.equal(set.itemId,undefined);
  assert.equal(ring.itemId,77);assert.deepEqual(ring.bonusIds,[1,2]);assert.equal(ring.slot,'finger1');assert.equal(ring.gain,-1);
  assert.throws(()=>simEntry({...base,mode:'quick',results:[]},{},{season,tracks}),/Only Upgrade Finder/);
  assert.throws(()=>simEntry({...base,mode:'talents',status:'running',results:[]},{},{season,tracks}),/finished/);
});

test('the store keeps the newest N sims per character and specialization',()=>{
  const store={};
  for(let i=0;i<7;i++)addSim(store,who(),{...entry(upgradeJob({id:`id-${i}`})),created:1000+i},5);
  const sims=store.characters['temulan-ravencrest'].specs[250].sims;
  assert.deepEqual(sims.map(s=>s.id),['id-6','id-5','id-4','id-3','id-2']);
  addSim(store,who(),{...entry(upgradeJob({id:'id-4'})),created:2000},5);
  assert.equal(store.characters['temulan-ravencrest'].specs[250].sims.filter(s=>s.id==='id-4').length,1,'sending again replaces');
  removeSim(store,'id-4');
  assert.equal(store.characters['temulan-ravencrest'].specs[250].sims.length,4);
  for(const s of [...store.characters['temulan-ravencrest'].specs[250].sims])removeSim(store,s.id);
  assert.deepEqual(store.characters,{});
});

test('Data.lua is valid Lua 5.1, versioned, and reads back exactly',async()=>{
  const store=addSim({},who(),entry());
  const {text,bytes}=dataFile(store,{tracks,app:'1.1.0',now:new Date('2026-09-19T15:00:00Z')});
  assert.ok(bytes<20000);
  assert.match(text,/^-- SimC Lab data for the SimCLab addon, generated 2026-09-19T15:00:00.000Z/);
  assert.match(text,/\nlocal _, ns = \.\.\.\nns\.data = \{/);
  luaparse.parse(text,{luaVersion:'5.1'});
  const lua=await factory.createEngine();
  try{
    lua.global.set('__src',text);
    await lua.doString('__ns = {} load(__src, "@Data.lua")("SimCLab", __ns)');
    const get=async e=>{await lua.doString(`__out = ${e}`);return lua.global.get('__out');};
    assert.equal(await get('__ns.data.schemaVersion'),schemaVersion);
    assert.equal(await get('__ns.data.generated'),Math.floor(Date.parse('2026-09-19T15:00:00Z')/1000));
    assert.equal(await get('__ns.data.tracks[12830].name'),'Hero');
    assert.equal(await get('__ns.data.characters["temulan-ravencrest"].specs[250].sims[1].scenarios[1].results[2].sources[1].encounterId'),2895);
    assert.equal(await get('__ns.data.characters["temulan-ravencrest"].specs[250].sims[1].gear.head.enchant'),8016);
  }finally{lua.global.close();}
  const parsed=parseLua(text.replace('local _, ns = ...\nns.data','data'));
  assert.equal(parsed.data.characters['temulan-ravencrest'].specs['250'].sims[0].scenarios[0].results[0].name,'Fang of the Altar');
});

test('hostile names are escaped for Lua and reach the addon unchanged',async()=>{
  const w=who();w.name='Evil"]] end os.exit() --\n\\|cffff0000';
  const store=addSim({},w,entry());
  const {text}=dataFile(store,{tracks});
  luaparse.parse(text,{luaVersion:'5.1'});
  assert.equal(parseLua(text.replace('local _, ns = ...\nns.data','data')).data.characters['temulan-ravencrest'].name,w.name);
});

test('Data.lua stays under its size limit by dropping the oldest sims first',()=>{
  const store={};
  for(let c=0;c<6;c++)for(let i=0;i<5;i++){
    const w={...who(),key:`char${c}-realm`,name:`Char${c}`};
    addSim(store,w,{...entry(upgradeJob({id:`c${c}-${i}`})),created:10000+c*10+i},5);
  }
  const all=dataFile(store,{tracks,maxBytes:10*1024*1024});
  assert.equal(all.dropped,0);
  const limited=dataFile(store,{tracks,maxBytes:Math.floor(all.bytes/2)});
  assert.ok(limited.bytes<=Math.floor(all.bytes/2));assert.ok(limited.dropped>0);
  const kept=parseLua(limited.text.replace('local _, ns = ...\nns.data','data')).data.characters;
  const created=Object.values(kept).flatMap(c=>Object.values(c.specs).flatMap(s=>s.sims.map(x=>x.created)));
  assert.ok(Math.min(...created)>10000,'the oldest sims went first');
  assert.equal(dataFile(store,{tracks,keep:2}).text.match(/\bid="/g).length,12,'keep applies when writing too');
  assert.throws(()=>dataFile(store,{tracks,maxBytes:200}),/too large/);
  assert.ok(limits.bytes<=2*1024*1024);
});

test('result lists are capped per scenario',()=>{
  const job=upgradeJob();
  job.upgrade.candidates=Array.from({length:120},(_,i)=>({key:`k${i}`,slot:'head',itemId:300000+i,name:`Item ${i}`,itemLevel:280,value:`,id=${300000+i},bonus_id=12830`,sources:[]}));
  job.results=job.upgrade.candidates.map((c,i)=>({scenario:0,stage:2,key:c.key,dps:100000+i*10,error95:100,status:'complete'}));
  const [single]=entry(job).scenarios;
  assert.equal(single.results.length,limits.itemResults);
  assert.equal(single.results[0].itemId,300119);
});
