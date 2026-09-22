import {itemLink} from '/items.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const signed=(n,digits=2)=>`${n>=0?'+':''}${n.toFixed(digits)}`;

export function weaponUI({api,notice,updateCount}){
  let data=null,countTimer=null;
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="weapon-panel" class="panel" hidden><div class="panel-heading"><h2><span class="step">01</span> Weapon Lab</h2><span id="weapon-season" class="pill">Loading season</span></div><p class="panel-intro">Ranks every weapon, off-hand, shield and held item in the season's loot tables for each specialization. SimulationCraft's own reference character carries them, so no import is needed, and every candidate is pinned to the same item level.</p><div id="weapon-options"><p class="hint">Loading specializations …</p></div></section>`);

  const levelOptions=(trackId,selected)=>(data.tracks.find(t=>t.id===Number(trackId))||data.tracks.at(-1)).levels.map(l=>`<option value="${l.level}" ${l.level===selected?'selected':''}>${l.level}/${l.max} · item level ${l.itemLevel}</option>`).join('');
  function render(){
    const track=data.tracks.at(-1),top=track.levels.at(-1);
    $('#weapon-season').textContent=data.season.name;
    const byClass=new Map();
    for(const spec of data.specs){if(!byClass.has(spec.className))byClass.set(spec.className,[]);byClass.get(spec.className).push(spec);}
    $('#weapon-options').innerHTML=`<div class="weapon-grid">
      <section class="upgrade-card"><strong>Specializations</strong><p class="hint">${data.specs.length} specializations have a reference profile. Healing specializations have none, so they cannot be ranked.</p><div class="upgrade-group-actions"><button class="text-button" data-all="spec">All</button><button class="text-button" data-none="spec">None</button><button class="text-button" data-only="tank">Tanks only</button></div><div class="weapon-specs">${[...byClass].map(([className,specs])=>`<div class="weapon-class"><h4>${esc(className)}</h4>${specs.map(s=>`<label class="check"><input type="checkbox" data-group="spec" value="${esc(s.key)}" data-tank="${s.tank?'1':'0'}" checked>${esc(s.specName)}<small>${esc(s.season)}${s.tank?' · tank':''}</small></label>`).join('')}</div>`).join('')}</div></section>
      <section class="upgrade-card"><strong>Weapon categories</strong><p class="hint">A candidate is only tried where the reference profile already wields the same kind: a two-hander replaces a two-hander, a shield replaces a shield.</p><div class="upgrade-groups">${Object.entries(data.kinds).map(([key,label])=>`<label class="check"><input type="checkbox" data-group="kind" value="${key}" checked>${esc(label)}</label>`).join('')}</div>
        <div class="two-col upgrade-track"><label>Item level<select data-track="weapons">${data.tracks.map(t=>`<option value="${t.id}" ${t.id===track.id?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('')}</select></label><label>Level<select data-level="weapons">${levelOptions(track.id,top.level)}</select></label></div>
        <label>Final round size<select id="weapon-finalists">${data.limits.finalists.map(n=>`<option value="${n}" ${n===24?'selected':''}>${n} candidates per spec</option>`).join('')}</select></label>
        <p class="hint">A specialization with more candidates than this is screened first, and only the best go on to the full simulation. Shorter lists are simulated once at full precision.</p></section>
    </div>
    <div id="weapon-count" class="hint">Counting candidates …</div>
    <p class="result-note">Tier lists compare weapons, not item levels: every candidate is pinned to the chosen upgrade level, and the enchant and any gems of the reference profile carry over. Tank specializations are ranked on the same weighted DPS and survival score as the rest of the app, with a boss calibrated for each of them.</p>`;
  }
  const checked=name=>$$(`[data-group="${name}"]:checked`).map(e=>e.value);
  function settings(){
    if(!data)return {};
    return {specs:checked('spec'),kinds:checked('kind'),track:Number($('[data-track="weapons"]').value),level:Number($('[data-level="weapons"]').value),finalists:Number($('#weapon-finalists').value)};
  }
  async function init(){
    try{
      data=await api('/api/weapon-specs');render();
      $('#weapon-options').addEventListener('change',event=>{
        if(event.target.dataset.track){const level=$('[data-level="weapons"]');level.innerHTML=levelOptions(event.target.value,Number(level.value));}
        updateCount();
      });
      $('#weapon-options').addEventListener('click',event=>{
        const {all,none,only}=event.target.dataset;
        if(!all&&!none&&!only)return;
        event.preventDefault();
        if(only)$$('[data-group="spec"]').forEach(el=>el.checked=el.dataset.tank==='1');
        else $$(`[data-group="${all||none}"]`).forEach(el=>el.checked=!!all);
        updateCount();
      });
    }catch(e){$('#weapon-options').textContent=e.message;notice(e.message);}
  }
  // Candidate counts come from the server so the numbers match what will run.
  function count(request){
    clearTimeout(countTimer);if(!data)return;
    $('#weapon-count').textContent='Counting candidates …';
    countTimer=setTimeout(async()=>{
      try{
        const preview=await api('/api/preview',request());const w=preview.weapons;
        $('#weapon-count').innerHTML=`<strong>${w.candidates} candidates</strong> across ${w.specs} specialization${w.specs===1?'':'s'} at item level ${w.level.itemLevel} · ${w.steps} SimC runs${w.tanks?` · ${w.tanks} tank boss calibration${w.tanks===1?'':'s'}`:''}${w.skipped.length?`<br><small>Left out: ${esc(w.skipped.map(s=>s.label).join(', '))} — no item in the selected categories fits what the reference profile wields.</small>`:''}`;
      }catch(e){$('#weapon-count').textContent=e.message;}
    },350);
  }

  const tierClass=tier=>`tier tier-${tier}`;
  function table(rows,candidates,tanky){
    return `<table class="result-table weapon-table"><thead><tr><th>#</th><th>Item</th><th>${tanky?'Score':'DPS'}</th><th>Behind best</th><th>Tier</th></tr></thead><tbody>${rows.map(row=>{
      const c=candidates.get(row.key);if(!c)return '';
      return `<tr class="${row.rank===1?'winner':''}"><td class="weapon-rank">${row.rank}</td><td>${itemLink(c.itemId,c.name,c.value)}<small>${esc(data.kinds[c.kind]||c.kind)} · ${esc(c.sources.join(' · '))}${row.screened?' · screening only':''}</small></td><td>${tanky?`${signed(row.score)}<small>DPS ${signed(row.dpsGain)} % · survival ${signed(row.survival)} %</small>`:`${number(row.dps)}<small>${row.error95!==null?`± ${number(row.error95)}`:''}</small>`}</td><td>${row.rank===1?'—':`${tanky?`−${row.behind.toFixed(2)}`:`−${row.behind.toFixed(2)} %`}${row.tied?'<small>within uncertainty</small>':''}`}</td><td><span class="${tierClass(row.tier)}">${row.tier}</span></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function results(job){
    if(!job.weapons)return '';
    const specs=job.weapons.specs;
    let html=`<div class="search-summary"><strong>Weapon Lab · ${specs.length} specialization${specs.length===1?'':'s'} · ${esc(job.weapons.level.label)} · item level ${job.weapons.level.itemLevel}</strong><p class="hint">${esc(job.weapons.season?.name||'')} loot tables · categories: ${esc(job.weapons.kinds.map(k=>({main:'Main hand',offhand:'Off-hand weapon',shield:'Shield',held:'Held in off hand'})[k]||k).join(', '))}. Screening uses up to ${number(job.weapons.screen.iterations)} iterations at ${job.weapons.screen.targetError}% target error; the final round uses ${number(job.settings.iterations)} iterations at ${job.settings.targetError}%.</p></div>`;
    if(job.weapons.skipped?.length)html+=`<p class="hint">Left out: ${esc(job.weapons.skipped.map(s=>s.label).join(', '))}.</p>`;
    for(const stage of (job.stages||[]).filter(st=>st.status==='failed'&&st.stage===0))html+=`<p class="notice">${esc(specs.find(s=>s.key===stage.spec)?.label||stage.spec)}: tank boss calibration failed — ${esc(stage.error)}</p>`;
    for(let s=0;s<job.scenarios.length;s++){
      const scenario=job.scenarios[s];
      const done=specs.map(spec=>{
        const candidates=new Map(spec.candidates.map(c=>[c.key,c]));
        const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===s&&!r.superseded&&Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
        return {spec,candidates,rows,tanky:spec.tank&&rows.some(r=>Number.isFinite(r.score))};
      }).filter(x=>x.rows.length);
      if(!done.length)continue;
      html+=`<section class="result-scenario"><h3>${esc(scenario.style)} <span class="muted">/ ${scenario.targets} targets / ${job.settings.duration} sec</span></h3>`;
      html+=`<h4 class="upgrade-heading">Best weapon per specialization</h4><div class="upgrade-source-list">${done.map(({spec,candidates,rows})=>{
        const best=rows[0],c=candidates.get(best.key),runnerUp=rows.find(r=>r.rank===2);
        return `<div class="upgrade-source"><span><small>${esc(spec.className)}</small><strong>${esc(spec.specName)}</strong></span><span>${itemLink(c.itemId,c.name,c.value)}<small>${esc(data?.kinds?.[c.kind]||c.kind)} · ${esc(c.sources[0]||'')}</small></span><b>${runnerUp?`+${runnerUp.behind.toFixed(2)}${runnerUp.tied?'?':''}`:'—'}</b></div>`;
      }).join('')}</div><p class="hint">The number is how far the second-best weapon falls behind; “?” means that gap is inside the statistical uncertainty.</p>`;
      for(const {spec,candidates,rows,tanky} of done){
        const stages=(job.stages||[]).filter(st=>st.spec===spec.key&&st.scenario===s);
        html+=`<details class="log-details weapon-spec" open><summary>${esc(spec.label)} <span class="pill">${rows.length} weapons</span></summary>`;
        const base=stages.find(st=>st.stage===2&&st.baseline)?.baseline||stages.find(st=>st.baseline)?.baseline;
        if(base)html+=`<p class="hint">Reference profile ${esc(spec.file.replace(/\.simc$/,''))} with its own weapon: ${number(base.dps)} DPS.</p>`;
        if(spec.boss?.measured)html+=`<p class="hint">Tank boss calibrated to ${number(spec.boss.health)} health: ${spec.boss.measured.sustained.toFixed(1)}% health per second, tank-busters of ${spec.boss.measured.buster.toFixed(0)}%, and the reference gear died in ${spec.boss.measured.deaths.toFixed(0)}% of calibration fights.${spec.boss.measured.reached?'':' The death target was not reached, so survival differences may be muted.'}</p>`;
        for(const st of stages)if(st.status==='failed')html+=`<p class="notice">${st.stage===1?'Screening':'Final round'} failed: ${esc(st.error)}</p>`;
        html+=table(rows,candidates,tanky);
        html+=`<p class="result-note">${stages.filter(st=>st.stem).map(st=>`${st.stage===1?'Screening':'Final round'} (${st.count}): <a href="/reports/${job.id}/${st.stem}.html" download>HTML</a> <a href="/reports/${job.id}/${st.stem}.json" download>JSON</a> <a href="/reports/${job.id}/${st.stem}.simc" download>Input</a>`).join(' · ')}</p></details>`;
      }
      html+='</section>';
    }
    html+='<p class="result-note">A tier is the distance behind the best weapon of the same specialization: S under 0.5, A under 1.5, B under 3, C under 5, then D — in percent of DPS, or in score points for tanks. Weapons inside the combined 95% uncertainty of the best one are marked; raise the precision before acting on small differences.</p>';
    return html;
  }
  return {init,settings,count,results};
}
