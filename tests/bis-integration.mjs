// A real Best in Slot run against the local server, kept small: two raid bosses, one dungeon, plain crafted gear and a
// short fight at low precision. Run with the server up (node server.mjs); BIS_THREADS sets the CPU threads it may use.
import assert from 'node:assert/strict';
import {referenceProfile} from './reference.mjs';
const base='http://127.0.0.1:8642';
const {token}=await(await fetch(base+'/api/status')).json();
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const body=await r.json();assert.ok(r.ok,JSON.stringify(body));return body;};
const sources=await(await fetch(base+'/api/bis-sources')).json();
assert.ok(sources.tracks.length>=4&&sources.raids.length&&sources.dungeons.length&&sources.depths.quick);
const hero=sources.tracks.find(t=>t.name==='Hero')||sources.tracks.at(-1);
const spec=process.env.BIS_SPEC||'Warrior_Fury';
// BIS_WEAK=1 puts every worn piece at item level 250, so the sources have something to offer.
const weak=line=>{line=line.trimEnd();return process.env.BIS_WEAK&&/^(head|neck|shoulder|back|chest|wrist|hands|waist|legs|feet|finger1|finger2|trinket1|trinket2|main_hand|off_hand)=/.test(line)?line+',ilevel=250':line;};
// BIS_CAPTURE=<character key> uses that character's export from the SimCLab addon instead of a reference profile.
const capture=process.env.BIS_CAPTURE&&(await(await fetch(base+'/api/wow/captures')).json()).characters.find(c=>c.key===process.env.BIS_CAPTURE);
if(process.env.BIS_CAPTURE)assert.ok(capture?.text,'No such captured character.');
const profile=capture?capture.text:(await referenceProfile(spec)).split('\n').filter(l=>!l.startsWith('actions')).map(weak).join('\n');
const bis={depth:'quick',bags:true,
  raid:{enabled:!process.env.BIS_NO_RAID,difficulty:sources.difficulties.at(-1).track,encounters:sources.raids.at(-1).encounters.slice(0,2).map(e=>e.id)},
  mplus:{enabled:true,track:hero.id,level:hero.levels.at(-1).level,dungeons:[sources.dungeons[0].id]},
  crafted:{enabled:true,itemLevel:sources.craftedCap||hero.levels.at(-1).itemLevel,embellishments:[]}};
// BIS_TANK=heroic runs a tank specialization (BIS_SPEC=Death_Knight_Blood) on the weighted damage and survival score.
const tank=process.env.BIS_TANK?{preset:process.env.BIS_TANK,weight:60}:undefined;
const request={profile,mode:'bis',bis,tank,iterations:Number(process.env.BIS_ITERATIONS||300),duration:Number(process.env.BIS_DURATION||60),threads:Number(process.env.BIS_THREADS||4),targetError:0,scenarios:[{style:'Patchwerk',targets:1}]};
const preview=await post('/api/preview',request);
assert.ok(preview.bis.candidates>10,JSON.stringify(preview.bis));
console.log(`${preview.bis.candidates} candidates, ${preview.total} SimC runs planned`);
const job=await post('/api/jobs',request);
let result;for(let i=0;i<3600;i++){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,2000));}
assert.equal(result.status,'complete',JSON.stringify(result.stages)+result.error+result.log);
assert.equal(result.done,result.total,'every planned step is counted exactly once');
const run=result.bis.runs[0];
assert.ok(run.set?.length,JSON.stringify(run));
assert.ok(result.stages.find(s=>s.stage===1&&s.status==='complete'));
if(run.final?.same)console.log('The reference gear is already best in slot from these sources.');
else{
  assert.ok(run.final.current.dps>0&&run.final.dps>0,JSON.stringify(run.final));
  console.log(`PASS: ${run.final.current.dps.toFixed(0)} -> ${run.final.dps.toFixed(0)} DPS (${run.final.gain.toFixed(2)} %), ${run.rounds.length} refinement round(s)`);
  for(const s of run.final.slots)console.log(' ',s.slot,result.bis.candidates.find(c=>c.key===s.key)?.name,s.worth?.toFixed(2));
}
if(run.catalyst){
  console.log(`Tier set ${run.catalyst.set}: ${run.catalyst.pieces} pieces in the set${run.catalyst.required?' (required)':''}`);
  for(const s of run.catalyst.slots)console.log(`  ${s.group.padEnd(9)} tier ${s.tier.name} (${s.tier.origin||'worn'}, ${s.tier.rank.toFixed(2)}) vs ${s.alt.name} (${s.alt.rank.toFixed(2)}) cost ${s.cost.toFixed(2)} ${s.chosen?(s.catalyzed?'IN SET via catalyst':'IN SET'):''}`);
  if(process.env.BIS_REQUIRE_TIER)assert.ok(run.catalyst.pieces>=4||run.notes.some(n=>/Fewer than 4/.test(n)),'the tier set was required');
}
const page=await fetch(`${base}/bis-report/${job.id}.html`);assert.equal(page.status,200);assert.match(await page.text(),/Best in Slot/);
