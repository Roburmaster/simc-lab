const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const clock=s=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
const percent=x=>`${(100*x).toFixed(0)}%`;
const day=iso=>new Date(iso).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
export const routeStyle='MythicPlusRoute';

// EXPERIMENTAL, MADE BY AI: written by an AI assistant (Claude) and not yet validated against Mythic+ combat logs.
// Treat its numbers as a comparison between choices on the same route, not as a forecast of a real run.
// Mythic+ route: a whole dungeon, pull by pull, built from Mythic Dungeon Tools and Raider.IO on this PC (see
// lib/mplus.mjs). The route is the pulls; the pace is how fast the group went, which sets how much of each mob's
// health is the player's to take.
export function mplusUI({api,notice,onChange}){
  let data=null,loading=null;
  $('#fight-style-hint').insertAdjacentHTML('afterend',`<div id="route-settings" hidden>
    <p class="hint route-experimental"><span class="pill">Experimental · made by AI</span><br>Built by an AI assistant and not yet checked against Mythic+ combat logs. Compare choices on the same route with it; do not read its DPS or run time as what a real run will give. Boss mechanics, movement and deaths are not simulated, and time saved assumes the whole group speeds up with you.</p>
    <label>Dungeon<select id="route-dungeon"></select></label>
    <div class="two-col"><label>Keystone level<input id="route-level" type="number" min="2" max="40" value="12"></label><label>Walk to each pull (s)<input id="route-gap" type="number" min="0" max="300" value="10"></label></div>
    <label>Route<select id="route-source"></select></label>
    <label>Group pace<select id="route-pace"></select></label>
    <label id="route-share-label" hidden>Your share of the group’s damage (%)<input id="route-share" type="number" min="1" max="100" value="25"></label>
    <label class="check"><input type="checkbox" id="route-lust" checked>Bloodlust on the first pull, then whenever it is ready</label>
    <label class="check"><input type="checkbox" id="route-all">Every season dungeon, each on your latest run</label>
    <p class="hint" id="route-hint"></p></div>`);
  const dungeon=()=>data?.dungeons.find(d=>String(d.index)===$('#route-dungeon').value);
  const usable=d=>d&&d.index!==null&&(d.runs.some(r=>r.route)||d.routes.length);
  // The defaults for a dungeon: the latest run that holds a route, else an MDT route; paced on the latest run.
  const pick=d=>({route:d.runs.find(r=>r.route)?.id||d.routes[0]?.id||'',pace:d.runs.find(r=>r.killed)?.id||'share'});
  function fill(){
    const d=dungeon();if(!d)return;
    const runLabel=r=>`+${r.level} · ${day(r.date)} · ${clock(r.clearTime)}${r.deaths?` · ${r.deaths} death${r.deaths===1?'':'s'}`:''}`;
    $('#route-source').innerHTML=[...d.runs.filter(r=>r.route).map(r=>`<option value="${esc(r.id)}">Your run ${esc(runLabel(r))}</option>`),...d.routes.map(r=>`<option value="${esc(r.id)}">MDT · ${esc(r.name)} · ${r.pulls} pulls</option>`)].join('')||'<option value="">No route for this dungeon</option>';
    $('#route-pace').innerHTML=[...d.runs.filter(r=>r.killed).map(r=>`<option value="${esc(r.id)}">As fast as your run ${esc(runLabel(r))}</option>`),'<option value="share">A share of the group’s damage</option>'].join('');
    const p=pick(d);$('#route-source').value=p.route;$('#route-pace').value=p.pace;
    sync();
  }
  function sync(){
    const share=$('#route-pace').value==='share',all=$('#route-all').checked;
    $('#route-share-label').hidden=!share&&!all;
    for(const id of ['#route-dungeon','#route-source','#route-pace'])$(id).disabled=all;
    const d=dungeon();
    $('#route-hint').textContent=all?`${data.dungeons.filter(usable).length} of ${data.dungeons.length} season dungeons have a route on this PC. Each runs on your latest run there and is paced on it; one without a finished run uses the share above.`:
      share?'Every mob gets this share of its health at the key level: the rest of the group does the rest.':
      `Bosses last as long as they did in that run and the trash takes the rest of its time, each at the share of the group’s damage that makes it so.${d?.runs.find(r=>r.id===$('#route-pace').value)?.level!==Number($('#route-level').value)?' At another key level the pace stays and the health changes.':''}`;
    onChange();
  }
  async function load(){
    loading??=api('/api/mplus').then(r=>{
      data=r;
      $('#route-dungeon').innerHTML=r.dungeons.map(d=>`<option value="${d.index??''}"${usable(d)?'':' disabled'}>${esc(d.name)}${usable(d)?'':' · no route'}</option>`).join('');
      const first=r.dungeons.find(usable);if(first)$('#route-dungeon').value=String(first.index);
      const latest=r.dungeons.flatMap(d=>d.runs).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];if(latest)$('#route-level').value=latest.level;
      if(r.missing.length)notice(r.missing.join(' '));
      fill();
    }).catch(e=>{loading=null;notice(e.message);});
    return loading;
  }
  $('#route-dungeon').addEventListener('change',fill);
  for(const id of ['#route-source','#route-pace','#route-all','#route-level','#route-gap','#route-share','#route-lust'])$(id).addEventListener('change',sync);
  const common=()=>({level:Number($('#route-level').value),gap:Number($('#route-gap').value),share:Number($('#route-share').value),lust:$('#route-lust').checked});
  return {
    show(on){$('#route-settings').hidden=!on;if(on)void load();},
    // One scenario, or one per season dungeon that has a route.
    scenarios(){
      if(!data)return [{style:routeStyle,route:{...common()}}];
      if($('#route-all').checked)return data.dungeons.filter(usable).map(d=>({style:routeStyle,route:{...common(),dungeon:d.index,...pick(d)}}));
      return [{style:routeStyle,route:{...common(),dungeon:Number($('#route-dungeon').value),route:$('#route-source').value,pace:$('#route-pace').value}}];
    },
    title(scenario){
      const r=scenario.route;if(!r?.dungeonName)return 'Mythic+ route';
      return `<span class="pill">Experimental · made by AI</span> ${esc(r.dungeonName)} +${r.level} <span class="muted">/ ${esc(r.routeName)} / ${r.pace.mode==='replay'?`paced on your +${r.pace.level} run`:`${percent(r.shareSet)} of the group’s damage`}</span>`;
    },
    // Under a scenario: the run against the real one, and every pull of the baseline.
    details(scenario,row){
      const r=scenario.route,res=row?.route;if(!r||!res)return '';
      const real=r.pace.mode==='replay'?r.pace.clearTime:null;
      const shares=r.pace.mode==='replay'?`Your share of the group’s damage: ${percent(res.share)} on bosses, ${percent(res.trashShare)} on trash.`:`Your share of the group’s damage: ${percent(res.share)}.`;
      let html=`<p class="hint">Simulated run ${clock(res.run)} (${clock(res.combat)} in combat)${real?` · your run took ${clock(real)}`:''} · ${number(res.activeDps)} DPS in combat, ${number(row.dps)} over the whole run. ${shares} Bloodlust on pull${res.pulls.filter(p=>p.lust).length===1?'':'s'} ${res.pulls.map((p,i)=>p.lust?i+1:null).filter(Boolean).join(', ')||'none'}.</p>`;
      html+=`<details class="route-pulls"><summary>Every pull</summary><table class="result-table"><thead><tr><th>Pull</th><th>Health at +${r.level}</th><th>Your share</th><th>Length</th><th>Your DPS</th>${r.source==='replay'?'<th>Ended in your run</th>':''}</tr></thead><tbody>`;
      for(const [i,p] of res.pulls.entries())html+=`<tr${p.boss?' class="winner"':''}><td>${i+1}. ${esc(p.name)}${p.lust?'<small>BLOODLUST</small>':''}</td><td>${number(p.realHealth)}<small>${p.mobs} mob${p.mobs===1?'':'s'}</small></td><td>${percent(p.share)}</td><td>${p.length?p.length.toFixed(1)+' s':'—'}<small>after ${p.delay.toFixed(0)} s</small></td><td>${p.dps?number(p.dps):'—'}</td>${r.source==='replay'?`<td>${p.runEnd!==undefined?clock(p.runEnd):'—'}</td>`:''}</tr>`;
      return html+'</tbody></table></details>';
    },
    // In a variant's row: how long the run took, so gear and talents can be read as time saved.
    runTime(row,base){
      if(!row?.route)return '';
      const d=base?.route&&row!==base?row.route.run-base.route.run:null;
      return `<small>Run ${clock(row.route.run)}${d!==null?` · ${d<=0?'−':'+'}${Math.abs(d).toFixed(0)} s`:''}</small>`;
    }
  };
}
