import {upgradeUI} from '/upgrades.js';
import {crestUI} from '/crests.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);

// The fights a tank can be run through: the boss alone, and the boss with mobs that all hit the tank.
export const fights=[
  {id:'boss',label:'Boss alone',targets:1,note:'One enemy: the boss swings, busts you every 30 seconds and puts a damage-over-time on you.'},
  {id:'pack',label:'Boss + 2 adds',targets:3,note:'A small pack: two mobs swing at you for the whole fight on top of the boss.'},
  {id:'pull',label:'Boss + 4 adds',targets:5,note:'A big pull: four mobs swing at you for the whole fight on top of the boss.'}
];
// The fights above are the whole description of the encounter, so the style is not a choice: Patchwerk, a boss that stands
// still and swings. The other styles change nothing the tank's own boss does.
const style='Patchwerk';
const consumableKinds=[['flask','Flask'],['food','Food'],['potion','Potion'],['augmentation','Augment rune']];

// Tank Sim is a page of its own: its fights, its simulation settings, its buffs, its boss and its gear sources all live
// here, and nothing in the settings column beside the other modes is used. The boss settings (see tank.js) move in.
export function tankSimUI({api,notice,updateCount,run,cancel}){
  let countTimer=null,profile=null;
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="tanksim-panel" class="panel" hidden>
    <div class="panel-heading"><h2><span class="step">02</span> Tank Sim</h2><span class="pill">Boss and adds hit you</span></div>
    <p class="panel-intro">Your tank against a boss and its adds. Everything that stands next to the boss swings at you for the whole fight, healers top you up on a rhythm, and you can die. Every setting for it is on this page, apart from the other simulations.</p>
    <p id="tanksim-need" class="notice" hidden>Tank Sim needs a tank specialization: Protection Warrior or Paladin, Blood Death Knight, Guardian Druid, Brewmaster Monk or Vengeance Demon Hunter.</p>
    <div class="tank-sections">
      <section class="tank-section"><h3>Fights</h3><p class="hint">Each fight is one simulation. Dungeon Slice, Hectic Add Cleave, the Mythic+ route and the dummies have no mobs that attack a tank, so they are not offered.</p><div class="upgrade-groups" id="tanksim-fights">${fights.map(f=>`<label class="check"><input type="checkbox" data-tanksim="${f.id}" ${f.id==='boss'||f.id==='pull'?'checked':''}><span>${esc(f.label)}<small class="hint"> · ${esc(f.note)}</small></span></label>`).join('')}</div></section>
      <section class="tank-section"><h3>Simulation</h3><div class="tank-grid">
        <label>Duration (sec)<input id="tank-duration" type="number" min="10" max="1200" value="300"></label>
        <label>Iterations<select id="tank-iterations"><option value="1000">1 000 · quick test</option><option value="10000" selected>10 000 · standard</option><option value="50000">50 000 · high precision</option><option value="100000">100 000 · very high precision</option><option value="1000000">1 000 000 · maximum</option></select></label>
        <label>Target error (%)<select id="tank-target-error"><option value="0">None · all iterations</option><option value="0.1" selected>0.10%</option><option value="0.05">0.05%</option><option value="0.02">0.02%</option></select></label>
        <label>CPU threads<input id="tank-threads" type="number" min="1" value="4"></label></div>
        <p class="hint">Stops at the target error or the iteration cap. The first round of a gear search always uses at most 2,000 iterations; the final round uses what you set here.</p></section>
      <section class="tank-section"><h3>Buffs and consumables</h3><div id="tank-environment"><p class="hint">Loading live options …</p></div></section>
      <section class="tank-section" id="tanksim-boss"></section>
      <section class="tank-section"><h3>Gear to try</h3>
        <p class="hint">Your equipped gear is always simulated as the baseline, and everything below is compared with it on your tank score: survival and DPS, weighted as set under Tank survival. Leave all three off to run the fights alone.</p>
        <div class="tank-source"><label class="check"><input type="checkbox" id="tank-bags" checked><span><strong>Gear from my bags</strong><small class="hint" id="tank-bags-note"> · Import a character to see what you carry.</small></span></label></div>
        <div class="tank-source"><label class="check"><input type="checkbox" id="tank-crests" checked><span><strong>Upgrades with crests</strong><small class="hint"> · Each equipped item at every higher level of its upgrade track, within the crests you have.</small></span></label><details class="tank-more"><summary>Crest settings</summary><div id="tank-crests-host"></div></details></div>
        <div class="tank-source"><label class="check"><input type="checkbox" id="tank-loot" checked><span><strong>Loot from instances</strong><small class="hint"> · Raid, Mythic+, Great Vault, delves and crafted gear for your specialization.</small></span></label><details class="tank-more"><summary>Sources, upgrade levels and slots</summary><div id="tank-loot-host"></div></details></div>
        <div id="tank-gear-count" class="hint"></div>
      </section>
    </div>
    <div class="tank-run"><div><strong id="tank-run-summary">Waiting for character import</strong><span class="hint" id="tank-run-count"></span></div><div class="run-actions"><button id="tank-run" class="button primary">Run Tank Sim <span>→</span></button><button id="tank-cancel" class="button danger" hidden>Cancel job</button></div></div></section>`);
  const loot=upgradeUI({api,notice,updateCount,host:$('#tank-loot-host'),sfx:'-tank',owner:'tank'});
  const crests=crestUI({api,notice,updateCount,host:$('#tank-crests-host'),sfx:'-tank'});
  $('#tanksim-panel').addEventListener('change',event=>{
    if(event.target.matches('#tank-loot,#tank-crests'))$(`#${event.target.id}-host`).closest('.tank-source').classList.toggle('off',!event.target.checked);
    updateCount();
  });
  $('#tanksim-panel').addEventListener('input',event=>{if(event.target.matches('input[type=number]'))updateCount();});
  $('#tank-run').addEventListener('click',()=>run());
  $('#tank-cancel').addEventListener('click',()=>cancel());
  const chosen=()=>fights.filter(f=>$(`[data-tanksim="${f.id}"]`)?.checked);
  const row=(job,s)=>{
    const plain=job.results.find(r=>r.scenario===s&&r.baseline&&r.status==='complete');if(plain)return plain;
    // With gear searched, the baseline comes with each round; the last one is the most precise.
    const last=(job.stages||[]).filter(st=>st.scenario===s&&st.status==='complete'&&st.baseline).sort((a,b)=>b.stage-a.stage)[0];
    return last?{...last.baseline,scenario:s,baseline:true,status:'complete'}:null;
  };
  function environment(){
    return {buffs:Object.fromEntries($$('[data-tank-buff]').map(el=>[el.dataset.tankBuff,el.checked])),consumables:Object.fromEntries($$('[data-tank-consumable]').map(el=>[el.dataset.tankConsumable,el.value])),bloodlust:{mode:'pull',value:0},variation:20};
  }
  // The sources that are switched on; none at all means plain fights.
  function gear(){
    const out={finalists:Number(loot.settings().finalists)||48};
    if($('#tank-bags').checked)out.bags={};
    if($('#tank-crests').checked)out.crests=crests.settings();
    if($('#tank-loot').checked)out.loot=loot.settings();
    return out;
  }
  const sources=()=>[$('#tank-bags'),$('#tank-crests'),$('#tank-loot')].filter(el=>el.checked).length;
  return {
    chosen,gear:()=>sources()>0,
    async init({options,engine}){
      await Promise.all([loot.init(),crests.init()]);
      const buffs=['Raid buffs','Target debuffs'].map(group=>`<h4 class="upgrade-heading">${group}</h4><div class="upgrade-groups">${options.buffs.filter(b=>b.group===group).map(b=>`<label class="check"><input type="checkbox" data-tank-buff="${b.id}" checked>${esc(b.name)}</label>`).join('')}</div>`).join('');
      const consumables=consumableKinds.map(([key,label])=>`<label>${label}<select data-tank-consumable="${key}"><option value="profile">From profile / SimC</option><option value="none">None</option>${(options.consumables?.[key]||[]).map(c=>`<option value="${esc(c.value)}">${esc(c.name||c.shortName)}${c.craftingQuality&&!/quality|rank/i.test(c.name||'')?` · Rank ${c.craftingQuality}`:''}</option>`).join('')}</select></label>`).join('');
      $('#tank-environment').innerHTML=`<div class="upgrade-group-actions"><button class="text-button" data-tank-buffs="1">All buffs</button><button class="text-button" data-tank-buffs="0">No buffs</button></div>${buffs}<div class="tank-grid">${consumables}</div><p class="hint">Disabling a buff removes the assumed external one; your tank can still provide its own. Bloodlust comes at the pull. These settings are only used by Tank Sim.</p>`;
      $('#tank-environment').addEventListener('click',event=>{const all=event.target.closest('[data-tank-buffs]');if(!all)return;event.preventDefault();$$('[data-tank-buff]').forEach(el=>el.checked=all.dataset.tankBuffs==='1');updateCount();});
      if(engine?.maxThreads){$('#tank-threads').value=engine.maxThreads;$('#tank-threads').max=engine.maxThreads;}
    },
    // A new character: crests fill from its export, and the bags say what is in them.
    show(parsed){
      profile=parsed;crests.show(parsed);
      $('#tanksim-need').hidden=!parsed||!!parsed.isTank;
      const bags=(parsed?.alternatives||[]).filter(a=>a.slot);
      const sections=[...bags.reduce((m,a)=>m.set(a.section||'Bags',(m.get(a.section||'Bags')||0)+1),new Map())].map(([name,n])=>`${n} in ${esc(name)}`);
      $('#tank-bags-note').innerHTML=!parsed?' · Import a character to see what you carry.':bags.length?` · ${bags.length} item${bags.length===1?'':'s'} in the export: ${sections.join(', ')}.`:' · This export lists no bag gear. Export with the SimulationCraft addon to try what you carry.';
    },
    // Everything the server needs for a tank job except the character and the boss, which the page adds.
    request(){
      return {mode:'tank',iterations:Number($('#tank-iterations').value),targetError:Number($('#tank-target-error').value),duration:Number($('#tank-duration').value),threads:Number($('#tank-threads').value),
        environment:environment(),scenarios:chosen().map(f=>({style,targets:f.targets})),tankGear:gear()};
    },
    // What a run will be, from the server's own count, so the numbers match what will run.
    count(request){
      clearTimeout(countTimer);
      const n=chosen().length;
      const say=(summary,count='',detail='')=>{$('#tank-run-summary').textContent=summary;$('#tank-run-count').textContent=count?` · ${count}`:'';$('#tank-gear-count').innerHTML=detail;};
      $('#tank-run').disabled=!profile||!profile.isTank||!n;
      if(!profile)return say('Waiting for character import');
      if(!profile.isTank)return say('Import a tank specialization');
      if(!n)return say('Choose at least one fight');
      say(sources()?'Counting what to try …':'One simulation per fight',sources()?'':`${n} run${n===1?'':'s'}`);
      if(!sources())return;
      countTimer=setTimeout(async()=>{try{
        const preview=await api('/api/preview',request());const u=preview.upgrade;if(!u)return;
        const c=u.counts||{};const parts=[['bags','from your bags'],['crests','crest upgrades'],['loot','from instances']].filter(([k])=>c[k]!==undefined&&$(`#tank-${k}`).checked).map(([k,label])=>`${c[k]} ${label}`);
        say('Screening and a final round per fight',`${preview.total} SimC runs`,`<strong>${u.candidates} candidates</strong> across ${u.slots} slots${parts.length?` (${parts.join(', ')})`:''}${u.blocked?` · ${u.blocked} left out by the equip limit`:''}${(u.warnings||[]).map(w=>`<br>${esc(w)}`).join('')}`);
      }catch(e){say('Nothing to run yet','',esc(e.message));}},350);
    },
    busy(on){$('#tank-run').disabled=!!on;},
    running(on){$('#tank-cancel').hidden=!on;},
    results(job){
      if(job.mode!=='tank')return '';
      const t=job.settings?.tank;
      let html=`<div class="search-summary"><strong>Tank Sim · ${esc(job.name)}</strong><p class="hint">${job.scenarios.length} fight${job.scenarios.length===1?'':'s'}, ${job.settings.duration} sec, up to ${number(job.settings.iterations)} iterations each. The adds hit for ${t?.addDamage??40}% of a boss swing each, for the whole fight.${job.upgrade?' Every fight also searches your gear, below.':''}</p></div>`;
      const rows=job.scenarios.map((sc,s)=>({sc,r:row(job,s)})).filter(x=>x.r?.tank);
      if(!rows.length)return html+'<p class="hint">The fights show here as they finish.</p>';
      html+=`<table class="result-table"><thead><tr><th>Fight</th><th>Damage taken</th><th>Healing and absorbs</th><th>Survived</th><th>Deaths</th><th>Your DPS</th></tr></thead><tbody>${rows.map(({sc,r})=>{
        const x=r.tank,health=x.health||t?.boss?.health,fight=fights.find(f=>f.targets===sc.targets);
        const pct=n=>health?`${(100*n/health).toFixed(1)}% of your health`:'';
        return `<tr><td>${esc(fight?.label||`${sc.targets} targets`)}<small>${esc(sc.style)} · ${sc.targets-1} add${sc.targets===2?'':'s'}</small></td><td>${number(x.dtps)} / sec<small>${pct(x.dtps)} per second</small></td><td>${number(x.hps)} healed + ${number(x.aps)} absorbed / sec<small>net after healing ${number(x.dtps-x.hps)} / sec</small></td><td>${(100*x.alive).toFixed(0)}%<small>of the fight, on average</small></td><td>${x.deaths===undefined?'—':`${(100*x.deaths).toFixed(0)}%`}<small>of ${number(r.iterations||job.settings.iterations)} fights</small></td><td>${number(r.dps)}<small>±${number(r.error95||0)}</small></td></tr>`;}).join('')}</tbody></table><p class="result-note">Damage taken is after your armor, avoidance and absorbs, as SimC counts it. More adds means more damage and more deaths, and that is the point: the same gear holds up differently against a pack than against a single hit. Deaths are against a boss whose tank-busters were sized so your current gear dies in about ${t?.deathTarget??25}% of boss-alone fights.</p>`;
      return html;
    },
    loot
  };
}
