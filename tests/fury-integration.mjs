import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {referenceProfile} from './reference.mjs';
const base='http://127.0.0.1:8642';
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
const search=async spec=>await(await fetch(base+`/api/gear?slot=off_hand&class=warrior&spec=${spec}&level=90&q=Venom-Cursed%20Claymore`)).json();
const items=await search('fury');assert.ok(items.length);assert.equal((await search('arms')).length,0);assert.equal((await search('protection')).length,0);
const source=await referenceProfile('Warrior_Fury');
const profile=source.split('\n').filter(l=>!l.startsWith('actions')).join('\n')+`\n### Gear from Bags\n# Test two-handed weapon\n# main_hand=,id=${items[0].id}\n`;
const imported=await post('/api/import',{profile});const off=imported.alternatives.find(v=>v.slot==='off_hand'&&v.name==='Test two-handed weapon');assert.ok(off);
const job=await post('/api/jobs',{profile,mode:'compare',variants:[{name:'Two-handed off-hand',text:off.text}],iterations:100,duration:20,threads:2,targetError:0});
let result;for(let i=0;i<90;i++){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,500));}
assert.equal(result.status,'complete',result.log);assert.equal(result.results.length,2);assert.ok(result.results.every(r=>r.dps>0));
console.log('PASS: Fury off-hand search, Arms/Protection exclusion, imported two-hand mirroring and two successful real SimC runs.');
