import test from 'node:test';
import assert from 'node:assert/strict';
import {catalystCandidates,tierPieces,searchBis,bisSteps,assemble,bisContext,buildPool,ranksFrom,pickOf,neighbors,signature,upgradeOptions,bagCandidates,activeSets,depths,stages,groupOf} from '../lib/bis.mjs';
import {shoppingList,slotRows,bisReportPage} from '../lib/bispage.mjs';

// A toy character whose DPS is a plain sum of what each worn item is worth, plus a bonus for tier pieces and a penalty
// when two clashing trinkets are worn together. No SimC: the point is that the search finds what the numbers say.
const worth={1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0,10:5,20:2,11:4,21:1,12:6,22:3,13:3,23:.5,14:2,30:8,31:7,32:1,40:10,41:9,42:5};
const tier=new Set([20,21,22,23]);
let tierBonus=true;
const slotOfItem={1:'head',2:'neck',3:'finger1',4:'finger2',5:'trinket1',6:'trinket2',7:'shoulder',8:'chest',9:'legs'};
const gearText=Object.entries(slotOfItem).map(([id,slot])=>`${slot}=,id=${id}`).join('\n');
const gear=Object.fromEntries(Object.entries(slotOfItem).map(([id,slot])=>[slot,{slot,id:Number(id),value:`,id=${id}`}]));
const profile={info:{class:'warrior',spec:'arms',level:90},text:`warrior="Toy"\nspec=arms\n${gearText}`,gear};
const catalog={items:new Map(Object.keys(worth).concat(Object.keys(slotOfItem)).map(id=>[Number(id),{id:Number(id),name:`Item ${id}`,inventoryType:1}])),
  setBonuses:[2,4].map(pieces=>({name:'Toy Tier',setId:7,pieces,classId:1,specId:-1,items:[...tier]}))};
const source=label=>[{origin:'raid',group:'raid:1',groupName:'Boss',label}];
let n=0;
const cand=(slot,itemId,extra={})=>({key:'c'+String(++n).padStart(3,'0'),slot,itemId,name:`Item ${itemId}`,itemLevel:300,value:`,id=${itemId}`,line:`${slot}=,id=${itemId}`,sources:source(`Raid · Boss · ${itemId}`),...extra});
const candidates=[
  cand('head',10),cand('head',20),cand('shoulder',11),cand('shoulder',21),cand('chest',12),cand('chest',22),cand('legs',13),cand('legs',23),cand('neck',14),
  ...[30,31,32].flatMap(id=>[cand('finger1',id),cand('finger2',id)]),
  ...[40,41,42].flatMap(id=>[cand('trinket1',id),cand('trinket2',id)])];

// What the toy character does for a list of profileset parts laid over a base actor.
function toyDps(text,lines=[]){
  const worn={};
  for(const l of [...text.split('\n'),...lines]){const m=l.match(/^([a-z_0-9]+)=,id=(\d+)/);if(m)worn[m[1]]=Number(m[2]);}
  const ids=Object.values(worn);
  let dps=1000+ids.reduce((s,id)=>s+(worth[id]||0),0);
  const pieces=ids.filter(id=>tier.has(id)).length;
  if(tierBonus){if(pieces>=2)dps+=30;if(pieces>=4)dps+=80;}
  if(ids.includes(40)&&ids.includes(41))dps-=20;
  if(ids.includes(30)&&ids.includes(31))dps-=15;
  return dps;
}
function harness({plan,limit=Infinity}){
  const run={scenario:0,variants:[],rounds:[],notes:[],set:null,final:null,start:null,bySource:null};
  const calls=[];let done=0,calledSim=0;
  const sim=async(stage,list,settings,extra={})=>{
    calledSim++;done++;calls.push({stage,count:list.length,title:extra.title});
    const text=extra.base?.text||plan.profile.text;
    const baseline={dps:toyDps(text),error95:0};
    return {baseline,rows:list.map(l=>({key:l.key,dps:toyDps(text,l.parts?l.parts.map(p=>p.line):[l.line,...(l.extra||[])]),error95:0}))};
  };
  const env={plan,catalog,run,settings:{iterations:100,targetError:0},tank:null,sim,step:k=>{done+=k;},cancelled:()=>false,save:async()=>{}};
  return {env,run,calls,done:()=>done};
}
const plan=(extra={})=>({profile,bis:{candidates,finalists:48,rounds:3,itemLimits:null,specId:71,...extra}});

