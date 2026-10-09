import {itemLink,slotNames} from '/items.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);

// Slots in the order a player reads them. Rings and trinkets are answered by pairs, the rest one slot at a time.
const single=['head','neck','shoulder','back','chest','wrist','hands','waist','legs','feet'];
const weapons=['main_hand','off_hand'];
const families={finger:'Rings',trinket:'Trinkets'};
const signed=(n,digits=2)=>`${n>=0?'+':''}${n.toFixed(digits)}`;

// The weighted score of a measured row. Each row keeps its gain in DPS and in survival, so another weight is a sum, not a
// new simulation. Rows from before the errors were kept fall back on the error they were weighed with.
export const weighted=(row,w)=>({
  score:(1-w)*row.dpsGain+w*row.survival,
  error:Number.isFinite(row.dpsError)&&Number.isFinite(row.survivalError)?Math.hypot((1-w)*row.dpsError,w*row.survivalError):row.scoreError||0
});

// What to wear in every slot of one fight, at a weight (0 to 1): the best measured item per slot, and the best pair of
// trinkets and of rings. A slot where nothing beats the current gear says to keep it.
export function recommend(job,s,w){
  const up=job.upgrade;if(!up)return null;
  const candidates=new Map(up.candidates.map(c=>[c.key,c]));
  const rows=job.results.filter(r=>r.scenario===s&&r.stage===2&&r.status==='complete'&&candidates.has(r.key)&&Number.isFinite(r.dpsGain)).map(r=>({r,c:candidates.get(r.key),...weighted(r,w)}));
  const pairs=(up.jewelryPairs||[]).filter(p=>p.scenario===s).map(p=>{const r=job.results.find(x=>x.scenario===s&&x.stage===4&&x.key===p.key&&x.status==='complete'&&Number.isFinite(x.dpsGain));return r?{r,p,...weighted(r,w)}:null;}).filter(Boolean);
  const best=list=>[...list].sort((a,b)=>b.score-a.score)[0];
  // A slot counts as searched when anything was offered for it, even if screening sent nothing on: it was measured and lost.
  const offered=slot=>up.candidates.some(c=>c.slot===slot);
  const slots=[...single,...weapons].map(slot=>{const pick=best(rows.filter(x=>x.c.slot===slot));return {slot,pick:pick&&pick.score>0?pick:null,tried:offered(slot)};});
  const sets=Object.keys(families).map(family=>{const own=pairs.filter(x=>x.p.family===family).sort((a,b)=>b.score-a.score);return {family,pick:own[0]&&own[0].score>0?own[0]:null,top:own.slice(0,5),tried:own.length>0||offered(family+'1')||offered(family+'2')};});
  return {slots,sets,rows:rows.length,hasPairs:pairs.length>0};
}

const gain=x=>`${signed(x.score)}<small>DPS ${signed(x.r.dpsGain)} % · survival ${signed(x.r.survival)} %${Math.abs(x.score)<=x.error?' · uncertain':''}</small>`;
function piece(c,up){
  // The same item you wear, at a higher level: say so, since the name alone looks like "keep".
  if(!c.upgrade&&Object.entries(up.worn||{}).some(([slot,w])=>w.itemId===c.itemId&&(slot===c.slot||slot.replace(/\d$/,'')===c.slot.replace(/\d$/,''))))return `${itemLink(c.itemId,c.name,c.value)}<small>The item you wear, at item level ${c.itemLevel} · ${esc(label(c))}</small>`;
  if(c.upgrade)return `${itemLink(c.itemId,c.name,c.value)}<small>Upgrade to ${c.upgrade.to}/${c.upgrade.max} · item level ${c.itemLevel} · ${c.upgrade.crests} crest${c.upgrade.crests===1?'':'s'} from ${c.upgrade.from}/${c.upgrade.max}</small>`;
  return `${itemLink(c.itemId,c.name,c.value)}<small>Item level ${c.itemLevel} · ${esc(label(c))}</small>`;
}
// The source label often carries the item level already; it is shown once.
const label=c=>String(c.sources?.[0]?.label||'').replace(/\s*·?\s*item level \d+/i,'');
const wornName=(up,slot)=>esc(up.worn?.[slot]?.name||'—');
const part=p=>p.worn?`${esc(p.name)}<small>worn now · keep</small>`:`${itemLink(p.itemId,p.name,p.value)}<small>new · item level ${p.itemLevel}${p.upgrade?` · upgrade to ${p.upgrade.to}/${p.upgrade.max}`:''}</small>`;

