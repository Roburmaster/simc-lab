import {itemLink} from '/items.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
// One colour per item level, dark to bright: the bright end of a bar is the highest level simulated.
const levelColors=['#3b4a63','#4f6b8f','#5f8fb8','#7fb6d6','#a6dcc1','#f3d27a','#f3b754','#ff9d4a'];

export function trinketUI({api,notice,updateCount}){
  let data=null,countTimer=null;
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="trinket-panel" class="panel" hidden><div class="panel-heading"><h2><span class="step">01</span> Trinket Lab</h2><span id="trinket-season" class="pill">Loading season</span></div><p class="panel-intro">Ranks every trinket in the season's loot tables for each specialization, the way Bloodmallet charts them: SimulationCraft's own reference character wears one trinket at a time with the other slot empty, at every item level its source can reach, and the bar is what it adds over wearing none.</p><div id="trinket-options"><p class="hint">Loading specializations …</p></div></section>`);

  const levelOptions=(trackId,selected)=>(data.tracks.find(t=>t.id===Number(trackId))||data.tracks.at(-1)).levels.map(l=>`<option value="${l.level}" ${l.level===selected?'selected':''}>${l.level}/${l.max} · item level ${l.itemLevel}</option>`).join('');
  function render(){
    const hero=data.tracks.find(t=>t.name==='Hero')||data.tracks.at(-2)||data.tracks.at(-1);
    $('#trinket-season').textContent=data.season.name;
    const byClass=new Map();
    for(const spec of data.specs){if(!byClass.has(spec.className))byClass.set(spec.className,[]);byClass.get(spec.className).push(spec);}
    $('#trinket-options').innerHTML=`<div class="weapon-grid">
      <section class="upgrade-card"><strong>Specializations</strong><p class="hint">${data.specs.length} specializations have a reference profile. Healers are left out: SimulationCraft cannot simulate healing, and a trinket is mostly its effect, which no stat score can value${data.healers.length?` (${esc(data.healers.join(', '))})`:''}.${data.specs.some(s=>s.stale)?` <b>${data.specs.filter(s=>s.stale).map(s=>esc(s.label)).join(', ')}</b> still carry the previous season's gear.`:''}${data.specs.some(s=>s.ours)?` SimC Lab carries its own profile for <b>${data.specs.filter(s=>s.ours).map(s=>esc(s.label)).join(', ')}</b>, until SimulationCraft ships one.`:''}</p><div class="upgrade-group-actions"><button class="text-button" data-all="tspec">All</button><button class="text-button" data-none="tspec">None</button><button class="text-button" data-only="tank">Tanks only</button></div><div class="weapon-specs">${[...byClass].map(([className,specs])=>`<div class="weapon-class"><h4>${esc(className)}</h4>${specs.map(s=>`<label class="check${s.stale?' stale':''}${s.ours?' ours':''}"><input type="checkbox" data-group="tspec" value="${esc(s.key)}" data-tank="${s.tank?'1':'0'}" checked>${esc(s.specName)}<small>${s.ours?'ours':esc(s.season)}${s.stale?' · old gear':''}${s.tank?' · tank':''}</small></label>`).join('')}</div>`).join('')}</div></section>
      <section class="upgrade-card"><strong>Item levels on the chart</strong><p class="hint">Each bar is split at these levels, the top of each upgrade track. A trinket is shown at every one below the level its source can give, and then at that level, so a delve trinket stops where delve loot stops.</p><div class="upgrade-groups">${data.steps.map(s=>`<label class="check"><input type="checkbox" data-group="tstep" value="${s.track}" ${data.defaultSteps.includes(s.track)?'checked':''}>${esc(s.label)} · ${s.itemLevel}</label>`).join('')}</div>
        <label>Final round size<select id="trinket-finalists">${data.limits.finalists.map(n=>`<option value="${n}" ${n===data.limits.finalists.at(-1)?'selected':''}>${n} trinkets per spec</option>`).join('')}</select></label>
        <p class="hint">A specialization with more trinkets than this is screened first, one run per trinket at its top level; only the best go on to be simulated at every level. The rest keep their screened number and no curve.</p></section>
      <section class="upgrade-card"><strong>Item level per source</strong><p class="hint">How far each source can take a trinket. Only the raid reaches the Myth track, and its last bosses drop above it. Crafted trinkets sit at their own cap${data.craftedCap?` — item level ${data.craftedCap} this season`:''}.</p>
        <div class="two-col upgrade-track"><label>Raid difficulty<select data-tsource-track="raid">${data.difficulties.map(d=>`<option value="${d.track}" ${d.track===data.difficulties.at(-1).track?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><label>Crafted item level<select id="trinket-crafted-ilevel">${craftedOptions()}</select></label></div>
        ${['mplus','delves'].map(kind=>`<div class="two-col upgrade-track"><label>${kind==='mplus'?'Mythic+':'Delves'} track<select data-tsource-track="${kind}">${data.tracks.map(t=>`<option value="${t.id}" ${t.id===hero.id?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('')}</select></label><label>Level<select data-tsource-level="${kind}">${levelOptions(hero.id,hero.levels.at(-1).level)}</select></label></div>`).join('')}
        <label class="check"><input type="checkbox" id="trinket-vault" checked>Mythic+ trinkets from the Great Vault</label>
        <div class="two-col upgrade-track" id="trinket-vault-level"><label>Vault track<select data-tsource-track="vault">${data.tracks.map(t=>`<option value="${t.id}" ${t.id===data.tracks.at(-1).id?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('')}</select></label><label>Level<select data-tsource-level="vault">${levelOptions(data.tracks.at(-1).id,data.tracks.at(-1).levels.at(-1).level)}</select></label></div>
        <p class="hint">The vault gives Mythic+ loot on the Myth track, above what the dungeon's own chest can. With it on, a dungeon trinket runs up to the vault's level, and the chest's level stays one of its steps.</p>
        <label class="check"><input type="checkbox" id="trinket-equal">Show every trinket at every level instead</label>
        <p class="hint">Equal footing answers what a trinket is worth rather than what you can reach with it, so it shows trinkets at levels their source cannot give.</p></section>
    </div>
    <div id="trinket-count" class="hint">Counting trinkets …</div>
    <p class="result-note">The reference character keeps its gear, gems and enchants and loses both trinkets; one trinket goes in the first slot. Tank specializations are ranked on the same weighted DPS and survival score as the rest of the app, with a boss calibrated for each of them.</p>`;
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
        updateCount();
      });
      $('#trinket-options').addEventListener('click',event=>{
        const {all,none,only}=event.target.dataset;
        if(!all&&!none&&!only)return;
        event.preventDefault();
        if(only)$$('[data-group="tspec"]').forEach(el=>el.checked=el.dataset[only]==='1');
        else $$(`[data-group="${all||none}"]`).forEach(el=>el.checked=!!all);
        updateCount();
      });
    }catch(e){$('#trinket-options').textContent=e.message;notice(e.message);}
  }
  function count(request){
    clearTimeout(countTimer);if(!data)return;
    $('#trinket-count').textContent='Counting trinkets …';
    countTimer=setTimeout(async()=>{
      try{
        const t=(await api('/api/preview',request())).trinkets;
        $('#trinket-count').innerHTML=`<strong>${t.trinkets} trinkets</strong> across ${t.specs} specialization${t.specs===1?'':'s'} · ${number(t.candidates)} trinket and item level pairs at item level ${t.levels.min===t.levels.max?t.levels.max:`${t.levels.min}–${t.levels.max}`} · ${t.steps} SimC run${t.steps===1?'':'s'}${t.screened?` · ${t.screened} screened first`:''}${t.tanks?` · ${t.tanks} tank boss calibration${t.tanks===1?'':'s'}`:''}${t.skipped.length?`<br><small>Left out: ${esc(t.skipped.map(s=>s.label).join(', '))}.</small>`:''}`;
      }catch(e){$('#trinket-count').textContent=e.message;}
    },350);
  }

  // The same split bar as the tier list page: each segment is what the next item level adds.
  function series(job,spec,s){
    const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
    const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===s&&!r.superseded&&r.status==='complete');
    return rows.filter(r=>Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank).map(row=>{
      const c=byKey.get(row.key);
      const levels=rows.filter(r=>byKey.get(r.key)?.itemId===c.itemId&&Number.isFinite(r.gain)&&r.stage===row.stage).map(r=>({itemLevel:byKey.get(r.key).itemLevel,gain:r.gain,percent:r.percent})).sort((a,b)=>a.itemLevel-b.itemLevel);
      return {row,c,levels};
    });
  }
  function bar(levels,most,palette,tanky){
    let before=0;
    return `<span class="trinket-bar">${levels.map(l=>{
      const width=Math.max(0,Math.min(l.gain,most)-Math.max(before,0)),left=Math.max(before,0);before=Math.max(before,l.gain);
      return width>0?`<i style="left:${(100*left/most).toFixed(2)}%;width:${(100*width/most).toFixed(2)}%;background:${palette.get(l.itemLevel)}" title="${l.itemLevel}: +${tanky?l.gain.toFixed(2)+' score':`${number(l.gain)} DPS (+${l.percent.toFixed(2)} %)`}"></i>`:'';
    }).join('')}</span>`;
  }
  function results(job){
    if(!job.trinkets)return '';
    const lab=job.trinkets,specs=lab.specs,src=lab.sources||{};
    const levels=[...new Set(specs.flatMap(s=>s.candidates.map(c=>c.itemLevel)))].sort((a,b)=>a-b);
    const palette=new Map(levels.map((level,i)=>[level,levelColors[Math.round(i*(levelColors.length-1)/Math.max(1,levels.length-1))]]));
    let html=`<div class="search-summary"><strong>Trinket Lab · ${specs.length} specialization${specs.length===1?'':'s'} · item level ${lab.levels.min===lab.levels.max?lab.levels.max:`${lab.levels.min}–${lab.levels.max}`}</strong><p class="hint">${src.equal?`Equal footing: every trinket at ${esc((src.steps||[]).join(', '))}, including levels its source cannot give.`:`Each trinket up to the level its source can give: ${esc([src.raid&&`raid ${src.raid.label}`,src.mplus&&`Mythic+ ${src.mplus.label}`,src.delves&&`delves ${src.delves.label}`,src.vault&&`Mythic+ through the Great Vault ${src.vault.label.replace(/^Great Vault · /,'')}`,src.crafted&&`crafted ${src.crafted.label}`].filter(Boolean).join(' · '))}.`} One trinket worn, the other slot empty; the gain is over no trinket at all.<br>Screening uses up to ${number(lab.screen.iterations)} iterations at ${lab.screen.targetError}% target error; the final round uses ${number(job.settings.iterations)} iterations at ${job.settings.targetError}%.</p><p class="legend-line">${levels.map(l=>`<span><i style="background:${palette.get(l)}"></i>${l}</span>`).join('')}</p></div>`;
    if(lab.skipped?.length)html+=`<p class="hint">Left out: ${esc(lab.skipped.map(s=>s.label).join(', '))}.</p>`;
    if(job.results.some(r=>Number.isFinite(r.rank)))html+=`<p class="tier-page-links"><a class="button small secondary" href="/trinket-tier-list/${job.id}.html" target="_blank" rel="noopener">Open the tier list page ↗</a><a class="button small secondary" href="/trinket-tier-list/${job.id}.html?download" download>Download it</a><span class="hint">One page with every class and specialization and its chart, ready to read or send on.</span></p>`;
    for(const stage of (job.stages||[]).filter(st=>st.status==='failed'&&st.stage===0))html+=`<p class="notice">${esc(specs.find(s=>s.key===stage.spec)?.label||stage.spec)}: tank boss calibration failed — ${esc(stage.error)}</p>`;
    for(let s=0;s<job.scenarios.length;s++){
      const scenario=job.scenarios[s];
      const done=specs.map(spec=>({spec,list:series(job,spec,s)})).filter(x=>x.list.length);
      if(!done.length)continue;
      html+=`<section class="result-scenario"><h3>${esc(scenario.style)} <span class="muted">/ ${scenario.targets} targets / ${job.settings.duration} sec</span></h3>`;
      html+=`<h4 class="upgrade-heading">Best trinket per specialization</h4><div class="upgrade-source-list">${done.map(({spec,list})=>{
        const best=list[0],second=list[1];
        return `<div class="upgrade-source"><span><small>${esc(spec.className)}</small><strong>${esc(spec.specName)}</strong></span><span>${itemLink(best.c.itemId,best.c.name,best.c.value)}<small>${esc(best.c.sources[0]||'')} · ${best.c.itemLevel}</small></span><b>${second?`+${(second.row.behindFirst??second.row.behind).toFixed(2)}${second.row.tied?'?':''}`:'—'}</b></div>`;
      }).join('')}</div><p class="hint">The number is how far the second-best trinket falls behind; “?” means that gap is inside the statistical uncertainty.</p>`;
      for(const {spec,list} of done){
        const tanky=list.some(x=>Number.isFinite(x.row.score));
        const stages=(job.stages||[]).filter(st=>st.spec===spec.key&&st.scenario===s);
        const base=stages.find(st=>st.stage===2&&st.baseline)?.baseline;
        const idle=stages.find(st=>st.idle&&st.status==='complete');
        const most=Math.max(...list.flatMap(x=>x.levels.map(l=>l.gain)),0)||1;
        html+=`<details class="log-details weapon-spec" open><summary>${esc(spec.label)} <span class="pill">${list.length} trinkets</span></summary>`;
        if(base)html+=`<p class="hint">Reference profile ${esc(spec.file.replace(/\.simc$/,''))} without its trinkets: ${number(base.dps)} ${spec.support?'raid ':''}DPS${spec.gear?` · gear at item level ${spec.gear.itemLevel} on average`:''}.</p>`;
        if(spec.support)html+=`<p class="hint">${esc(spec.specName)} is ranked on the whole raid's damage${idle?`; the gains are percent of the ${number(idle.share)} DPS it adds to that raid`:''}.</p>`;
        if(spec.stale)html+=`<p class="notice">${esc(spec.season)} profile: ranked on last season's character. The order holds; do not read the numbers next to the others.</p>`;
        for(const st of stages)if(st.status==='failed')html+=`<p class="notice">${st.stage===1?'Screening':st.idle?'Measuring its share of the raid':'Final round'} failed: ${esc(st.error)}</p>`;
        html+=`<table class="result-table weapon-table trinket-table"><thead><tr><th>#</th><th>Trinket</th><th>Gain by item level</th><th>At its top level</th><th>Behind best</th><th>Tier</th></tr></thead><tbody>${list.map(({row,c,levels:ls})=>{
          const top=ls.at(-1)||row;
          return `<tr class="${row.rank===1?'winner':''}"><td class="weapon-rank">${row.rank}</td><td>${itemLink(c.itemId,c.name,c.value)}<small>${esc(c.sources.join(' · '))} · item level ${c.itemLevel}${c.levelLabel?` (${esc(c.levelLabel)})`:''}${c.onUse?' · on use':''}${row.screened?' · screening only':''}${c.set?`<br>◆ ${esc(c.set.name)} ${c.set.pieces}-set with ${esc(c.set.with.join(', '))}`:''}</small></td><td>${bar(ls.length?ls:[{itemLevel:c.itemLevel,gain:row.gain,percent:row.percent}],most,palette,tanky)}</td><td>${Number.isFinite(top.gain)?(tanky?`+${top.gain.toFixed(2)}<small>score</small>`:`+${top.percent.toFixed(2)} %<small>+${number(top.gain)} DPS</small>`):'—'}</td><td>${row.behind<=0?'—':`−${row.behind.toFixed(2)}${tanky?'':' %'}${row.tied?'<small>within uncertainty</small>':''}`}</td><td><span class="tier tier-${row.tier}">${row.tier}</span></td></tr>`;
        }).join('')}</tbody></table>`;
        html+=`<p class="result-note">${stages.filter(st=>st.stem).map(st=>`${st.stage===1?'Screening':st.idle?'Raid without its buffs':'Final round'}${st.idle?'':` (${st.count})`}: <a href="/reports/${job.id}/${st.stem}.html" download>HTML</a> <a href="/reports/${job.id}/${st.stem}.json" download>JSON</a> <a href="/reports/${job.id}/${st.stem}.simc" download>Input</a>`).join(' · ')}</p></details>`;
      }
      html+='</section>';
    }
    html+=`<p class="result-note">A tier is the distance behind the best trinket of the same specialization at each one's top level: S under 0.5, A under 1.5, B under 3, C under 5, then D — in percent of DPS, or in score points for tanks. A trinket marked ◆ completes an item set with the reference gear: its lead is that set's bonus. Two trinkets together are not the sum of their bars; sim the pair on your own character before you decide.</p>`;
    return html;
  }
  return {init,settings,count,results};
}