test('the search builds the best set, reaches the tier bonus, and finds the clash a greedy set misses',async()=>{
  const p=plan(),h=harness({plan:p});
  await searchBis(h.env);
  const wear=Object.fromEntries(h.run.set.map(s=>[s.slot,s.itemId]));
  // The four tier pieces (4 piece bonus +110) beat the best loose item in each of their slots.
  assert.deepEqual([wear.head,wear.shoulder,wear.chest,wear.legs],[20,21,22,23]);
  assert.equal(wear.neck,14);
  // Rings 30 and 31 clash, and so do trinkets 40 and 41: the search settles on 30 + 32 and 40 + 42.
  assert.deepEqual([wear.finger1,wear.finger2].sort(),[30,32]);
  assert.deepEqual([wear.trinket1,wear.trinket2].sort(),[40,42]);
  const expected=toyDps(p.profile.text,Object.entries({head:20,shoulder:21,chest:22,legs:23,neck:14,finger1:30,finger2:32,trinket1:40,trinket2:42}).map(([s,id])=>`${s}=,id=${id}`));
  assert.equal(h.run.final.dps,expected);
  assert.equal(h.run.final.current.dps,1000);
  assert.ok(Math.abs(h.run.final.gain-100*(expected-1000)/1000)<1e-9);
  // Each changed slot is worth what it adds inside the set.
  assert.ok(h.run.final.slots.every(s=>s.worth>0),JSON.stringify(h.run.final.slots));
  // Two independent fixes in different slot groups are made in the same round, and the next round checks they added up.
  assert.equal(h.run.rounds[0].adopted?.length,2,JSON.stringify(h.run.rounds));
  assert.equal(h.run.rounds[0].adopted.map(a=>a.changes[0].replace(/[12]$/,'')).sort().join(),'finger,trinket');
  assert.equal(h.done(),bisSteps(p.bis,1),'every step of the job is counted once');
});

test('a ring or trinket is never worn twice, and the embellishment limit holds',()=>{
  const limits={bonuses:new Map(),items:new Map(),quantities:new Map([[512,2]])};
  const emb=(slot,id,w)=>{worth[id]=w;return cand(slot,id,{limits:[512]});};
  const list=[emb('neck',60,10),emb('finger1',61,9),emb('finger2',61,9),emb('trinket1',62,8),emb('trinket2',62,8),cand('finger1',30),cand('finger2',30),cand('finger1',31),cand('finger2',31)];
  const p={profile,bis:{candidates:list,finalists:48,rounds:1,itemLimits:limits,specId:71}};
  const ctx=bisContext(p,catalog);
  const ranks=new Map(list.map(c=>[c.key,{rank:worth[c.itemId],noise:0,stage:stages.final}]));
  const picks=assemble(buildPool(list,ranks,ctx),ctx);
  const ids=[...picks.values()].map(x=>x.itemId);
  assert.equal(new Set(ids.filter(id=>[60,61,62].includes(id))).size,2,'at most two embellished items');
  assert.ok(ids.includes(60)&&ids.includes(61),'the best two embellished items are the ones kept');
  assert.notEqual(picks.get('finger1').itemId,picks.get('finger2').itemId);
  assert.deepEqual(signature(picks,ctx),signature(new Map([...picks].reverse()),ctx),'ring order does not change the set');
  for(const s of ['neck','finger1','finger2','trinket1','trinket2'])assert.ok(picks.get(s));
});

