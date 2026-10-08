// The Best in Slot report: one page per finished job. The best full set the sources allow, slot by slot against what the
// character wears, where each piece comes from, and what each piece is worth inside the set. Like the upgrade report it
// carries no script of its own, so it reads the same after it is saved and sent on.
import {escape,number,signed,classColors,classNames,title,link,reportCss} from './upgradepage.mjs';

const originNames={raid:'Raid',mplus:'Mythic+',crafted:'Crafted',catalyst:'Revival Catalyst',bags:'Your bags'};
const families=[['head','Head'],['neck','Neck'],['shoulder','Shoulders'],['back','Back'],['chest','Chest'],['wrist','Wrists'],['hands','Hands'],['waist','Waist'],['legs','Legs'],['feet','Feet'],['finger1','Ring 1'],['finger2','Ring 2'],['trinket1','Trinket 1'],['trinket2','Trinket 2'],['main_hand','Main hand'],['off_hand','Off hand']];
const groupOf=slot=>String(slot).replace(/[12]$/,'');
const originOf=c=>c.sources?.[0]?.origin;

// The shopping list: the pieces of the set grouped by where they drop, best source first.
export function shoppingList(pieces){
  const groups=new Map();
  for(const p of pieces)for(const s of p.c.sources.slice(0,1)){
    const id=s.group;if(!groups.has(id))groups.set(id,{origin:s.origin,name:s.groupName,items:[]});
    groups.get(id).items.push(p);
  }
  const order=Object.keys(originNames);
  return [...groups.values()].sort((a,b)=>order.indexOf(a.origin)-order.indexOf(b.origin)||b.items.length-a.items.length||a.name.localeCompare(b.name));
}

// What changes in each slot: the piece to wear, or the one you wear kept.
export function slotRows(job,run){
  const byKey=new Map(job.bis.candidates.map(c=>[c.key,c])),worn=new Map(job.bis.worn.map(w=>[w.slot,w]));
  const worth=new Map((run.final?.slots||[]).map(s=>[s.slot,s]));
  const set=new Map((run.set||[]).map(s=>[s.slot,s]));
  return families.map(([slot,name])=>{
    const w=worn.get(slot),pick=set.get(slot),c=pick?.key?byKey.get(pick.key):null;
    if(!w&&!c)return null;
    return {slot,name,worn:w,c,worth:worth.get(slot)};
  }).filter(Boolean);
}

// The tier set: the slots cheapest to make tier first, and which pieces of the set come from the Catalyst.
export function catalystSection(run,unit,slotName=g=>g){
  const c=run.catalyst;if(!c?.slots?.length)return '';
  const cost=s=>{const noise=Math.hypot(s.tier.noise||0,s.alt.noise||0),v=-s.cost;return `<b>${signed(v)}${unit}</b><small>${Math.abs(v)<=noise?'within noise':v>0?'tier is better here':'costs this much'}</small>`;};
  const piece=p=>`${escape(p.name)}<small>${p.itemLevel?`item level ${p.itemLevel} · `:''}${escape(originNames[p.origin]||(p.kept?'worn':''))}</small>`;
  return `<h3>Tier set · ${escape(c.set)}</h3><p class="lead">${c.pieces??0} pieces in the set${c.required?', as required':' (the 4 piece set was not required)'}. The slots where wearing tier costs least come first. Where the tier piece comes from the Catalyst, convert any piece of that slot at that item level: a spare drop is enough, and the piece you convert does not matter.</p><table><thead><tr><th>Slot</th><th>Tier piece</th><th>Best other piece</th><th>Tier vs other</th><th>In the set</th></tr></thead><tbody>${c.slots.map(s=>`<tr${s.chosen?' class="first"':''}><td>${escape(slotName(s.group))}</td><td>${piece(s.tier)}</td><td>${piece(s.alt)}</td><td class="num">${cost(s)}</td><td>${s.chosen?(s.catalyzed?'Yes · from the Catalyst':'Yes'):'No'}</td></tr>`).join('')}</tbody></table>`;
}

