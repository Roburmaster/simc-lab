// The WoW addon panel, the Send to WoW action on results, and Import from WoW for the character field.
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=unix=>unix?new Date(unix*1000).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'Unknown';
const sendable={upgrades:'Upgrade Finder',talents:'Talent Search',compare:'Gear Compare'};

export function wowUI({api,notice,importText}){
  let status=null;
  $('#history').insertAdjacentHTML('afterend',`<section id="wow-panel" class="panel" hidden><div class="panel-heading"><h2>SimCLab addon</h2><button id="wow-refresh" class="text-button">Refresh</button></div>
    <p class="panel-intro">The SimCLab addon shows your latest sims in the game: a results window (/simclab), the gear farm from Upgrade Finder on the Encounter Journal and at dungeon entrances, simulated gains in item tooltips, and the best choice in the Great Vault and loot rolls. The app installs it, keeps it up to date and writes its data file. After sending, type /reload in the game.</p>
    <div id="wow-status"><p class="hint">Looking for World of Warcraft …</p></div></section>`);
  $('#example').insertAdjacentHTML('beforebegin','<button id="wow-import" class="text-button">Import from WoW ↙</button>');
  $('#character').insertAdjacentHTML('beforebegin','<div id="wow-captures" class="wow-captures" hidden></div>');

  function render(s){
    status=s;
    // One button decides whether the addon is installed at all; while it is, the app keeps it up to date.
    const install=!s.found?'':s.linked?'<p class="notice">The SimCLab folder in AddOns is a link to another location. SimC Lab only writes into a real folder, so remove the link to install from here.</p>'
      :!s.installed?`<button class="button small primary" data-wow-install>Install addon</button><p class="hint">It goes into Interface\\AddOns\\SimCLab, and SimC Lab keeps it up to date from then on.</p>`
      :`<div class="wow-buttons">${s.updateAvailable?`<button class="button small primary" data-wow-install>Update to ${esc(s.shipped)}</button>`:`<button class="button small secondary" data-wow-install>Reinstall</button>`}<button class="button small wow-remove" data-wow-uninstall>Remove addon</button></div>
        <p class="hint">${s.manage?`Kept up to date automatically: a newer addon is installed when SimC Lab starts.${s.updateAvailable?' This one is waiting for a restart, or press the button now.':''}`:'Automatic updates are off for this addon. Press Reinstall to let SimC Lab keep it up to date again.'}</p>`;
    const last=s.last?`<p class="hint">${s.last.error?`Automatic send failed: ${esc(s.last.error)}`:`Last sent ${new Date(s.last.time).toLocaleTimeString('en-GB')}: ${esc(s.last.name)} · ${esc(s.last.spec)}${s.last.auto?' (automatic)':''}${s.last.written?'. Type /reload in the game.':'. Install the addon to use it in the game.'}`}</p>`:'';
    $('#wow-status').innerHTML=`<div class="wow-grid">
      <div><span class="field-label">ADDONS FOLDER</span><strong class="wow-path">${esc(s.addons||'Not found')}</strong>${s.found?'':'<p class="hint">World of Warcraft was not found in the registry or the default folders. Install the game, or set SIMC_LAB_WOW_DIR to its _retail_ folder.</p>'}</div>
      <div><span class="field-label">ADDON VERSION</span><strong>${s.installed?`Installed ${esc(s.installed)}`:'Not installed'}</strong><p class="hint">Shipped with this app: ${esc(s.shipped||'none')}${s.updateAvailable?' · update available':''}</p>${install}</div>
    </div>
    <div class="divider"></div>
    <label class="check"><input type="checkbox" id="wow-auto" ${s.settings.autoSend?'checked':''}> Send to WoW automatically after each Upgrade Finder, Talent Search and Gear Compare job</label>
    <div class="two-col wow-keep"><label>Sims kept per character and specialization<select id="wow-keep">${Array.from({length:s.limits.keep[1]-s.limits.keep[0]+1},(_,i)=>i+s.limits.keep[0]).map(n=>`<option value="${n}" ${n===s.settings.keep?'selected':''}>${n}</option>`).join('')}</select></label></div>
    ${last}
    <h3 class="wow-heading">In the game</h3>
    ${s.sent.length?`<table class="result-table"><thead><tr><th>Character</th><th>Sim</th><th>Results</th><th></th></tr></thead><tbody>${s.sent.map(r=>`<tr><td>${esc(r.name)} <small>${esc(r.realm)} · ${esc(r.spec)}</small></td><td>${esc(r.title)}<small>${esc(when(r.created))} · ${r.scenarios} scenario${r.scenarios===1?'':'s'}</small></td><td>${r.results}</td><td><button class="text-button" data-wow-remove="${esc(r.id)}">Remove</button></td></tr>`).join('')}</tbody></table>`:'<p class="empty-small">Nothing sent yet. Open an Upgrade Finder, Talent Search or Gear Compare result and choose Send to WoW.</p>'}
    <details class="log-details"><summary>Import without copy-paste</summary><p class="hint">With the official SimulationCraft addon installed, SimCLab stores its /simc export whenever you log out or /reload, and Import from WoW (in the Character panel) reads it from the game's SavedVariables. SimCLab does not build its own export: SimulationCraft's addon is updated with every patch for new gear, talent and upgrade systems, and a second exporter would drift from it. Type /simclab capture to store the export right away, then /reload.</p></details>`;
  }
  async function refresh(){try{render(await api('/api/wow'));}catch(e){$('#wow-status').innerHTML=`<p class="notice">${esc(e.message)}</p>`;}}
  async function act(fn){try{notice('');render(await fn());}catch(e){notice(e.message);}}

  // Removing deletes files in the game folder, so it takes a second click.
  let confirming=null;
  function armRemove(button){
    clearTimeout(confirming);
    if(button.dataset.armed){act(()=>api('/api/wow/uninstall',{}));return;}
    button.dataset.armed='1';button.textContent='Remove addon — click again';
    confirming=setTimeout(()=>{delete button.dataset.armed;button.textContent='Remove addon';},5000);
  }
  $('#wow-panel').addEventListener('click',e=>{
    if(e.target.closest('#wow-refresh'))refresh();
    if(e.target.closest('[data-wow-install]'))act(()=>api('/api/wow/install',{}));
    const uninstall=e.target.closest('[data-wow-uninstall]');if(uninstall)armRemove(uninstall);
    const id=e.target.closest('[data-wow-remove]')?.dataset.wowRemove;if(id)act(()=>api('/api/wow/remove',{id}));
  });
  $('#wow-panel').addEventListener('change',e=>{
    if(e.target.id==='wow-auto')act(()=>api('/api/wow/settings',{autoSend:e.target.checked}));
    if(e.target.id==='wow-keep')act(()=>api('/api/wow/settings',{keep:Number(e.target.value)}));
  });

  // Results: one button per finished job of a mode the addon understands.
  $('#result-content').addEventListener('click',async e=>{
    const button=e.target.closest('[data-wow-send]');if(!button)return;
    button.disabled=true;const out=button.parentElement.querySelector('.wow-send-result');
    try{const r=await api('/api/wow/send',{job:button.dataset.wowSend});out.textContent=r.written?`Sent. Type /reload in the game.${r.dropped?` ${r.dropped} older sim${r.dropped===1?' was':'s were'} dropped to keep the file small.`:''}`:'Saved. Install the addon under WoW addon to see it in the game.';status=null;}
    catch(err){out.textContent=err.message;}finally{button.disabled=false;}
  });
  function sendButton(job){
    if(!sendable[job.mode]||!['complete','partial'].includes(job.status))return '';
    return `<div class="wow-send"><button class="button small secondary" data-wow-send="${esc(job.id)}">Send to WoW</button><span class="wow-send-result hint"></span></div>`;
  }

  // Import from WoW: captured /simc exports, newest first.
  $('#wow-import').addEventListener('click',async()=>{
    const box=$('#wow-captures');
    try{
      const list=await api('/api/wow/captures');
      box.hidden=false;
      box.innerHTML=list.length?`<p class="hint">Exports captured in the game (newest first). The export is refreshed on every logout and /reload.</p>${list.map((c,i)=>`<button class="history-row" data-capture="${i}"><span><strong>${esc(c.name)}</strong><small>${esc(c.realm)} · ${esc(c.spec)} · ${esc(when(c.time))} · account ${esc(c.account)}${c.checksum===false?' · checksum does not match':''}</small></span><span class="pill">Use</span></button>`).join('')}<button class="text-button" data-capture-close>Close</button>`
        :`<p class="hint">No captured exports yet. Install the SimCLab addon (WoW addon in the menu) and the official SimulationCraft addon, log in, then /reload or log out. The export is stored in the game's SavedVariables.</p><button class="text-button" data-capture-close>Close</button>`;
      box.onclick=async ev=>{
        if(ev.target.closest('[data-capture-close]')){box.hidden=true;return;}
        const i=ev.target.closest('[data-capture]')?.dataset.capture;if(i===undefined)return;
        try{await importText(list[Number(i)].text);box.hidden=true;}catch(err){notice(err.message);}
      };
    }catch(e){notice(e.message);}
  });

  return {refresh,sendButton,shown:()=>refresh()};
}