test('a gain inside its own noise does not replace what is worn',()=>{
  const ctx=bisContext(plan(),catalog);
  const list=[cand('head',10),cand('head',20)];
  const ranks=new Map([[list[0].key,{rank:1,noise:2,stage:stages.final}],[list[1].key,{rank:5,noise:1,stage:stages.final}]]);
  assert.equal(assemble(buildPool(list,ranks,ctx),ctx).get('head').itemId,20,'a clear gain wins');
  const noisy=buildPool([list[0]],new Map([[list[0].key,{rank:1,noise:2,stage:stages.final}]]),ctx);
  assert.equal(assemble(noisy,ctx).get('head').itemId,1,'a gain smaller than its noise leaves what is worn');
});

test('nothing beats what is worn: the search says so and counts every step',async()=>{
  const none=[cand('head',1,{value:',id=1',line:'head=,id=1'})];
  const p=plan({candidates:[cand('head',9)]});worth[9]=0;
  const h=harness({plan:p});
  await searchBis(h.env);
  assert.ok(h.run.final?.same||h.run.notes.length,JSON.stringify(h.run));
  assert.equal(h.done(),bisSteps(p.bis,1));
  void none;
});

test('item sets in the sources are found for the class, and only when enough pieces are on offer',()=>{
  const available=new Set([20,21,22,23]);
  const sets=activeSets(catalog,profile.info,71,available);
  assert.equal(sets.length,1);assert.deepEqual(sets[0].thresholds,[2,4]);
  assert.equal(activeSets(catalog,{class:'mage'},64,available).length,0,'another class has none');
  assert.equal(activeSets(catalog,profile.info,71,new Set([20])).length,0,'a single piece cannot reach a bonus');
});

test('a request becomes fully upgraded Upgrade Finder sources',()=>{
  const season={difficulties:[{name:'Heroic',track:617},{name:'Mythic',track:618}],tracks:[{id:617,levels:[1,2,3,4,5,6]},{id:618,levels:[1,2,3,4,5,6]}]};
  const o=upgradeOptions({depth:'quick',raid:{enabled:true,difficulty:618},mplus:{enabled:true,track:617,level:6},crafted:{enabled:true,itemLevel:331}},season);
  assert.equal(o.finalists,depths.quick.finalists);
  assert.deepEqual(o.raid,{enabled:true,difficulty:618,upgrade:6});
  assert.deepEqual(o.crafted,{enabled:true,itemLevel:331,stats:'all'});
  assert.equal(o.mplus.level,6);
  assert.equal(upgradeOptions({raid:{enabled:false}},season).raid,undefined,'an unticked source is not searched');
  assert.throws(()=>upgradeOptions({depth:'bogus'},season),/search depth/);
  assert.throws(()=>upgradeOptions({raid:{enabled:true,difficulty:1}},season),/difficulty/);
});

test('gear in the bags is offered where it fits, with the worn enchant, and the vault is not',()=>{
  const items=new Map([[501,{id:501,name:'Bag Ring',inventoryType:11,ilevel:280}],[502,{id:502,name:'Vault Ring',inventoryType:11,ilevel:290}]]);
  const char={info:{class:'warrior',spec:'arms',level:90},gear:{finger1:{slot:'finger1',id:3,value:',id=3,enchant_id=7000,gem_id=9'},finger2:{slot:'finger2',id:4,value:',id=4'}},
    alternatives:[{name:'Bag Ring (285)',slot:'finger1',text:'finger1=,id=501,bonus_id=1/2',section:'Gear from Bags'},{name:'Vault Ring (290)',slot:'finger1',text:'finger1=,id=502',section:'Weekly Reward Choices'}]};
  const found=bagCandidates(char,{entries:[],itemLimits:null,bonusSockets:{},weaponSpecs:[]},{items},71);
  assert.deepEqual(found.map(c=>c.slot),['finger1','finger2']);
  assert.equal(found[0].itemId,501);assert.equal(found[0].itemLevel,285);assert.equal(found[0].name,'Bag Ring');
  assert.match(found[0].value,/enchant_id=7000/,'the enchant of the ring it replaces carries over');
  assert.doesNotMatch(found[1].value,/enchant_id/,'the other ring had none');
  assert.equal(found[0].sources[0].origin,'bags');
  assert.ok(found.every(c=>c.itemId!==502));
});

