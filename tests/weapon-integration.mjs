import assert from 'node:assert/strict';
const base='http://127.0.0.1:'+(process.env.PORT||8642);
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
const data=await(await fetch(base+'/api/weapon-specs')).json();
assert.ok(data.specs.length>20,`only ${data.specs.length} reference profiles`);
assert.ok(data.specs.some(s=>s.tank)&&data.tracks.length&&Object.keys(data.kinds).length===4);
assert.ok(data.specs.every(s=>s.key&&s.label&&s.season&&!s.text),'the profile text stays on the server');
const track=data.tracks.at(-1),top=track.levels.at(-1);
// One damage specialization and one tank, so both rankings and the per-spec boss calibration are covered.
const specs=['warrior-arms','warrior-protection'].filter(key=>data.specs.some(s=>s.key===key));
assert.equal(specs.length,2);
const weapons={specs,kinds:Object.keys(data.kinds),track:track.id,level:top.level,finalists:12};
const request={mode:'weapons',weapons,tank:{preset:'dungeon',weight:50},iterations:200,duration:60,threads:8,targetError:0,scenarios:[{style:'Patchwerk',targets:1}]};
const preview=await post('/api/preview',request);
assert.ok(preview.weapons.candidates>20,JSON.stringify(preview.weapons));
assert.equal(preview.weapons.specs,2);assert.equal(preview.weapons.tanks,1);
assert.equal(preview.total,preview.weapons.steps);
const job=await post('/api/jobs',request);
let result;for(let i=0;i<1800;i++){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,1000));}
assert.equal(result.status,'complete',JSON.stringify(result.stages)+result.log);
assert.equal(result.done,result.total);
for(const spec of result.weapons.specs){
  const rows=result.results.filter(r=>r.spec===spec.key&&!r.superseded&&Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
  assert.equal(rows.length,spec.candidates.length,`${spec.key}: every candidate is ranked once`);
  assert.equal(rows[0].behind,0);
  assert.ok(rows.every(r=>'SABCD'.includes(r.tier)),`${spec.key}: every row has a tier`);
  assert.ok(rows.every((r,i)=>r.rank===i+1),`${spec.key}: ranks are a sequence`);
  assert.ok(rows.every(r=>spec.candidates.some(c=>c.key===r.key)),`${spec.key}: every row belongs to a candidate`);
  assert.ok(rows.some(r=>!r.screened),`${spec.key}: the final round replaced its screening rows`);
  if(spec.tank){
    assert.ok(rows.every(r=>Number.isFinite(r.score)),'a tank spec ranks on the weighted score');
    assert.ok(spec.boss?.measured?.deaths>=0,'the boss was calibrated for this spec');
  }else assert.ok(rows.every(r=>r.dps>0));
}
const stages=result.stages.filter(s=>s.stem);
assert.ok(stages.some(s=>s.stage===1)&&stages.some(s=>s.stage===2),'both screening and a final round ran');
const input=await(await fetch(`${base}/reports/${job.id}/${stages[0].stem}.simc`)).text();
assert.match(input,/profileset\."w001"=(main_hand|off_hand)=,id=\d+,bonus_id=/);
assert.ok(!/^main_hand=.*\n.*profileset."w001"=main_hand=.*ilevel=/m.test(input),'candidates carry their item level through bonus IDs');
console.log(`PASS: ${preview.weapons.candidates} weapons ranked for ${preview.weapons.specs} specializations at item level ${preview.weapons.level.itemLevel}, ${stages.length} profileset runs.`);