export function recommendBody(job,s,w){
  const up=job.upgrade,rec=recommend(job,s,w);
  if(!rec||!rec.rows)return '<p class="hint">The gear search has not finished for this fight yet.</p>';
  const slotRow=({slot,pick,tried})=>`<tr><td>${esc(slotNames[slot]||slot)}</td><td>${wornName(up,slot)}</td><td>${pick?piece(pick.c,up):`<span class="hint">${tried?'Keep what you wear':'Nothing offered for this slot'}</span>`}</td><td>${pick?gain(pick):'—'}</td></tr>`;
  const setRow=({family,pick,tried,top})=>{
    const label=families[family],now=['1','2'].map(n=>wornName(up,family+n)).join(' + ');
    const others=top.length>1?`<details class="log-details"><summary>Best ${label.toLowerCase().replace(/s$/,'')} pairs measured</summary><table class="result-table"><thead><tr><th>First</th><th>Second</th><th>Score</th></tr></thead><tbody>${top.map(x=>`<tr><td>${part(x.p.parts[0])}</td><td>${part(x.p.parts[1])}</td><td>${gain(x)}</td></tr>`).join('')}</tbody></table></details>`:'';
    return `<tr><td>${label}<small>as a pair</small></td><td>${now}</td><td>${pick?`${part(pick.p.parts[0])}<br>${part(pick.p.parts[1])}`:`<span class="hint">${tried?'Keep both':'Not searched'}</span>`}${others}</td><td>${pick?gain(pick):'—'}</td></tr>`;
  };
  const head=slots=>slots.map(slotRow).join('');
  const [first,last]=[rec.slots.filter(x=>single.includes(x.slot)),rec.slots.filter(x=>weapons.includes(x.slot))];
  return `<table class="result-table reco-table"><thead><tr><th>Slot</th><th>You wear</th><th>Wear this</th><th>Score</th></tr></thead><tbody>${head(first)}${rec.sets.filter(x=>x.tried||up.jewelry).map(setRow).join('')}${head(last)}</tbody></table>`;
}

export function recommendUI(){
  let lastJob=null,fight=0,weight=null,jobId=null;
  const jobWeight=job=>(job.settings?.tank?.weight??50);
  const note=job=>{const w=weight??jobWeight(job);return Math.abs(w-jobWeight(job))>=15?`<p class="notice">The final round was chosen with ${jobWeight(job)}% weight on survival. At ${w}% something better may be missing from it: run again with the weight you want to be sure.</p>`:'';};
  function redraw(){
    const box=$('#tank-reco-body');if(!box||!lastJob)return;
    const w=weight??jobWeight(lastJob);
    box.innerHTML=recommendBody(lastJob,fight,w/100);
    const label=$('#tank-reco-label');if(label)label.textContent=`${w}% survival · ${100-w}% DPS`;
    const warn=$('#tank-reco-note');if(warn)warn.innerHTML=note(lastJob);
  }
  document.querySelector('#result-content').addEventListener('input',e=>{if(e.target.id!=='tank-reco-weight')return;weight=Number(e.target.value);redraw();});
  document.querySelector('#result-content').addEventListener('click',e=>{const chip=e.target.closest('[data-reco-fight]');if(!chip||!lastJob)return;fight=Number(chip.dataset.recoFight);document.querySelectorAll('[data-reco-fight]').forEach(c=>c.classList.toggle('active',c===chip));redraw();});
  return {
    html(job,fights){
      if(!job.upgrade||!job.results.some(r=>r.stage===2&&r.status==='complete'&&Number.isFinite(r.dpsGain)))return '';
      if(jobId!==job.id){jobId=job.id;weight=null;fight=0;}
      lastJob=job;
      const w=weight??jobWeight(job);
      const chips=job.scenarios.length>1?`<div class="slot-filter">${job.scenarios.map((sc,i)=>`<button class="slot-chip${i===fight?' active':''}" data-reco-fight="${i}">${esc(fights.find(f=>f.targets===sc.targets)?.label||`${sc.targets} targets`)}</button>`).join('')}</div>`:'';
      return `<section class="tank-reco"><h3>Gear to wear</h3><p class="hint">What scored best in every slot for the fight below, at the weight you set. Each slot was measured on its own against the gear you wear now, so these are not one combined set: two upgrades can be worth less together than apart. Trinkets and rings are the exception, because they are simulated as pairs.</p><div class="reco-weight"><label>Ranking weight<input id="tank-reco-weight" type="range" min="0" max="100" step="5" value="${w}"></label><span class="hint" id="tank-reco-label">${w}% survival · ${100-w}% DPS</span></div><div id="tank-reco-note">${note(job)}</div>${chips}<div id="tank-reco-body">${recommendBody(job,fight,w/100)}</div></section>`;
    }
  };
}
