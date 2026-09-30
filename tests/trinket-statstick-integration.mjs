// Single trinkets beside a stat stick, against a running server and the real engine: Fury Warrior and Blood Death
// Knight. Start the server first (PORT picks it), then: node tests/trinket-statstick-integration.mjs
import assert from 'node:assert/strict';
const base='http://127.0.0.1:'+(process.env.PORT||8642);
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
const request={mode:'trinkets',trinkets:{specs:['warrior-fury','deathknight-blood'],model:'statstick',scenarioSet:['raid_st']},tank:{preset:'mythic',weight:50},
  iterations:Number(process.env.ITERATIONS||10000),targetError:Number(process.env.TARGET_ERROR??0.1),duration:300,threads:Number(process.env.THREADS||16)};
const job=await post('/api/jobs',request);
assert.equal(job.trinkets.model,'statstick');
let result;for(;;){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,2000));}
assert.equal(result.status,'complete',JSON.stringify(result.stages)+result.log);
assert.equal(result.done,result.total);
assert.equal(result.results.some(r=>r.pair),false,'no pairs in this model');
for(const spec of result.trinkets.specs){
  assert.equal(spec.statStick.stick,142508,`${spec.key}: the strength stick`);
  const stage=result.stages.find(s=>s.spec===spec.key&&s.stem);
  const input=await(await fetch(`${base}/reports/${job.id}/${stage.stem}.simc`)).text();
  assert.match(input,/^trinket2=,id=142508,bonus_id=607,ilevel=\d+$/m,'the stick is in the baseline');
  assert.equal(/^trinket1=/m.test(input),false,'the first slot is empty in the baseline');
  assert.equal(/profileset\.[^\n]*trinket2=/.test(input),false,'candidates never replace the stick');
  const by=new Map(spec.candidates.map(c=>[c.key,c]));
  const ranked=result.results.filter(r=>r.spec===spec.key&&Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
  assert.ok(ranked.length>20);
  assert.equal(ranked.find(r=>!by.get(r.key).set&&!by.get(r.key).overLimit).behind,0,'measured from the best trinket it can wear');
  console.log(`\n${spec.label} beside ${spec.statStick.trinket2} (baseline ${Math.round(stage.baseline.dps)} DPS)`);
  for(const r of ranked.slice(0,8))console.log(`  ${r.rank}. ${by.get(r.key).name} ${by.get(r.key).itemLevel}  ${Number.isFinite(r.score)?`dps ${r.dpsGain.toFixed(2)}% surv ${r.survival.toFixed(2)}% score ${r.score.toFixed(2)}`:`+${r.percent.toFixed(2)}%`}${r.tied?' ~':''}${by.get(r.key).overLimit?' (over limit)':''}${by.get(r.key).freed?` (in place of ${by.get(r.key).freed.embellishment} on ${by.get(r.key).freed.slot})`:''}`);
}
console.log('\nPASS');
