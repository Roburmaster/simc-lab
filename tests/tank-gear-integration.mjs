// Tank Sim with gear: bags, crest upgrades and instance loot in one tank job. Needs the server on 127.0.0.1:8642 and SimC installed.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:8642';
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data,ok=true)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();if(ok)assert.ok(r.ok,body.error||route);return {status:r.status,body};};
const wait=async id=>{let job;for(let i=0;i<1800;i++){job=await(await fetch(base+'/api/jobs/'+id)).json();if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setTimeout(r,1000));}throw new Error('The job did not finish.');};
const source=await fs.readFile(new URL('../profiles/druid-guardian.simc',import.meta.url),'utf8');
// The addon lists bag gear as comments below the equipped gear: a name with its item level, then the line.
const waist=source.match(/^waist=([^,]*),(id=\d+[^\n]*)$/m);
const bag=`\n### Gear from Bags\n#\n# Spare Sash (250)\n# waist=,${waist[2].replace(/,bonus_id=[^,]+/,'')},ilevel=250\n`;
const profile=source.split('\n').filter(l=>!l.startsWith('actions')).join('\n')+bag;
const imported=await post('/api/import',{profile});assert.equal(imported.body.isTank,true);
assert.ok(imported.body.alternatives.some(a=>a.slot==='waist'),'The bag item is read from the export.');
const sources=await(await fetch(base+'/api/upgrade-sources')).json();
const raid=sources.raids.at(-1);
const common={profile,mode:'tank',tank:{preset:'heroic',weight:60},iterations:400,duration:120,threads:8,targetError:0,scenarios:[{style:'Patchwerk',targets:1},{style:'Patchwerk',targets:3}]};

// No source: plain fights, no gear search.
const plain=await post('/api/preview',{...common,tankGear:{finalists:24}});
assert.equal(plain.body.upgrade,undefined,'No gear source means plain fights.');

// Bags alone: the one bag item is a candidate with its item level and its own source.
const bags=await post('/api/preview',{...common,tankGear:{finalists:24,bags:{}}});
assert.equal(bags.body.upgrade.candidates,1);assert.deepEqual(bags.body.upgrade.counts,{loot:0,bags:1,crests:0});

// All three sources at once, run for real.
const gear={finalists:24,bags:{},crests:{levels:'max',affordable:false},loot:{slots:['waist','head'],finalists:24,raid:{enabled:true,difficulty:sources.difficulties.at(-1).track,upgrade:0,encounters:raid.encounters.slice(0,2).map(e=>e.id)}}};
const preview=await post('/api/preview',{...common,tankGear:gear});
const counts=preview.body.upgrade.counts;assert.ok(counts.bags===1&&counts.loot>0,JSON.stringify(counts));
const job=await wait((await post('/api/jobs',{...common,tankGear:gear})).body.id);
assert.equal(job.status,'complete',JSON.stringify(job.stages)+job.error);
assert.equal(job.mode,'tank');assert.ok(job.settings.tank.adds&&job.settings.tank.boss.health>0);
const origins=new Set(job.upgrade.candidates.flatMap(c=>c.sources.map(s=>s.origin)));
assert.ok(origins.has('bags')&&origins.has('raid'),[...origins].join());
for(const s of [0,1]){
  const stages=job.stages.filter(st=>st.scenario===s&&st.status==='complete');
  assert.ok(stages.length>=1&&stages[0].baseline.tank,`Fight ${s} has a tank baseline.`);
  assert.ok(job.results.some(r=>r.scenario===s&&Number.isFinite(r.score)),`Fight ${s} ranks gear on the tank score.`);
}
console.log('tank gear ok',JSON.stringify({counts,candidates:job.upgrade.candidates.length,origins:[...origins]}));
