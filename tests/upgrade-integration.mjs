import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {referenceProfile} from './reference.mjs';
const base='http://127.0.0.1:8642';
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
const sources=await(await fetch(base+'/api/upgrade-sources')).json();
assert.ok(sources.tracks.length>=4&&sources.raids.length&&sources.dungeons.length);
const hero=sources.tracks.find(t=>t.name==='Hero')||sources.tracks.at(-1);
const raid=sources.raids.at(-1),encounters=raid.encounters.slice(0,3).map(e=>e.id);
const source=await referenceProfile('Warrior_Fury');
const profile=source.split('\n').filter(l=>!l.startsWith('actions')).join('\n');
const upgrades={raid:{enabled:true,difficulty:sources.difficulties.at(-1).track,upgrade:0,encounters},mplus:{enabled:false},crafted:{enabled:true,itemLevel:hero.levels.at(-1).itemLevel,stats:sources.craftedStats[0].bonusId},finalists:24};
const request={profile,mode:'upgrades',upgrades,iterations:300,duration:60,threads:8,targetError:0,scenarios:[{style:'Patchwerk',targets:1}]};
const preview=await post('/api/preview',request);
assert.equal(preview.total,2);assert.ok(preview.upgrade.candidates>10,JSON.stringify(preview));
const oldDungeon=sources.dungeons.find(d=>d.name==="Kings' Rest");
if(oldDungeon){const p=await post('/api/preview',{...request,upgrades:{mplus:{enabled:true,track:hero.id,level:1,dungeons:[oldDungeon.id]}}});assert.ok(p.upgrade.candidates>0,'Reissued dungeon loot must be offered through the season pool.');}
const job=await post('/api/jobs',request);
let result;for(let i=0;i<600;i++){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,1000));}
assert.equal(result.status,'complete',JSON.stringify(result.stages)+result.log);
const screen=result.stages.find(s=>s.stage===1);assert.equal(screen.status,'complete');assert.equal(result.results.filter(r=>r.stage===1).length,preview.upgrade.candidates);
const final=result.stages.find(s=>s.stage===2);assert.ok(final);
if(final.status==='complete')assert.ok(result.results.filter(r=>r.stage===2).every(r=>r.dps>0));
const input=await(await fetch(`${base}/reports/${job.id}/000.simc`)).text();assert.match(input,/profileset\."c001"=/);
console.log(`PASS: ${preview.upgrade.candidates} candidates screened, final round ${final.status} (${final.count}), reissued dungeon pool ${oldDungeon?'checked':'absent'}.`);
