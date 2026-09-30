// Trinket pairs against a running server and the real engine: Fury Warrior (damage) and Blood Death Knight (tank).
// Start the server first (PORT picks it), then: node tests/trinket-pairs-integration.mjs
// ITERATIONS, POOL and PAIRS change the precision and size; the defaults keep it to a few minutes.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:'+(process.env.PORT||8642);
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
const specs=['warrior-fury','deathknight-blood'];
const pool=Number(process.env.POOL||8),pairFinalists=Number(process.env.PAIRS||10);
const request={mode:'trinkets',trinkets:{specs,finalists:64,model:'pairs',pool,pairFinalists},tank:{preset:'mythic',weight:50},
  iterations:Number(process.env.ITERATIONS||2000),duration:300,threads:Number(process.env.THREADS||12),targetError:Number(process.env.TARGET_ERROR??0.2),
  scenarios:[{style:process.env.STYLE||'Patchwerk',targets:1}]};
const preview=await post('/api/preview',request);
const t=preview.trinkets;
assert.equal(t.model,'pairs');
assert.equal(t.estimate.specs.length,2);
console.log('Estimate:',JSON.stringify(t.estimate));
const job=await post('/api/jobs',request);
const started=Date.now();
let result;for(let i=0;i<24*3600;i++){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;if(i%30===0)console.log(`${result.done}/${result.total} ${result.current?.name||''}`);await new Promise(r=>setTimeout(r,1000));}
assert.equal(result.status,'complete',JSON.stringify(result.stages)+result.log);
assert.equal(result.done,result.total,'the step count holds');
const repro=result.trinkets.repro;
assert.match(repro.simcSha,/^[0-9a-f]{40}$/);assert.ok(repro.wowBuild&&repro.simcBranch);
assert.equal(repro.duration,300);assert.equal(repro.ptr,0);
for(const spec of result.trinkets.specs){
  assert.match(spec.profile.hash,/^[0-9a-f]{16}$/);assert.ok(spec.profile.talents,`${spec.key}: talents recorded`);
  assert.ok(spec.candidates.every(c=>c.item?.id===c.itemId&&Array.isArray(c.item.bonusIds)),`${spec.key}: every candidate records its construction`);
  const entry=spec.pairs[0];
  assert.ok(entry.pool.length>=pool,`${spec.key}: pool of ${entry.pool.length}`);
  const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
  for(const p of entry.pairs)assert.notEqual(byKey.get(p.keys[0]).itemId,byKey.get(p.keys[1]).itemId,'never the same trinket twice');
  assert.equal(new Set(entry.pairs.map(p=>p.pairKey)).size,entry.pairs.filter(p=>p.onUse<2).length+entry.pairs.filter(p=>p.onUse===2).length/2,'one pair key per pair, both orders for two on-use trinkets');
  const ranked=result.results.filter(r=>r.spec===spec.key&&r.pair&&!r.superseded&&Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
  assert.ok(ranked.length>=pairFinalists,`${spec.key}: ${ranked.length} ranked pairs`);
  assert.ok(ranked.every((r,i)=>r.rank===i+1),`${spec.key}: ranks run without a gap`);
  assert.equal(new Set(ranked.map(r=>entry.pairs.find(p=>p.key===r.key).pairKey)).size,ranked.length,'a pair is ranked once');
  if(spec.tank)assert.ok(ranked.every(r=>Number.isFinite(r.dpsGain)&&Number.isFinite(r.survival)&&Number.isFinite(r.score)),`${spec.key}: damage and survival kept apart`);
  else assert.ok(ranked[0].gain>0&&ranked[0].percent>0,`${spec.key}: the best pair adds damage`);
  // The best pair should beat the best single trinket: a second trinket adds its stats at least.
  const single=result.results.find(r=>r.spec===spec.key&&!r.pair&&r.rank===1);
  if(!spec.tank)assert.ok(ranked[0].gain>single.gain,`${spec.key}: best pair ${ranked[0].gain} over best single ${single.gain}`);
  assert.equal(entry.partners.length,new Set(ranked.flatMap(r=>entry.pairs.find(p=>p.key===r.key).keys)).size,`${spec.key}: every ranked trinket has a best partner`);
  const kinds=new Set(entry.pairs.map(p=>p.onUse));
  const top=ranked.slice(0,5).map(r=>{const p=entry.pairs.find(x=>x.key===r.key);return `${r.rank}. ${p.keys.map(k=>byKey.get(k).name+' '+byKey.get(k).itemLevel).join(' + ')} ${spec.tank?`dps ${r.dpsGain.toFixed(2)}% surv ${r.survival.toFixed(2)}% score ${r.score.toFixed(2)}±${r.scoreError.toFixed(2)}`:`+${r.percent.toFixed(2)}% (${Math.round(r.dps)}±${Math.round(r.error95)})`}${r.tied?' ~':''}`;});
  console.log(`\n${spec.label}: pool ${entry.pool.length}, ${entry.pairs.length} pairs, on-use kinds ${[...kinds].sort()}\n  ${top.join('\n  ')}`);
  const stages=result.stages.filter(s=>s.spec===spec.key);
  console.log('  stages:',stages.map(s=>`${s.stage}:${s.status}${s.count?`(${s.count})`:''}`).join(' '));
  const final=stages.find(s=>s.stage===7&&s.stem);
  const input=await(await fetch(`${base}/reports/${job.id}/${final.stem}.simc`)).text();
  assert.equal(/^trinket[12]=/m.test(input),false,'the base character wears no trinket');
  const sets=new Set([...input.matchAll(/^profileset\."([^"]+)"/gm)].map(m=>m[1]));
  for(const name of sets){
    const lines=input.split('\n').filter(l=>l.startsWith(`profileset."${name}"`));
    assert.ok(lines.some(l=>/="?trinket1=,id=\d+/.test(l))&&lines.some(l=>/\+=trinket2=,id=\d+/.test(l)),`${name} wears two trinkets`);
  }
  assert.match(input,new RegExp(`^iterations=${request.iterations}$`,'m'));assert.match(input,/^max_time=300$/m);assert.match(input,/^vary_combat_length=0\.2$/m);assert.match(input,/^desired_targets=1$/m);
}
const page=await(await fetch(`${base}/trinket-tier-list/${job.id}.html`)).text();
assert.match(page,/<div class="pairs"><h4>Best pairs/);
console.log(`\nPASS in ${Math.round((Date.now()-started)/1000)} s.`);
