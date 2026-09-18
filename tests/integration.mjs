import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base='http://127.0.0.1:8642';
const status=await(await fetch(base+'/api/status')).json();
async function post(route,data,token=status.token){const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});return {status:response.status,body:await response.json()};}
async function wait(id){for(let i=0;i<120;i++){const job=await(await fetch(`${base}/api/jobs/${id}`)).json();if(!['running','queued'].includes(job.status))return job;await new Promise(r=>setTimeout(r,100));}throw new Error('Job timed out');}
const example=(await(await fetch(base+'/api/example')).json()).text;
assert.equal(status.engine.compatible,true);
assert.equal((await post('/api/jobs',{profile:example},'bad')).status,403);
assert.equal((await post('/api/jobs',{profile:'# WoW 12.0.7.68974\n'+example})).status,400);
assert.equal((await post('/api/import',{profile:example+'\nrace=tauren output=outside.txt'})).status,400);
const imported=await post('/api/import',{profile:example+'\n### Gear from Bags\n# Vault ring\n# finger1=,id=251136,enchant_id=8021\n# Saved Loadout: Test\n# talents=ABC123'});
assert.equal(imported.body.alternatives.length,2);
const config={profile:example,iterations:100,duration:20,threads:2,targetError:0};
const combinations=await post('/api/jobs',{...config,mode:'enchants',combine:true,enchants:{finger1:[0,8021],finger2:[7965,8021]},scenarios:[{style:'Patchwerk',targets:1},{style:'Patchwerk',targets:3}]});
assert.equal(combinations.status,201);const finished=await wait(combinations.body.id);assert.equal(finished.status,'complete');assert.equal(finished.results.length,10);assert.ok(finished.results.every(r=>r.dps>0&&r.error95>0));
const input=await(await fetch(`${base}/reports/${finished.id}/001.simc`)).text();assert.match(input,/finger1=[^\n]*\n/);assert.ok(!input.match(/finger1=[^\n]*enchant/));assert.match(input,/finger2=[^\n]*enchant_id=7965/);
const broken=await post('/api/jobs',{...config,mode:'compare',variants:[{name:'Intentional invalid talents',text:'talents=invalid'}]});
const partial=await wait(broken.body.id);assert.equal(partial.status,'partial');assert.equal(partial.results[0].status,'complete');assert.equal(partial.results[1].status,'failed');
const long=await post('/api/jobs',{...config,iterations:1000000,duration:1200,threads:1});
const queued=await post('/api/jobs',config);assert.equal(queued.body.status,'queued');
await post(`/api/jobs/${queued.body.id}/cancel`,{});assert.equal((await wait(queued.body.id)).status,'cancelled');
await post(`/api/jobs/${long.body.id}/cancel`,{});assert.equal((await wait(long.body.id)).status,'cancelled');
await new Promise(r=>setTimeout(r,500));
for(const id of [long.body.id,queued.body.id]){const saved=JSON.parse(await fs.readFile(path.join('runs',id,'job.json'),'utf8'));assert.equal(saved.status,'cancelled');}
console.log('PASS: exact version, CSRF, directive injection, addon alternatives, 2x2 enchants across 2 scenarios, removal of existing enchant, partial failure, queued/running cancellation, persisted results.');
