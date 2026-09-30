// Trinket Lab against a running server and the real engine: one damage specialization and one tank, at low
// precision. Start the server first (PORT picks it), then: node tests/trinket-integration.mjs
import assert from 'node:assert/strict';
const base='http://127.0.0.1:'+(process.env.PORT||8642);
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
const data=await(await fetch(base+'/api/trinket-specs')).json();
assert.ok(data.specs.length>20,`only ${data.specs.length} reference profiles`);
assert.ok(data.specs.every(s=>!s.healer&&!s.text),'no healers, and the profile text stays on the server');
assert.ok(data.healers.length>=5,'the healers left out are named');
const specs=['warrior-arms','warrior-protection'];
// A final round of 16 is smaller than either list, so both screening and the final round run.
const request={mode:'trinkets',trinkets:{specs,finalists:16,model:'single'},tank:{preset:'dungeon',weight:50},iterations:300,duration:60,threads:8,targetError:0,scenarios:[{style:'Patchwerk',targets:1}]};
const preview=await post('/api/preview',request);
const t=preview.trinkets;
assert.equal(t.specs,2);assert.equal(t.tanks,1);assert.equal(t.screened,2);
assert.ok(t.trinkets>30,JSON.stringify(t));
assert.equal(preview.total,t.steps);
assert.ok(t.sources.delves.itemLevel<t.sources.raid.itemLevel,'delve loot stops below the raid');
const job=await post('/api/jobs',request);
let result;for(let i=0;i<3600;i++){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,1000));}
assert.equal(result.status,'complete',JSON.stringify(result.stages)+result.log);
assert.equal(result.done,result.total);
for(const spec of result.trinkets.specs){
  const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
  const items=new Set(spec.candidates.map(c=>c.itemId));
  const ranked=result.results.filter(r=>r.spec===spec.key&&!r.pair&&!r.superseded&&Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
  assert.equal(ranked.length,items.size,`${spec.key}: every trinket is ranked once`);
  assert.ok(ranked.every(r=>byKey.get(r.key).top),`${spec.key}: the tier is read at each trinket's top level`);
  assert.ok(ranked.every((r,i)=>r.rank===i+1&&'SABCD'.includes(r.tier)),`${spec.key}: ranks run without a gap and all have a tier`);
  assert.equal(ranked.find(r=>!byKey.get(r.key).set).behind,0,`${spec.key}: measured from the best trinket without a set`);
  const finals=ranked.filter(r=>!r.screened);
  assert.equal(finals.length,16,`${spec.key}: the final round took the best 16`);
  // A finalist has a curve: every level it was simulated at, rising with item level within noise.
  for(const row of finals.slice(0,3)){
    const c=byKey.get(row.key);
    const curve=result.results.filter(r=>r.spec===spec.key&&r.stage===2&&byKey.get(r.key).itemId===c.itemId).map(r=>({level:byKey.get(r.key).itemLevel,gain:r.gain})).sort((a,b)=>a.level-b.level);
    assert.equal(curve.length,spec.candidates.filter(x=>x.itemId===c.itemId).length,`${c.name}: every level simulated`);
    assert.ok(curve.every(p=>Number.isFinite(p.gain)),`${c.name}: every level has a gain`);
  }
  if(spec.tank){assert.ok(ranked.every(r=>Number.isFinite(r.score)));assert.ok(spec.boss?.measured);}
  else assert.ok(ranked[0].gain>0&&ranked[0].percent>0,`${spec.key}: the best trinket adds damage over none`);
  assert.equal(spec.worn.length,2,`${spec.key}: both reference trinkets were taken off`);
}
const stages=result.stages.filter(s=>s.stem);
const input=await(await fetch(`${base}/reports/${job.id}/${stages.find(s=>s.stage===1).stem}.simc`)).text();
assert.equal(/^trinket[12]=/m.test(input),false,'the base character wears no trinket');
assert.match(input,/profileset\."t\d{4}"=trinket1=,id=\d+/);
assert.equal(/profileset\.[^\n]*trinket2=/.test(input),false,'the second slot stays empty');
const page=await(await fetch(`${base}/trinket-tier-list/${job.id}.html`)).text();
assert.deepEqual(page.match(/<script[^>]*>/gi),['<script async src="https://wow.zamimg.com/js/tooltips.js">']);
assert.match(page,/data-levels="\d+:/);
assert.equal((await fetch(`${base}/trinket-tier-list/00000000-0000-0000-0000-000000000000.html`)).status,404);
console.log(`PASS: ${t.trinkets} trinkets, ${t.candidates} trinket and item level pairs, ${stages.length} profileset runs, page ${page.length} bytes.`);
