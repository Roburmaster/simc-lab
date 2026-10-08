import {itemLink,importedCards} from '/items.js';
import {environmentUI} from '/environment.js';
import {featureUI} from '/features.js';
import {upgradeUI} from '/upgrades.js';
import {crestUI} from '/crests.js';
import {vaultUI} from '/vault.js';
import {weaponUI} from '/weapons.js';
import {trinketUI} from '/trinkets.js';
import {tankUI,signed} from '/tank.js';
import {engineUI} from '/engine.js';
import {activityUI,describeProgress,duration} from '/activity.js';
import {wowUI} from '/wow.js';
import {logsUI,rotationView} from '/logs.js';
import {mplusUI,routeStyle} from '/mplus.js';
// The Silvermoon dummies are always five, measured from a combat log beside them (lib/dummies.mjs).
const dummyStyles={
  SilvermoonDummies:'Five Cleave Training Dummies stacked together, 3,537,050 health each and level 90, as measured in Silvermoon. They cannot die. Held: they sit at 1% the whole fight, as busy dummies in the city do, so execute is always up. From 100%: four short runs first measure how fast your damage takes each dummy down, then each one falls from 100% to 1% at that pace and stays there. Every raid buff, target debuff, Bloodlust and consumable starts off; turn on under Buffs what you had.'
};
import {armoryUI} from '/armory.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const labels={head:'Head',neck:'Neck',shoulder:'Shoulders',back:'Back',chest:'Chest',wrist:'Wrists',hands:'Hands',waist:'Waist',legs:'Legs',feet:'Feet',finger1:'Ring 1',finger2:'Ring 2',main_hand:'Main hand',off_hand:'Offhand'};
const modes={logs:['Log Analysis','Read a combat log and see what your rotation did, and what to change.'],quick:['Quick Sim','Import your character. Find out what your gear can do.'],enchants:['Enchant Lab','Test Midnight enchants, ranks and combinations on your character.'],compare:['Gear Compare','Compare current-expansion gear, gems, talents and consumables.'],upgrades:['Upgrade Finder','Search raid, Mythic+, Great Vault, delve and crafted loot for your best simulated upgrades.'],crests:['Crest Planner','Find which equipped item to upgrade first with the crests you have.'],vault:['Great Vault','Simulate every choice in your Great Vault and see which one to take.'],weapons:['Weapon Lab','Rank this season’s weapons, off-hands and shields for every specialization at one item level.'],trinkets:['Trinket Lab','Find the best two trinkets for every specialization, per raid and Mythic+ scenario.'],talents:['Talent Search','Automatically generate legal builds and find the strongest tested talents for your gear.'],history:['History','Open previous results and download complete SimC reports.'],wow:['WoW addon','Bring your sims and gear farm into the game.']};
const states={queued:'Queued',running:'Running',complete:'Complete',partial:'Partially complete',failed:'Failed',cancelled:'Cancelled',interrupted:'Interrupted on restart'};
let token='',engine=null,mode='quick',profile=null,importedText='',selections={},currentJob=null,pollTimer=null,previewTimer=null;
let variants=[{name:'Alternative 1',text:''}];
async function api(url,data){const res=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-SimC-Token':token},body:JSON.stringify(data)});const result=await res.json();if(!res.ok)throw new Error(result.error||'The request failed.');return result;}
function notice(message){$('#notice').hidden=!message;$('#notice').textContent=message||'';}
function safeStore(key,value){try{localStorage.setItem(key,value);}catch{}}
async function setMode(value){mode=value;$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.mode===value));$('#page-title').innerHTML=`${esc(modes[value][0])}<span class="accent">.</span>`;$('#breadcrumb').textContent=modes[value][0];$('#page-description').textContent=modes[value][1];$('#workspace').hidden=['history','wow','logs'].includes(value);$('#history').hidden=value!=='history';$('#logs-panel').hidden=value!=='logs';if(value==='logs')logs.show();$('#wow-panel').hidden=value!=='wow';$('#enchant-panel').hidden=value!=='enchants';$('#compare-panel').hidden=value!=='compare';$('#quick-info').hidden=value!=='quick';$('#talent-panel').hidden=value!=='talents';$('#upgrade-panel').hidden=value!=='upgrades';$('#crest-panel').hidden=value!=='crests';$('#vault-panel').hidden=value!=='vault';$('#weapon-panel').hidden=value!=='weapons';$('#trinket-panel').hidden=value!=='trinkets';
  // Weapon Lab and Trinket Lab run on SimC's reference profiles, so they hide the character panel and always offer tank settings.
  const lab=['weapons','trinkets'].includes(value);
  // Trinket Lab carries every setting it uses in its own panel, so the rest of the app's settings are out of sight.
  document.body.classList.toggle('clean-lab',value==='trinkets');
  $('.import-panel').hidden=lab;tank.forWeapons(value==='weapons');syncTankStyles();
  if(value==='history')await loadHistory();else if(value==='wow')await wow.refresh();else updateCount();}
