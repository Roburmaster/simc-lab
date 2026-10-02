const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Math.round(n||0).toLocaleString('en-US');
const size=b=>b>1073741824?`${(b/1073741824).toFixed(1)} GB`:b>1048576?`${(b/1048576).toFixed(0)} MB`:`${Math.ceil(b/1024)} KB`;
const when=iso=>new Date(iso).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});
const clock=s=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
const short=name=>String(name||'').replace(/-[^-]+-(EU|US|KR|TW|CN)$/,'');
// Abilities drawn on the cast timeline, in this order; the rest of the casts are listed in the table.
const lanes=['Recklessness','Avatar','Bladestorm',"Odyn's Fury",'Thunderous Roar','Rampage','Bloodthirst','Bloodbath','Raging Blow','Crushing Blow','Execute','Whirlwind'];

// Log Analysis: pick a combat log, a fight and a player, and see what the rotation did and what to change, beside a
// finished simulation of the same character when one is chosen.
export function logsUI({api,notice}){
  let files=[],scan=null,polling=null;
  $('#history').insertAdjacentHTML('afterend',`<section id="logs-panel" class="panel logs-panel" hidden>
    <div class="panel-heading"><h2>Analyse a combat log</h2><span class="pill" id="logs-specs"></span></div>
    <p class="panel-intro">Turn on Advanced Combat Logging in WoW (System → Network) and type /combatlog before you fight. SimC Lab reads the log from your WoW folder, finds the fights, and shows what your rotation did and what to change.</p>
    <div class="logs-pick"><label>Combat log<select id="log-file"></select></label><button class="button small secondary" id="log-refresh">Refresh</button><button class="button small primary" id="log-scan">Find fights</button></div>
    <div id="log-scan-state" class="hint"></div>
    <div class="logs-pick" id="log-filters" hidden><label>Player<input id="log-player" type="search" placeholder="Name, e.g. Roburevolved" autocomplete="off"></label><label class="check"><input type="checkbox" id="log-bosses">Boss encounters only</label></div>
    <div id="log-fights"></div>
    <div id="log-report"></div></section>`);

  async function refresh(){
    try{
      const r=await api('/api/logs');files=r.files;$('#logs-specs').textContent=`Analysed: ${r.specs.join(', ')}`;
      $('#log-file').innerHTML=files.length?files.map(f=>`<option value="${esc(f.name)}">${esc(f.name)} · ${size(f.size)} · ${when(f.modified)}</option>`).join(''):'<option value="">No combat logs found</option>';
      if(!r.dir)$('#log-scan-state').textContent='The WoW folder was not found, so there are no logs to read.';
    }catch(e){notice(e.message);}
  }
  async function startScan(){
    const file=$('#log-file').value;if(!file)return;clearTimeout(polling);$('#log-report').innerHTML='';
    try{
      const state=await api('/api/logs/scan',{file});
      if(state.status==='scanning'){$('#log-scan-state').innerHTML=`Reading the log … ${Math.round(100*state.progress)}%<div class="progress-track live"><div class="progress-fill" style="width:${Math.round(100*state.progress)}%"></div></div>`;polling=setTimeout(startScan,700);return;}
      if(state.status==='failed')throw new Error(state.error);
      scan={file,...state.scan};$('#log-scan-state').textContent=`${scan.fights.length} fights in ${file}.`;renderFights();
    }catch(e){$('#log-scan-state').textContent=e.message;}
  }
  // A raid log has a stretch of activity for every player and pull, so the list is filtered and capped.
  function renderFights(){
    $('#log-filters').hidden=false;
    const q=$('#log-player').value.trim().toLowerCase(),bosses=$('#log-bosses').checked;
    const all=scan.fights.slice().reverse().filter(f=>(!bosses||f.kind==='encounter')&&(!q||(f.kind==='encounter'?f.players.some(p=>p.name.toLowerCase().includes(q)):String(f.name).toLowerCase().includes(q))));
    const rows=all.slice(0,60);
    $('#log-fights').innerHTML=rows.length?`<table class="result-table log-fights"><thead><tr><th>Fight</th><th>Length</th><th>Player</th><th>Damage</th><th></th></tr></thead><tbody>${rows.map(f=>{
      const players=f.kind==='encounter'?(q?[...f.players].sort((a,b)=>Number(b.name.toLowerCase().includes(q))-Number(a.name.toLowerCase().includes(q))):f.players):[{guid:f.player,name:f.name,damage:f.damage}];
      return `<tr><td>${f.kind==='encounter'?`<strong>${esc(f.name)}</strong><small>${f.success?'Kill':'Wipe'}</small>`:`Activity<small>${esc(f.targets.slice(0,3).join(', '))}${f.targets.length>3?' …':''}</small>`}</td><td>${clock(f.length)}</td><td><select data-fight-player="${f.id}">${players.map(p=>`<option value="${esc(p.guid)}">${esc(short(p.name))} · ${number(p.damage/Math.max(1,f.length))} DPS</option>`).join('')}</select></td><td>${number(players.reduce((n,p)=>n+p.damage,0))}</td><td><button class="button small secondary" data-analyse="${f.id}">Analyse</button></td></tr>`;}).join('')}</tbody></table>${all.length>rows.length?`<p class="hint">Showing the newest 60 of ${all.length}. Filter by player to narrow it.</p>`:''}`:'<p class="hint">No fights found. A fight is a boss encounter, or at least 20 seconds of continuous damage by one player.</p>';
  }
  async function analyse(id){
    const player=document.querySelector(`[data-fight-player="${id}"]`).value;
    const name=short(document.querySelector(`[data-fight-player="${id}"]`).selectedOptions[0].textContent.split(' · ')[0]);
    // Finished simulations of the same character, newest first, to set the rotation beside.
    let sims=[];try{sims=(await api('/api/jobs')).filter(j=>['complete','partial'].includes(j.status)&&['quick','compare','enchants','talents'].includes(j.mode)&&String(j.name).toLowerCase()===name.toLowerCase()).sort((a,b)=>String(b.created).localeCompare(String(a.created)));}catch{}
    $('#log-report').innerHTML=`<div class="log-compare"><label>Compare with a simulation<select id="log-compare"><option value="">No comparison</option>${sims.map(j=>`<option value="${esc(j.id)}">${esc(j.name)} · ${when(j.created)}</option>`).join('')}</select></label><p class="hint">${sims.length?'SimC’s casts per minute from that simulation are shown beside yours.':`No finished simulation of ${esc(name)} yet. Run a Quick Sim of the same character (for dummies, the Silvermoon dummies fight style) to compare.`}</p></div><div id="log-result">Analysing …</div>`;
    const run=async()=>{try{render(await api('/api/logs/analyse',{file:scan.file,fight:id,player,job:$('#log-compare').value||null}));}catch(e){$('#log-result').innerHTML=`<p class="notice">${esc(e.message)}</p>`;}};
    $('#log-compare').onchange=run;if(sims[0]){$('#log-compare').value=sims[0].id;}await run();
  }
  function render(r){
    const icon={warning:'!',tip:'→',good:'✓'};
    const timeline=lanes.filter(l=>r.casts.some(c=>c.name===l)).map(l=>`<div class="lane"><span>${esc(l)}</span><div>${r.casts.filter(c=>c.name===l).map(c=>`<i style="left:${Math.max(0,Math.min(100,100*c.t/r.length)).toFixed(2)}%" title="${esc(l)} at ${c.t.toFixed(1)} s"></i>`).join('')}</div></div>`).join('');
    $('#log-result').innerHTML=`<div class="log-summary"><div><strong>${number(r.dps)}</strong><span>DPS · ${esc(short(r.name))} · ${esc(r.spec)}</span></div><div><strong>${clock(r.length)}</strong><span>${r.targets} target${r.targets===1?'':'s'}</span></div><div><strong>${r.uptime.enrage}%</strong><span>Enrage</span></div><div><strong>${r.uptime.recklessness}%</strong><span>Recklessness</span></div>${r.compare?`<div><strong>${number(r.compare.dps)}</strong><span>SimC · ${esc(r.compare.scenario?.style||'')}</span></div>`:''}</div>
      <h3 class="upgrade-heading">What to change</h3><div class="log-findings">${r.findings.map(f=>`<div class="finding ${f.severity}"><span>${icon[f.severity]}</span><div><strong>${esc(f.title)}</strong><p>${esc(f.detail)}</p></div></div>`).join('')}</div>
      <h3 class="upgrade-heading">Casts over the fight</h3><div class="cast-timeline">${timeline}</div>
      <h3 class="upgrade-heading">Casts per minute${r.compare?' · you and SimC':''}</h3><table class="result-table"><thead><tr><th>Ability</th><th>Casts</th><th>Per minute</th>${r.compare?'<th>SimC per minute</th>':''}<th>Damage</th></tr></thead><tbody>${r.abilities.map(a=>`<tr><td>${esc(a.name)}</td><td>${a.casts}</td><td>${a.cpm}</td>${r.compare?`<td>${a.simCpm??'—'}</td>`:''}<td>${a.share?a.share+'%':'—'}</td></tr>`).join('')}</tbody></table>
      ${r.cooldowns.length?`<h3 class="upgrade-heading">Recklessness</h3><table class="result-table"><thead><tr><th>At</th><th>With</th></tr></thead><tbody>${r.cooldowns.map(c=>`<tr><td>${clock(c.time)}</td><td>${c.with.length?esc([...new Set(c.with)].join(', ')):'Nothing else'}</td></tr>`).join('')}</tbody></table>`:''}
      ${r.potions.length?`<h3 class="upgrade-heading">Potions</h3><table class="result-table"><thead><tr><th>At</th><th>Potion</th><th>With Recklessness</th></tr></thead><tbody>${r.potions.map(p=>`<tr><td>${clock(p.time)}</td><td>${esc(p.name)}</td><td>${p.withRecklessness?'Yes':'No'}</td></tr>`).join('')}</tbody></table>`:''}
      <details class="environment-detail"><summary>Damage by spell</summary><table class="result-table"><thead><tr><th>Spell</th><th>Damage</th><th>Share</th><th>Hits</th><th>Crit</th></tr></thead><tbody>${r.spells.map(s=>`<tr><td>${esc(s.name)}</td><td>${number(s.amount)}</td><td>${s.share}%</td><td>${s.hits}</td><td>${s.crit}%</td></tr>`).join('')}</tbody></table></details>
      <p class="hint">Rage: ${number(r.rage.gained)} gained, ${number(r.rage.wasted)} lost to the cap. Buffs you already had when the log started (flask, food, rune) do not show in a log.</p>`;
  }
  $('#log-refresh').onclick=refresh;$('#log-scan').onclick=startScan;
  $('#log-player').oninput=()=>{if(scan)renderFights();};$('#log-bosses').onchange=()=>{if(scan)renderFights();};
  document.addEventListener('click',e=>{const b=e.target.closest('[data-analyse]');if(b)analyse(Number(b.dataset.analyse));});
  return {show:refresh};
}

