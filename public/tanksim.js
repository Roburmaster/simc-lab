import {signed} from '/tank.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);

// The fights a tank can be run through: the boss alone, and the boss with mobs that all hit the tank.
export const fights=[
  {id:'boss',label:'Boss alone',targets:1,note:'One enemy: the boss swings, busts you every 30 seconds and puts a damage-over-time on you.'},
  {id:'pack',label:'Boss + 2 adds',targets:3,note:'A small pack: two mobs swing at you for the whole fight on top of the boss.'},
  {id:'pull',label:'Boss + 4 adds',targets:5,note:'A big pull: four mobs swing at you for the whole fight on top of the boss.'}
];

// Tank Sim: one imported tank, run against a boss and its adds, with the numbers a tank cares about.
export function tankSimUI({updateCount}){
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="tanksim-panel" class="panel" hidden><div class="panel-heading"><h2><span class="step">02</span> Tank Sim</h2><span class="pill">Boss and adds hit you</span></div><p class="panel-intro">Your tank against a boss and its adds. Everything that stands next to the boss swings at you for the whole fight, healers top you up on a rhythm, and you can die. Pick the fights to run; each is one simulation. The boss is tuned to your own gear once, under Tank survival below, where you also set how hard the adds hit.</p><div class="upgrade-groups" id="tanksim-fights">${fights.map(f=>`<label class="check"><input type="checkbox" data-tanksim="${f.id}" ${f.id==='boss'||f.id==='pull'?'checked':''}><span>${esc(f.label)}<small class="hint"> · ${esc(f.note)}</small></span></label>`).join('')}</div><label class="check tanksim-upgrades"><input type="checkbox" data-tanksim-upgrades checked><span>Also find gear upgrades<small class="hint"> · Every item from the sources below is simulated in its slot in each fight above, and the best ones are simulated again. An upgrade is one that raises your survival and damage score, which you weigh under Tank survival.</small></span></label><p class="result-note">Dungeon Slice, Hectic Add Cleave, the Mythic+ route and the dummies have no mobs that attack a tank, so they are not offered for tanks.</p></section>`);
  $('#tanksim-panel').addEventListener('change',()=>updateCount());
  const chosen=()=>fights.filter(f=>$(`[data-tanksim="${f.id}"]`)?.checked);
  const row=(job,s)=>job.results.find(r=>r.scenario===s&&r.baseline&&r.status==='complete');
  const upgrades=()=>!!$('[data-tanksim-upgrades]')?.checked;
  return {
    chosen,upgrades,
    // One scenario per fight, in the fight style chosen in the settings.
    scenarios(style,extra={}){return chosen().map(f=>({style,targets:f.targets,...extra}));},
    results(job){
      if(job.mode!=='tank')return '';
      const t=job.settings?.tank;
      let html=`<div class="search-summary"><strong>Tank Sim · ${esc(job.name)}</strong><p class="hint">${chosen().length||job.scenarios.length} fight${job.scenarios.length===1?'':'s'}, each one simulation of ${number(job.settings.iterations)} iterations at most, ${job.settings.duration} sec. The adds hit for ${t?.addDamage??40}% of a boss swing each, for the whole fight.</p></div>`;
      const rows=job.scenarios.map((sc,s)=>({sc,r:row(job,s)})).filter(x=>x.r?.tank);
      if(!rows.length)return html+'<p class="hint">The fights show here as they finish.</p>';
      html+=`<table class="result-table"><thead><tr><th>Fight</th><th>Damage taken</th><th>Healing and absorbs</th><th>Survived</th><th>Deaths</th><th>Your DPS</th></tr></thead><tbody>${rows.map(({sc,r})=>{
        const x=r.tank,health=x.health||t?.boss?.health,fight=fights.find(f=>f.targets===sc.targets);
        const pct=n=>health?`${(100*n/health).toFixed(1)}% of your health`:'';
        return `<tr><td>${esc(fight?.label||`${sc.targets} targets`)}<small>${esc(sc.style)} · ${sc.targets-1} add${sc.targets===2?'':'s'}</small></td><td>${number(x.dtps)} / sec<small>${pct(x.dtps)} per second</small></td><td>${number(x.hps)} healed + ${number(x.aps)} absorbed / sec<small>net after healing ${number(x.dtps-x.hps)} / sec</small></td><td>${(100*x.alive).toFixed(0)}%<small>of the fight, on average</small></td><td>${x.deaths===undefined?'—':`${(100*x.deaths).toFixed(0)}%`}<small>of ${number(r.iterations||job.settings.iterations)} fights</small></td><td>${number(r.dps)}<small>±${number(r.error95||0)}</small></td></tr>`;}).join('')}</tbody></table><p class="result-note">Damage taken is after your armor, avoidance and absorbs, as SimC counts it. More adds means more damage and more deaths, and that is the point: the same gear holds up differently against a pack than against a single hit. Deaths are against a boss whose tank-busters were sized so your current gear dies in about ${t?.deathTarget??25}% of boss-alone fights.</p>`;
      return html;
    }
  };
}
