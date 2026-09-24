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
    const hero=data.tracks.find(t=>t.name==='Hero')||data.tracks.at(-2)||track;
    $('#weapon-season').textContent=data.season.name;
    const byClass=new Map();
    for(const spec of data.specs){if(!byClass.has(spec.className))byClass.set(spec.className,[]);byClass.get(spec.className).push(spec);}
    $('#weapon-options').innerHTML=`<div class="weapon-grid">
      <section class="upgrade-card"><strong>Specializations</strong><p class="hint">${data.specs.filter(s=>!s.healer).length} specializations have a reference profile — SimulationCraft's own character for the season, gear, gems and enchants included.${data.specs.some(s=>s.healer)?` SimulationCraft cannot simulate healing, so the ${data.specs.filter(s=>s.healer).length} healing specializations are ranked on a stat score instead; see Healers.`:''}${data.specs.some(s=>s.stale)?` <b>${data.specs.filter(s=>s.stale).map(s=>esc(s.label)).join(', ')}</b> still carry the previous season's gear, tens of item levels below the rest: their own ranking holds, but it is made on a weaker character.`:''}${data.specs.some(s=>s.ours)?` SimulationCraft has no profile this season for <b>${data.specs.filter(s=>s.ours).map(s=>esc(s.label)).join(', ')}</b>, so SimC Lab carries one of its own${data.specs.find(s=>s.ours)?.provenance?` built from ${esc(data.specs.find(s=>s.ours).provenance.name)}`:''}. They stand down as soon as the engine ships its own.`:''}</p><div class="upgrade-group-actions"><button class="text-button" data-all="spec">All</button><button class="text-button" data-none="spec">None</button><button class="text-button" data-only="tank">Tanks only</button><button class="text-button" data-only="healer">Healers only</button></div><div class="weapon-specs">${[...byClass].map(([className,specs])=>`<div class="weapon-class"><h4>${esc(className)}</h4>${specs.map(s=>`<label class="check${s.stale?' stale':''}${s.ours?' ours':''}" ${s.stale?`title="SimulationCraft has not rebuilt this profile for the current season, so its character wears the previous season's gear."`:s.ours?`title="SimulationCraft has no profile for this specialization this season, so SimC Lab carries one of its own${s.provenance?`, built from ${s.provenance.name}`:''}."`:s.healer?`title="Ranked on a stat score: healing from ${esc(s.provenance?.name||'')} stat weights, damage from SimC Lab's own model. Not simulated."`:''}><input type="checkbox" data-group="spec" value="${esc(s.key)}" data-tank="${s.tank?'1':'0'}" data-healer="${s.healer?'1':'0'}" checked>${esc(s.specName)}<small>${s.healer?'stat score · healer':`${s.ours?'ours':esc(s.season)}${s.stale?' · old gear':''}${s.tank?' · tank':''}`}</small></label>`).join('')}</div>`).join('')}</div></section>
      <section class="upgrade-card"><strong>Weapon categories</strong><p class="hint">A candidate is only tried where the reference profile already wields the same kind: a two-hander replaces a two-hander, a shield replaces a shield.</p><div class="upgrade-groups">${Object.entries(data.kinds).map(([key,label])=>`<label class="check"><input type="checkbox" data-group="kind" value="${key}" checked>${esc(label)}</label>`).join('')}</div>
        <label>Final round size<select id="weapon-finalists">${data.limits.finalists.map(n=>`<option value="${n}" ${n===24?'selected':''}>${n} candidates per spec</option>`).join('')}</select></label>
        <p class="hint">A specialization with more candidates than this is screened first, and only the best go on to the full simulation. Shorter lists are simulated once at full precision.</p></section>
      <section class="upgrade-card"><strong>Item level per source</strong><p class="hint">A weapon is ranked at the level its own source can actually give it. Delve and dungeon loot stops at the top of its track; only the raid reaches the Myth track, and its last bosses drop above it. Crafted gear sits at its own cap${data.craftedCap?` — item level ${data.craftedCap} this season, the level SimulationCraft's own profiles craft to`:''}.</p>
        <div class="two-col upgrade-track"><label>Raid difficulty<select data-source-track="raid">${data.difficulties.map(d=>`<option value="${d.track}" ${d.track===data.difficulties.at(-1).track?'selected':''}>${esc(d.name)}</option>`).join('')}</select></label><label>Crafted item level<input id="weapon-crafted-ilevel" type="number" min="1" max="1000" value="${data.craftedCap||hero.levels.at(-1).itemLevel}"></label></div>
        ${['mplus','delves'].map(kind=>`<div class="two-col upgrade-track"><label>${kind==='mplus'?'Mythic+':'Delves'} track<select data-source-track="${kind}">${data.tracks.map(t=>`<option value="${t.id}" ${t.id===hero.id?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('')}</select></label><label>Level<select data-source-level="${kind}">${levelOptions(hero.id,hero.levels.at(-1).level)}</select></label></div>`).join('')}
        <label class="check"><input type="checkbox" id="weapon-equal">Compare at one item level instead</label>
        <div class="two-col upgrade-track" id="weapon-equal-level" hidden><label>Track<select data-track="weapons">${data.tracks.map(t=>`<option value="${t.id}" ${t.id===track.id?'selected':''}>${esc(t.name)} · ${t.levels[0].itemLevel}–${t.levels.at(-1).itemLevel}</option>`).join('')}</select></label><label>Level<select data-level="weapons">${levelOptions(track.id,top.level)}</select></label></div>
        <p class="hint">Equal footing answers what a weapon is worth rather than what you can reach with it, so it will show weapons at levels their source cannot give.</p></section>
      <section class="upgrade-card"><strong>Crafted secondary stats</strong><p class="hint">Crafted weapons and shields carry no secondary stats of their own; without a pair they lose several percent. Every selected pair is simulated, and each crafted item is listed once, at the pair that served it best.</p><div class="upgrade-group-actions"><button class="text-button" data-all="stat">All</button><button class="text-button" data-none="stat">None</button></div><div class="upgrade-groups">${data.craftedStats.map(s=>`<label class="check"><input type="checkbox" data-group="stat" value="${s.bonusId}" checked>${esc(s.name)}</label>`).join('')}</div></section>
      ${data.healer?`<section class="upgrade-card"><strong>Healers</strong><p class="hint">SimulationCraft cannot simulate healing, so healer weapons are not simulated. SimC reads each weapon's stats at the level its source gives, and a score ranks them: healing from ${esc(data.healer.source.name)}'s stat weights for the chosen content (read ${esc(data.healer.source.readAt)}), damage from SimC Lab's own model — intellect, crit, haste and versatility as multipliers, mastery none, since every healing mastery works on healing alone. Equip and use effects are in neither score; hover a weapon to read its effect.</p>
        <label>Healing share of the score <output id="weapon-healer-weight-out">70 %</output><input id="weapon-healer-weight" type="range" min="0" max="100" step="5" value="70"></label>
        <p class="hint">The rest is damage. A healer's damage counts in Mythic+, but healing counts more.</p>
        <label>Healing stat weights<select id="weapon-healer-content">${Object.entries(data.healer.contents).map(([key,label])=>`<option value="${key}" ${key==='dungeon'?'selected':''}>${esc(label)}</option>`).join('')}</select></label></section>`:''}
    </div>
    <div id="weapon-count" class="hint">Counting candidates …</div>
    <p class="result-note">Tier lists compare weapons, not item levels: every candidate is pinned to the chosen upgrade level, and the enchant and any gems of the reference profile carry over. Tank specializations are ranked on the same weighted DPS and survival score as the rest of the app, with a boss calibrated for each of them.</p>`;
  }
  const checked=name=>$$(`[data-group="${name}"]:checked`).map(e=>e.value);
  function settings(){
    if(!data)return {};
    const equal=$('#weapon-equal').checked;
    return {specs:checked('spec'),kinds:checked('kind'),craftedStats:checked('stat').map(Number),finalists:Number($('#weapon-finalists').value),
      equal,track:Number($('[data-track="weapons"]').value),level:Number($('[data-level="weapons"]').value),
      sources:{raid:{track:Number($('[data-source-track="raid"]').value)},
        mplus:{track:Number($('[data-source-track="mplus"]').value),level:Number($('[data-source-level="mplus"]').value)},
        delves:{track:Number($('[data-source-track="delves"]').value),level:Number($('[data-source-level="delves"]').value)},
        crafted:{itemLevel:Number($('#weapon-crafted-ilevel').value)}},
      ...($('#weapon-healer-weight')?{healer:{weight:Number($('#weapon-healer-weight').value),content:$('#weapon-healer-content').value}}:{})};
  }
  async function init(){
    try{
      data=await api('/api/weapon-specs');render();
      $('#weapon-options').addEventListener('change',event=>{
        if(event.target.dataset.track){const level=$('[data-level="weapons"]');level.innerHTML=levelOptions(event.target.value,Number(level.value));}
        const kind=event.target.dataset.sourceTrack;
        if(kind&&kind!=='raid'){const level=$(`[data-source-level="${kind}"]`);level.innerHTML=levelOptions(event.target.value,Number(level.value));}
        if(event.target.id==='weapon-equal')$('#weapon-equal-level').hidden=!event.target.checked;
        updateCount();
      });
      $('#weapon-options').addEventListener('input',event=>{
        if(event.target.id==='weapon-crafted-ilevel')updateCount();
        if(event.target.id==='weapon-healer-weight')$('#weapon-healer-weight-out').textContent=`${event.target.value} %`;
      });
      $('#weapon-options').addEventListener('click',event=>{
        const {all,none,only}=event.target.dataset;
        if(!all&&!none&&!only)return;
        event.preventDefault();
        if(only)$$('[data-group="spec"]').forEach(el=>el.checked=el.dataset[only]==='1');
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
        $('#weapon-count').innerHTML=`<strong>${w.candidates} candidates</strong> across ${w.specs} specialization${w.specs===1?'':'s'} at item level ${w.levels.min===w.levels.max?w.levels.max:`${w.levels.min}–${w.levels.max}`}${w.craftedStats>1?` · crafted in ${w.craftedStats} stat pairs`:''} · ${w.steps} SimC run${w.steps===1?"":"s"}${w.tanks?` · ${w.tanks} tank boss calibration${w.tanks===1?'':'s'}`:''}${w.healers?` · ${w.healers} healer${w.healers===1?'':'s'} scored on stats, read in one run`:''}${w.skipped.length?`<br><small>Left out: ${esc(w.skipped.map(s=>s.label).join(', '))} — no item in the selected categories fits what the reference profile wields.</small>`:''}`;
      }catch(e){$('#weapon-count').textContent=e.message;}
    },350);
  }

  const tierClass=tier=>`tier tier-${tier}`;
  // A set weapon's lead is the set bonus; the rest of the hand is measured from the best weapon without one.
  function gapCell(row,c,tanky,sets){
    const unit=tanky?'':' %';
    if(c.set&&row.behind<0)return `+${(-row.behind).toFixed(2)}${unit}<small>with the set</small>`;
    if(row.behind<=0)return sets&&!c.set?'—<small>best without a set bonus</small>':'—';
    return `−${row.behind.toFixed(2)}${unit}${row.tied?'<small>within uncertainty</small>':''}`;
  }
  function table(rows,candidates,tanky){
    const sets=rows.some(r=>candidates.get(r.key)?.set);
    return `<table class="result-table weapon-table"><thead><tr><th>#</th><th>Item</th><th>${tanky?'Score':'DPS'}</th><th>Behind best</th><th>Tier</th></tr></thead><tbody>${rows.map(row=>{
      const c=candidates.get(row.key);if(!c)return '';
      return `<tr class="${row.rank===1?'winner':''}"><td class="weapon-rank">${row.rank}</td><td>${itemLink(c.itemId,c.name,c.value)}<small>${esc(data.kinds[c.kind]||c.kind)} · ${esc(c.sources.join(' · '))}${c.craftedStat?` · ${esc(c.craftedStat)}`:''}${c.itemLevel?` · item level ${c.itemLevel}${c.levelLabel?` (${esc(c.levelLabel)})`:''}`:''}${row.screened?' · screening only':''}${c.set?`<br>◆ ${esc(c.set.name)} ${c.set.pieces}-set with ${esc(c.set.with.join(', '))}`:''}</small></td><td>${tanky?`${signed(row.score)}<small>DPS ${signed(row.dpsGain)} % · survival ${signed(row.survival)} %</small>`:`${number(row.dps)}<small>${row.error95!==null?`± ${number(row.error95)}`:''}</small>`}</td><td>${gapCell(row,c,tanky,sets)}</td><td><span class="${tierClass(row.tier)}">${row.tier}</span></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  // Healers are scored, not simulated, so they get a section of their own rather than one per fight style.
  const healerHands={two:'Two-hand',one:'One-hand',off:'Off hand'};
  function healerResults(job){
    const healers=job.weapons.specs.filter(s=>s.healer);
    if(!healers.length)return '';
    const h=job.weapons.healer||{},stage=(job.stages||[]).find(st=>st.healer);
    let html=`<section class="result-scenario"><h3>Healers <span class="muted">/ stat score / ${h.weight} % healing, ${100-h.weight} % damage</span></h3>`;
    html+=`<p class="hint">Not simulated: SimulationCraft cannot simulate healing. Each weapon's stats were read by SimC at the level its source gives, then scored — healing on ${esc(data?.healer?.source?.name||'QE Live')}'s ${esc(data?.healer?.contents?.[h.content]||h.content)} stat weights, damage on SimC Lab's own model${h.damageWeights?` (per point against intellect: crit ${h.damageWeights.crit.toFixed(2)}, haste ${h.damageWeights.haste.toFixed(2)}, versatility ${h.damageWeights.versatility.toFixed(2)}, mastery 0)`:''}. A score is the share of a whole character the weapon carries, measured on ${esc(h.reference?.label||'a caster reference profile')}${h.reference?.intellect?` (${number(h.reference.intellect)} intellect)`:''}. Equip and use effects are not in the score; hover a weapon to read its effect.</p>`;
    if(stage?.status==='failed')return html+`<p class="notice">Reading the healer weapons failed: ${esc(stage.error)}</p></section>`;
    for(const spec of healers){
      const candidates=new Map(spec.candidates.map(c=>[c.key,c]));
      const rows=job.results.filter(r=>r.spec===spec.key&&Number.isFinite(r.rank));
      if(!rows.length)continue;
      const w=spec.weights;
      html+=`<details class="log-details weapon-spec" open><summary>${esc(spec.label)} <span class="pill">${rows.length} weapons</span></summary>`;
      if(w)html+=`<p class="hint">Healing weights per point against intellect: haste ${w.haste.toFixed(2)}, crit ${w.crit.toFixed(2)}, mastery ${w.mastery.toFixed(2)}, versatility ${w.versatility.toFixed(2)}.</p>`;
      const cmp=spec.compare;
      if(cmp){const two=candidates.get(cmp.two),one=candidates.get(cmp.one),off=candidates.get(cmp.off);
        html+=`<p class="hint"><b>${cmp.lead>=0?'Two-hand ahead':'One-hand and off hand ahead'}</b> by ${Math.abs(cmp.lead).toFixed(2)} %: ${esc(two?.name)} against ${esc(one?.name)} with ${esc(off?.name)}.</p>`;}
      for(const [hand,name] of Object.entries(healerHands)){
        const list=rows.filter(r=>candidates.get(r.key)?.hand===hand).sort((a,b)=>a.rank-b.rank);
        if(!list.length)continue;
        html+=`<h4 class="upgrade-heading">${name} · ${list.length} weapons</h4><table class="result-table weapon-table"><thead><tr><th>#</th><th>Item</th><th>Score</th><th>Behind best</th><th>Tier</th></tr></thead><tbody>${list.map(row=>{
          const c=candidates.get(row.key);
          return `<tr class="${row.rank===1?'winner':''}"><td class="weapon-rank">${row.rank}</td><td>${itemLink(c.itemId,c.name,c.value)}<small>${esc(data?.kinds?.[c.kind]||c.kind)} · ${esc(c.sources.join(' · '))}${c.craftedStat?` · ${esc(c.craftedStat)}`:''} · item level ${c.itemLevel}${c.levelLabel?` (${esc(c.levelLabel)})`:''}</small></td><td>${row.score.toFixed(2)} %<small>healing ${row.healing.toFixed(2)} · damage ${row.damage.toFixed(2)}</small></td><td>${row.rank===1?'—':`−${row.behind.toFixed(2)} %`}</td><td><span class="${tierClass(row.tier)}">${row.tier}</span></td></tr>`;
        }).join('')}</tbody></table>`;
      }
      html+='</details>';
    }
    return html+`${stage?.stem?`<p class="result-note">Stat readout (${stage.count} weapons): <a href="/reports/${job.id}/${stage.stem}.json" download>JSON</a> <a href="/reports/${job.id}/${stage.stem}.simc" download>Input</a></p>`:''}</section>`;
  }
  function results(job){
    if(!job.weapons)return '';
    const specs=job.weapons.specs;
    const levels=job.weapons.levels||{},src=job.weapons.sources||{};
    const levelText=levels.min===levels.max?`item level ${levels.max}`:`item level ${levels.min}–${levels.max}`;
    let html=`<div class="search-summary"><strong>Weapon Lab · ${specs.length} specialization${specs.length===1?'':'s'} · ${esc(levelText)}</strong><p class="hint">${src.equal?`Equal footing: every weapon pinned to ${esc(src.label||'')}, including ones their source cannot give at that level.`:`Each weapon at the level its source can give: ${esc([src.raid&&`raid ${src.raid.label}`,src.mplus&&`Mythic+ ${src.mplus.label}`,src.delves&&`delves ${src.delves.label}`,src.crafted&&`crafted ${src.crafted.label}`].filter(Boolean).join(' · '))}.`}<br>${esc(job.weapons.season?.name||'')} loot tables · categories: ${esc(job.weapons.kinds.map(k=>({main:'Main hand',offhand:'Off-hand weapon',shield:'Shield',held:'Held in off hand'})[k]||k).join(', '))}.${specs.some(s=>!s.healer)?` Screening uses up to ${number(job.weapons.screen.iterations)} iterations at ${job.weapons.screen.targetError}% target error; the final round uses ${number(job.settings.iterations)} iterations at ${job.settings.targetError}%.`:''}</p></div>`;
    if(job.weapons.skipped?.length)html+=`<p class="hint">Left out: ${esc(job.weapons.skipped.map(s=>s.label).join(', '))}.</p>`;
    if(job.results.some(r=>Number.isFinite(r.rank)))html+=`<p class="tier-page-links"><a class="button small secondary" href="/tier-list/${job.id}.html" target="_blank" rel="noopener">Open the tier list page ↗</a><a class="button small secondary" href="/tier-list/${job.id}.html?download" download>Download it</a><span class="hint">One page with every class and specialization, ready to read or send on. It needs no server of its own; the only thing it fetches is Wowhead's tooltip script.</span></p>`;
    for(const stage of (job.stages||[]).filter(st=>st.status==='failed'&&st.stage===0))html+=`<p class="notice">${esc(specs.find(s=>s.key===stage.spec)?.label||stage.spec)}: tank boss calibration failed — ${esc(stage.error)}</p>`;
    for(let s=0;s<job.scenarios.length;s++){
      const scenario=job.scenarios[s];
      // Each hand is its own list: rank 1 means the best weapon for that hand, not the better hand to replace.
      const done=specs.filter(spec=>!spec.healer).map(spec=>{
        const candidates=new Map(spec.candidates.map(c=>[c.key,c]));
        const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===s&&!r.superseded&&Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
        const hands=['main_hand','off_hand'].map(slot=>({slot,name:slot==='main_hand'?'Main hand':'Off hand',rows:rows.filter(r=>candidates.get(r.key)?.slot===slot)})).filter(h=>h.rows.length);
        return {spec,candidates,rows,hands,tanky:spec.tank&&rows.some(r=>Number.isFinite(r.score))};
      }).filter(x=>x.rows.length);
      if(!done.length)continue;
      html+=`<section class="result-scenario"><h3>${esc(scenario.style)} <span class="muted">/ ${scenario.targets} targets / ${job.settings.duration} sec</span></h3>`;
      html+=`<h4 class="upgrade-heading">Best weapon per hand</h4><div class="upgrade-source-list">${done.flatMap(({spec,candidates,hands})=>hands.map(hand=>{
        const best=hand.rows.find(r=>r.rank===1)||hand.rows[0],c=candidates.get(best.key),runnerUp=hand.rows.find(r=>r.rank===2);
        return `<div class="upgrade-source"><span><small>${esc(spec.className)} · ${esc(hand.name)}</small><strong>${esc(spec.specName)}</strong></span><span>${itemLink(c.itemId,c.name,c.value)}<small>${esc(data?.kinds?.[c.kind]||c.kind)} · ${esc(c.sources[0]||'')}${c.craftedStat?` · ${esc(c.craftedStat)}`:''}</small></span><b>${runnerUp?`+${(runnerUp.behindFirst??runnerUp.behind).toFixed(2)}${runnerUp.tied?'?':''}`:'—'}</b></div>`;
      })).join('')}</div><p class="hint">The number is how far the second-best weapon of that hand falls behind; “?” means that gap is inside the statistical uncertainty.</p>`;
      for(const {spec,candidates,rows,hands,tanky} of done){
        const stages=(job.stages||[]).filter(st=>st.spec===spec.key&&st.scenario===s);
        html+=`<details class="log-details weapon-spec" open><summary>${esc(spec.label)} <span class="pill">${rows.length} weapons</span></summary>`;
        const base=stages.find(st=>st.stage===2&&st.baseline)?.baseline||stages.find(st=>st.baseline)?.baseline;
        if(base)html+=`<p class="hint">Reference profile ${esc(spec.file.replace(/\.simc$/,''))} with its own weapon: ${number(base.dps)} DPS${spec.gear?` · gear at item level ${spec.gear.itemLevel} on average (${spec.gear.min}–${spec.gear.max})`:''}.</p>`;
        if(spec.stale)html+=`<p class="notice">${esc(spec.season)} profile: SimulationCraft has not rebuilt this specialization for the current season, so it is ranking current weapons on last season's character. The order within this list holds; do not read it next to the others.</p>`;
        if(spec.ours)html+=`<p class="hint">SimulationCraft has no profile for this specialization this season, so this character is SimC Lab's own${spec.provenance?`, built from ${esc(spec.provenance.name)}'s best in slot for patch ${esc(spec.provenance.patch)} (read ${esc(spec.provenance.readAt)})`:''}. Item levels, enchant ranks and the crafting cap come from the pinned game data. It is dropped as soon as SimulationCraft ships its own.</p>`;
        if(spec.boss?.measured)html+=`<p class="hint">Tank boss calibrated to ${number(spec.boss.health)} health: ${spec.boss.measured.sustained.toFixed(1)}% health per second, tank-busters of ${spec.boss.measured.buster.toFixed(0)}%, and the reference gear died in ${spec.boss.measured.deaths.toFixed(0)}% of calibration fights.${spec.boss.measured.reached?'':' The death target was not reached, so survival differences may be muted.'}</p>`;
        for(const st of stages)if(st.status==='failed')html+=`<p class="notice">${st.stage===1?'Screening':'Final round'} failed: ${esc(st.error)}</p>`;
        html+=hands.map(hand=>`${hands.length>1?`<h4 class="upgrade-heading">${esc(hand.name)} · ${hand.rows.length} weapons</h4>`:''}${table(hand.rows,candidates,tanky)}`).join('');
        html+=`<p class="result-note">${stages.filter(st=>st.stem).map(st=>`${st.stage===1?'Screening':'Final round'} (${st.count}): <a href="/reports/${job.id}/${st.stem}.html" download>HTML</a> <a href="/reports/${job.id}/${st.stem}.json" download>JSON</a> <a href="/reports/${job.id}/${st.stem}.simc" download>Input</a>`).join(' · ')}</p></details>`;
      }
      html+='</section>';
    }
    html+=healerResults(job);
    html+=`<p class="result-note">A tier is the distance behind the best weapon of the same specialization: S under 0.5, A under 1.5, B under 3, C under 5, then D — in percent of DPS, or in score points for tanks. Weapons inside the combined 95% uncertainty of the best one are marked; raise the precision before acting on small differences. A weapon marked ◆ completes an item set with the reference gear: its lead is that set's bonus, which every other weapon in the hand loses, so the rest of the hand is measured from the best weapon without one.</p>`;
    return html;
  }
  return {init,settings,count,results};
}
