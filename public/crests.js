import {itemLink,gearGroups,slotNames} from '/items.js';
import {spendingPlan} from '/crestplan.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const signed=(n,digits=2)=>`${n>=0?'+':''}${n.toFixed(digits)}`;
const plus=n=>`${n>=0?'+':''}${number(n)}`;

export function crestUI({api,notice,updateCount}){
  let data=null,countTimer=null,lastJob=null;const budgets=new Map();
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="crest-panel" class="panel" hidden><div class="panel-heading"><h2><span class="step">02</span> Crest Planner</h2><span id="crest-season" class="pill">Loading season</span></div><p class="panel-intro">Every equipped item on an upgrade track is simulated at each higher level of its track. The result is the order to spend your crests in: the most DPS per crest first, within the crests you have.</p><div id="crest-options"><p class="hint">Loading upgrade tracks …</p></div></section>`);
  const icon=c=>c?.icon?`<img class="crest-icon" src="https://wow.zamimg.com/images/wow/icons/small/${esc(c.icon)}.jpg" alt="" width="18" height="18">`:'';
  const currency=id=>data?.crests.currencies.find(c=>c.id===Number(id));
  const crestText=(amount,id)=>amount?`${icon(currency(id))}${number(amount)} ${esc(currency(id)?.name||'crests')}`:'<span class="crest-free">No crests</span>';
  function render(){
    $('#crest-season').textContent=data.season.name;
    $('#crest-options').innerHTML=`<div class="two-col"><label>Levels to simulate<select id="crest-levels"><option value="all" selected>Every level</option><option value="max">Highest level only</option></select></label><div></div></div>
      <h4 class="upgrade-heading">Crests to spend</h4><div class="crest-budget">${data.crests.currencies.map(c=>`<label><span>${icon(c)}${esc(c.name)}</span><input type="number" min="0" step="1" data-crest-have="${c.id}" placeholder="From the export"></label>`).join('')}</div>
      <label class="check"><input type="checkbox" id="crest-affordable" checked> Only upgrades these crests pay for</label><p id="crest-state" class="hint">Import a character. The SimulationCraft addon's export includes your crests and each slot's upgrade discount.</p>
      <details class="log-details upgrade-slots"><summary>Slots to include</summary><div class="upgrade-group-actions"><button class="text-button" data-crest-all>All</button><button class="text-button" data-crest-none>None</button></div><div class="upgrade-groups">${gearGroups.flatMap(([,slots])=>slots).map(s=>`<label class="check"><input type="checkbox" data-crest-slot value="${s}" checked>${esc(slotNames[s])}</label>`).join('')}</div></details>
      <div id="crest-items"></div>
      <p class="result-note">One SimC run per scenario simulates every upgrade at your simulation settings. Enchants and gems stay as they are. An upgrade to an item level the slot has already held costs no crests, as in the game; the account-wide high watermark counts once the crest's warband achievement is done. The spending order treats gains in different slots as adding up.</p>`;
  }
  function settings(){
    if(!data)return {};
    const budget={};for(const el of $$('[data-crest-have]'))if(el.value!=='')budget[el.dataset.crestHave]=Number(el.value);
    return {levels:$('#crest-levels').value,affordable:$('#crest-affordable').checked,slots:$$('[data-crest-slot]:checked').map(e=>e.value),budget:Object.keys(budget).length?budget:undefined};
  }
  // Crests from the addon export fill the fields; what the player types afterwards wins.
  function show(profile){
    if(!data)return;
    const state=profile?.upgradeState;
    for(const el of $$('[data-crest-have]')){const owned=state?.owned?.[el.dataset.crestHave];el.value=state?.owned?String(owned??0):'';}
    $('#crest-state').textContent=!state?'Import a character.':state.exported?`Crests read from the export${state.watermarks?', with each slot\'s upgrade discount':''}. Lower them to keep some back, or change them if you have spent or earned some since.`:'The export has no crest data (the SimulationCraft addon writes it). Enter your crests to get a spending order; costs assume no discount.';
  }
  function count(request,hasProfile){
    clearTimeout(countTimer);if(!data)return;
    if(!hasProfile){$('#crest-items').innerHTML='';return;}
    $('#crest-items').innerHTML='<p class="hint">Reading upgrade tracks …</p>';
    countTimer=setTimeout(async()=>{try{
      const preview=await api('/api/preview',request());const c=preview.crests;
      $('#crest-items').innerHTML=`<p class="hint"><strong>${c.candidates} upgrades</strong> of ${c.items.length} items · ${preview.total} SimC run${preview.total===1?'':'s'}</p><table class="result-table crest-items"><thead><tr><th>Equipped</th><th>Track</th><th>Item level</th><th>Crests to the top</th></tr></thead><tbody>${c.items.map(i=>`<tr><td>${esc(i.name)}<small>${esc(slotNames[i.slot]||i.slot)}</small></td><td>${esc(i.track)} ${i.level}/${i.max}${i.level===i.max?'<small>Fully upgraded</small>':c.affordable&&i.reach<i.max?`<small>${i.reach>i.level?`Crests reach ${i.reach}/${i.max}`:'Not affordable'}</small>`:''}</td><td>${i.itemLevel}</td><td>${i.level===i.max?'—':crestText(i.crests,i.currencyId)+(i.crests<i.fullCrests?`<small>${number(i.fullCrests-i.crests)} waived by the slot discount</small>`:'')}</td></tr>`).join('')}</tbody></table>`;
    }catch(e){$('#crest-items').innerHTML=`<p class="hint">${esc(e.message)}</p>`;}},350);
  }
  async function init(){
    try{data=await api('/api/upgrade-sources');render();
      $('#crest-options').addEventListener('change',()=>updateCount());
      $('#crest-options').addEventListener('click',e=>{const all=e.target.hasAttribute('data-crest-all'),none=e.target.hasAttribute('data-crest-none');if(!all&&!none)return;e.preventDefault();$$('[data-crest-slot]').forEach(el=>el.checked=all);updateCount();});
    }catch(e){$('#crest-options').textContent=e.message;notice(e.message);}
  }

  // Measured upgrades of one scenario: gain against the baseline, and what it costs from the equipped level.
  function measured(job,s){
    const stage=(job.stages||[]).find(st=>st.scenario===s&&st.status==='complete');if(!stage)return null;
    const base=stage.baseline,byKey=new Map(job.crests.candidates.map(c=>[c.key,c]));
    const rows=job.results.filter(r=>r.scenario===s&&r.status==='complete'&&byKey.has(r.key)).map(r=>{
      const c=byKey.get(r.key),delta=r.dps-base.dps,tanky=Number.isFinite(r.score);
      const error=r.error95!==null&&base.error95!==null?Math.hypot(r.error95,base.error95):null;
      return {c,r,delta,percent:100*delta/Math.max(1,base.dps),tanky,gain:tanky?r.score:delta,uncertain:tanky?Math.abs(r.score)<=(r.scoreError||0):error!==null&&Math.abs(delta)<=error};
    });
    return {base,rows,stage};
  }
  const gainText=(row,gain)=>row.tanky?`${signed(gain)} score`:`${plus(gain)} DPS`;
  function plan(job,s,rows){
    const budget=budgets.get(job.id)??job.crests.budget??null;
    const result=spendingPlan(rows.map(x=>({id:x.c.slot,to:x.c.to,gain:x.gain,crests:x.c.crests,currencyId:x.c.currencyId,row:x})),budget);
    const base=measured(job,s).base;const tanky=rows.some(x=>x.tanky);
    const total=tanky?`${signed(result.gain)} score`:`${plus(result.gain)} DPS (${signed(100*result.gain/Math.max(1,base.dps))} %)`;
    const cheapest=rows.filter(x=>x.gain>0).sort((a,b)=>a.c.crests-b.c.crests)[0];
    const spent=Object.entries(result.spent).map(([id,n])=>crestText(n,id)).join(' · ')||'no crests';
    const steps=result.steps.map((st,i)=>{const {row}=st.option,c=row.c;const from=job.crests.candidates.find(x=>x.slot===c.slot&&x.to===st.from);
      return `<li><span class="crest-step">${i+1}</span><span>${itemLink(c.itemId,c.name,c.value)}<small>${esc(slotNames[c.slot]||c.slot)} · ${esc(c.track.name)} ${st.from||c.from}/${c.max} → ${c.to}/${c.max} · item level ${from?.itemLevel??c.fromItemLevel} → ${c.itemLevel}</small></span><span>${crestText(st.crests,st.currencyId)}</span><b>${gainText(row,st.gain)}${!row.tanky?`<small>${st.crests?`${number(st.gain/st.crests)} DPS per crest`:'free'}</small>`:''}</b></li>`;}).join('');
    return `<h4 class="upgrade-heading">Spend your crests in this order</h4>
      <div class="crest-budget" data-crest-job="${esc(job.id)}">${job.crests.currencies.map(c=>`<label><span>${icon(c)}${esc(c.name)}</span><input type="number" min="0" step="1" data-plan-have="${c.id}" value="${budget&&budget[c.id]!==undefined?budget[c.id]:''}" placeholder="No limit"></label>`).join('')}</div>
      <p class="hint">${budget?'Within the crests above.':'No crest limit: every upgrade that gains, best value first.'} Change the numbers to plan again without simulating${job.crests.affordable?'; more crests than the run had cannot add upgrades it did not simulate':''}.</p>
      ${result.steps.length?`<ol class="crest-plan">${steps}</ol><p class="hint">Total: ${total} for ${spent}.${result.left?` Left over: ${Object.entries(result.left).filter(([id])=>result.spent[id]).map(([id,n])=>n?crestText(n,id):`0 ${esc(currency(id)?.name)}`).join(' · ')||'nothing'}.`:''}</p>`:`<p class="hint">${cheapest?`Nothing fits these crests. The cheapest measured gain needs ${crestText(cheapest.c.crests,cheapest.c.currencyId)}.`:'No measured upgrade gains.'}</p>`}`;
  }
  function table(rows){
    const value=x=>x.c.crests?x.gain/x.c.crests:x.gain>0?Infinity:-Infinity;
    const sorted=[...rows].sort((a,b)=>value(b)-value(a)||b.gain-a.gain);const max=Math.max(...rows.map(x=>Math.abs(x.tanky?x.gain:x.percent)),1e-9);
    return `<table class="result-table"><thead><tr><th>Upgrade</th><th>Crests from equipped</th><th>${rows.some(x=>x.tanky)?'Score':'vs current'}</th><th>Per crest</th></tr></thead><tbody>${sorted.map(x=>`<tr><td>${itemLink(x.c.itemId,x.c.name,x.c.value)}<small>${esc(slotNames[x.c.slot]||x.c.slot)} · ${esc(x.c.track.name)} ${x.c.from}/${x.c.max} → ${x.c.to}/${x.c.max} · item level ${x.c.fromItemLevel} → ${x.c.itemLevel}</small>${x.gain>0?`<div class="bar"><span style="width:${((x.tanky?x.gain:x.percent)/max*100).toFixed(1)}%"></span></div>`:''}</td><td>${crestText(x.c.crests,x.c.currencyId)}${x.c.crests<x.c.fullCrests?`<small>${number(x.c.fullCrests-x.c.crests)} waived by the slot discount</small>`:''}</td><td>${x.tanky?`${signed(x.gain)}<small>DPS ${signed(x.r.dpsGain)} % · survival ${signed(x.r.survival)} %${x.uncertain?' · uncertain':''}</small>`:`${signed(x.percent)} %<small>${plus(x.delta)} DPS${x.uncertain?' · uncertain':''}</small>`}</td><td>${x.c.crests?(x.gain>0?(x.tanky?(x.gain/x.c.crests).toFixed(3):number(x.gain/x.c.crests)):'—'):'Free'}</td></tr>`).join('')}</tbody></table>`;
  }
  function results(job){
    if(!job.crests)return '';
    lastJob=job;
    const own=job.crests.state?.exported?'Crests and slot discounts from the addon export.':'The export had no crest data; costs assume no slot discount.';
    let html=`<div class="search-summary"><strong>Crest Planner · ${job.crests.candidates.length} upgrades · ${esc(job.crests.season?.name)}</strong><p class="hint">${own} ${job.crests.affordable?'Only upgrades the crests paid for were simulated.':''} ${job.crests.levels==='max'?'Each item was simulated at the highest level simulated for it.':'Every level up to that was simulated.'}</p></div>`;
    for(let s=0;s<job.scenarios.length;s++){
      const scenario=job.scenarios[s];const failed=(job.stages||[]).find(st=>st.scenario===s&&st.status==='failed');
      const m=measured(job,s);if(!m&&!failed)continue;
      html+=`<section class="result-scenario" data-crest-scenario="${s}"><h3>${esc(scenario.style)} <span class="muted">/ ${scenario.targets} targets / ${job.settings.duration} sec</span></h3>`;
      if(failed)html+=`<p class="notice">The run failed: ${esc(failed.error)}</p>`;
      if(m){
        html+=`<p class="hint">Current gear: ${number(m.base.dps)} DPS${m.base.error95!==null?` ± ${number(m.base.error95)}`:''}</p>`;
        html+=`<div class="crest-plan-box">${plan(job,s,m.rows)}</div>`;
        html+=`<h4 class="upgrade-heading">Every upgrade, best value first</h4>${table(m.rows)}`;
        html+=`<p class="result-note"><a href="/reports/${job.id}/${m.stage.stem}.html" download>HTML</a> <a href="/reports/${job.id}/${m.stage.stem}.json" download>JSON</a> <a href="/reports/${job.id}/${m.stage.stem}.simc" download>Input</a></p>`;
      }
      html+='</section>';
    }
    return `<div id="crest-results">${html}</div>`;
  }
  $('#result-content').addEventListener('input',event=>{
    const el=event.target;if(!el.matches('[data-plan-have]')||!lastJob)return;
    const budget={};for(const input of el.closest('.crest-budget').querySelectorAll('[data-plan-have]'))if(input.value!==''&&Number(input.value)>=0)budget[input.dataset.planHave]=Math.floor(Number(input.value));
    budgets.set(lastJob.id,Object.keys(budget).length?budget:null);
    // Only the plan is drawn again, so the field being typed in keeps its focus.
    const section=el.closest('[data-crest-scenario]');
    for(const other of $$('#crest-results [data-crest-scenario]')){
      const n=Number(other.dataset.crestScenario),m=measured(lastJob,n);if(!m)continue;
      const box=other.querySelector('.crest-plan-box');const focus=other===section?el.dataset.planHave:null;const caret=el.selectionStart;
      box.innerHTML=plan(lastJob,n,m.rows);
      if(focus){const again=box.querySelector(`[data-plan-have="${focus}"]`);again.focus();try{again.setSelectionRange(caret,caret);}catch{}}
    }
  });
  return {init,settings,count,results,show};
}