$$('.nav').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode).catch(e=>notice(e.message))));
async function importProfile(){notice('');const text=$('#profile').value;const parsed=await api('/api/import',{profile:text});profile=parsed;importedText=text;selections={};safeStore('simc-lab-profile',text);$('#character').hidden=false;$('#character').innerHTML=`<span class="character-icon">◈</span><div><strong>${esc(parsed.info.name)}</strong><p>${esc(parsed.info.race)} · ${esc(parsed.info.spec)} ${esc(parsed.info.class)} · Level ${esc(parsed.info.level)}</p></div>${parsed.armory?'<span class="pill" title="Imported from the Armory. Not sent to the WoW addon.">Armory</span>':''}<span class="pill">${Object.keys(parsed.gear).length} gear slots</span>`;$('#import-status').textContent=`Imported · ${Object.keys(parsed.gear).length} gear slots · ready to simulate`;renderEnchants();renderImportedChoices();features.render(parsed);crests.show(parsed);tank.show(parsed);syncTankStyles();updateCount();return parsed;}
$('#import').addEventListener('click',async()=>{try{$('#import').disabled=true;await importProfile();}catch(e){notice(e.message);}finally{$('#import').disabled=false;}});
$('#profile').addEventListener('input',()=>{$('#import-status').textContent='The profile changed. Import it again before selecting enchants.';profile=null;selections={};$('#character').hidden=true;renderEnchants();updateCount();});
$('#example').addEventListener('click',async()=>{try{$('#profile').value=(await api('/api/example')).text;await importProfile();$('#import-status').textContent='SimC example: MID2 Frost Mage. Replace it with your own /simc export.';}catch(e){notice(e.message);}});
function renderEnchants(){
  if(!profile){$('#enchant-slots').innerHTML='<p class="empty-small">Import a character to select enchants.</p>';return;}
  const query=$('#enchant-search').value.toLowerCase(),rank=$('#rank-filter').value;
  const opened=new Set($$('.slot[open]').map(el=>el.dataset.slot));
  $('#enchant-slots').innerHTML=Object.entries(profile.gear).filter(([,item])=>item.enchants.length).map(([slot,item])=>{
    const chosen=selections[slot]||[];
    const enchantList=item.enchants.filter(e=>chosen.includes(e.id) || ((!query||`${e.label} ${e.id}`.toLowerCase().includes(query))&&(rank==='all'||e.rank===Number(rank)))).sort((a,b)=>b.id-a.id);
    if(query&&!enchantList.length&&!chosen.length)return '';
    const equipped=item.enchants.find(e=>e.id===item.enchantId)?.label || (item.value.match(/(?:^|,)enchant=([^,]+)/)?.[1]) || (item.enchantId?`ID ${item.enchantId}`:'No enchant');
    const options=[{id:0,label:'No enchant'},...enchantList];
    return `<details class="slot" data-slot="${esc(slot)}" open><summary><span><strong>${esc(labels[slot]||slot)} <small>${itemLink(item.id,item.item?.name||`Item ${item.id}`,item.value)}</small></strong><small>Equipped: ${esc(equipped)}</small></span><span class="pill">${chosen.length} selected</span></summary><div class="slot-actions"><button class="text-button" data-clear-enchants="${slot}">Clear selections</button></div><div class="slot-options">${options.map(e=>`<label class="enchant-option"><input type="checkbox" data-slot="${slot}" data-enchant="${e.id}" ${chosen.includes(e.id)?'checked':''}><span>${e.itemId?itemLink(e.itemId,e.label):esc(e.label)}${e.id?`<small>Enchant ID ${e.id}</small>`:''}</span></label>`).join('')}</div></details>`;
  }).join('') || '<p class="empty-small">No enchants match this search or gear.</p>';
}
$('#enchant-slots').addEventListener('change',event=>{const el=event.target;if(!el.matches('[data-enchant]'))return;const slot=el.dataset.slot,id=Number(el.dataset.enchant);selections[slot]||=[];selections[slot]=el.checked?[...new Set([...selections[slot],id])]:selections[slot].filter(x=>x!==id);el.closest('.slot').querySelector('.pill').textContent=`${selections[slot].length} selected`;updateCount();});
for(const sel of ['#enchant-search','#rank-filter'])$(sel).addEventListener('input',renderEnchants);
function renderVariants(){$('#variants').innerHTML=variants.map((v,i)=>`<div class="variant" data-index="${i}"><div class="variant-top"><input aria-label="Variant name ${i+1}" data-field="name" value="${esc(v.name)}" maxlength="160"><button class="remove" data-remove="${i}" aria-label="Remove variant ${i+1}">Remove</button></div><textarea data-field="text" aria-label="SimC changes for variant ${i+1}" spellcheck="false" placeholder="finger1=,id=123456,enchant_id=8021&#10;talents=…&#10;flask=…">${esc(v.text)}</textarea></div>`).join('');}
$('#add-variant').addEventListener('click',()=>{variants.push({name:`Alternative ${variants.length+1}`,text:''});renderVariants();updateCount();});
$('#variants').addEventListener('input',event=>{const el=event.target;if(el.dataset.field){variants[Number(el.closest('.variant').dataset.index)][el.dataset.field]=el.value;updateCount();}});
$('#variants').addEventListener('click',event=>{if(event.target.dataset.remove!==undefined){variants.splice(Number(event.target.dataset.remove),1);renderVariants();updateCount();}});
function request(){if(mode==='trinkets')return trinkets.request();const targets=Number($('#targets').value);const scenarioTargets=dummyStyles[$('#fight-style').value]?[5]:$('#matrix').checked?[...new Set([targets,3,5])]:[targets];const route=$('#fight-style').value===routeStyle;return {profile:$('#profile').value,mode,enchants:selections,combine:$('input[name=combine]:checked').value==='true',talentSearch:features.settings(),upgrades:upgrades.settings(),crests:crests.settings(),vault:vault.settings(),weapons:weapons.settings(),trinkets:trinkets.settings(),tank:tank.settings(),environment:environment.settings(),variants,iterations:Number($('#iterations').value),targetError:Number($('#target-error').value),duration:Number($('#duration').value),threads:Number($('#threads').value),scenarios:route?mplus.scenarios():scenarioTargets.map(n=>({style:$('#fight-style').value,targets:n,...(dummyStyles[$('#fight-style').value]?{dummyHealth:{mode:$('#dummy-health').value}}:{}),...($('#bleed-tail-on').checked?{bleedTail:Number($('#bleed-tail').value)}:{})}))};}
function updateCount(){
  syncGearSelection();
  const groups=Object.values(selections).filter(v=>v.length);const count=groups.reduce((n,v)=>n+v.length,0);$('#selection-count').textContent=`${count} selected`;
  const combined=$('input[name=combine]:checked').value==='true';$('#combine-help').textContent=combined?'Combine every selected alternative across slots. Equipped gear runs separately as the baseline.':'Compare each enchant against your equipped gear. Other slots stay unchanged.';
  let n=mode==='enchants'?1+(combined&&groups.length?groups.reduce((n,v)=>n*v.length,1):count):mode==='compare'?1+variants.length:mode==='talents'?1+Number($('#talent-budget').value):mode==='upgrades'?2:1;
  n*=request().scenarios.length;$('#run-summary').textContent=profile?'Includes equipped baseline':'Waiting for character import';$('#run-count').textContent=profile?`${n} run${n===1?'':'s'}`:'';
  clearTimeout(previewTimer);
  if(mode==='crests'){$('#run-summary').textContent=profile?'Every upgrade level in one run per scenario':'Waiting for character import';crests.count(request,!!profile);}
  if(mode==='vault'){$('#run-summary').textContent=profile?'Every vault choice in one run per scenario':'Waiting for character import';vault.count(request,!!profile);}
  if(mode==='upgrades'){$('#run-summary').textContent=profile?'Screening + final round per scenario':'Waiting for character import';upgrades.count(request,!!profile);}
  // Weapon Lab needs no import: the reference profiles are always there, so the run summary never waits for one.
  if(mode==='weapons'){$('#run-summary').textContent='One tier list per specialization';$('#run-count').textContent='';weapons.count(request);}
  if(mode==='trinkets'){$('#run-summary').textContent='One trinket chart per specialization';$('#run-count').textContent='';trinkets.count(request);}
}
const mplus=mplusUI({api,notice,onChange:()=>updateCount()});
const styleNames={SilvermoonDummies:'Silvermoon dummies'};
// SimC's Dungeon Slice is one boss for six minutes whatever it is told, so those two fields are locked and show it.
const sliceNote='Dungeon Slice is a 6 minute slice of an M+ dungeon with one boss. SimC sets the duration and the target count itself, so those fields are locked.';
let beforeSlice=null;
// Nothing in Dungeon Slice attacks the tank, so a tank specialization has no survival to measure there: the choice is off
// for an imported tank (the labs run their own fights and are left alone).
function syncTankStyles(){
  const option=[...$('#fight-style').options].find(o=>o.value==='DungeonSlice');if(!option)return;
  const off=!!profile?.isTank&&!['weapons','trinkets'].includes(mode);
  option.disabled=off;option.title=off?'Not available for tank specializations: nothing in this fight attacks the tank.':'';
  if(off&&$('#fight-style').value==='DungeonSlice'){$('#fight-style').value='Patchwerk';syncFightStyle();}
}
function syncFightStyle(){
  const note=dummyStyles[$('#fight-style').value],route=$('#fight-style').value===routeStyle,slice=$('#fight-style').value==='DungeonSlice';
  if(slice&&!beforeSlice){beforeSlice={targets:$('#targets').value,duration:$('#duration').value};$('#targets').value=1;$('#duration').value=360;}
  else if(!slice&&beforeSlice){$('#targets').value=beforeSlice.targets;$('#duration').value=beforeSlice.duration;beforeSlice=null;}
  $('#targets').disabled=!!note||route||slice;$('#matrix').disabled=!!note||route||slice;if(note)$('#targets').value=5;$('#dummy-health-label').hidden=!note;
  // A Mythic+ route is as long as its pulls take, and its targets are the pulls' mobs.
  $('#duration').disabled=route||slice;$('#bleed-tail-on').disabled=route||slice;mplus.show(route);
  $('#fight-style-hint').hidden=!(note||slice);$('#fight-style-hint').textContent=note||(slice?sliceNote:'');
}
// Choosing the dummies starts from nothing; what the user turns on afterwards is kept.
$('#bleed-tail-on').addEventListener('change',()=>{$('#bleed-tail-hint').hidden=!$('#bleed-tail-on').checked;});
$('#fight-style').addEventListener('change',()=>{syncFightStyle();if(dummyStyles[$('#fight-style').value])environment.bare();});syncFightStyle();
$$('.settings input,.settings select,input[name=combine]').forEach(el=>el.addEventListener('change',updateCount));
async function runJob(){
  try{notice('');$('#run').disabled=true;if(!['weapons','trinkets'].includes(mode)&&(!profile||importedText!==$('#profile').value))await importProfile();const data=request();const preview=await api('/api/preview',data);$('#run-summary').textContent=`Starting ${preview.total} runs …`;const job=await api('/api/jobs',data);activity.refresh();await watchJob(job.id);$('#results').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){notice(e.message);}finally{$('#run').disabled=false;updateCount();}
}
$('#run').addEventListener('click',runJob);
$('#cancel').addEventListener('click',async()=>{try{if(currentJob){await api(`/api/jobs/${currentJob}/cancel`,{});await poll();}}catch(e){notice(e.message);}});
$('#job-progress').addEventListener('click',event=>{const id=event.target.closest('[data-watch-job]')?.dataset.watchJob;if(id)watchJob(id).catch(e=>notice(e.message));});
async function watchJob(id){clearTimeout(pollTimer);currentJob=id;$('#results').hidden=false;await poll();}
async function poll(){clearTimeout(pollTimer);try{const id=currentJob;const job=await api(`/api/jobs/${id}`);if(id!==currentJob)return;renderJob(job);if(['running','queued'].includes(job.status))pollTimer=setTimeout(poll,1200);}catch(e){notice(e.message);pollTimer=setTimeout(poll,3000);}}
function renderJob(job){
  $('#job-status').textContent=states[job.status]||job.status;$('#job-log').textContent=job.log || (job.status==='queued'?'Waiting for earlier jobs to finish …':'Waiting for the engine …');$('#cancel').hidden=!['running','queued'].includes(job.status);trinkets.running(['running','queued'].includes(job.status));
  const waiting=job.queue?.ahead?.length?`<div class="queue-note">Waiting in the queue behind ${job.queue.ahead.length} job${job.queue.ahead.length===1?'':'s'}. Simulations run one at a time.${job.queue.ahead.map(j=>`<br>${esc(modes[j.mode]?.[0]||j.mode)} · ${esc(j.name)} · ${j.status==='running'?`running, ${j.done} / ${j.total}${j.current?' · '+esc(j.current):''}`:'queued'} <button class="text-button" data-watch-job="${esc(j.id)}">Show</button>`).join('')}</div>`:'';
  const progress=describeProgress(job);const scenario=job.current?.scenario?.route?.dungeonName?` · ${esc(job.current.scenario.route.dungeonName)} +${job.current.scenario.route.level}`:job.current?.scenario?` · ${esc(job.current.scenario.style)}, ${job.current.scenario.targets} target${job.current.scenario.targets===1?'':'s'}`:'';
  const took=job.started&&job.finished?` · took ${duration((new Date(job.finished)-new Date(job.started))/1000)}`:'';
  $('#job-progress').innerHTML=waiting+`<div class="progress-description"><strong>${esc(job.name)}</strong> · ${job.done} of ${job.total} steps done${scenario}${took}${progress.lines.map(l=>`<br>${l}`).join('')}${job.error?`<br>${esc(job.error)}`:''}</div><div class="progress-track${job.status==='running'?' live':''}"><div class="progress-fill" style="width:${Math.round(100*progress.fraction)}%"></div></div>`;
  let html=wow.sendButton(job)+tank.summary(job)+features.results(job)+upgrades.results(job)+crests.results(job)+vault.results(job)+weapons.results(job)+trinkets.results(job);
  if(job.settings.environment){const env=job.settings.environment;html+=`<details class="environment-detail"><summary>Environment used for this job</summary><p class="hint">External buffs: ${esc(Object.entries(env.buffs).filter(([,on])=>on).map(([key])=>key.replaceAll('_',' ')).join(', ')||'None')}<br>Bloodlust: ${env.buffs.bloodlust?esc(env.bloodlust.mode+' '+env.bloodlust.value):'No external override'} · Duration variation: ±${env.variation}%<br>Consumables: ${esc(Object.entries(env.consumables).map(([key,value])=>key.replaceAll('_',' ')+': '+value).join('; ')||'From profile / SimC')}</p></details>`;}
  for(let s=0;s<job.scenarios.length&&!['upgrades','crests','vault','weapons','trinkets'].includes(job.mode);s++){
    const rows=job.results.filter(r=>r.scenario===s);if(!rows.length)continue;
    const baseline=rows.find(r=>r.baseline&&r.status==='complete');const tanky=!!job.settings.tank;const rank=r=>tanky?(r.baseline?0:r.score??-Infinity):(r.dps||0);const ordered=[...rows].sort((a,b)=>rank(b)-rank(a));const max=Math.max(...ordered.map(r=>r.dps||0),1);const scenario=job.scenarios[s];
    if(scenario.style===routeStyle)html+=`<section class="result-scenario"><h3>${mplus.title(scenario)}</h3>${mplus.details(scenario,baseline)}`;
    else html+=`<section class="result-scenario"><h3>${esc(styleNames[scenario.style]||scenario.style)} <span class="muted">/ ${scenario.targets} targets / ${job.settings.duration} sec${scenario.bleedTail?` + ${scenario.bleedTail} s of bleeds`:''}${scenario.dummyHealth?.mode==='falling'?' / dummies from 100%':scenario.dummyHealth?' / dummies held at 1%':''}</span></h3>${scenario.dummyHealth?.reached?`<p class="hint">Your damage took the dummies to 1% after ${scenario.dummyHealth.reached.map(r=>r===null?'—':r.toFixed(0)+' s').join(', ')} (the first is your main target).</p>`:''}`;
    if(rows.length===1&&job.total===1&&baseline)html+=`<div class="dps-hero"><strong>${number(baseline.dps)}</strong><span>DPS${baseline.error95!==null?` · ±${number(baseline.error95)} (95 %)` : ''}</span></div>`;
    html+=`<table class="result-table"><thead><tr><th>Variant</th><th>DPS / 95 %</th><th>vs baseline</th>${tanky?'<th>Survival</th><th>Score</th>':''}<th>Report</th></tr></thead><tbody>`;
    for(const [i,row] of ordered.entries()){
      const delta=baseline && row.status==='complete' ? row.dps-baseline.dps:null;
      const deltaError=baseline && row.error95!==null && baseline.error95!==null ? Math.hypot(row.error95,baseline.error95):null;
      const uncertain=!row.baseline && delta!==null && deltaError!==null && Math.abs(delta)<=deltaError;
      html+=`<tr class="${i===0&&row.status==='complete'?'winner':''}"><td>${esc(row.baseline?(job.mode==='talents'?'Current talents':'Current gear'):row.name)}${row.baseline?'<small>BASELINE</small>':''}${row.status==='complete'?`<div class="bar"><span style="width:${(row.dps/max*100).toFixed(1)}%"></span></div>`:`<small>${esc(row.error)}</small>`}</td><td>${row.status==='complete'?number(row.dps):'Failed'}${row.status==='complete'&&row.error95!==null?`<small>±${number(row.error95)}</small>`:''}${mplus.runTime(row,baseline)}</td><td>${delta===null?'—':row.baseline?'—':`${delta>=0?'+':''}${(100*delta/Math.max(1,baseline.dps)).toFixed(2)} %<small>${delta>=0?'+':''}${number(delta)} DPS${uncertain?' · uncertain':''}</small>`}</td>${tanky?`<td>${row.baseline&&row.tank?`${(100*row.tank.alive).toFixed(0)}% survived<small>${row.tank.deaths!==undefined?(100*row.tank.deaths).toFixed(0)+'% deaths · ':''}net ${(100*(row.tank.dtps-row.tank.hps)/row.tank.health).toFixed(2)}%/s</small>`:Number.isFinite(row.survival)?`${signed(row.survival)} %<small>${(100*row.tank.alive).toFixed(0)}% survived</small>`:'—'}</td><td>${Number.isFinite(row.score)?`${signed(row.score)}<small>±${row.scoreError.toFixed(2)}${Math.abs(row.score)<=row.scoreError?' · uncertain':''}</small>`:'—'}</td>`:''}<td>${row.status==='complete'?`<a href="#" data-rotation="${job.id}/${row.stem}">Rotation</a><a href="/reports/${job.id}/${row.stem}.html" download>HTML</a><a href="/reports/${job.id}/${row.stem}.json" download>JSON</a>`:''}<a href="/reports/${job.id}/${row.stem}.simc" download>Input</a></td></tr>`;
    }
    html+=`</tbody></table><div class="rotation-slot"></div></section>`;
  }
  if(job.results.length&&!['upgrades','crests','vault','weapons','trinkets'].includes(job.mode))html+='<p class="result-note">± is an approximate 95% confidence interval for mean DPS. “Uncertain” means the difference is within combined statistical uncertainty, not that the builds are equal. Increase precision for small differences.</p>';
  html+=`<p class="result-note">SimC ${esc(job.engine.version)} · WoW ${esc(job.engine.wowVersion)} · commit ${esc(job.engine.commit?.slice(0,12))}<br>${number(job.settings.iterations)} max iterations · target error ${job.settings.targetError} % · ${job.settings.threads} CPU threads <a href="/reports/${job.id}/request.json" download> · Download job settings</a></p>`;
  $('#result-content').innerHTML=html;
}
async function loadHistory(){const jobs=await api('/api/jobs');$('#history-list').innerHTML=jobs.length?jobs.map(j=>`<button class="history-row" data-job="${j.id}" data-job-mode="${esc(j.mode)}"><span><strong>${esc(j.name)}</strong><small>${esc(modes[j.mode]?.[0]||j.mode)} · ${new Date(j.created).toLocaleString('en-US')}</small></span><span class="history-state"><span class="pill">${esc(states[j.status]||j.status)} · ${j.done}/${j.total}</span>${j.status==='running'?`<span class="history-track"><span style="width:${Math.round(100*(j.fraction||0))}%"></span></span>`:''}</span></button>`).join(''):'<p class="empty-small">No simulations yet. Run Quick Sim, Enchant Lab or Talent Search to get started.</p>';}
// SimC's rotation for a finished run, shown under its scenario.
document.addEventListener('click',async e=>{const link=e.target.closest('[data-rotation]');if(!link)return;e.preventDefault();const [job,stem]=link.dataset.rotation.split('/');const slot=link.closest('.result-scenario').querySelector('.rotation-slot');slot.innerHTML='<p class="hint">Loading SimC’s rotation …</p>';try{slot.innerHTML=await rotationView(api,job,stem);}catch(err){slot.innerHTML=`<p class="notice">${esc(err.message)}</p>`;}});
$('#refresh-history').addEventListener('click',()=>loadHistory().catch(e=>notice(e.message)));
$('#history-list').addEventListener('click',async event=>{const row=event.target.closest('[data-job]');if(row){await setMode(['weapons','trinkets','crests','vault'].includes(row.dataset.jobMode)?row.dataset.jobMode:'quick');await watchJob(row.dataset.job);$('#results').scrollIntoView({behavior:'smooth'});}});
async function init(){
  try{const status=await api('/api/status');token=status.token;engine=status.engine;engineView.render(status);
    $('#wow-version').textContent=engine.installed||'Not found';$('#side-version').textContent=engine.version?`SimulationCraft ${engine.version}`:'Not installed';$('#engine-badge').textContent=engine.compatible&&engine.ready?'Live build verified':engine.ready?'Update SimC for your WoW version':'SimC not installed';$('#engine-badge').classList.toggle('warning',!engine.compatible||!engine.ready);
    // Without an engine only the install screen is useful.
    if(engineView.missing()){$('#workspace').hidden=true;return;}
    await Promise.all([environment.init(),upgrades.init(),crests.init(),weapons.init(),trinkets.init()]);tank.init(environment.options()||{tankPresets:{}});$('#threads').value=engine.maxThreads;$('#threads').max=engine.maxThreads;if(engine.installed&&!engine.compatible)notice(`WoW ${engine.installed} and SimC ${engine.wowVersion} differ. Use Update SimC.`);renderVariants();try{$('#profile').value=localStorage.getItem('simc-lab-profile')||'';}catch{}if($('#profile').value)await importProfile();void wow.characters({autoLoad:true});updateCount();}catch(e){notice(e.message);}
}
init();