test('the report names the set slot by slot, groups it by where it drops, and escapes names',()=>{
  const candidatesJob=[
    {key:'c1',slot:'head',itemId:10,name:'Helm <b>',itemLevel:334,value:',id=10',sources:[{origin:'raid',group:'raid:5',groupName:'Boss One',label:'Raid · Boss One'}]},
    {key:'c2',slot:'neck',itemId:14,name:'Necklace',itemLevel:321,value:',id=14',sources:[{origin:'mplus',group:'mplus:9',groupName:'Dungeon',label:'Mythic+ · Dungeon'}]}];
  const job={id:'x',name:'Toy',created:'2026-10-08T10:00:00Z',finished:'2026-10-08T11:00:00Z',status:'complete',engine:{version:'1',wowVersion:'12.1'},settings:{iterations:1000,targetError:.1,duration:300},scenarios:[{style:'Patchwerk',targets:1}],
    bis:{season:{name:'Season'},screen:{iterations:2000,targetError:.5},candidates:candidatesJob,worn:[{slot:'head',itemId:1,name:'Old Helm',value:',id=1'},{slot:'neck',itemId:2,name:'Old Neck',value:',id=2'},{slot:'back',itemId:3,name:'Cloak',value:',id=3'}],
      runs:[{set:[{slot:'head',key:'c1',itemId:10},{slot:'neck',key:'c2',itemId:14},{slot:'back',key:null,itemId:3}],notes:[],variants:[],rounds:[],bySource:{head:{raid:{key:'c1',rank:2,noise:.1}}},
        final:{dps:1100,error95:5,current:{dps:1000,error95:5},gain:10,noise:.5,slots:[{slot:'head',key:'c1',worth:6,noise:.1},{slot:'neck',key:'c2',worth:4,noise:.1}]}}]}};
  const rows=slotRows(job,job.bis.runs[0]);
  assert.deepEqual(rows.filter(r=>r.c).map(r=>r.slot),['head','neck']);
  assert.equal(rows.find(r=>r.slot==='back').c,null,'a kept slot has no new item');
  const shop=shoppingList(rows.filter(r=>r.c));
  assert.deepEqual(shop.map(g=>g.origin),['raid','mplus']);
  const html=bisReportPage(job,{info:{name:'Toy',class:'warrior',spec:'arms'}});
  assert.match(html,/Best in Slot/);assert.match(html,/Keep it\./);assert.match(html,/\+10\.00 %/);
  assert.doesNotMatch(html,/Helm <b>/);assert.match(html,/Helm &lt;b&gt;/);
});

test('rings and trinkets collapse to one group each',()=>{
  assert.equal(groupOf('finger2'),'finger');assert.equal(groupOf('trinket1'),'trinket');assert.equal(groupOf('main_hand'),'main_hand');
  void pickOf;void neighbors;void ranksFrom;
});

