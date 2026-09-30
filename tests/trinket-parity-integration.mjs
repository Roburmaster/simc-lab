// Bloodmallet parity against a running server and the real engine, Fury Warrior only: the generated input must be
// Bloodmallet's experiment, and the run must complete. Start the server first (PORT picks it), then:
// node tests/trinket-parity-integration.mjs
import assert from 'node:assert/strict';
const base='http://127.0.0.1:'+(process.env.PORT||8642);
const {token,engine}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
// One item level keeps it short; the fight and precision are Bloodmallet's whatever is asked for here.
const request={mode:'trinkets',trinkets:{specs:['warrior-fury'],parity:true,compareSha:engine.commit.slice(0,7),steps:[Number(process.env.TRACK||0)].filter(Boolean)},iterations:1000,targetError:0.5,duration:120,threads:Number(process.env.THREADS||16),scenarios:[{style:'Patchwerk',targets:3}]};
if(!request.trinkets.steps.length)delete request.trinkets.steps;
const job=await post('/api/jobs',request);
assert.equal(job.settings.iterations,60000);assert.equal(job.settings.targetError,0.1);assert.equal(job.settings.duration,300);
assert.deepEqual(job.scenarios.map(s=>[s.style,s.targets]),[['CastingPatchwerk',1]]);
assert.equal(job.trinkets.model,'single');assert.equal(job.trinkets.repro.parity.shaMatches,true);
let result;for(let i=0;i<24*3600;i++){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;if(i%60===0)console.log(`${result.done}/${result.total} ${result.current?.name||''}`);await new Promise(r=>setTimeout(r,1000));}
assert.equal(result.status,'complete',JSON.stringify(result.stages)+result.log);
const stage=result.stages.find(s=>s.stem);
const input=await(await fetch(`${base}/reports/${job.id}/${stage.stem}.simc`)).text();
assert.match(input,/^trinket2=,id=142508,bonus_id=607,ilevel=\d+$/m,'the strength stat stick in the second slot');
assert.match(input,/^potion=lights_potential_2$/m);
assert.match(input,/^fight_style=CastingPatchwerk$/m);assert.match(input,/^iterations=60000$/m);assert.match(input,/^target_error=0.1$/m);
assert.equal(/^optimal_raid=0$/m.test(input),false,"SimC's default raid, as Bloodmallet runs it");
for(const m of input.matchAll(/^profileset\."[^"]+"=(.*)$/gm))assert.match(m[1],/^trinket1=,id=\d+(,bonus_id=\d+)?,ilevel=\d+$/,'item ID and item level, and a stat choice where the trinket rolls one');
const spec=result.trinkets.specs[0];
const ranked=result.results.filter(r=>Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
console.log(ranked.slice(0,10).map(r=>`${r.rank}. ${byKey.get(r.key).name} ${byKey.get(r.key).itemLevel} +${r.percent.toFixed(2)}%`).join('\n'));
console.log('PASS');
