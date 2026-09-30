import {itemLink,slotNames} from '/items.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const signed=(n,digits=2)=>`${n>=0?'+':''}${n.toFixed(digits)}`;
const plus=n=>`${n>=0?'+':''}${number(n)}`;

export function vaultUI({api,updateCount}){
  let countTimer=null;
  $('#quick-info').insertAdjacentHTML('beforebegin',`<section id="vault-panel" class="panel" hidden><div class="panel-heading"><h2><span class="step">02</span> Great Vault</h2><span class="pill">From the addon export</span></div><p class="panel-intro">Every choice in your Great Vault is simulated in its slot against the gear you wear, so you can see which one to take. Rings and trinkets are tried in both slots, and the better one is shown.</p>
    <label class="check"><input type="checkbox" id="vault-upgraded"> Also simulate each choice at the top of its upgrade track</label>
    <p class="hint">The SimulationCraft addon exports the vault only while it has rewards to claim. After the weekly reset, open the Great Vault in the game, type /simc and import the new export.</p>
    <div id="vault-items"></div>
    <p class="result-note">One SimC run per scenario at your simulation settings. The enchant and the gems of the item a choice replaces carry over into it. A two-hander replaces a main hand and off-hand together.</p></section>`);
  $('#vault-panel').addEventListener('change',()=>updateCount());
  const settings=()=>({upgraded:$('#vault-upgraded').checked});
  const trackText=t=>t?`${esc(t.name)} ${t.level}/${t.max}`:'';
  function count(request,hasProfile){
    clearTimeout(countTimer);
    if(!hasProfile){$('#vault-items').innerHTML='';return;}
    $('#vault-items').innerHTML='<p class="hint">Reading the vault …</p>';
    countTimer=setTimeout(async()=>{try{
      const v=(await api('/api/preview',request())).vault;
      $('#vault-items').innerHTML=`<p class="hint"><strong>${v.items.length} choice${v.items.length===1?'':'s'}</strong> · ${v.candidates} profilesets</p><table class="result-table"><thead><tr><th>Choice</th><th>Item level</th><th>Tried in</th></tr></thead><tbody>${v.items.map(i=>`<tr><td>${itemLink(i.itemId,i.name)}${i.track?`<small>${trackText(i.track)}</small>`:''}</td><td>${i.itemLevel??'—'}</td><td>${i.slots.map(s=>esc(slotNames[s]||s)).join(' or ')}</td></tr>`).join('')}${v.skipped.map(i=>`<tr><td>${itemLink(i.itemId,i.name)}</td><td>—</td><td class="muted">${esc(i.reason)}</td></tr>`).join('')}</tbody></table>`;
    }catch(e){$('#vault-items').innerHTML=`<p class="hint">${esc(e.message)}</p>`;}},350);
  }
  // One row per choice and level: the better of its placements.
  function measured(job,s){
    const stage=(job.stages||[]).find(st=>st.scenario===s&&st.status==='complete');if(!stage)return null;
    const base=stage.baseline,byKey=new Map(job.vault.candidates.map(c=>[c.key,c])),best=new Map();
    for(const r of job.results.filter(r=>r.scenario===s&&r.status==='complete'&&byKey.has(r.key))){
      const c=byKey.get(r.key),delta=r.dps-base.dps,tanky=Number.isFinite(r.score);
      const error=r.error95!==null&&base.error95!==null?Math.hypot(r.error95,base.error95):null;
      const row={c,r,delta,percent:100*delta/Math.max(1,base.dps),tanky,gain:tanky?r.score:delta,uncertain:tanky?Math.abs(r.score)<=(r.scoreError||0):error!==null&&Math.abs(delta)<=error};
      const id=`${c.choice}|${c.upgraded?1:0}`;if(!best.has(id)||row.gain>best.get(id).gain)best.set(id,row);
    }
    return {base,stage,rows:[...best.values()].sort((a,b)=>b.gain-a.gain)};
  }
  const gainCell=x=>x.tanky?`${signed(x.gain)}<small>DPS ${signed(x.r.dpsGain)} % · survival ${signed(x.r.survival)} %${x.uncertain?' · uncertain':''}</small>`:`${signed(x.percent)} %<small>${plus(x.delta)} DPS${x.uncertain?' · uncertain':''}</small>`;
  function results(job){
    if(!job.vault)return '';
    let html=`<div class="search-summary"><strong>Great Vault · ${job.vault.items.length} choice${job.vault.items.length===1?'':'s'}</strong><p class="hint">Each choice in the slot where it gains the most.${job.vault.upgraded?' Choices below the top of their track were also simulated fully upgraded.':''}${job.vault.skipped?.length?` Not simulated: ${job.vault.skipped.map(i=>`${esc(i.name)} (${esc(i.reason)})`).join(', ')}.`:''}</p></div>`;
    for(let s=0;s<job.scenarios.length;s++){
      const scenario=job.scenarios[s],failed=(job.stages||[]).find(st=>st.scenario===s&&st.status==='failed');
      const m=measured(job,s);if(!m&&!failed)continue;
      html+=`<section class="result-scenario"><h3>${esc(scenario.style)} <span class="muted">/ ${scenario.targets} targets / ${job.settings.duration} sec</span></h3>`;
      if(failed)html+=`<p class="notice">The run failed: ${esc(failed.error)}</p>`;
      if(m){
        const asIs=m.rows.filter(x=>!x.c.upgraded),pick=asIs[0];
        html+=`<p class="hint">Current gear: ${number(m.base.dps)} DPS${m.base.error95!==null?` ± ${number(m.base.error95)}`:''}</p>`;
        if(pick)html+=`<p class="vault-pick">${pick.gain>0?'Take':'Nothing beats your gear. The least loss is'} <strong>${itemLink(pick.c.itemId,pick.c.name,pick.c.value)}</strong> in ${esc(slotNames[pick.c.slot]||pick.c.slot)} · ${pick.tanky?`${signed(pick.gain)} score`:`${signed(pick.percent)} % (${plus(pick.delta)} DPS)`}${pick.gain>0&&asIs[1]&&(pick.uncertain||asIs[1].uncertain)&&Math.abs(pick.gain-asIs[1].gain)<=Math.hypot(pick.r.error95||0,asIs[1].r.error95||0)?` · too close to call against ${esc(asIs[1].c.name)}; raise the precision to separate them`:''}</p>`;
        const max=Math.max(...m.rows.map(x=>Math.abs(x.tanky?x.gain:x.percent)),1e-9);
        html+=`<table class="result-table"><thead><tr><th>Choice</th><th>Slot</th><th>Item level</th><th>${m.rows.some(x=>x.tanky)?'Score':'vs current'}</th></tr></thead><tbody>${m.rows.map(x=>`<tr${x===pick?' class="best"':''}><td>${itemLink(x.c.itemId,x.c.name,x.c.value)}<small>${x.c.upgraded?'Fully upgraded · ':''}${trackText(x.c.track)}</small>${x.gain>0?`<div class="bar"><span style="width:${((x.tanky?x.gain:x.percent)/max*100).toFixed(1)}%"></span></div>`:''}</td><td>${esc(slotNames[x.c.slot]||x.c.slot)}</td><td>${x.c.itemLevel??'—'}</td><td>${gainCell(x)}</td></tr>`).join('')}</tbody></table>`;
        html+=`<p class="result-note"><a href="/reports/${job.id}/${m.stage.stem}.html" download>HTML</a> <a href="/reports/${job.id}/${m.stage.stem}.json" download>JSON</a> <a href="/reports/${job.id}/${m.stage.stem}.simc" download>Input</a></p>`;
      }
      html+='</section>';
    }
    return html;
  }
  return {settings,count,results};
}
