import {itemLink} from '/items.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
// One colour per item level, dark to bright: the bright end of a bar is the highest level simulated.
const levelColors=['#3b4a63','#4f6b8f','#5f8fb8','#7fb6d6','#a6dcc1','#f3d27a','#f3b754','#ff9d4a'];

export function trinketUI({api,notice,updateCount,run,cancel}){
  let data=null,countTimer=null;
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="trinket-panel" class="panel" hidden><div class="panel-heading"><h2><span class="step">01</span> Trinket Lab</h2><span id="trinket-season" class="pill">Loading season</span></div><p class="panel-intro">Finds the best two trinkets for each specialization. SimulationCraft's own reference character wears two of the season's trinkets at once, each at the item level its source can really give it, and the pairs are ranked on what they add together. Each trinket is also measured alone, with the other slot empty: that isolated value shows how it scales with item level and decides which trinkets are paired.</p><div id="trinket-options"><p class="hint">Loading specializations …</p></div></section>`);

  const levelOptions=(trackId,selected)=>(data.tracks.find(t=>t.id===Number(trackId))||data.tracks.at(-1)).levels.map(l=>`<option value="${l.level}" ${l.level===selected?'selected':''}>${l.level}/${l.max} · item level ${l.itemLevel}</option>`).join('');
  function render(){
    const hero=data.tracks.find(t=>t.name==='Hero')||data.tracks.at(-2)||data.tracks.at(-1);
    $('#trinket-season').textContent=data.season.name;
    const byClass=new Map();
    for(const spec of data.specs){if(!byClass.has(spec.className))byClass.set(spec.className,[]);byClass.get(spec.className).push(spec);}
    $('#trinket-options').innerHTML=`<div class="weapon-grid">
      <section class="upgrade-card"><strong>Specializations</strong><p class="hint">${data.specs.length} specializations have a reference profile. Healers are left out: SimulationCraft cannot simulate healing, and a trinket is mostly its effect, which no stat score can value${data.healers.length?` (${esc(data.healers.join(', '))})`:''}.${data.specs.some(s=>s.stale)?` <b>${data.specs.filter(s=>s.stale).map(s=>esc(s.label)).join(', ')}</b> still carry the previous season's gear.`:''}${data.specs.some(s=>s.ours)?` SimC Lab carries its own profile for <b>${data.specs.filter(s=>s.ours).map(s=>esc(s.label)).join(', ')}</b>, until SimulationCraft ships one.`:''}</p><div class="upgrade-group-actions"><button class="text-button" data-all="tspec">All</button><button class="text-button" data-none="tspec">None</button><button class="text-button" data-only="tank">Tanks only</button></div><div class="weapon-specs">${[...byClass].map(([className,specs])=>`<div class="weapon-class"><h4>${esc(className)}</h4>${specs.map(s=>`<label class="check${s.stale?' stale':''}${s.ours?' ours':''}"><input type="checkbox" data-group="tspec" value="${esc(s.key)}" data-tank="${s.tank?'1':'0'}" checked>${esc(s.specName)}<small>${s.ours?'ours':esc(s.season)}${s.stale?' · old gear':''}${s.tank?' · tank':''}</small></label>`).join('')}</div>`).join('')}</div></section>
      <section class="upgrade-card"><strong>Scenarios</strong><p class="hint">A trinket can be the best in a raid and ordinary in a dungeon, so each scenario is ranked on its own. Tick at least one.</p><div class="upgrade-groups">${data.scenarios.map(p=>`<label class="check"><input type="checkbox" data-group="tscn" value="${esc(p.id)}" ${p.id==='raid_st'?'checked':''}>${esc(p.label)}<small>${esc(p.style)} · ${p.targets} target${p.targets===1?'':'s'}${p.duration?` · ${p.duration} sec`:''}${p.bloodlust===false?' · no Bloodlust or potion':''}</small></label>`).join('')}</div><p class="hint">Mythic+ pulls run for their own length. Casting Patchwerk is for checking effects that react to enemy casts, and for comparing with other sites that use it.</p></section>
      <section class="upgrade-card"><strong>What to rank</strong><p class="hint">The tier list measures each trinket alone beside a stat stick, a versatility-only trinket in the other slot, as Bloodmallet does: every trinket has the same stats around it, so every number compares with every other, at every item level. Best pairs then wears two real trinkets together: the best from the tier list, those close behind, and the best on-use trinkets, since every pair of every trinket is far too many runs.</p>
        <label>What to rank<select id="trinket-model"><option value="pairs" selected>Stat stick tier list and best pairs</option><option value="statstick">Stat stick tier list only</option></select></label>
        <div class="two-col"><label>Pair pool<select id="trinket-pool">${data.limits.pool.map(n=>`<option value="${n}" ${n===16?'selected':''}>${n?`best ${n} trinkets`:'every trinket'}</option>`).join('')}</select></label>
        <label>Final pair round<select id="trinket-pair-finalists">${data.limits.pairFinalists.map(n=>`<option value="${n}" ${n===20?'selected':''}>${n?`best ${n} pairs`:'every pair'}</option>`).join('')}</select></label></div>
        <p class="hint">Every legal pair in the pool is screened at 5,000 iterations and 0.3% target error; the best go on at your precision, and pairs still tied with the best run once more at 0.05%. The same trinket is never paired with itself, and equip limits count the rest of the gear.</p></section>
      <section class="upgrade-card"><strong>Item levels on the chart</strong><p class="hint">Each bar is split at these levels, the top of each upgrade track. A trinket is shown at every one below the level its source can give, and then at that level, so a delve trinket stops where delve loot stops.</p><div class="upgrade-groups">${data.steps.map(s=>`<label class="check"><input type="checkbox" data-group="tstep" value="${s.track}" ${data.defaultSteps.includes(s.track)?'checked':''}>${esc(s.label)} · ${s.itemLevel}</label>`).join('')}</div>
        <label>Final round size<select id="trinket-finalists">${data.limits.finalists.map(n=>`<option value="${n}" ${n===data.limits.finalists.at(-1)?'selected':''}>${n} trinkets per spec</option>`).join('')}</select></label>
        <p class="hint">A specialization with more trinkets than this is screened first, one run per trinket at its top level; only the best go on to be simulated at every level. The rest keep their screened number and no curve.</p></section>
      <section class="upgrade-card"><strong>Item level per source</strong><p class="hint">How far each source can take a trinket. Only the raid reaches the Myth track, and its last bosses drop above it. Crafted trinkets sit at their own cap${data.craftedCap?` — item level ${data.craftedCap} this season`:''}.</p>
        <div class="two-col upgrade-track"><label>Raid difficulty<select data-tsource-track="raid">${data.difficulties.map(d=>`<option value="${d.track}" ${d.track===data.difficulties.at(-1).track?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><label>Crafted item level<select id="trinket-crafted-ilevel">${craftedOptions()}</select></label></div>
        ${['mplus','delves'].map(kind=>`<div class="two-col upgrade-track"><label>${kind==='mplus'?'Mythic+':'Delves'} track<select data-tsource-track="${kind}">${data.tracks.map(t=>`<option value="${t.id}" ${t.id===hero.id?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('')}</select></label><label>Level<select data-tsource-level="${kind}">${levelOptions(hero.id,hero.levels.at(-1).level)}</select></label></div>`).join('')}
        <label class="check"><input type="checkbox" id="trinket-vault" checked>Mythic+ trinkets from the Great Vault</label>
        <div class="two-col upgrade-track" id="trinket-vault-level"><label>Vault track<select data-tsource-track="vault">${data.tracks.map(t=>`<option value="${t.id}" ${t.id===data.tracks.at(-1).id?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('')}</select></label><label>Level<select data-tsource-level="vault">${levelOptions(data.tracks.at(-1).id,data.tracks.at(-1).levels.at(-1).level)}</select></label></div>
        <p class="hint">The vault gives Mythic+ loot on the Myth track, above what the dungeon's own chest can. With it on, a dungeon trinket runs up to the vault's level, and the chest's level stays one of its steps.</p>
        <label class="check"><input type="checkbox" id="trinket-equal">Equal item level: every trinket at every level instead</label>
        <p class="hint">Realistic (the default) shows each trinket at the level its source can give. Equal item level answers what a trinket is worth rather than what you can reach with it, so it shows trinkets at levels their source cannot give.</p></section>
    </div>
    <details class="upgrade-card" id="trinket-debug"><summary><strong>Debug · Bloodmallet parity</strong></summary><p class="hint">For finding out why a result differs from Bloodmallet, not for choosing trinkets. It runs Bloodmallet's own experiment: a versatility stat stick in the second slot, each trinket as item ID and item level only, Casting Patchwerk, 60,000 iterations at 0.1%, SimC's default raid and a forced potion. Tanks are ranked on damage alone. Parity is only claimed when this engine is the same SimC commit Bloodmallet used.</p>
      <label class="check"><input type="checkbox" id="trinket-parity">Run as a Bloodmallet parity check</label>
      <label>Bloodmallet's SimC commit<input id="trinket-compare-sha" type="text" placeholder="e.g. a69b069" spellcheck="false" autocomplete="off"></label>
      <p class="hint">This engine: SimC ${esc(data.engine?.version||'')} · commit <code>${esc((data.engine?.commit||'').slice(0,10))}</code>.</p></details>
    <section class="upgrade-card trinket-run"><strong>Run</strong>
      <div class="three-col"><label>Precision<select id="trinket-iterations"><option value="1000">1 000 · quick test</option><option value="10000" selected>10 000 · standard</option><option value="50000">50 000 · high</option><option value="100000">100 000 · very high</option></select></label>
        <label>Target error<select id="trinket-target-error"><option value="0">None · all iterations</option><option value="0.1" selected>0.10%</option><option value="0.05">0.05%</option><option value="0.02">0.02%</option></select></label>
        <label>Raid fight length (sec)<input id="trinket-duration" type="number" min="10" max="1200" value="300"></label>
        <label>CPU threads<input id="trinket-threads" type="number" min="1" max="${data.engine?.maxThreads||16}" value="${data.engine?.maxThreads||4}"></label></div>
      <div class="two-col"><label>Tank boss<select id="trinket-tank-preset">${Object.entries(data.tankPresets||{}).map(([key,p])=>`<option value="${esc(key)}" ${key==='mythic'?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label>Tank ranking weight<input id="trinket-tank-weight" type="range" min="0" max="100" step="5" value="50"><span class="hint" id="trinket-tank-weight-label">50% survival · 50% DPS</span></label></div>
      <p class="hint">Mythic+ pulls keep their own length. Tank specializations fight a boss calibrated to their reference character; their damage and survival are shown apart, and the weight only orders them. Raid buffs are SimC Lab's defaults.</p>
      <div id="trinket-count" class="hint">Counting trinkets …</div>
      <div class="run-actions"><button class="button primary" id="trinket-run">Run Trinket Lab <span>→</span></button><button class="button danger" id="trinket-cancel" hidden>Cancel job</button></div></section>
    <p class="result-note">The reference character keeps its gear, gems and enchants and loses both trinkets. Tank specializations show damage and survival apart, and are ordered on the same weighted score as the rest of the app, with a boss calibrated for each of them.</p>`;
  }
  // Crafted trinkets have no upgrade track: the choice is an item level, every one the season's tracks use up to the
  // crafting cap, and the cap itself, which is the level SimulationCraft's own season profiles craft to.
  function craftedOptions(){
    const cap=data.craftedCap||data.tracks.at(-2)?.levels.at(-1).itemLevel;
    const levels=[...new Set([...data.tracks.flatMap(t=>t.levels.map(l=>l.itemLevel)).filter(l=>l<cap),cap])].sort((a,b)=>b-a);
    return levels.map(l=>`<option value="${l}" ${l===cap?'selected':''}>${l}${l===cap?' · crafting cap':''}</option>`).join('');
  }
  const checked=name=>$$(`[data-group="${name}"]:checked`).map(e=>e.value);
  function settings(){
    if(!data)return {};
    return {specs:checked('tspec'),steps:checked('tstep').map(Number),finalists:Number($('#trinket-finalists').value),equal:$('#trinket-equal').checked,
      model:$('#trinket-model').value,scenarioSet:checked('tscn'),parity:$('#trinket-parity').checked,compareSha:$('#trinket-compare-sha').value.trim(),pool:Number($('#trinket-pool').value),pairFinalists:Number($('#trinket-pair-finalists').value),
      sources:{raid:{track:Number($('[data-tsource-track="raid"]').value)},
        mplus:{track:Number($('[data-tsource-track="mplus"]').value),level:Number($('[data-tsource-level="mplus"]').value)},
        delves:{track:Number($('[data-tsource-track="delves"]').value),level:Number($('[data-tsource-level="delves"]').value)},
        crafted:{itemLevel:Number($('#trinket-crafted-ilevel').value)}},
      vault:$('#trinket-vault').checked?{track:Number($('[data-tsource-track="vault"]').value),level:Number($('[data-tsource-level="vault"]').value)}:false};
  }
  async function init(){
    try{
      data=await api('/api/trinket-specs');render();
      $('#trinket-options').addEventListener('change',event=>{
        const kind=event.target.dataset.tsourceTrack;
        if(kind&&kind!=='raid'){const level=$(`[data-tsource-level="${kind}"]`);level.innerHTML=levelOptions(event.target.value,Number(level.value));}
        if(event.target.id==='trinket-vault')$('#trinket-vault-level').hidden=!event.target.checked;
        if(event.target.id==='trinket-tank-weight'){const w=Number(event.target.value);$('#trinket-tank-weight-label').textContent=`${w}% survival · ${100-w}% DPS`;}
        if(event.target.id==='trinket-model')$('#trinket-pool,#trinket-pair-finalists').forEach(el=>el.disabled=event.target.value!=='pairs');
        updateCount();
      });
      $('#trinket-options').addEventListener('input',event=>{
        if(event.target.id==='trinket-tank-weight'){const w=Number(event.target.value);$('#trinket-tank-weight-label').textContent=`${w}% survival · ${100-w}% DPS`;}
      });
      $('#trinket-options').addEventListener('click',event=>{
        if(event.target.closest('#trinket-run')){event.preventDefault();if(!checked('tscn').length&&!$('#trinket-parity').checked){notice('Choose at least one scenario.');return;}run();return;}
        if(event.target.closest('#trinket-cancel')){event.preventDefault();cancel();return;}
        const {all,none,only}=event.target.dataset;
        if(!all&&!none&&!only)return;
        event.preventDefault();
        if(only)$$('[data-group="tspec"]').forEach(el=>el.checked=el.dataset[only]==='1');
        else $$(`[data-group="${all||none}"]`).forEach(el=>el.checked=!!all);
        updateCount();
      });
    }catch(e){$('#trinket-options').textContent=e.message;notice(e.message);}
  }
  // The whole job request: Trinket Lab takes nothing from the rest of the app's settings.
  function request(){
    const t=settings();
    return {mode:'trinkets',trinkets:t,tank:{preset:$('#trinket-tank-preset')?.value||'mythic',weight:Number($('#trinket-tank-weight')?.value??50)},
      iterations:Number($('#trinket-iterations')?.value||10000),targetError:Number($('#trinket-target-error')?.value??0.1),duration:Number($('#trinket-duration')?.value||300),threads:Number($('#trinket-threads')?.value||1),
      scenarios:[{style:'Patchwerk',targets:1}]};
  }
  function running(on){const r=$('#trinket-run'),c=$('#trinket-cancel');if(r)r.disabled=on;if(c)c.hidden=!on;}
  function count(request){
    clearTimeout(countTimer);if(!data)return;
    $('#trinket-count').textContent='Counting trinkets …';
    countTimer=setTimeout(async()=>{
      try{
        const t=(await api('/api/preview',request())).trinkets;
        $('#trinket-count').innerHTML=`<strong>${t.trinkets} trinkets</strong> across ${t.specs} specialization${t.specs===1?'':'s'} · ${number(t.candidates)} trinket and item level pairs at item level ${t.levels.min===t.levels.max?t.levels.max:`${t.levels.min}–${t.levels.max}`} · ${t.steps} SimC run${t.steps===1?'':'s'}${t.screened?` · ${t.screened} screened first`:''}${t.tanks?` · ${t.tanks} tank boss calibration${t.tanks===1?'':'s'}`:''}${t.estimate?`<br>About ${number(t.estimate.profilesets)} simulated characters${t.estimate.pairs?`, ${number(t.estimate.pairs)} of them pairs (${t.estimate.specs.map(x=>`${x.pool} trinkets → ${x.pairs}`).filter((v,i,a)=>a.indexOf(v)===i).join(', ')} per scenario)`:''}; tied pairs may add a resolution run.`:''}${t.skipped.length?`<br><small>Left out: ${esc(t.skipped.map(s=>s.label).join(', '))}.</small>`:''}`;
      }catch(e){$('#trinket-count').textContent=e.message;}
    },350);
  }

  // The same split bar as the tier list page: each segment is what the next item level adds.
  function series(job,spec,s){
    const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
    const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===s&&!r.superseded&&!r.pair&&r.status==='complete');
    return rows.filter(r=>Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank).map(row=>{
      const c=byKey.get(row.key);
      const levels=rows.filter(r=>(byKey.get(r.key)?.group||byKey.get(r.key)?.itemId)===(c.group||c.itemId)&&Number.isFinite(r.gain)&&r.stage===row.stage).map(r=>({itemLevel:byKey.get(r.key).itemLevel,gain:r.gain,percent:r.percent})).sort((a,b)=>a.itemLevel-b.itemLevel);
      return {row,c,levels};
    });
  }
  // Ranked pairs of one spec and scenario, best first, each with its two trinkets.
  function pairSeries(job,spec,s){
    const entry=spec.pairs?.[s];if(!entry)return [];
    const byKey=new Map(spec.candidates.map(c=>[c.key,c])),pairs=new Map(entry.pairs.map(p=>[p.key,p]));
    return job.results.filter(r=>r.spec===spec.key&&r.scenario===s&&r.pair&&!r.superseded&&r.status==='complete'&&Number.isFinite(r.rank))
      .sort((a,b)=>a.rank-b.rank).map(row=>({row,parts:(pairs.get(row.key)?.keys||[]).map(k=>byKey.get(k)).filter(Boolean)})).filter(x=>x.parts.length===2);
  }
  const signed=n=>Number.isFinite(n)?`${n>=0?'+':'−'}${Math.abs(n).toFixed(2)}`:'—';
  function pairTable(job,spec,s,shown=15){
    const list=pairSeries(job,spec,s);
    if(!list.length)return '';
    const tanky=list.some(x=>Number.isFinite(x.row.score));
    const entry=spec.pairs[s],byKey=new Map(spec.candidates.map(c=>[c.key,c]));
    const name=c=>itemLink(c.itemId,c.name,c.value);
    let html=`<h4 class="upgrade-heading">Best trinket pairs</h4><div class="table-scroll"><table class="result-table weapon-table pair-table"><thead><tr><th>#</th><th>Pair</th>${tanky?'<th>DPS</th><th>Survival</th><th>Score</th>':`<th>${spec.support?'Raid DPS':'DPS'}</th><th>Over no trinket</th>`}<th>Behind best</th></tr></thead><tbody>${list.slice(0,shown).map(({row,parts})=>`<tr class="${row.rank===1?'winner':''}"><td class="weapon-rank">${row.rank}</td><td>${parts.map(name).join(' + ')}<small>${parts.map(c=>`${c.itemLevel}${c.onUse?' on use':''}`).join(' + ')}${parts.filter(c=>c.freed).map(c=>` · ${esc(c.name)} replaces the ${esc(c.freed.embellishment)} on ${esc(c.freed.item)}`).join('')}${row.screened?' · screening only':''}${row.stage===8?' · resolved at high precision':''}</small></td>${tanky
        ?`<td>${signed(row.dpsGain)} %</td><td>${signed(row.survival)} %</td><td>${signed(row.score)}<small>±${(row.scoreError||0).toFixed(2)}</small></td>`
        :`<td>${number(row.dps)}<small>±${number(row.error95||0)}</small></td><td>+${row.percent.toFixed(2)} %<small>+${number(row.gain)} DPS</small></td>`}<td>${row.behind<=0?'—':`−${row.behind.toFixed(2)}${tanky?'':' %'}${row.tied?'<small>statistically tied</small>':''}`}</td></tr>`).join('')}</tbody></table></div>`;
    if(list.length>shown)html+=`<p class="hint">${list.length-shown} more pairs ranked; the tier list page and the JSON carry them all.</p>`;
    const partners=(entry.partners||[]).map(p=>({...p,c:byKey.get(p.key),partner:byKey.get(p.partner)})).filter(p=>p.c&&p.partner).sort((a,b)=>a.rank-b.rank);
    if(partners.length)html+=`<h4 class="upgrade-heading">Best partner per trinket</h4><div class="table-scroll"><table class="result-table weapon-table pair-table"><thead><tr><th>Trinket</th><th>Best partner</th><th>Pair rank</th></tr></thead><tbody>${partners.map(p=>`<tr><td>${name(p.c)}<small>${p.c.itemLevel}</small></td><td>${name(p.partner)}<small>${p.partner.itemLevel}</small></td><td>${p.rank}${p.tied?'<small>tied with the best</small>':''}</td></tr>`).join('')}</tbody></table></div>`;
    html+=`<p class="hint">Pair pool: ${entry.pool.length} trinkets, ${new Set(entry.pairs.map(p=>p.pairKey)).size} pairs.</p>`;
    return html;
  }
  function bar(levels,most,palette,tanky){
    let before=0;
    return `<span class="trinket-bar">${levels.map(l=>{
      const width=Math.max(0,Math.min(l.gain,most)-Math.max(before,0)),left=Math.max(before,0);before=Math.max(before,l.gain);
      return width>0?`<i style="left:${(100*left/most).toFixed(2)}%;width:${(100*width/most).toFixed(2)}%;background:${palette.get(l.itemLevel)}" title="${l.itemLevel}: +${tanky?l.gain.toFixed(2)+' score':`${number(l.gain)} DPS (+${l.percent.toFixed(2)} %)`}"></i>`:'';
    }).join('')}</span>`;
  }
  const stageName=st=>({1:'Screening',2:'Final round',6:'Pair screening',7:'Pair final',8:'Tied pairs resolved'}[st.stage]||(st.idle?'Raid without its buffs':'Round'));
  function results(job){
    if(!job.trinkets)return '';
    const lab=job.trinkets,specs=lab.specs,src=lab.sources||{};
    const levels=[...new Set(specs.flatMap(s=>s.candidates.map(c=>c.itemLevel)))].sort((a,b)=>a-b);
    const palette=new Map(levels.map((level,i)=>[level,levelColors[Math.round(i*(levelColors.length-1)/Math.max(1,levels.length-1))]]));
    let html=`<div class="search-summary"><strong><span class="pill">${lab.parity?'Bloodmallet parity · debug':src.equal?'Equal item level':'Realistic · source-aware'}</span> Trinket Lab · ${specs.length} specialization${specs.length===1?'':'s'} · item level ${lab.levels.min===lab.levels.max?lab.levels.max:`${lab.levels.min}–${lab.levels.max}`}</strong><p class="hint">${src.equal?`Equal footing: every trinket at ${esc((src.steps||[]).join(', '))}, including levels its source cannot give.`:`Each trinket up to the level its source can give: ${esc([src.raid&&`raid ${src.raid.label}`,src.mplus&&`Mythic+ ${src.mplus.label}`,src.delves&&`delves ${src.delves.label}`,src.vault&&`Mythic+ through the Great Vault ${src.vault.label.replace(/^Great Vault · /,'')}`,src.crafted&&`crafted ${src.crafted.label}`].filter(Boolean).join(' · '))}.`} ${specs[0]?.statStick||lab.parity?`Tier list: one trinket beside a stat stick, a versatility-only trinket at item level ${specs[0]?.statStick?.itemLevel??specs[0]?.parity?.itemLevel??''} in the other slot, measured against the same character wearing only the stat stick.`:'One trinket worn, the other slot empty, measured against the same character wearing no trinket.'}${lab.model==='pairs'?' Best pairs: two real trinkets worn together, measured against the character wearing none.':''}<br>Screening uses up to ${number(lab.screen.iterations)} iterations at ${lab.screen.targetError}% target error; the final round uses ${number(job.settings.iterations)} iterations at ${job.settings.targetError}%.${lab.pairScreen&&lab.model==='pairs'?` Pair screening ${number(lab.pairScreen.iterations)} at ${lab.pairScreen.targetError}%, resolution up to ${number(lab.resolve.iterations)} at ${lab.resolve.targetError}%.`:''}${lab.repro?`<br><small>SimC ${esc(lab.repro.simcVersion||'')} · commit ${esc((lab.repro.simcSha||'').slice(0,10))} (${esc(lab.repro.simcBranch||'')}) · WoW ${esc(lab.repro.wowBuild||'')} · length variation ${Math.round(100*lab.repro.variation)}%</small>`:''}</p><p class="legend-line">${levels.map(l=>`<span><i style="background:${palette.get(l)}"></i>${l}</span>`).join('')}</p></div>`;
    if(lab.parity){const p=lab.repro?.parity;html+=`<p class="${p?.shaMatches?'hint':'notice'}">Bloodmallet parity: ${p?.shaMatches?`same SimC commit as given (${esc((p.compareSha||'').slice(0,10))}), so a difference is in the input, not the engine.`:p?.compareSha?`this engine is not the SimC commit given (${esc(p.compareSha.slice(0,10))}); differences may come from SimC itself.`:'no Bloodmallet commit was given, so parity is not claimed.'} Second slot: ${esc(specs[0]?.parity?.trinket2||'')} (stat stick), potion ${esc(specs[0]?.parity?.potion||'')}.</p>`;}
    if(lab.skipped?.length)html+=`<p class="hint">Left out: ${esc(lab.skipped.map(s=>s.label).join(', '))}.</p>`;
    if(job.results.some(r=>Number.isFinite(r.rank)))html+=`<p class="tier-page-links"><a class="button small secondary" href="/trinket-tier-list/${job.id}.html" target="_blank" rel="noopener">Open the tier list page ↗</a><a class="button small secondary" href="/trinket-tier-list/${job.id}.html?download" download>Download it</a><a class="button small secondary" href="/trinket-lab/${job.id}.json" download>Website data</a><span class="hint">One page with every class and specialization and its chart, ready to read or send on.</span></p>`;
    for(const stage of (job.stages||[]).filter(st=>st.status==='failed'&&st.stage===0))html+=`<p class="notice">${esc(specs.find(s=>s.key===stage.spec)?.label||stage.spec)}: tank boss calibration failed — ${esc(stage.error)}</p>`;
    for(let s=0;s<job.scenarios.length;s++){
      const scenario=job.scenarios[s];
      const done=specs.map(spec=>({spec,list:series(job,spec,s)})).filter(x=>x.list.length);
      if(!done.length)continue;
      html+=`<section class="result-scenario"><h3>${esc(scenario.label||scenario.style)} <span class="muted">/ ${scenario.label?`${esc(scenario.style)} / `:''}${scenario.targets} target${scenario.targets===1?'':'s'} / ${scenario.duration||job.settings.duration} sec</span></h3>`;
      const paired=done.map(({spec})=>({spec,pairs:pairSeries(job,spec,s)})).filter(x=>x.pairs.length);
      if(paired.length)html+=`<h4 class="upgrade-heading">Best pair per specialization</h4><div class="upgrade-source-list">${paired.map(({spec,pairs})=>{
        const [best,second]=pairs;
        return `<div class="upgrade-source"><span><small>${esc(spec.className)}</small><strong>${esc(spec.specName)}</strong></span><span>${best.parts.map(c=>itemLink(c.itemId,c.name,c.value)).join(' + ')}<small>${best.parts.map(c=>c.itemLevel).join(' + ')}</small></span><b>${second?`+${(second.row.behindFirst??second.row.behind).toFixed(2)}${second.row.tied?'?':''}`:'—'}</b></div>`;
      }).join('')}</div><p class="hint">The number is how far the second-best pair falls behind; “?” means that gap is inside the statistical uncertainty.</p>`;
      html+=`<h4 class="upgrade-heading">${paired.length?'Best single trinket per specialization · isolated':'Best trinket per specialization'}</h4><div class="upgrade-source-list">${done.map(({spec,list})=>{
        // The best the character can wear: a trinket over an equip limit beside the reference gear is not an answer.
        const wear=list.filter(x=>!x.c.overLimit),best=wear[0]||list[0],second=wear[1];
        return `<div class="upgrade-source"><span><small>${esc(spec.className)}</small><strong>${esc(spec.specName)}</strong></span><span>${itemLink(best.c.itemId,best.c.name,best.c.value)}<small>${esc(best.c.sources[0]||'')} · ${best.c.itemLevel}</small></span><b>${second?`+${(second.row.behindFirst??second.row.behind).toFixed(2)}${second.row.tied?'?':''}`:'—'}</b></div>`;
      }).join('')}</div><p class="hint">The number is how far the second-best trinket falls behind; “?” means that gap is inside the statistical uncertainty.</p>`;
      for(const {spec,list} of done){
        const tanky=list.some(x=>Number.isFinite(x.row.score));
        const stages=(job.stages||[]).filter(st=>st.spec===spec.key&&st.scenario===s);
        const base=stages.find(st=>st.stage===2&&st.baseline)?.baseline;
        const idle=stages.find(st=>st.idle&&st.status==='complete');
        const most=Math.max(...list.flatMap(x=>x.levels.map(l=>l.gain)),0)||1;
        html+=`<details class="log-details weapon-spec" open><summary>${esc(spec.label)} <span class="pill">${list.length} trinkets</span></summary>`;
        html+=pairTable(job,spec,s);
        if(spec.pairs?.[s])html+=`<h4 class="upgrade-heading">Tier list · ${spec.statStick?'each trinket beside a stat stick':'one trinket, the other slot empty'}</h4>`;
        if(base)html+=`<p class="hint">Reference profile ${esc(spec.file.replace(/\.simc$/,''))}${spec.profile?` (${esc(spec.profile.source)}, ${esc(spec.profile.profileType)} talents, hash ${esc(spec.profile.hash)})`:''} without its trinkets: ${number(base.dps)} ${spec.support?'raid ':''}DPS${spec.gear?` · gear at item level ${spec.gear.itemLevel} on average`:''}.</p>`;
        if(spec.support)html+=`<p class="hint">${esc(spec.specName)} is ranked on the whole raid's damage${idle?`; the gains are percent of the ${number(idle.share)} DPS it adds to that raid`:''}.</p>`;
        if(spec.stale)html+=`<p class="notice">${esc(spec.season)} profile: ranked on last season's character. The order holds; do not read the numbers next to the others.</p>`;
        for(const st of stages)if(st.status==='failed')html+=`<p class="notice">${stageName(st)} failed: ${esc(st.error)}</p>`;
        html+=`<table class="result-table weapon-table trinket-table"><thead><tr><th>#</th><th>Trinket</th><th>Gain by item level</th><th>At its top level</th><th>Behind best</th><th>Tier</th></tr></thead><tbody>${list.map(({row,c,levels:ls})=>{
          const top=ls.at(-1)||row;
          return `<tr class="${row.rank===1?'winner':''}"><td class="weapon-rank">${row.rank}</td><td>${itemLink(c.itemId,c.name,c.value)}<small>${esc(c.sources.join(' · '))} · item level ${c.itemLevel}${c.levelLabel?` (${esc(c.levelLabel)})`:''}${c.onUse?' · on use':''}${c.freed?` · worn in place of the ${esc(c.freed.embellishment)} on ${esc(c.freed.item)}, as two embellishments is the limit`:''}${c.overLimit?` · over the ${esc(c.overLimit.join(', '))} limit, and no embellishment in this gear can be taken off for it`:''}${row.screened?' · screening only':''}${c.set?`<br>◆ with the ${esc(c.set.name)} ${c.set.pieces}-set bonus (with ${esc(c.set.with.join(', '))})`:''}${c.setOff?`<br>◇ without the ${esc(c.setOff.name)} set bonus`:''}</small></td><td>${bar(ls.length?ls:[{itemLevel:c.itemLevel,gain:row.gain,percent:row.percent}],most,palette,tanky)}</td><td>${Number.isFinite(top.gain)?(tanky?`+${top.gain.toFixed(2)}<small>score · DPS ${signed(row.dpsGain)} % · survival ${signed(row.survival)} %</small>`:`+${top.percent.toFixed(2)} %<small>+${number(top.gain)} DPS</small>`):'—'}</td><td>${row.behind<=0?'—':`−${row.behind.toFixed(2)}${tanky?'':' %'}${row.tied?'<small>within uncertainty</small>':''}`}</td><td><span class="tier tier-${row.tier}">${row.tier}</span></td></tr>`;
        }).join('')}</tbody></table>`;
        html+=`<p class="result-note">${stages.filter(st=>st.stem).map(st=>`${stageName(st)}${st.idle?'':` (${st.count})`}: <a href="/reports/${job.id}/${st.stem}.html" download>HTML</a> <a href="/reports/${job.id}/${st.stem}.json" download>JSON</a> <a href="/reports/${job.id}/${st.stem}.simc" download>Input</a>`).join(' · ')}</p></details>`;
      }
      html+='</section>';
    }
    html+=`<p class="result-note">A tier is the distance behind the best trinket of the same specialization at each one's top level: S under 0.5, A under 1.5, B under 3, C under 5, then D — in percent of DPS, or in score points for tanks. A trinket marked ◆ completes an item set with the reference gear: its lead is that set's bonus. Two trinkets together are not the sum of their bars, which is why pairs are simulated worn together. The reference character is not you: sim the pair on your own character before you decide.</p>`;
    return html;
  }
  return {init,settings,request,running,count,results};
}
