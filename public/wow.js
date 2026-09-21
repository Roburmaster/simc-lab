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
  // Characters read straight out of the game's SavedVariables, beside the field you can still paste into.
  $('#character').insertAdjacentHTML('beforebegin',`<div id="wow-characters" class="wow-characters" hidden>
    <label class="field-label" for="wow-character">CHARACTERS FROM WOW</label>
    <div class="wow-character-row"><select id="wow-character"></select><button id="wow-character-load" class="button small secondary">Load</button></div>
    <p class="hint" id="wow-character-hint"></p></div>`);

  function render(s){
    status=s;
    // One button decides whether the addon is installed at all; while it is, the app keeps it up to date.
    const install=!s.found?'':s.linked?'<p class="notice">The SimCLab folder in AddOns is a link to another location. SimC Lab only writes into a real folder, so remove the link to install from here.</p>'
      :!s.installed?`<button class="button small primary" data-wow-install>Install addon</button><p class="hint">It goes into Interface\\AddOns\\SimCLab, and SimC Lab keeps it up to date from then on.</p>`
      // A waiting update comes either from the app's own copy or from the addon's own release on GitHub.
      :`<div class="wow-buttons">${s.updateAvailable
          ?`<button class="button small primary" ${s.fromGitHub?'data-wow-addon-update':'data-wow-install'}>Update to ${esc(s.newest)}</button>`
          :`<button class="button small secondary" data-wow-install>Reinstall</button>`}<button class="button small wow-remove" data-wow-uninstall>Remove addon</button></div>
        <p class="hint">${s.manage?`Kept up to date automatically: a newer addon is installed when SimC Lab starts.${s.updateAvailable?` Version ${esc(s.newest)} is waiting${s.fromGitHub?' as its own release':''} — press the button to take it now.`:''}`:'Automatic updates are off for this addon. Press Reinstall to let SimC Lab keep it up to date again.'}</p>`;
    const last=s.last?`<p class="hint">${s.last.error?`Automatic send failed: ${esc(s.last.error)}`:`Last sent ${new Date(s.last.time).toLocaleTimeString('en-GB')}: ${esc(s.last.name)} · ${esc(s.last.spec)}${s.last.auto?' (automatic)':''}${s.last.written?'. Type /reload in the game.':'. Install the addon to use it in the game.'}`}</p>`:'';
    $('#wow-status').innerHTML=`<div class="wow-grid">
      <div><span class="field-label">ADDONS FOLDER</span><strong class="wow-path">${esc(s.addons||'Not found')}</strong>${s.found?'':'<p class="hint">World of Warcraft was not found in the registry or the default folders. Install the game, or set SIMC_LAB_WOW_DIR to its _retail_ folder.</p>'}</div>
      <div><span class="field-label">ADDON VERSION</span><strong>${s.installed?`Installed ${esc(s.installed)}`:'Not installed'}</strong><p class="hint">Shipped with this app: ${esc(s.shipped||'none')}${s.updateAvailable?' · update available':''}</p>${install}</div>
    </div>
    <div class="divider"></div>
    <label class="check"><input type="checkbox" id="wow-online" ${s.settings.online?'checked':''}> Look for addon updates on GitHub, so a fix for the game needs no new app version</label>
    <p class="hint wow-online-hint">${s.online?.error?`Last check: ${esc(s.online.error)}`
      :s.online?.version?`The addon's own release is ${esc(s.online.version)}${s.online.tag?` (${esc(s.online.tag)})`:''}, checked ${esc(when(Math.floor(s.online.checked/1000)))}.`
      :s.settings.online?'Checked when SimC Lab starts. Only an addon built for this app\'s data format is installed.':'SimC Lab will only use the addon that came with it.'}
      <button class="text-button" data-wow-addon-check>Check now</button></p>
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
    if(e.target.closest('[data-wow-addon-check]'))act(()=>api('/api/wow/addon-check',{}));
    if(e.target.closest('[data-wow-addon-update]'))act(()=>api('/api/wow/addon-update',{}));
    const uninstall=e.target.closest('[data-wow-uninstall]');if(uninstall)armRemove(uninstall);
    const id=e.target.closest('[data-wow-remove]')?.dataset.wowRemove;if(id)act(()=>api('/api/wow/remove',{id}));
  });
  $('#wow-panel').addEventListener('change',e=>{
    if(e.target.id==='wow-auto')act(()=>api('/api/wow/settings',{autoSend:e.target.checked}));
    if(e.target.id==='wow-online')act(()=>api('/api/wow/settings',{online:e.target.checked}));
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

  // Characters from the game: read on every start, kept fresh while the app is open, loaded into the
  // character field with one choice. The game writes them at logout and /reload.
  let characters=[],signature='';
  const ago=unix=>{
    const seconds=Math.max(0,Math.floor(Date.now()/1000)-unix);
    if(seconds<90)return 'just now';
    if(seconds<5400)return `${Math.round(seconds/60)} minutes ago`;
    if(seconds<172800)return `${Math.round(seconds/3600)} hours ago`;
    return when(unix);
  };
  function describe(c){
    if(!c)return '';
    return `${esc(c.spec||'')} ${esc(c.name)} of ${esc(c.realm)}, captured ${esc(ago(c.time))} by ${esc(c.source)}.${c.checksum===false?' The export\'s checksum does not match, so it may have been edited.':''}`;
  }
  async function load(character,{quiet=false}={}){
    if(!character)return;
    try{await importText(character.text);$('#wow-character-hint').innerHTML=describe(character);}
    catch(e){if(!quiet)notice(e.message);}
  }
  function renderCharacters(data){
    const next=JSON.stringify([data.found,data.installed,data.characters.map(c=>[c.key,c.time]),data.problems.map(p=>[p.reason,p.time])]);
    if(next===signature)return;
    signature=next;characters=data.characters;
    const select=$('#wow-character'),box=$('#wow-characters');
    const chosen=select.value;
    // The list stays on show even while it is empty: it is where characters will appear, and it says
    // what is still missing. Only a machine without World of Warcraft hides it.
    box.hidden=!data.found;
    select.innerHTML=characters.map(c=>`<option value="${esc(c.key)}">${esc(c.name)} · ${esc(c.realm)} · ${esc(c.spec||'')}</option>`).join('')||'<option value="">No characters captured yet</option>';
    select.disabled=!characters.length;
    $('#wow-character-load').disabled=!characters.length;
    if(characters.some(c=>c.key===chosen))select.value=chosen;
    const problem=data.problems[0];
    $('#wow-character-hint').innerHTML=characters.length?describe(characters.find(c=>c.key===select.value))
      :problem?`The game could not build an export for ${esc(problem.name||'your character')}: ${esc(problem.reason)}`
      :!data.installed?'Install the SimCLab addon first, under WoW addon in the menu. Your characters then appear here by themselves.'
      :'Log in on a character. The addon captures it a few seconds later, and the game writes it when you type /reload or log out — then it appears here.';
    return characters.find(c=>c.key===select.value);
  }
  async function refreshCharacters({autoLoad=false}={}){
    try{
      const newest=renderCharacters(await api('/api/wow/captures'));
      // On a fresh start with nothing pasted, the newest character is loaded straight away.
      if(autoLoad&&newest&&!$('#profile').value.trim())await load(newest,{quiet:true});
    }catch{}
  }
  $('#wow-character').addEventListener('change',()=>{
    const c=characters.find(x=>x.key===$('#wow-character').value);
    $('#wow-character-hint').innerHTML=describe(c);
    load(c);
  });
  $('#wow-character-load').addEventListener('click',()=>load(characters.find(c=>c.key===$('#wow-character').value)));
  setInterval(()=>{if(!document.hidden)refreshCharacters();},15000);
  window.addEventListener('focus',()=>refreshCharacters());

  return {refresh,sendButton,characters:refreshCharacters,shown:()=>refresh()};
}
