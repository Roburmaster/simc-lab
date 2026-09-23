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
assert.ok(data.craftedStats.length>=2,'the season has crafted stat pairs');
const weapons={specs,kinds:Object.keys(data.kinds),craftedStats:data.craftedStats.map(s=>s.bonusId),track:track.id,level:top.level,finalists:12};
const request={mode:'weapons',weapons,tank:{preset:'dungeon',weight:50},iterations:200,duration:60,threads:8,targetError:0,scenarios:[{style:'Patchwerk',targets:1}]};
const preview=await post('/api/preview',request);
assert.ok(preview.weapons.candidates>20,JSON.stringify(preview.weapons));
assert.equal(preview.weapons.specs,2);assert.equal(preview.weapons.tanks,1);
assert.equal(preview.weapons.craftedStats,data.craftedStats.length);
assert.equal(preview.total,preview.weapons.steps);
// Each source keeps to the level it can actually give: only the raid reaches the top track.
const src=preview.weapons.sources;
assert.equal(src.equal,false);
assert.ok(src.delves.itemLevel<src.raid.itemLevel,`delves ${src.delves.itemLevel} must stay below raid ${src.raid.itemLevel}`);
assert.ok(src.mplus.itemLevel<src.raid.itemLevel);
assert.equal(preview.weapons.levels.max,src.raid.itemLevel);
const job=await post('/api/jobs',request);
let result;for(let i=0;i<1800;i++){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,1000));}
assert.equal(result.status,'complete',JSON.stringify(result.stages)+result.log);
assert.equal(result.done,result.total);
for(const spec of result.weapons.specs){
  const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
  const rows=result.results.filter(r=>r.spec===spec.key&&!r.superseded&&Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
  // Crafted weapons run in every stat pair but are ranked once, so the list is one row per item, not per candidate.
  const items=new Set(spec.candidates.map(c=>`${c.slot}|${c.itemId}`));
  assert.equal(rows.length,items.size,`${spec.key}: every item is ranked once`);
  const crafted=spec.candidates.filter(c=>c.craftedStat);
  assert.ok(crafted.length>=2,`${spec.key}: crafted weapons are in the pool`);
  assert.ok(rows.some(r=>byKey.get(r.key)?.craftedStat),`${spec.key}: a crafted weapon reached the ranking`);
  assert.ok(result.results.some(r=>r.spec===spec.key&&r.variant),`${spec.key}: the weaker stat pairs are marked as variants`);
  assert.ok(rows.every(r=>'SABCD'.includes(r.tier)),`${spec.key}: every row has a tier`);
  assert.ok(rows.every(r=>spec.candidates.some(c=>c.key===r.key)),`${spec.key}: every row belongs to a candidate`);
  assert.ok(rows.some(r=>!r.screened),`${spec.key}: the final round replaced its screening rows`);
  assert.ok(spec.gear?.itemLevel>0,`${spec.key}: the reference character's item level was read`);
  // Each hand is its own list: it starts at rank 1 with nothing behind it, and runs without a gap.
  const hands=[...new Set(spec.candidates.map(c=>c.slot))];
  for(const slot of hands){
    const hand=rows.filter(r=>byKey.get(r.key)?.slot===slot);
    assert.ok(hand.length,`${spec.key}: ${slot} has a list`);
    assert.equal(hand[0].rank,1,`${spec.key}: ${slot} starts at rank 1`);
    assert.equal(hand[0].behind,0,`${spec.key}: ${slot} is measured from its own best`);
    assert.ok(hand.every((r,i)=>r.rank===i+1),`${spec.key}: ${slot} ranks are a sequence`);
    // Both hands reach the full round; neither is left with screening numbers alone.
    assert.ok(hand.some(r=>!r.screened),`${spec.key}: ${slot} had candidates in the final round`);
  }
  if(spec.tank){
    assert.ok(rows.every(r=>Number.isFinite(r.score)),'a tank spec ranks on the weighted score');
    assert.ok(spec.boss?.measured?.deaths>=0,'the boss was calibrated for this spec');
  }else assert.ok(rows.every(r=>r.dps>0));
}
const stages=result.stages.filter(s=>s.stem);
assert.ok(stages.some(s=>s.stage===1)&&stages.some(s=>s.stage===2),'both screening and a final round ran');
// The tier list page is built from the finished job, for every class and specialization in it.
const page=await fetch(`${base}/tier-list/${job.id}.html`);
assert.equal(page.headers.get('content-type'),'text/html; charset=utf-8');
const html=await page.text();
assert.deepEqual(html.match(/<script[^>]*>/gi),['<script async src="https://wow.zamimg.com/js/tooltips.js">'],'only Wowhead’s tooltip script');
assert.match(html,/Main hand <span>/,'the page lists each hand on its own');
for(const spec of result.weapons.specs){
  assert.ok(html.includes(spec.specName),`the page lists ${spec.label}`);
  const best=result.results.filter(r=>r.spec===spec.key&&r.rank===1)[0];
  const winner=spec.candidates.find(c=>c.key===best.key);
  const escaped=winner.name.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  assert.ok(html.includes(escaped),`the page names ${spec.label}'s best weapon (${winner.name})`);
}
assert.match(html,/wowhead\.com\/item=\d+\?bonus=/);
assert.equal((await fetch(`${base}/tier-list/00000000-0000-0000-0000-000000000000.html`)).status,404);
const input=await(await fetch(`${base}/reports/${job.id}/${stages[0].stem}.simc`)).text();
assert.match(input,/profileset\."w001"=(main_hand|off_hand)=,id=\d+,bonus_id=/);
// A delve weapon is never simulated above the level its own track can reach.
for(const spec of result.weapons.specs)for(const c of spec.candidates.filter(c=>c.sources.some(s=>s.startsWith('Delves'))))
  assert.ok(c.itemLevel<=src.delves.itemLevel,`${c.name} from delves at ${c.itemLevel}, cap ${src.delves.itemLevel}`);
console.log(`PASS: ${preview.weapons.candidates} candidates in ${preview.weapons.craftedStats} crafted stat pairs ranked for ${preview.weapons.specs} specializations at item level ${preview.weapons.levels.min}-${preview.weapons.levels.max}, ${stages.length} profileset runs, tier list page ${html.length} bytes.`);
