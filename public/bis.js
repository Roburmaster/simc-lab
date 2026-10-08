import {itemLink,slotNames} from '/items.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const signed=(n,digits=2)=>`${n>=0?'+':''}${Number(n).toFixed(digits)}`;
const originNames={raid:'Raid',mplus:'Mythic+',crafted:'Crafted',catalyst:'Revival Catalyst',bags:'Your bags'};
const slotOrder=['head','neck','shoulder','back','chest','wrist','hands','waist','legs','feet','finger1','finger2','trinket1','trinket2','main_hand','off_hand'];

// Best in Slot: the sources a character can use, ticked, and the best full set they allow after the simulation.
export function bisUI({api,notice,updateCount}){
  let data=null,countTimer=null;
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="bis-panel" class="panel" hidden><div class="panel-heading"><h2><span class="step">02</span> Best in Slot</h2><span id="bis-season" class="pill">Loading season</span></div><p class="panel-intro">Tick where this character can get gear. A player who does not raid unticks Raid and keeps Mythic+ and Crafted. Every piece the sources offer is simulated in its slot, then the best full set is built from the results and simulated as a whole, and compared with what you wear.</p><div id="bis-sources"><p class="hint">Loading loot tables …</p></div></section>`);
  const trackOptions=selected=>data.tracks.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('');
  const levelOptions=(trackId,selected)=>{const levels=(data.tracks.find(t=>t.id===Number(trackId))||data.tracks[0]).levels;return levels.map(l=>`<option value="${l.level}" ${l.level===(selected??levels.at(-1).level)?'selected':''}>${l.level}/${l.max} · item level ${l.itemLevel}</option>`).join('');};
  // Bosses and dungeons can be narrowed; everything is ticked to begin with.
  const groupChecks=(name,list)=>`<details><summary>${name==='raid'?'Bosses':'Dungeons'} (${list.length})</summary><div class="upgrade-group-actions"><button class="text-button" data-bis-all="${name}">All</button><button class="text-button" data-bis-none="${name}">None</button></div><div class="upgrade-groups">${list.map(g=>`<label class="check"><input type="checkbox" data-bis-group="${name}" value="${g.id}" checked>${esc(g.name)}</label>`).join('')}</div></details>`;
  const checked=name=>[...document.querySelectorAll(`[data-bis-group="${name}"]:checked`)].map(e=>Number(e.value));
  function render(){
    const hero=(data.tracks.find(t=>t.name==='Hero')||data.tracks.at(-1)).id,top=data.difficulties.at(-1);
    const topTrack=data.tracks.find(t=>t.id===top.track),heroTop=data.tracks.find(t=>t.id===hero).levels.at(-1).itemLevel;
    $('#bis-season').textContent=data.season.name;
    $('#bis-sources').innerHTML=`<div class="upgrade-grid">
      <section class="upgrade-card"><label class="check upgrade-toggle"><input type="checkbox" data-bis-source="raid" checked><strong>Raid</strong></label><p class="hint">${esc(data.raids.map(r=>r.name).join(' · '))}. Every boss, with tier tokens turned into your class's set piece, fully upgraded.</p><label>Difficulty<select data-bis="difficulty">${data.difficulties.map(d=>`<option value="${d.track}" ${d.track===top.track?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label>${groupChecks('raid',data.raids.flatMap(r=>r.encounters))}</section>
      <section class="upgrade-card"><label class="check upgrade-toggle"><input type="checkbox" data-bis-source="mplus" checked><strong>Mythic+</strong></label><p class="hint">${data.dungeons.length} dungeons in the current rotation. Choose the best upgrade you can reach.</p><div class="two-col"><label>Upgrade track<select data-bis="mplus-track">${trackOptions(hero)}</select></label><label>Level<select data-bis="mplus-level">${levelOptions(hero)}</select></label></div>${groupChecks('mplus',data.dungeons)}</section>
      ${data.crafted?`<section class="upgrade-card"><label class="check upgrade-toggle"><input type="checkbox" data-bis-source="crafted" checked><strong>Crafted</strong></label><p class="hint">Epic profession gear in every legal pair of secondary stats, with every embellishment, within the equip limit. Some pieces require the matching profession to equip.</p><label>Item level<input data-bis="crafted" type="number" min="1" max="1000" value="${data.craftedCap||heroTop}"></label>${data.embellishments?.length?`<label class="check"><input type="checkbox" data-bis="embellishments" checked>Try every embellishment (${data.embellishments.length}); this multiplies the candidates</label>`:''}</section>`:''}
    </div>
    <div class="two-col upgrade-options"><label>Search depth<select data-bis="depth">${Object.entries(data.depths).map(([id,d])=>`<option value="${id}" ${id==='standard'?'selected':''}>${esc(d.label)} · final round of ${d.finalists}, up to ${d.rounds} refinement rounds</option>`).join('')}</select></label><div class="bis-checks"><label class="check"><input type="checkbox" data-bis="bags" checked>Include the gear in my bags</label><label class="check"><input type="checkbox" data-bis="requireSet" checked>Wear at least 4 pieces of the tier set</label><label class="check"><input type="checkbox" data-bis="catalyst" checked>Allow the Revival Catalyst</label></div></div>
    <p class="hint">The 4 piece tier set is held to by the search: if the best loose items are better, it still wears four tier pieces and says what that costs. The Catalyst turns a piece into the tier piece of its slot at the same item level, so tier is on offer at the level of each Mythic+ or crafted source you ticked, and the result says which slots are cheapest to make tier.</p>
    <div id="bis-count" class="hint">Import a character to count candidates.</div>
    <p class="result-note">Everything is assumed fully upgraded: the crests that takes are not counted, so this is the ceiling of the sources you tick, not what drops today. The search starts from the best piece in every slot and from each item set bonus, then keeps the single change that helps most while one still helps by more than the noise. It is a bounded search checked by simulation, not a proof that nothing better exists. Screening runs every candidate at low precision first, as Upgrade Finder does.</p>`;
  }
  const on=name=>!!$(`[data-bis-source="${name}"]`)?.checked;
  const value=name=>$(`[data-bis="${name}"]`)?.value;
  function settings(){
    if(!data)return {};
    return {depth:value('depth'),bags:$('[data-bis="bags"]').checked,requireSet:$('[data-bis="requireSet"]').checked,catalyst:$('[data-bis="catalyst"]').checked,
      raid:{enabled:on('raid'),difficulty:Number(value('difficulty')),encounters:checked('raid')},
      mplus:{enabled:on('mplus'),track:Number(value('mplus-track')),level:Number(value('mplus-level')),dungeons:checked('mplus')},
      ...(data.crafted?{crafted:{enabled:on('crafted'),itemLevel:Number(value('crafted')),...($('[data-bis="embellishments"]')&&!$('[data-bis="embellishments"]').checked?{embellishments:[]}:{})}}:{})};
  }
  function changed(event){
    if(event.target.dataset.bis==='mplus-track'){const level=$('[data-bis="mplus-level"]');level.innerHTML=levelOptions(event.target.value,Number(level.value));}
    updateCount();
  }
  async function init(){
    try{data=await api('/api/bis-sources');render();
      $('#bis-sources').addEventListener('click',e=>{const all=e.target.dataset.bisAll,none=e.target.dataset.bisNone;if(!all&&!none)return;e.preventDefault();document.querySelectorAll(`[data-bis-group="${all||none}"]`).forEach(el=>{el.checked=!!all;});updateCount();});
      $('#bis-sources').addEventListener('change',changed);$('#bis-sources').addEventListener('input',e=>{if(e.target.dataset.bis==='crafted')updateCount();});
    }catch(e){$('#bis-sources').textContent=e.message;notice(e.message);}
  }
  // Candidate counts come from the server so the numbers match what will run.
  function count(request,hasProfile){
    clearTimeout(countTimer);if(!data)return;
    if(!hasProfile){$('#bis-count').textContent='Import a character to count candidates.';return;}
    $('#bis-count').textContent='Counting candidates …';
    countTimer=setTimeout(async()=>{try{const b=(await api('/api/preview',request())).bis;$('#bis-count').innerHTML=`<strong>${b.candidates} candidates</strong> across ${b.slots} slots${b.bags?` · ${b.bags} from your bags`:''}${b.catalyst?` · ${b.catalyst} through the Catalyst`:''} · screening, a final round of up to ${b.finalists}, the first sets, up to ${b.rounds} refinement rounds and a check: ${b.steps} SimC runs${b.embellished?`<br>${b.embellished} with an embellishment`:''}`;}catch(e){$('#bis-count').textContent=e.message;}},350);
  }

  // The set slot by slot, against what is worn.
  function rows(job,run){
    const byKey=new Map(job.bis.candidates.map(c=>[c.key,c])),worn=new Map(job.bis.worn.map(w=>[w.slot,w]));
    const set=new Map((run.set||[]).map(s=>[s.slot,s])),worth=new Map((run.final?.slots||[]).map(s=>[s.slot,s]));
    return slotOrder.map(slot=>{const w=worn.get(slot),pick=set.get(slot),c=pick?.key?byKey.get(pick.key):null;return w||c?{slot,worn:w,c,worth:worth.get(slot)}:null;}).filter(Boolean);
  }
  // The tier set: which slots are cheapest to make tier, and which of the set's pieces come from the Catalyst.
  function catalyst(run,unit){
    const c=run.catalyst;if(!c?.slots?.length)return '';
    const cost=s=>{const noise=Math.hypot(s.tier.noise||0,s.alt.noise||0),v=-s.cost;return `${signed(v)}${unit}<small>${Math.abs(v)<=noise?'within noise':v>0?'tier is better here':'costs this much'}</small>`;};
    const piece=p=>`${p.key?esc(p.name):`${esc(p.name)}`}<small>${p.itemLevel?`item level ${p.itemLevel} · `:''}${esc(originNames[p.origin]||(p.kept?'worn':''))}</small>`;
    return `<h4 class="upgrade-heading">Tier set · ${esc(c.set)} · ${c.pieces??0} pieces in the set${c.required?'':' (not required)'}</h4><p class="hint">The slots where wearing tier costs least come first. Where the tier piece comes from the Catalyst, convert any piece of that slot at that item level: a spare drop is enough, and the piece you convert does not matter.</p><table class="result-table"><thead><tr><th>Slot</th><th>Tier piece</th><th>Best other piece</th><th>Tier vs other</th><th>In the set</th></tr></thead><tbody>${c.slots.map(s=>`<tr class="${s.chosen?'winner':''}"><td>${esc(slotNames[s.group]||s.group)}</td><td>${piece(s.tier)}</td><td>${piece(s.alt)}</td><td>${cost(s)}</td><td>${s.chosen?(s.catalyzed?'Yes · from the Catalyst':'Yes'):'No'}</td></tr>`).join('')}</tbody></table>`;
  }
  function scenario(job,s){
    const run=job.bis.runs[s],scenario=job.scenarios[s];if(!run)return '';
    const tanky=!!job.settings.tank,unit=tanky?'':' %',final=run.final;
    let html=`<section class="result-scenario"><h3>${esc(scenario.style)} <span class="muted">/ ${scenario.targets} targets / ${job.settings.duration} sec</span></h3>`;
    if(final?.same)html+=`<p class="hint">Nothing in the sources you ticked beats what you wear by more than the noise: you are already best in slot from them as far as the simulation can tell. More iterations or a lower target error resolve smaller differences.</p>`;
    else if(final?.current)html+=`<div class="dps-hero"><strong>${signed(final.gain)}${unit}</strong><span>best in slot ${number(final.dps)} DPS · what you wear ${number(final.current.dps)} DPS${final.error95!=null?` · ±${number(final.error95)}`:''}</span></div>`;
    html+=run.notes.map(n=>`<p class="hint">${esc(n)}</p>`).join('');
    const list=rows(job,run);
    if(run.set){
      html+=`<h4 class="upgrade-heading">Slot by slot</h4><table class="result-table"><thead><tr><th>Slot</th><th>You wear</th><th>Best in slot</th><th>In the set</th></tr></thead><tbody>${list.map(r=>`<tr class="${r.c?'winner':''}"><td>${esc(slotNames[r.slot]||r.slot)}</td><td>${r.worn?itemLink(r.worn.itemId,r.worn.name,r.worn.value):'<span class="muted">Empty</span>'}</td><td>${r.c?`${itemLink(r.c.itemId,r.c.name,r.c.value)}<small>${r.c.sources.map(x=>esc(x.label)).join(' · ')}${r.c.embellishment?` · ${esc(r.c.embellishment)}`:''}${r.c.freed?` · worn in place of the ${esc(r.c.freed.embellishment)} on ${esc(r.c.freed.item)}`:''}</small>`:'<span class="muted">Keep it</span>'}</td><td>${r.c&&r.worth&&Number.isFinite(r.worth.worth)?`${signed(r.worth.worth)}${unit}<small>${Math.abs(r.worth.worth)<=r.worth.noise?'within noise':'lost without it'}</small>`:'—'}</td></tr>`).join('')}</tbody></table>`;
      html+=catalyst(run,unit);
      // Where to get it: the changed slots grouped by their first source.
      const groups=new Map();
      for(const r of list.filter(r=>r.c)){const src=r.c.sources[0];const g=groups.get(src.group)||{origin:src.origin,name:src.groupName,items:[]};g.items.push(r);groups.set(src.group,g);}
      const order=Object.keys(originNames),shop=[...groups.values()].sort((a,b)=>order.indexOf(a.origin)-order.indexOf(b.origin)||b.items.length-a.items.length);
      if(shop.length)html+=`<h4 class="upgrade-heading">Where to get it</h4><div class="upgrade-source-list">${shop.map(g=>`<div class="upgrade-source"><span><small>${esc(originNames[g.origin]||g.origin)}</small><strong>${esc(g.name)}</strong></span><span>${g.items.map(r=>`${itemLink(r.c.itemId,r.c.name,r.c.value)}<small>${esc(slotNames[r.slot]||r.slot)} · ${r.c.itemLevel}</small>`).join('')}</span><b>${g.items.length}</b></div>`).join('')}</div>`;
    }
    if(run.rounds?.length)html+=`<details class="log-details"><summary>How the set was found (${run.variants.length} first sets, ${run.rounds.length} refinement round${run.rounds.length===1?'':'s'})</summary><table class="result-table"><thead><tr><th>Step</th><th>What</th><th>${tanky?'Score':'vs what you wear'}</th></tr></thead><tbody>${run.variants.map(v=>`<tr><td>First set</td><td>${esc(v.label)}${v.tier!==undefined?` · ${v.tier} tier pieces`:''}${v.key===run.start?'<small>started from this one</small>':v.allowed===false?'<small>not allowed: fewer than 4 tier pieces</small>':''}</td><td>${Number.isFinite(v.gain)?`${signed(v.gain)}${unit}`:'—'}</td></tr>`).join('')}${run.rounds.map(r=>`<tr><td>Round ${r.round}</td><td>${r.adopted?r.adopted.map(a=>esc(a.label)).join('<br>'):'No change beat the set'}<small>${r.tried} sets tried</small></td><td>${r.adopted?r.adopted.map(a=>`${signed(a.gain)}${unit}`).join('<br>'):'—'}</td></tr>`).join('')}</tbody></table></details>`;
    return html+'</section>';
  }
  function results(job){
    if(!job.bis)return '';
    let html=`<div class="search-summary"><strong>Best in Slot · ${job.bis.candidates.length} candidates · ${esc(job.bis.season?.name)}</strong><p class="hint">Screening: up to ${number(job.bis.screen.iterations)} iterations, ${job.bis.screen.targetError}% target error. Final round and sets: up to ${number(job.settings.iterations)} iterations, ${job.settings.targetError}% target error. Everything fully upgraded; crests not counted.</p></div>`;
    for(let s=0;s<job.scenarios.length;s++)html+=scenario(job,s);
    if(['complete','partial'].includes(job.status)&&job.bis.runs.some(r=>r.set))html=`<p class="tier-page-links"><a class="button small secondary" href="/bis-report/${job.id}.html" target="_blank" rel="noopener">Open the Best in Slot report ↗</a><a class="button small secondary" href="/bis-report/${job.id}.html?download" download>Download it</a><span class="hint">The set slot by slot, where each piece comes from, the best piece from every source, and how the set was found, on one page.</span></p>`+html;
    return `<div id="bis-results">${html}</div>`;
  }
  // The SimC runs per scenario: screening, final round, the first sets, the refinement rounds and the check.
  const steps=()=>data&&data.depths[value('depth')]?4+data.depths[value('depth')].rounds:4;
  return {init,settings,count,results,steps};
}
