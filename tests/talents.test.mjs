import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadTalentData,decodeTalents,encodeTalents,validateBuild,pointTotals,generateCandidates,selectedHero} from '../lib/talents.mjs';
import {prepareTalents} from '../lib/optimizer.mjs';
import {parseProfile,createVariants} from '../lib/profile.mjs';
import {loadCatalog} from '../lib/catalog.mjs';
import {source} from '../lib/engine.mjs';
import {upstreamDir} from '../lib/paths.mjs';
import {referenceProfile} from './reference.mjs';
const data=await loadTalentData(upstreamDir,source),catalog=await loadCatalog(source);
const profile=parseProfile(await referenceProfile('Mage_Frost'));
const tree=data.find(profile.info),build=decodeTalents(profile.info.talents,tree),budgets={class:34,spec:34,hero:13};
test('current talent serialization round-trips without changing the imported build',()=>{
  assert.equal(encodeTalents(build,tree),profile.info.talents);assert.deepEqual(pointTotals(build,tree),budgets);assert.deepEqual(validateBuild(build,tree,{budgets,entries:data.entries}),[]);
});
test('validator rejects overspending, disconnected nodes, invalid choices and cross-spec strings',()=>{
  const broken=structuredClone(build);const leaf=tree.specNodes.find(n=>build.selected[n.id]?.purchased);delete broken.selected[leaf.id];assert.ok(validateBuild(broken,tree,{budgets}).length);
  const ranks=structuredClone(build);ranks.selected[leaf.id].rank=99;assert.ok(validateBuild(ranks,tree,{budgets}).some(e=>e.includes('rank')));
  const choice=structuredClone(build);choice.selected[leaf.id].entry=-1;assert.ok(validateBuild(choice,tree,{budgets}).some(e=>e.includes('choice')));
  assert.throws(()=>decodeTalents(profile.info.talents,data.trees.find(t=>t.specId===63)),/specialization/);
  const gated=structuredClone(build);for(const n of tree.specNodes)delete gated.selected[n.id];const capstone=tree.specNodes.find(n=>n.reqPoints===20);gated.selected[capstone.id]={entry:capstone.entries[0].id,rank:1,purchased:true};assert.ok(validateBuild(gated,tree,{budgets}).some(e=>e.includes('point-gated')));
});
test('engine profiles with hero nodes in both trees, purchased keystones or empty choice entries are legal',async()=>{
  // Feral carries 14 nodes in its inactive hero tree, BM and MM mark their free keystones purchased,
  // and Windwalker Conduit has a choice node with an empty second entry. SimC runs all three as written.
  for(const spec of ['Druid_Feral','Hunter_Beast_Mastery','Hunter_Marksmanship','Monk_Windwalker_Conduit']){
    const p=parseProfile((await referenceProfile(spec)).replace(/^timeofday=.*$/m,'')),t=data.find(p.info),b=decodeTalents(p.info.talents,t);
    assert.deepEqual(validateBuild(b,t,{budgets,entries:data.entries}),[],spec);assert.deepEqual(pointTotals(b,t),budgets,spec);assert.equal(encodeTalents(b,t).replace(/A+$/,''),p.info.talents.replace(/A+$/,''),spec);
  }
  const feral=parseProfile((await referenceProfile('Druid_Feral')).replace(/^timeofday=.*$/m,'')),ft=data.find(feral.info),fb=decodeTalents(feral.info.talents,ft);
  const r=generateCandidates(fb,ft,{limit:8,entries:data.entries});assert.equal(r.candidates.length,8);
  const active=ft.heroNodes.find(n=>n.subTreeId===selectedHero(fb,ft)&&fb.selected[n.id]?.purchased&&!n.freeNode);
  const mixed=structuredClone(fb);delete mixed.selected[active.id];assert.ok(validateBuild(mixed,ft,{budgets}).length,'the active hero tree is still checked');
});
test('generated builds retain budgets and explicit utility locks',()=>{
  const choice=tree.specNodes.find(n=>n.type==='choice'&&build.selected[n.id]);const locks={[choice.id]:true};const r=generateCandidates(build,tree,{limit:32,locks,entries:data.entries});assert.equal(r.candidates.length,32);
  for(const c of r.candidates){assert.deepEqual(c.build.selected[choice.id],build.selected[choice.id]);assert.deepEqual(validateBuild(c.build,tree,{budgets,entries:data.entries,locks,baseline:build}),[]);assert.deepEqual(pointTotals(decodeTalents(c.talents,tree),tree),budgets);}
});
test('optimizer uses legal seeds, removes fixed APLs, and returns bounded exportable builds',async()=>{
  const r=await prepareTalents(profile,{talentSearch:{limit:16}},data,source);assert.equal(r.variants.length,17);assert.equal(r.search.exhaustive,false);assert.ok(r.search.seedCount>=2);
  for(const v of r.variants){assert.ok(v.talents);assert.ok(!/^actions[.=+]/m.test(v.text));assert.deepEqual(validateBuild(decodeTalents(v.talents,tree),tree,{budgets,entries:data.entries}),[]);}
});
test('catalog uses explicit Midnight metadata and excludes legacy gear, gems and enchants',()=>{
  assert.equal(catalog.expansion.id,11);assert.ok(catalog.currentItems.length>1000);assert.ok(catalog.gems.length>0);assert.ok(catalog.currentItems.every(i=>i.expansion===11));assert.ok(catalog.gems.every(g=>g.expansion===11));
  assert.ok(!catalog.currentItems.some(i=>i.id===158366));assert.ok(!catalog.enchants.some(e=>e.id===6109));assert.ok(!catalog.gems.some(g=>g.id===22459));
  for(const text of ['finger1=,id=158366','finger1=,id=251136,enchant_id=6109','finger1=,id=251136,gem_id=22459','flask=flask_of_alchemical_chaos_3'])assert.throws(()=>createVariants(profile,{mode:'compare',variants:[{name:'Rejected old selection',text}]},catalog),/Midnight/);
  assert.doesNotThrow(()=>createVariants(profile,{mode:'compare',variants:[{name:'Current gem',text:'finger1=,id=251136,gem_id=240908'}]},catalog));
});