function renderImportedChoices(){
  $('#imported-choices').innerHTML=profile?importedCards(profile):'<p class="hint">Import a character to browse equipped gear, bag items and saved talents.</p>';
}
function syncGearSelection(){
  document.querySelectorAll('#imported-choices [data-imported-card]').forEach(card=>{const v=profile?.alternatives[Number(card.dataset.importedCard)];const selected=!!v&&variants.some(item=>item.text.trim()===v.text.trim());card.classList.toggle('selected',selected);const button=card.querySelector('[data-add-imported]');button.setAttribute('aria-pressed',String(selected));button.textContent=selected?'✓ Selected · click to remove':'+ Select for comparison';});
}
function toggleGearCard(card){const v=profile?.alternatives[Number(card.dataset.importedCard)];if(!v)return;const index=variants.findIndex(item=>item.text.trim()===v.text.trim());if(index>=0)variants=variants.filter(item=>item.text.trim()!==v.text.trim());else{if(variants.length===1&&!variants[0].text)variants=[];variants.push({name:v.name.slice(0,160),text:v.text});}renderVariants();updateCount();}
$('#imported-choices').addEventListener('click',event=>{if(event.target.closest('a'))return;const card=event.target.closest('[data-imported-card]');if(card)toggleGearCard(card);});
$('#imported-choices').addEventListener('keydown',event=>{if(event.target.matches('[data-imported-card]')&&['Enter',' '].includes(event.key)){event.preventDefault();toggleGearCard(event.target);}});
const features=featureUI({api,getProfile:()=>profile,notice,updateCount,addVariant:v=>{if(variants.length===1&&!variants[0].text)variants=[];variants.push(v);renderVariants();updateCount();}});

const upgrades=upgradeUI({api,notice,updateCount});
const crests=crestUI({api,notice,updateCount});
const vault=vaultUI({api,updateCount});
const weapons=weaponUI({api,notice,updateCount});
const trinkets=trinketUI({api,notice,updateCount,run:()=>runJob(),cancel:()=>$('#cancel').click()});
const engineView=engineUI({api,notice});
const activity=activityUI({api,openJob:async id=>{if(mode==='history')await setMode('quick');await watchJob(id);$('#results').scrollIntoView({behavior:'smooth',block:'start'});},onChange:()=>{if(mode==='history')loadHistory().catch(()=>{});}});
const wow=wowUI({api,notice,importText:async text=>{$('#profile').value=text;await importProfile();}});
const logs=logsUI({api,notice});
armoryUI({api,notice,importText:async text=>{$('#profile').value=text;await importProfile();}});
const tank=tankUI({updateCount});
const environment=environmentUI({api,notice,addVariant:v=>{if(variants.length===1&&!variants[0].text)variants=[];variants.push(v);renderVariants();updateCount();}});
$('#enchant-slots').addEventListener('click',e=>{const slot=e.target.dataset.clearEnchants;if(slot){selections[slot]=[];renderEnchants();updateCount();}});