// SimC's rotation for one finished run: the action list it followed and what it pressed in a sample iteration.
export async function rotationView(api,job,stem){
  const r=await api(`/api/jobs/${job}/rotation/${stem}`);
  const cpm=Object.entries(r.castsPerMinute||{}).sort((a,b)=>b[1]-a[1]);
  return `<div class="rotation-view"><h4>SimC rotation · ${esc(r.variant)}</h4>
    <div class="rotation-grid"><div><h5>Casts per minute</h5><table class="result-table"><tbody>${cpm.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>
    <div><h5>Sample sequence · first 60 s</h5><table class="result-table"><thead><tr><th>Time</th><th>Action</th><th>Rage</th><th>Buffs</th></tr></thead><tbody>${r.sequence.filter(e=>e.t<=60).map(e=>`<tr><td>${e.t.toFixed(2)}</td><td>${esc(e.name)}</td><td>${e.rage===null?'—':Math.round(e.rage)}</td><td><small>${esc(e.buffs.filter(b=>/enrage|reckless|whirlwind|sudden|bladestorm|avatar|bloodlust|potion/.test(b)).join(', '))}</small></td></tr>`).join('')}</tbody></table></div></div>
    ${r.apl.length?`<details><summary>Action priority list (${r.apl.length} lines)</summary><pre class="apl">${esc(r.apl.join('\n'))}</pre></details>`:'<p class="hint">The action list is saved for runs made from SimC Lab 1.32.0 on.</p>'}</div>`;
}