function scenarioSection(job,scenario,index){
  const run=job.bis.runs[index];if(!run)return '';
  const tanky=!!job.settings.tank,unit=tanky?'':' %';
  const rows=slotRows(job,run),changed=rows.filter(r=>r.c);
  const final=run.final;
  const headline=final?.same?`<p class="note">Nothing in the sources you chose beats what you wear by more than the noise, so you are already best in slot from them as far as the simulation can tell.</p>`
    :final?.current?`<p class="scenario-title"><b>${escape(scenario.style)} · ${scenario.targets} target${scenario.targets===1?'':'s'}</b> Best in slot ${number(final.dps)} DPS · what you wear ${number(final.current.dps)} DPS · <b>${signed(final.gain)}${unit}</b></p>`
    :`<p class="scenario-title"><b>${escape(scenario.style)} · ${scenario.targets} target${scenario.targets===1?'':'s'}</b></p>`;
  const notes=run.notes.map(n=>`<p class="note">${escape(n)}</p>`).join('');
  const worth=r=>r.worth&&Number.isFinite(r.worth.worth)?`<em>${signed(r.worth.worth)}${unit}</em>`:'';
  const cards=rows.map(r=>`<article class="slot${r.c?' up':''}">
      <header><span>${escape(r.name)}</span>${worth(r)}</header>
      <div class="worn">${r.worn?`<span>${link(r.worn.itemId,r.worn.name,r.worn.value)}</span>`:'<span class="muted">Empty</span>'}</div>
      ${r.c?`<div class="best"><span class="arrow">↑</span><span>${link(r.c.itemId,r.c.name,r.c.value)}<small>${r.c.sources.map(s=>escape(s.label)).join('<br>')}${r.c.embellishment&&!r.c.sources[0]?.label?.includes(r.c.embellishment)?` · ${escape(r.c.embellishment)}`:''}${r.c.freed?` · worn in place of the ${escape(r.c.freed.embellishment)} on ${escape(r.c.freed.item)}`:''}${r.worth&&Math.abs(r.worth.worth)<=r.worth.noise?' · within noise':''}</small></span></div>`:'<p class="none">Keep it.</p>'}
    </article>`).join('');
  const list=shoppingList(changed).map(g=>`<div class="origin"><h4>${escape(originNames[g.origin]||g.origin)} · ${escape(g.name)}</h4><ol>${g.items.map(p=>`<li><span class="item">${link(p.c.itemId,p.c.name,p.c.value)}<small>${escape(p.name)} · item level ${p.c.itemLevel}</small></span><span class="gain">${p.worth?`<b>${signed(p.worth.worth)}${unit}</b>`:''}</span></li>`).join('')}</ol></div>`).join('');
  // The best piece from each source for every slot group, as measured alone: what to take when the best one is out of reach.
  const byKey=new Map(job.bis.candidates.map(c=>[c.key,c]));
  const origins=Object.keys(originNames).filter(o=>Object.values(run.bySource||{}).some(g=>g[o]));
  const groups=[['head','Head'],['neck','Neck'],['shoulder','Shoulders'],['back','Back'],['chest','Chest'],['wrist','Wrists'],['hands','Hands'],['waist','Waist'],['legs','Legs'],['feet','Feet'],['finger','Rings'],['trinket','Trinkets'],['main_hand','Main hand'],['off_hand','Off hand']];
  const cell=(g,o)=>{const e=run.bySource?.[g]?.[o],c=e&&byKey.get(e.key);return c?`${link(c.itemId,c.name,c.value)}<small>${c.itemLevel} · ${signed(e.rank)}${unit}${Math.abs(e.rank)<=e.noise?' · within noise':''}</small>`:'<span class="muted">—</span>';};
  const sources=origins.length?`<h3>Best piece from each source</h3><p class="lead">Each piece alone in its slot against the gear you wear, final round. When the best piece is out of reach, take the next from the source you do play.</p><table><thead><tr><th>Slot</th>${origins.map(o=>`<th>${escape(originNames[o])}</th>`).join('')}</tr></thead><tbody>${groups.filter(([g])=>run.bySource?.[g]).map(([g,name])=>`<tr><td>${escape(name)}</td>${origins.map(o=>`<td>${cell(g,o)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'';
  const how=run.variants?.length||run.rounds?.length?`<details class="lost"><summary>How the set was found <span>${(run.variants?.length||0)+(run.rounds?.length||0)} steps</span></summary><p class="lead">The search starts from the best piece in every slot and from each way to reach an item set bonus, then keeps making the single change that helps most while one still helps by more than the noise. It was checked by simulation, but it is a bounded search, not a proof that nothing better exists.</p><table><thead><tr><th>Step</th><th>What</th><th>${tanky?'Score':'vs what you wear'}</th></tr></thead><tbody>${(run.variants||[]).map(v=>`<tr${v.key===run.start?' class="first"':''}><td>First set</td><td>${escape(v.label)}${v.tier!==undefined?` · ${v.tier} tier pieces`:''}${v.key===run.start?'<small>Started from this one</small>':v.allowed===false?'<small>Not allowed: fewer than 4 tier pieces</small>':''}</td><td class="num">${Number.isFinite(v.gain)?`${signed(v.gain)}${unit}`:'—'}</td></tr>`).join('')}${(run.rounds||[]).map(r=>`<tr><td>Round ${r.round}</td><td>${r.adopted?r.adopted.map(a=>escape(a.label)).join('<br>'):`No change beat the set (${r.tried} tried)`}<small>${r.tried} sets tried</small></td><td class="num">${r.adopted?r.adopted.map(a=>`${signed(a.gain)}${unit}`).join('<br>'):'—'}</td></tr>`).join('')}</tbody></table></details>`:'';
  return `<section class="scenario">
    ${headline}${notes}
    <h3>Slot by slot</h3><div class="slots">${cards}</div>
    ${catalystSection(run,unit,g=>(families.find(([s])=>s===g)||[g,g])[1])}
    ${list?`<h3>Where to get it</h3><div class="sources">${list}</div>`:''}
    ${sources}
    ${how}
  </section>`;
}

export function bisReportPage(job,{info={},armory=false}={}){
  if(!job.bis)throw new Error('This job is not a Best in Slot run.');
  const color=classColors[info.class]||'#f3b754';
  const first=job.bis.runs[0];
  const name=info.name||job.name,specText=[title(info.spec),classNames[info.class]].filter(Boolean).join(' ');
  const tanky=!!job.settings.tank,unit=tanky?'':' %';
  const when=new Date(job.finished||job.created).toISOString().slice(0,10);
  const stat=(value,label,good)=>`<div class="stat${good?' good':''}"><strong>${value}</strong><span>${escape(label)}</span></div>`;
  const final=first?.final;
  const changed=first?.set?.filter(s=>s.key).length||0;
  const screen=job.bis.screen;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${escape(name)} · Best in Slot · ${escape(job.bis.season?.name||'')}</title>
<script async src="https://wow.zamimg.com/js/tooltips.js"></script>
<style>
${reportCss(color)}
</style></head>
<body><main>
<header class="hero">
  <span class="eyebrow">${escape(job.bis.season?.name||'Best in Slot')} · Best in Slot</span>
  <h1>${escape(name)}<span>${escape(specText)}${armory?'<i class="tag">Armory import</i>':''}</span></h1>
  <p class="lede">The best full set of gear this character can reach from the sources chosen, with every piece fully upgraded. Each piece was simulated in its slot, then the best set was built from the results and simulated as a whole, because gear does not add up: stats trade against each other, the embellishment limit binds and a tier set only pays once enough pieces are worn. ${tanky?'Ranked on a weighted score of damage and survival.':'Ranked on the change in DPS.'} Simulated locally with SimulationCraft ${escape(job.engine.version)} on WoW ${escape(job.engine.wowVersion)}.</p>
  <div class="stats">
    ${final?.current?stat(number(final.current.dps),'DPS now')+stat(number(final.dps),'DPS best in slot')+stat(`${signed(final.gain)}${unit}`,'gain',true):''}
    ${stat(String(changed),'slots to change')}
    ${stat(String(job.bis.candidates.length),'candidates')}
    ${stat(when,'simulated')}
  </div>
</header>
${job.scenarios.map((s,i)=>scenarioSection(job,s,i)).join('')}
<footer>
Built by <a href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer">SimC Lab</a> · powered by <a href="https://github.com/simulationcraft/simc" target="_blank" rel="noopener noreferrer">SimulationCraft</a> · items link to Wowhead, and hovering one shows its tooltip.<br>
Every source is assumed fully upgraded; the crests that takes are not counted. Screening: up to ${number(screen.iterations)} iterations at ${screen.targetError}% target error. Final round and set simulations: ${number(job.settings.iterations)} iterations at ${job.settings.targetError}% target error, ${job.settings.duration} sec fights. “Within noise” marks a gain inside the combined 95% uncertainty.<br>
Your enchant carries over to a new item, and gems carry over into sockets it already has. Some crafted pieces require the matching profession to equip, and the data does not say which ones.${armory?' This character came from the Armory, which shows the gear from its last logout.':''}
</footer>
</main></body></html>`;
}
