import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {referenceProfile} from './reference.mjs';
const base='http://127.0.0.1:8642';
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
const wait=async id=>{let job;for(let i=0;i<900;i++){job=await(await fetch(base+'/api/jobs/'+id)).json();if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setTimeout(r,1000));}throw new Error('Timed out.');};
const source=await referenceProfile('Warrior_Protection');
const profile=source.split('\n').filter(l=>!l.startsWith('actions')).join('\n');
const imported=await post('/api/import',{profile});assert.equal(imported.isTank,true);
const tank={preset:'heroic',weight:60};
const common={profile,tank,iterations:600,duration:300,threads:8,targetError:0,scenarios:[{style:'Patchwerk',targets:1}]};

// Gear Compare: a stamina-free swap must change survival and produce a weighted score.
const compare=await wait((await post('/api/jobs',{...common,mode:'compare',variants:[{name:'No head',text:'head=none'}]})).id);
assert.equal(compare.status,'complete',compare.error||compare.log);
const boss=compare.settings.tank.boss;assert.ok(boss.health>0&&boss.auto>0&&boss.buster>0&&boss.healGap===5,JSON.stringify(boss));
assert.ok(Math.abs(boss.measured.sustained-4)<1&&boss.measured.buster>0&&boss.measured.reached,JSON.stringify(boss.measured));
const [baseline,variant]=[compare.results.find(r=>r.baseline),compare.results.find(r=>!r.baseline)];
assert.ok(baseline.tank&&variant.tank&&Number.isFinite(variant.score)&&Number.isFinite(variant.survival));
assert.ok(variant.survival<0,`Removing the helmet must reduce survival (got ${variant.survival}).`);
const input=await(await fetch(`${base}/reports/${compare.id}/000.simc`)).text();
assert.ok(input.indexOf('enemy=Tank_Boss')<input.indexOf('warrior='),'The boss is defined before the player.');
assert.match(input,/infinite_health=0/);assert.match(input,/to_pct=100,cooldown=5/);

// Upgrade Finder: profilesets carry tank metrics and finalists are ranked by score.
const sources=await(await fetch(base+'/api/upgrade-sources')).json();
const raid=sources.raids.at(-1);
const upgrade=await wait((await post('/api/jobs',{...common,mode:'upgrades',upgrades:{raid:{enabled:true,difficulty:sources.difficulties.at(-1).track,upgrade:0,encounters:raid.encounters.slice(0,2).map(e=>e.id)},slots:['head','chest','legs','finger1','finger2','trinket1','trinket2'],finalists:24}})).id);
assert.equal(upgrade.status,'complete',JSON.stringify(upgrade.stages)+upgrade.error);
const screened=upgrade.results.filter(r=>r.stage===1);assert.ok(screened.length&&screened.every(r=>r.tank&&Number.isFinite(r.score)),JSON.stringify(screened[0]));
assert.ok(screened.every(r=>r.tank.alive>0&&r.tank.alive<=1),'Profilesets report the share of the fight survived.');
const screen=upgrade.stages.find(s=>s.stage===1);assert.ok(screen.baseline.tank);
console.log(`PASS: boss ${Math.round(boss.health)} HP, ${boss.measured.sustained.toFixed(1)}%/s, busters ${boss.measured.buster.toFixed(0)}%; no-head survival ${variant.survival.toFixed(1)}, score ${variant.score.toFixed(1)}; ${screened.length} tank candidates screened, final ${upgrade.stages.find(s=>s.stage===2)?.status}.`);
