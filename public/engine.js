const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=iso=>iso?new Date(iso).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'Unknown';
const kinds={nightly:'Official nightly build',source:'Built from source'};

// Engine and app updates: one button installs the newest matching SimC and game data; the desktop app also
// updates itself through the preload bridge.
export function engineUI({api,notice}){
  let status=null,polling=null;
  const desktop=window.simcDesktop;
  $('#workspace').insertAdjacentHTML('beforebegin',`<section id="setup-panel" class="panel setup-panel" hidden><div class="info-symbol">⇪</div><div><h2>Install SimulationCraft</h2><p>SimC Lab needs the SimulationCraft engine and current game data. One click downloads the newest official build that matches your World of Warcraft version. If no matching build exists yet, SimC is built from source, and missing build tools are installed first.</p><button class="button primary setup-button" data-update="auto">Install SimC <span>→</span></button><div class="update-progress" data-progress></div></div></section>`);
  $('.sidebar-bottom').insertAdjacentHTML('beforeend','<button class="button small secondary sidebar-update" data-update="auto">Update SimC</button>');

  function render(s){
    status=s;const e=s.engine;
    $('#engine-detail').innerHTML=`<p>Installed WoW<br><strong>${esc(e.installed||'Not found')}</strong></p>
      <p>SimulationCraft<br><strong>${esc(e.version||'Not installed')}</strong>${e.wowVersion?` · WoW ${esc(e.wowVersion)}`:''}<br>${esc(kinds[e.source]||'Built from source')}${e.commitDate?` · ${when(e.commitDate)}`:''}</p>
      <p>Commit<br><code>${esc(e.commit||'—')}</code></p>
      <div class="engine-actions"><button class="button small primary" data-update="auto">Update SimC</button><button class="button small secondary" data-check>Check for updates</button></div>
      <div id="engine-check" class="hint"></div><div class="update-progress" data-progress></div>
      <details><summary>Advanced</summary><p class="hint">Build from source downloads the SimC source and compiles it. The first build installs Git, CMake and the Visual Studio C++ tools with winget, needs about 8 GB and takes 20–40 minutes.</p><div class="engine-actions"><button class="button small secondary" data-update="source">Build from source</button><button class="button small secondary" data-update="data">Refresh game data only</button></div></details>
      ${desktop?`<div class="divider"></div><p>SimC Lab<br><strong>${esc(s.app?.version||'')}</strong></p><div class="engine-actions"><button class="button small secondary" data-app-check>Check for app updates</button><button class="button small primary" data-app-install hidden>Restart and update</button></div><div class="hint" id="app-update"></div>`:''}`;
    const missing=!e.ready||!!s.loadError;
    $('#setup-panel').hidden=!missing;
    $('.engine-details').open=missing||$('.engine-details').open;
  }

  async function check(){
    const target=$('#engine-check');target.textContent='Checking SimC, WoW and game data …';
    try{
      const c=await api('/api/engine/check',{});
      const lines=[c.decision.reason];
      if(c.nightly)lines.push(`Newest official build: ${c.nightly.version} for WoW ${c.nightly.wowVersion} (${when(c.nightly.date)})`);
      if(c.head)lines.push(`Newest source: ${c.head.sha.slice(0,7)} for WoW ${c.head.wowVersion} (${when(c.head.date)})`);
      if(c.live)lines.push(`Game data: WoW ${c.live.wowBuild}`);
      for(const err of c.errors)lines.push(err);
      target.innerHTML=lines.map(esc).join('<br>');
    }catch(err){target.textContent=err.message;}
  }

  async function start(mode){
    try{await api('/api/engine/update',{mode});}catch(err){notice(err.message);return;}
    document.querySelectorAll('[data-update]').forEach(b=>b.disabled=true);
    poll();
  }
  async function poll(){
    clearTimeout(polling);
    let state;try{state=await api('/api/engine/update');}catch{polling=setTimeout(poll,2000);return;}
    const html=`<pre>${esc((state.log||[]).slice(-12).join('\n'))}${state.detail&&state.status==='running'?'\n'+esc(state.detail):''}</pre>${state.status==='failed'?`<p class="notice">${esc(state.error)}</p>`:''}`;
    document.querySelectorAll('[data-progress]').forEach(el=>el.innerHTML=html);
    if(state.status==='running'){polling=setTimeout(poll,1000);return;}
    document.querySelectorAll('[data-update]').forEach(b=>b.disabled=false);
    // A new engine changes the item, talent and loot data the page was built from.
    if(state.status==='complete'&&state.result?.changed)setTimeout(()=>location.reload(),1200);
  }

  document.addEventListener('click',event=>{
    const update=event.target.closest('[data-update]');if(update){start(update.dataset.update);return;}
    if(event.target.closest('[data-check]'))check();
    if(event.target.closest('[data-app-check]'))desktop.checkForUpdates();
    if(event.target.closest('[data-app-install]'))desktop.installUpdate();
  });
  desktop?.onUpdateStatus(update=>{
    const target=$('#app-update');if(!target)return;
    target.textContent=update.message;
    $('[data-app-install]').hidden=update.state!=='downloaded';
  });
  // Resume the view of an update that was running when the page loaded.
  api('/api/engine/update').then(state=>{if(state.status==='running'){document.querySelectorAll('[data-update]').forEach(b=>b.disabled=true);poll();}},()=>{});
  return {render,missing:()=>!status?.engine.ready||!!status?.loadError};
}
