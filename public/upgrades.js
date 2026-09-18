import {itemLink,gearGroups,slotNames} from '/items.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const originNames={raid:'Raid',mplus:'Mythic+',delves:'Delves',vault:'Great Vault',crafted:'Crafted'};

export function upgradeUI({api,notice,updateCount}){
  let data=null,countTimer=null;
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="upgrade-panel" class="panel" hidden><div class="panel-heading"><h2><span class="step">02</span> Upgrade Finder</h2><span id="upgrade-season" class="pill">Loading season</span></div><p class="panel-intro">Choose where you can get gear and at which upgrade level. Every usable item for your specialization is simulated in its slot, and the most promising ones are simulated again at full precision.</p><div id="upgrade-sources"><p class="hint">Loading loot tables …</p></div></section>`);
  const trackOptions=selected=>data.tracks.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('');
  const levelOptions=(trackId,selected)=>(data.tracks.find(t=>t.id===Number(trackId))||data.tracks[0]).levels.map(l=>`<option value="${l.level}" ${l.level===selected?'selected':''}>${l.level}/${l.max} · item level ${l.itemLevel}</option>`).join('');
  const trackPicker=(name,trackId,level)=>`<div class="two-col upgrade-track"><label>Upgrade track<select data-track="${name}">${trackOptions(trackId)}</select></label><label>Level<select data-level="${name}">${levelOptions(trackId,level)}</select></label></div>`;
  const upgradeOptions=(trackId,selected=0)=>{const t=data.tracks.find(x=>x.id===Number(trackId));return `<option value="0">As dropped</option>${t.levels.map(l=>`<option value="${l.level}" ${l.level===selected?'selected':''}>Upgraded to ${l.level}/${l.max} · item level ${l.itemLevel}</option>`).join('')}`;};
  const dropNote=trackId=>{const t=data.tracks.find(x=>x.id===Number(trackId));return `Boss n drops at ${t.name} n/${t.levels.length} (${t.levels.slice(0,3).map(l=>l.itemLevel).join(', ')}), trash at the first level. ${t.finalDrop?`The last bosses drop at item level ${t.finalDrop.itemLevel}.`:`The last bosses use ${t.name} 4/${t.levels.length} (${t.levels[3]?.itemLevel}); the data has no separate final-boss level for this difficulty.`}`;};
  const groupChecks=(name,list)=>`<div class="upgrade-groups">${list.map(g=>`<label class="check"><input type="checkbox" data-group="${name}" value="${g.id}" checked>${esc(g.name)}</label>`).join('')}</div>`;
  function render(){
    const hero=(data.tracks.find(t=>t.name==='Hero')||data.tracks.at(-1)).id,myth=data.tracks.at(-1).id;
    const heroTop=data.tracks.find(t=>t.id===hero).levels.at(-1).itemLevel;
    $('#upgrade-season').textContent=data.season.name;
    $('#upgrade-sources').innerHTML=`<div class="upgrade-grid">
      <section class="upgrade-card"><label class="check upgrade-toggle"><input type="checkbox" data-source="raid" checked><strong>Raid</strong></label><p class="hint">${esc(data.raids.map(r=>r.name).join(' · '))}. Tier tokens become your class's set piece.</p><div class="two-col upgrade-track"><label>Difficulty<select data-difficulty="raid">${data.difficulties.map(d=>`<option value="${d.track}" ${d.track===data.difficulties.at(-1).track?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><label>Upgrades<select data-upgrade="raid">${upgradeOptions(data.difficulties.at(-1).track)}</select></label></div><p class="hint" id="raid-drop-note">${esc(dropNote(data.difficulties.at(-1).track))}</p><details><summary>Bosses</summary><div class="upgrade-group-actions"><button class="text-button" data-all="raid">All</button><button class="text-button" data-none="raid">None</button></div>${data.raids.map(r=>`<h4>${esc(r.name)}</h4>${groupChecks('raid',r.encounters)}`).join('')}</details></section>
      <section class="upgrade-card"><label class="check upgrade-toggle"><input type="checkbox" data-source="mplus" checked><strong>Mythic+</strong></label><p class="hint">${data.dungeons.length} dungeons in the current rotation, including reissued older dungeons.</p>${trackPicker('mplus',hero,1)}<details><summary>Dungeons</summary><div class="upgrade-group-actions"><button class="text-button" data-all="mplus">All</button><button class="text-button" data-none="mplus">None</button></div>${groupChecks('mplus',data.dungeons)}</details></section>
      <section class="upgrade-card"><label class="check upgrade-toggle"><input type="checkbox" data-source="vault"><strong>Great Vault</strong></label><p class="hint">Any boss or dungeon item from the full season loot tables, one track per vault row.</p>${[['raid','Raid row'],['mplus','Dungeon row'],['delves','World row']].filter(([row])=>row!=='delves'||data.delves).map(([row,label])=>`<div class="vault-row"><label class="check"><input type="checkbox" data-vault-row="${row}" checked>${label}</label>${trackPicker('vault-'+row,myth,1)}</div>`).join('')}</section>
      ${data.delves?`<section class="upgrade-card"><label class="check upgrade-toggle"><input type="checkbox" data-source="delves"><strong>Delves</strong></label><p class="hint">${esc(data.delves.name)} loot table.</p>${trackPicker('delves',hero,1)}</section>`:''}
      ${data.crafted?`<section class="upgrade-card"><label class="check upgrade-toggle"><input type="checkbox" data-source="crafted"><strong>Crafted</strong></label><p class="hint">Epic profession gear. Embellishments are not included. Some pieces require the matching profession to equip.</p><div class="two-col"><label>Item level<input id="crafted-ilevel" type="number" min="1" max="1000" value="${heroTop}"></label><label>Secondary stats<select id="crafted-stats">${data.craftedStats.map(s=>`<option value="${s.bonusId}">${esc(s.name)}</option>`).join('')}</select></label></div></section>`:''}
    </div>
    <details class="log-details upgrade-slots"><summary>Slots to search</summary><div class="upgrade-group-actions"><button class="text-button" data-all="slot">All</button><button class="text-button" data-none="slot">None</button></div><div class="upgrade-groups">${gearGroups.flatMap(([,slots])=>slots).map(s=>`<label class="check"><input type="checkbox" data-group="slot" value="${s}" checked>${esc(slotNames[s])}</label>`).join('')}</div></details>
    <div class="two-col upgrade-options"><label>Final round size<select id="upgrade-finalists">${data.limits.finalists.map(n=>`<option value="${n}" ${n===48?'selected':''}>${n} candidates</option>`).join('')}</select></label><div id="upgrade-count" class="hint">Import a character to count candidates.</div></div>
    <p class="result-note">Screening runs every candidate with at most 2,000 iterations and a 0.5% target error. Candidates that could beat your gear within that uncertainty go to the final round with your simulation settings. Weapons are compared like for like with what you wield. Your enchant carries over, and existing gems carry over into sockets the new item already has. Vault sockets and embellishments are not added.</p>`;
  }
  const checked=name=>$$(`[data-group="${name}"]:checked`).map(e=>Number(e.value)||e.value);
  const pick=name=>({track:Number($(`[data-track="${name}"]`).value),level:Number($(`[data-level="${name}"]`).value)});
  const on=name=>!!$(`[data-source="${name}"]`)?.checked;
  function settings(){
    if(!data)return {};
    const result={slots:checked('slot'),finalists:Number($('#upgrade-finalists').value)};
    result.raid={enabled:on('raid'),difficulty:Number($('[data-difficulty="raid"]').value),upgrade:Number($('[data-upgrade="raid"]').value),encounters:checked('raid')};
    result.mplus={enabled:on('mplus'),...pick('mplus'),dungeons:checked('mplus')};
    result.vault={enabled:on('vault')};for(const row of ['raid','mplus','delves'])if($(`[data-vault-row="${row}"]`))result.vault[row]={enabled:$(`[data-vault-row="${row}"]`).checked,...pick('vault-'+row)};
    if(data.delves)result.delves={enabled:on('delves'),...pick('delves')};
    if(data.crafted)result.crafted={enabled:on('crafted'),itemLevel:Number($('#crafted-ilevel').value),stats:Number($('#crafted-stats').value)};
    return result;
  }
  function changed(event){
    if(event.target.dataset.difficulty){const up=$('[data-upgrade="raid"]');up.innerHTML=upgradeOptions(event.target.value,Number(up.value));$('#raid-drop-note').textContent=dropNote(event.target.value);}
    const track=event.target.dataset.track;
    if(track){const level=$(`[data-level="${track}"]`);const previous=Number(level.value);level.innerHTML=levelOptions(event.target.value,previous);}
    updateCount();
  }
  async function init(){
    try{data=await api('/api/upgrade-sources');render();
      $('#upgrade-sources').addEventListener('change',changed);$('#upgrade-sources').addEventListener('input',e=>{if(e.target.id==='crafted-ilevel')updateCount();});
      $('#upgrade-sources').addEventListener('click',e=>{const all=e.target.dataset.all,none=e.target.dataset.none;if(!all&&!none)return;e.preventDefault();$$(`[data-group="${all||none}"]`).forEach(el=>el.checked=!!all);updateCount();});
    }catch(e){$('#upgrade-sources').textContent=e.message;notice(e.message);}
  }
  // Candidate counts come from the server so the numbers match what will run.
  function count(request,hasProfile){
    clearTimeout(countTimer);if(!data)return;
    if(!hasProfile){$('#upgrade-count').textContent='Import a character to count candidates.';return;}
    $('#upgrade-count').textContent='Counting candidates …';
    countTimer=setTimeout(async()=>{try{const preview=await api('/api/preview',request());$('#upgrade-count').innerHTML=`<strong>${preview.upgrade.candidates} candidates</strong> across ${preview.upgrade.slots} slots · ${preview.total} SimC runs`;}catch(e){$('#upgrade-count').textContent=e.message;}},350);
  }
  function results(job){
    if(!job.upgrade)return '';
    const candidates=new Map(job.upgrade.candidates.map(c=>[c.key,c]));const screen=job.upgrade.screen;
    let html=`<div class="search-summary"><strong>Upgrade Finder · ${job.upgrade.candidates.length} candidates · ${esc(job.upgrade.season?.name)}</strong><p class="hint">Screening: up to ${number(screen.iterations)} iterations, ${screen.targetError}% target error. Final round: up to ${job.upgrade.finalists} candidates with ${number(job.settings.iterations)} iterations and ${job.settings.targetError}% target error.</p></div>`;
    for(let s=0;s<job.scenarios.length;s++){
      const stages=(job.stages||[]).filter(r=>r.scenario===s);if(!stages.length)continue;
      const baselines={};for(const st of stages)if(st.baseline)baselines[st.stage]=st.baseline;
      const best=new Map();
      for(const row of job.results.filter(r=>r.scenario===s&&r.status==='complete')){
        const c=candidates.get(row.key),base=baselines[row.stage];if(!c||!base)continue;
        const delta=row.dps-base.dps,error=row.error95!==null&&base.error95!==null?Math.hypot(row.error95,base.error95):null;
        // Tanks rank by the weighted score; everyone else by DPS change.
        const percent=100*delta/Math.max(1,base.dps),tanky=Number.isFinite(row.score);
        const entry={...row,c,delta,percent,rank:tanky?row.score:percent,tanky,uncertain:tanky?Math.abs(row.score)<=(row.scoreError||0):error!==null&&Math.abs(delta)<=error};
        // Rings and trinkets are tried in both slots: keep one placement per item, preferring the final round.
        const id=c.slot.replace(/[12]$/,'')+'|'+c.value;const previous=best.get(id);
        if(!previous||row.stage>previous.stage||row.stage===previous.stage&&entry.rank>previous.rank)best.set(id,entry);
      }
      const rows=[...best.values()].sort((a,b)=>b.stage-a.stage||b.rank-a.rank);
      const upgrades=rows.filter(r=>r.stage===2&&r.rank>0).sort((a,b)=>b.rank-a.rank);
      const scenario=job.scenarios[s];
      html+=`<section class="result-scenario"><h3>${esc(scenario.style)} <span class="muted">/ ${scenario.targets} targets / ${job.settings.duration} sec</span></h3>`;
      const base=baselines[2]||baselines[1];if(base)html+=`<p class="hint">Current gear: ${number(base.dps)} DPS${base.error95!==null?` ± ${number(base.error95)}`:''}</p>`;
      for(const st of stages){if(st.status==='failed')html+=`<p class="notice">${st.stage===1?'Screening':'Final round'} failed: ${esc(st.error)}</p>`;if(st.status==='skipped')html+=`<p class="hint">${esc(st.reason)}</p>`;}
      if(upgrades.length){
        const groups=new Map();
        for(const r of upgrades)for(const src of r.c.sources){const g=groups.get(src.group);if(!g||r.rank>g.r.rank)groups.set(src.group,{src,r});}
        html+=`<h4 class="upgrade-heading">Best upgrade per source</h4><div class="upgrade-source-list">${[...groups.values()].sort((a,b)=>b.r.rank-a.r.rank).map(({src,r})=>`<div class="upgrade-source"><span><small>${esc(originNames[src.origin])}</small><strong>${esc(src.groupName)}</strong></span><span>${itemLink(r.c.itemId,r.c.name,r.c.value)}<small>${esc(slotNames[r.c.slot]||r.c.slot)} · ${r.c.itemLevel}</small></span><b>+${r.rank.toFixed(2)}${r.tanky?'':' %'}</b></div>`).join('')}</div>`;
        html+=`<h4 class="upgrade-heading">All measured upgrades</h4>${table(upgrades)}`;
      }else if(stages.some(st=>st.stage===2&&st.status==='complete'))html+='<p class="hint">No final-round candidate beat your current gear.</p>';
      const screened=rows.filter(r=>r.stage===1);
      if(screened.length)html+=`<details class="log-details"><summary>Screening results not simulated again (${screened.length})</summary>${table(screened.sort((a,b)=>b.rank-a.rank))}</details>`;
      html+=`<p class="result-note">${stages.filter(st=>st.stem).map(st=>`${st.stage===1?'Screening':'Final round'} (${st.count}): <a href="/reports/${job.id}/${st.stem}.html" download>HTML</a> <a href="/reports/${job.id}/${st.stem}.json" download>JSON</a> <a href="/reports/${job.id}/${st.stem}.simc" download>Input</a>`).join(' · ')}</p></section>`;
    }
    return html;
  }
  function table(rows){
    const max=Math.max(...rows.map(r=>Math.abs(r.rank)),1e-9);const tanky=rows.some(r=>r.tanky);
    return `<table class="result-table"><thead><tr><th>Item</th><th>Source</th><th>${tanky?'Score':'vs current'}</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${i===0&&r.rank>0&&r.stage===2?'winner':''}"><td>${itemLink(r.c.itemId,r.c.name,r.c.value)}<small>${esc(slotNames[r.c.slot]||r.c.slot)} · item level ${r.c.itemLevel}${r.stage===1?' · screening only':''}</small>${r.rank>0?`<div class="bar"><span style="width:${(r.rank/max*100).toFixed(1)}%"></span></div>`:''}</td><td class="upgrade-source-cell">${r.c.sources.map(src=>`<small>${esc(src.label)}</small>`).join('')}</td><td>${r.tanky?`${r.score>=0?'+':''}${r.score.toFixed(2)}<small>DPS ${r.dpsGain>=0?'+':''}${r.dpsGain.toFixed(2)} % · survival ${r.survival>=0?'+':''}${r.survival.toFixed(2)} %${r.uncertain?' · uncertain':''}</small>`:`${r.delta>=0?'+':''}${r.percent.toFixed(2)} %<small>${r.delta>=0?'+':''}${number(r.delta)} DPS${r.uncertain?' · uncertain':''}</small>`}</td></tr>`).join('')}</tbody></table>`;
  }
  return {init,settings,count,results};
}