test('the search can be held to a 4 piece tier set, and says which slots are cheapest to make tier',async()=>{
  tierBonus=false;
  try{
    const worn=h=>Object.fromEntries(h.run.set.map(x=>[x.slot,x.itemId]));
    const count=w=>Object.values(w).filter(id=>tier.has(id)).length;
    // Without a tier bonus the loose items are better and the free search wears none of the set.
    const free=harness({plan:plan({tierItems:[20,21,22,23],requireSet:false,rounds:2})});await searchBis(free.env);
    assert.equal(count(worn(free)),0);
    // Held to four, it wears all four it can reach, and the free set is still simulated to show the cost.
    const held=harness({plan:plan({tierItems:[20,21,22,23],requireSet:true,rounds:2})});await searchBis(held.env);
    assert.equal(count(worn(held)),4);
    assert.equal(held.run.catalyst.pieces,4);
    assert.equal(held.run.variants.find(v=>v.allowed===false)?.tier,0,'the set without the rule is shown, marked as not allowed');
    assert.ok(held.run.variants.find(v=>v.key===held.run.start).allowed);
    // Cheapest slot first: head, shoulders and chest lose 3 each, legs 2.5.
    const costs=held.run.catalyst.slots.map(x=>x.cost);
    assert.deepEqual([...costs].sort((a,b)=>a-b),costs);
    assert.equal(held.run.catalyst.slots[0].group,'legs');
    assert.ok(held.run.catalyst.slots.every(x=>x.chosen));
    assert.equal(held.done(),bisSteps(plan({rounds:2}).bis,1));
    // Fewer than four on offer: the rule cannot be met, so the search says so and goes on without it.
    const short=harness({plan:plan({candidates:candidates.filter(c=>c.itemId!==23),tierItems:[20,21,22,23],requireSet:true,rounds:2})});await searchBis(short.env);
    assert.match(short.run.notes.join(' '),/Fewer than 4 pieces/);
    assert.equal(count(worn(short)),0);
  }finally{tierBonus=true;}
});

test('the Catalyst offers every tier piece at the level of each source that can feed it',()=>{
  const season={entries:[
    {item:{id:20,name:'Tier Helm',itemClass:4,itemSubClass:4,inventoryType:1,stats:[{id:74}],bonusLists:[111]},source:{kind:'raid',token:'Helm Token',group:1}},
    {item:{id:21,name:'Tier Shoulders',itemClass:4,itemSubClass:4,inventoryType:3,stats:[{id:74}]},source:{kind:'raid',token:'Shoulder Token',group:1}},
    {item:{id:99,name:'Loose Helm',itemClass:4,itemSubClass:4,inventoryType:1,stats:[{id:74}]},source:{kind:'raid',group:1}},
    {item:{id:98,name:'Other Class Helm',itemClass:4,itemSubClass:4,inventoryType:1,allowableClasses:[2],stats:[{id:74}]},source:{kind:'raid',token:'Other',group:1}}],
    weaponSpecs:[],bonusSockets:{},tracks:[{id:617,name:'Hero',levels:[{level:6,max:6,bonusId:13999,itemLevel:321}]}]};
  const char={info:{class:'warrior',spec:'arms',level:90},gear:{head:{slot:'head',id:1,value:',id=1,enchant_id=5'},shoulder:{slot:'shoulder',id:7,value:',id=7'}}};
  const items=new Map([[20,{inventoryType:1}],[21,{inventoryType:3}],[99,{inventoryType:1}]]);
  assert.deepEqual([...tierPieces(season,char.info,71).keys()].sort(),[20,21],'only the own class pieces that tokens turn into');
  const found=catalystCandidates(char,{mplus:{enabled:true,track:617,level:6},crafted:{enabled:true,itemLevel:331}},season,{items},71);
  assert.equal(found.length,4,'two pieces at two levels');
  const helm=found.filter(c=>c.itemId===20);
  assert.deepEqual(helm.map(c=>c.itemLevel).sort(),[321,331]);
  assert.match(helm.find(c=>c.itemLevel===321).value,/bonus_id=111[/]13999/,'the piece keeps its own bonus and the source level');
  assert.match(helm.find(c=>c.itemLevel===331).value,/ilevel=331/);
  assert.match(helm[0].value,/enchant_id=5/,'the enchant carries over');
  assert.equal(helm[0].sources[0].origin,'catalyst');
  assert.equal(catalystCandidates(char,{raid:{enabled:true}},season,{items},71).length,0,'a raid piece needs no Catalyst');
});
