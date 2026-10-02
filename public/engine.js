const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=iso=>iso?new Date(iso).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'Unknown';
const kinds={nightly:'Official nightly build',source:'Built from source'};
// The steps of an update (phasePlans in lib/updater.mjs), in the words the engine panel uses.
const phaseLabels={check:'Check versions',download:'Download SimC',tools:'Build tools',fetch:'Fetch SimC source',configure:'Configure build',compile:'Compile SimC',verify:'Test the new engine',wait:'Wait for running simulations',switch:'Game data and switch'};
const clock=seconds=>{seconds=Math.max(0,Math.round(seconds));const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}:${String(s).padStart(2,'0')}`;};
const since=iso=>iso?(Date.now()-new Date(iso))/1000:0;
const store={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}}};

// Engine and app updates. SimC is installed only when the user clicks: the server looks for a newer build at start
// and every few hours, and this page says so in a banner (and, in the desktop app, a system notification).
export function engineUI({api,notice}){
  let status=null,polling=null,settings={},state={};
  api('/api/settings').then(s=>{settings=s;if(status)render(status);},()=>{});
  const desktop=window.simcDesktop;
  $('#workspace').insertAdjacentHTML('beforebegin',`<section id="setup-panel" class="panel setup-panel" hidden><div class="info-symbol">⇪</div><div><h2>Install SimulationCraft</h2><p>SimC Lab needs the SimulationCraft engine and current game data. One click downloads the newest official build that matches your World of Warcraft version. If no matching build exists yet, SimC is built from source, and missing build tools are installed first.</p><button class="button primary setup-button" data-update="auto">Install SimC <span>→</span></button><div class="update-progress" data-progress></div></div></section>
    <section id="update-banner" class="panel setup-panel update-banner" hidden aria-live="polite"></section>`);
  $('.sidebar-bottom').insertAdjacentHTML('beforeend','<button class="button small secondary sidebar-update" data-update="auto">Update SimC</button>');
  // Linux has no official builds, and a Windows install can choose to follow the latest commit: both build from source.
  const follow=()=>(status?.app?.platform&&status.app.platform!=='win32')||!!settings.followLatestCommit;

  function render(s){
    status=s;const e=s.engine;
    const linux=s.app?.platform&&s.app.platform!=='win32';
    const following=follow();
    if(linux)$('#setup-panel p').textContent='SimC Lab needs the SimulationCraft engine and current game data. On Linux SimC is built from source (20–40 minutes the first time); Git, CMake, a C++ compiler and libcurl must be installed, and the en_US.UTF-8 locale (Ubuntu: sudo apt install git cmake build-essential libcurl4-openssl-dev && sudo locale-gen en_US.UTF-8).';
    $('#engine-detail').innerHTML=`<p>Installed WoW<br><strong>${esc(e.installed||'Not found')}</strong></p>
      <p>SimulationCraft<br><strong>${esc(e.version||'Not installed')}</strong>${e.wowVersion?` · WoW ${esc(e.wowVersion)}`:''}<br>${esc(kinds[e.source]||'Built from source')}${e.commitDate?` · ${when(e.commitDate)}`:''}</p>
      <p>Commit<br><code>${esc(e.commit||'—')}</code></p>
      <div class="engine-actions"><button class="button small primary" data-update="auto">${following?'Update to latest commit':'Update SimC'}</button>${following?'':'<button class="button small secondary" data-update="source">Update to latest commit</button>'}<button class="button small secondary" data-check>Check for updates</button></div>
      <p class="hint">${following?'Update to latest commit fetches the newest SimC commit on GitHub and compiles only what changed.':'Update SimC installs the newest official build (a day behind GitHub at most). Update to latest commit builds the newest GitHub commit from source instead.'}</p>
      <p class="hint" id="engine-auto-note">${autoNote()}</p>
      ${linux?'':`<label class="check"><input type="checkbox" id="follow-latest-commit" ${settings.followLatestCommit?'checked':''}>Follow the latest SimC commit</label><p class="hint">Updates build the newest GitHub commit from source instead of waiting for the next official build (a day at most), and the notice comes for every new commit. The first build takes 20–40 minutes; after that only what changed is compiled.</p>`}
      <div id="engine-check" class="hint"></div><div class="update-progress" data-progress></div>
      <details><summary>Advanced</summary><p class="hint">${linux?'Build from source downloads the SimC source and compiles it with the system’s Git, CMake and C++ compiler. It needs about 8 GB and takes 20–40 minutes; SIMC_LAB_BUILD_JOBS limits the compiler jobs on a small machine.':'Build from source downloads the SimC source and compiles it. The first build installs Git, CMake and the Visual Studio C++ tools with winget, needs about 8 GB and takes 20–40 minutes.'}</p><p class="hint">Build from source (clean) empties the build folder and compiles all of SimC again: for when a build has gone wrong.</p><div class="engine-actions"><button class="button small secondary" data-update="rebuild">Build from source (clean)</button><button class="button small secondary" data-update="data">Refresh game data only</button></div>
        <p class="hint">Install one exact SimC commit, to compare with a result made on it (Trinket Lab's Bloodmallet parity check). It must be for the WoW build you have installed; the next ordinary update moves on again.</p><div class="engine-actions"><input id="engine-pin" type="text" placeholder="SimC commit, e.g. a69b069" spellcheck="false" autocomplete="off"><button class="button small secondary" data-pin>Install this commit</button></div></details>
      ${desktop?`<div class="divider"></div><p>SimC Lab<br><strong>${esc(s.app?.version||'')}</strong></p><div class="engine-actions"><button class="button small secondary" data-app-check>Check for app updates</button><button class="button small primary" data-app-install hidden>Restart and update</button></div><div class="hint" id="app-update"></div>`:''}`;
    const missing=!e.ready||!!s.loadError;
    $('#setup-panel').hidden=!missing;
    $('.engine-details').open=missing||$('.engine-details').open;
    apply(state);
  }
  function autoNote(){
    const c=state.lastCheck;
    return 'SimC is only updated when you click. SimC Lab looks for a newer build at start and every 3 hours and tells you at the top of the page. Simulations keep running on the current engine while an update downloads or compiles; it is switched in when they are done.'
      +(c?` Last check ${esc(when(c.checkedAt))}: ${esc(c.error||c.reason)}`:'');
  }
  function sidebar(){
    const side=document.querySelector('.sidebar-update');if(!side)return;
    side.textContent=state.status==='running'?'Updating SimC …':`${follow()?'Update to latest commit':'Update SimC'}${state.available?' •':''}`;
    side.classList.toggle('has-update',!!state.available&&state.status!=='running');
  }

  // A newer build: say what it is and offer it, once per build unless the user brings it back with Check.
  function banner(){
    const a=state.available,el=$('#update-banner');
    const show=!!a&&state.status!=='running'&&store.get('simc-lab-update-dismissed')!==a.key&&!!status?.engine?.ready;
    el.hidden=!show;if(!show)return;
    const what=a.action==='data'?`New game data for WoW ${a.wowVersion||''}`:a.action==='source'?`A newer SimC commit${a.commit?` (${a.commit.slice(0,7)})`:''}`:`A newer official SimC build${a.version?` (${a.version}${a.commit?` · ${a.commit.slice(0,7)}`:''})`:''}`;
    const behind=Number.isFinite(a.behind)&&a.behind>0?` Your SimC is ${a.behind} commit${a.behind===1?'':'s'} behind GitHub.`:'';
    const cost=a.action==='source'?' It is built from source; after the first build only what changed is compiled.':a.action==='nightly'?' A download of a few minutes.':' A short download.';
    el.innerHTML=`<div class="info-symbol">⇪</div><div><h2>${esc(what)} is out</h2><p>${esc(a.reason)}${behind}${cost} Your simulations keep running on the current engine until it is switched in.${a.date?` Published ${esc(when(a.date))}.`:''}</p><div class="engine-actions"><button class="button small primary" data-update="auto">Update now</button><button class="button small secondary" data-dismiss-update>Not now</button></div></div>`;
    // The desktop app also tells the system, once per build.
    if(desktop&&'Notification' in window&&store.get('simc-lab-update-notified')!==a.key){store.set('simc-lab-update-notified',a.key);try{new Notification('SimC Lab',{body:`${what} is out. Open SimC Lab to update.`});}catch{}}
  }

  // Where a running update is: every step in order with the current one marked, how long it has run, and its own
  // progress where SimC or the download tells it (bytes, compiled files or make's percentage).
  function progress(){
    const s=state,phases=s.phases||[],current=phases.indexOf(s.phase);
    let html='';
    if(s.status==='running'||((s.status==='complete'||s.status==='failed')&&s.log?.length)){
      const failedAt=s.status==='failed'?Math.max(0,phases.indexOf(s.failedPhase)):-1;
      const steps=phases.map((id,i)=>{
        const done=s.status==='complete'||(s.status==='running'&&i<current)||(s.status==='failed'&&i<failedAt);
        const cls=done?'done':s.status==='running'&&i===current?'current':i===failedAt?'failed':'';
        return `<li class="${cls}"><span>${done?'✓':i===failedAt?'!':i+1}</span>${esc(phaseLabels[id]||id)}</li>`;
      }).join('');
      const p=s.progress;let bar='',part='';
      if(s.status==='running'&&p){
        const fraction=p.unit==='percent'?p.percent/100:p.total?p.done/p.total:0;
        part=p.unit==='bytes'?`${(p.done/1048576).toFixed(0)} of ${(p.total/1048576).toFixed(0)} MB`:p.unit==='files'?`${p.done} of up to ${p.total} files compiled`:`${p.percent}%`;
        bar=`<div class="progress-track live"><div class="progress-fill" style="width:${Math.round(100*Math.min(1,fraction))}%"></div></div>`;
      }
      const head=s.status==='running'?`<strong>Step ${Math.max(1,current+1)} of ${phases.length}: ${esc(phaseLabels[s.phase]||'Starting')}</strong> · ${clock(since(s.phaseStarted))} in this step · ${clock(since(s.started))} in all${part?` · ${part}`:''}`
        :s.status==='complete'?`<strong>${esc(s.result?.changed?'Update installed.':s.result?.reason||'Nothing to install.')}</strong>${s.started&&s.finished?` · took ${clock((new Date(s.finished)-new Date(s.started))/1000)}`:''}`
        :'<strong>The update failed.</strong>';
      const hint=s.status!=='running'?'':s.phase==='wait'?'The new engine is ready. It is switched in when the simulations running now are done.':s.phase==='switch'?'Switching engines: new simulations can start again in a moment.':'You can keep simulating meanwhile; jobs use the current engine.';
      html=`<ol class="update-steps">${steps}</ol><div class="update-now">${head}</div>${bar}${hint?`<p class="hint">${hint}</p>`:''}${s.status==='failed'?`<p class="notice">${esc(s.error)}</p>`:''}<details class="update-log"${s.status==='failed'?' open':''}><summary>Log</summary><pre>${esc((s.log||[]).slice(-14).join('\n'))}${s.detail&&s.status==='running'?'\n'+esc(s.detail):''}</pre></details>`;
    }
    document.querySelectorAll('[data-progress]').forEach(el=>el.innerHTML=html);
  }

  function apply(next){
    const was=state.status;state=next||{};
    document.querySelectorAll('[data-update]').forEach(b=>b.disabled=state.status==='running');
    sidebar();banner();progress();
    const note=$('#engine-auto-note');if(note)note.innerHTML=autoNote();
    // A new engine changes the item, talent and loot data the page was built from.
    if(was==='running'&&state.status==='complete'&&state.result?.changed)setTimeout(()=>location.reload(),1500);
  }

  async function check(){
    const target=$('#engine-check');target.textContent='Checking SimC, WoW and game data …';
    try{
      const c=await api('/api/engine/check',{});
      const lines=[c.decision.reason];
      if(Number.isFinite(c.local?.behind))lines.push(!c.local.behind?'Installed SimC is the newest commit on GitHub.':c.nightly?.sha===c.local.commit?`GitHub has ${c.local.behind} newer commit${c.local.behind===1?'':'s'} (${c.head.branch}) that no official build contains yet; the next nightly will. Build from source takes them now.`:`Installed SimC ${String(c.local.commit).slice(0,7)} is ${c.local.behind} commit${c.local.behind===1?'':'s'} behind GitHub (${c.head.branch}).`);
      if(c.nightly)lines.push(`Newest official build: ${c.nightly.version} for WoW ${c.nightly.wowVersion} (${when(c.nightly.date)})`);
      if(c.head)lines.push(`Newest source: ${c.head.sha.slice(0,7)} for WoW ${c.head.wowVersion} (${when(c.head.date)})`);
      if(c.live)lines.push(`Game data: WoW ${c.live.wowBuild}`);
      for(const err of c.errors)lines.push(err);
      target.innerHTML=lines.map(esc).join('<br>');
      // Checking by hand brings back a banner that was put off.
      store.set('simc-lab-update-dismissed','');
      apply(await api('/api/engine/update'));
    }catch(err){target.textContent=err.message;}
  }

  async function start(mode,sha){
    try{await api('/api/engine/update',{mode,...(sha?{sha}:{})});}catch(err){notice(err.message);return;}
    poll();
  }
  async function poll(){
    clearTimeout(polling);
    let next;try{next=await api('/api/engine/update');}catch{polling=setTimeout(poll,2000);return;}
    apply(next);
    // Every second while an update runs; otherwise once a minute, to show what the server's own check found (and
    // sooner until its first check at start is done).
    polling=setTimeout(poll,state.status==='running'?1000:state.lastCheck?60000:5000);
  }

  document.addEventListener('change',async event=>{
    if(event.target.id!=='follow-latest-commit')return;
    try{settings=await api('/api/settings',{followLatestCommit:event.target.checked});if(status)render(status);}catch(err){notice(err.message);event.target.checked=!event.target.checked;}
  });
  document.addEventListener('click',event=>{
    const update=event.target.closest('[data-update]');if(update){start(update.dataset.update);return;}
    if(event.target.closest('[data-dismiss-update]')){if(state.available)store.set('simc-lab-update-dismissed',state.available.key);banner();return;}
    if(event.target.closest('[data-check]'))check();
    if(event.target.closest('[data-pin]')){const sha=$('#engine-pin').value.trim();if(sha)start('source',sha);}
    if(event.target.closest('[data-app-check]'))desktop.checkForUpdates();
    if(event.target.closest('[data-app-install]'))desktop.installUpdate();
  });
  desktop?.onUpdateStatus(update=>{
    const target=$('#app-update');if(!target)return;
    target.textContent=update.message;
    $('[data-app-install]').hidden=update.state!=='downloaded';
  });
  // The step clock keeps moving between polls.
  setInterval(()=>{if(state.status==='running')progress();},1000);
  poll();
  return {render,missing:()=>!status?.engine.ready||!!status?.loadError};
}
