// The Upgrade Finder's own report: one page per finished job, in the spirit of a Droptimizer report. Your gear
// slot by slot with the best upgrade for each, the best item per boss and dungeon, and every measured upgrade.
// Like the weapon tier list it carries no script of its own, so it survives the app's content policy and reads
// the same after it is saved and sent on; only Wowhead's tooltip script is fetched.
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const signed=(n,digits=2)=>`${n>=0?'+':''}${Number(n).toFixed(digits)}`;
const classColors={deathknight:'#C41E3A',demonhunter:'#A330C9',druid:'#FF7C0A',evoker:'#33937F',hunter:'#AAD372',mage:'#3FC7EB',monk:'#00FF98',paladin:'#F48CBA',priest:'#DFDFDF',rogue:'#FFF468',shaman:'#0070DD',warlock:'#8788EE',warrior:'#C69B6D'};
const classNames={deathknight:'Death Knight',demonhunter:'Demon Hunter',druid:'Druid',evoker:'Evoker',hunter:'Hunter',mage:'Mage',monk:'Monk',paladin:'Paladin',priest:'Priest',rogue:'Rogue',shaman:'Shaman',warlock:'Warlock',warrior:'Warrior'};
const originNames={raid:'Raid',mplus:'Mythic+',vault:'Great Vault',delves:'Delves',crafted:'Crafted'};
const families=[['head','Head'],['neck','Neck'],['shoulder','Shoulders'],['back','Back'],['chest','Chest'],['wrist','Wrists'],['hands','Hands'],['waist','Waist'],['legs','Legs'],['feet','Feet'],['finger','Rings'],['trinket','Trinkets'],['main_hand','Main hand'],['off_hand','Off hand']];
const slotNames={finger1:'Ring 1',finger2:'Ring 2',trinket1:'Trinket 1',trinket2:'Trinket 2',...Object.fromEntries(families)};
const family=slot=>String(slot||'').replace(/[12]$/,'');
const title=s=>String(s||'').split('_').filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');

// Wowhead reads bonus, gem and enchant IDs from the item's own SimC line, so link and tooltip show the item as
// it was simulated.
function itemParams(id,value){
  const params=[`item=${Number(id)}`];
  for(const [key,target] of [['bonus_id','bonus'],['gem_id','gems'],['enchant_id','ench']]){
    const raw=String(value||'').match(new RegExp(`(?:^|,)${key}=([\\d/]+)`))?.[1];
    if(raw)params.push(`${target}=${raw.replaceAll('/',':')}`);
  }
  const ilevel=String(value||'').match(/(?:^|,)ilevel=(\d+)/)?.[1];if(ilevel)params.push(`ilvl=${ilevel}`);
  return params;
}
const link=(id,name,value)=>{const p=itemParams(id,value);return `<a href="https://www.wowhead.com/${p[0]}${p.length>1?'?'+p.slice(1).join('&'):''}" data-wowhead="${escape(p.join('&'))}" target="_blank" rel="noopener noreferrer">${escape(name||`Item ${id}`)}</a>`;};

// The same reading of a job as the app's results view: one placement per item (rings and trinkets are tried in
// both slots), the final round over screening, tanks on their weighted score and everyone else on DPS.
export function measured(job,scenario){
  const candidates=new Map(job.upgrade.candidates.map(c=>[c.key,c]));
  const baselines={};for(const st of (job.stages||[]).filter(s=>s.scenario===scenario))if(st.baseline)baselines[st.stage]=st.baseline;
  const best=new Map();
  for(const row of job.results.filter(r=>r.scenario===scenario&&r.status==='complete'&&r.stage!==3)){
    const c=candidates.get(row.key),base=baselines[row.stage];if(!c||!base)continue;
    const delta=row.dps-base.dps,error=row.error95!=null&&base.error95!=null?Math.hypot(row.error95,base.error95):null;
    const percent=100*delta/Math.max(1,base.dps),tanky=Number.isFinite(row.score);
    const entry={...row,c,delta,percent,rank:tanky?row.score:percent,tanky,uncertain:tanky?Math.abs(row.score)<=(row.scoreError||0):error!==null&&Math.abs(delta)<=error};
    const id=family(c.slot)+'|'+c.value;const previous=best.get(id);
    if(!previous||row.stage>previous.stage||row.stage===previous.stage&&entry.rank>previous.rank)best.set(id,entry);
  }
  const rows=[...best.values()];
  return {rows,upgrades:rows.filter(r=>r.stage===2&&r.rank>0).sort((a,b)=>b.rank-a.rank),baselines,candidates};
}

function pairRows(job,scenario,base){
  const pairs=(job.upgrade.pairs||[]).filter(p=>p.scenario===scenario);if(!pairs.length||!base)return [];
  return job.results.filter(r=>r.scenario===scenario&&r.stage===3&&r.status==='complete').map(r=>{
    const pair=pairs.find(p=>p.key===r.key);if(!pair)return null;
    const tanky=Number.isFinite(r.score),percent=100*(r.dps-base.dps)/Math.max(1,base.dps);
    return {r,pair,tanky,percent,rank:tanky?r.score:percent};
  }).filter(Boolean).sort((a,b)=>b.rank-a.rank);
}

const gain=(r,{short=false}={})=>r.tanky
  ?`<b>${signed(r.score)}</b>${short?'':`<small>DPS ${signed(r.dpsGain)} % · survival ${signed(r.survival)} %</small>`}`
  :`<b>${signed(r.percent)} %</b>${short?'':`<small>${r.delta>=0?'+':''}${number(r.delta)} DPS</small>`}`;
const bar=(value,max)=>`<span class="bar"><i style="width:${Math.max(3,Math.min(100,100*value/(max||1))).toFixed(1)}%"></i></span>`;

function scenarioSection(job,scenario,index,equipped){
  const {rows,upgrades,baselines,candidates}=measured(job,index);
  const stages=(job.stages||[]).filter(s=>s.scenario===index);if(!stages.length)return '';
  const base=baselines[2]||baselines[1];const tanky=rows.some(r=>r.tanky);const unit=tanky?'':' %';
  const max=Math.max(...upgrades.map(r=>r.rank),0.01);
  const notes=stages.filter(s=>s.status==='failed'||s.status==='skipped').map(s=>`<p class="note">${escape(s.status==='failed'?`A stage failed: ${s.error}`:s.reason)}</p>`).join('');

  // Slot by slot: what you wear and the best measured upgrade for it.
  const slotCards=families.map(([key,name])=>{
    const worn=Object.entries(equipped).filter(([slot])=>family(slot)===key);
    const best=upgrades.find(r=>family(r.c.slot)===key);
    const tried=rows.some(r=>family(r.c.slot)===key);
    if(!worn.length&&!best)return '';
    return `<article class="slot${best?' up':''}">
      <header><span>${escape(name)}</span>${best?`<em>${signed(best.rank)}${unit}</em>`:''}</header>
      <div class="worn">${worn.map(([,g])=>`<span>${link(g.id,g.name,g.value)}</span>`).join('')||'<span class="muted">Empty</span>'}</div>
      ${best?`<div class="best"><span class="arrow">↑</span><span>${link(best.c.itemId,best.c.name,best.c.value)}<small>${escape(best.c.sources[0]?.label||best.c.itemLevel)}${best.c.embellishment&&!best.c.sources[0]?.label?.includes(best.c.embellishment)?` · ${escape(best.c.embellishment)}`:''}${best.uncertain?' · within noise':''}</small></span></div>`
        :`<p class="none">${tried?'Nothing measured beat it.':'Not searched.'}</p>`}
    </article>`;
  }).join('');

  // One line per boss, dungeon or source group: its best upgrade.
  const groups=new Map();
  for(const r of upgrades)for(const src of r.c.sources){const g=groups.get(src.group);if(!g||r.rank>g.r.rank)groups.set(src.group,{src,r});}
  const byOrigin=Object.keys(originNames).map(origin=>({origin,list:[...groups.values()].filter(g=>g.src.origin===origin).sort((a,b)=>b.r.rank-a.r.rank)})).filter(o=>o.list.length);
  const sources=byOrigin.map(o=>`<div class="origin"><h4>${escape(originNames[o.origin])}</h4><ol>${o.list.map(({src,r})=>`<li><span class="group">${escape(src.groupName)}</span><span class="item">${link(r.c.itemId,r.c.name,r.c.value)}<small>${escape(slotNames[r.c.slot]||r.c.slot)} · ${r.c.itemLevel}</small></span><span class="gain">${gain(r,{short:true})}${bar(r.rank,max)}</span></li>`).join('')}</ol></div>`).join('');

  const table=upgrades.length?`<table><thead><tr><th>#</th><th>Item</th><th>Where</th><th>${tanky?'Score':'vs current'}</th></tr></thead><tbody>${upgrades.map((r,i)=>`<tr${i===0?' class="first"':''}><td class="n">${i+1}</td><td>${link(r.c.itemId,r.c.name,r.c.value)}<small>${escape(slotNames[r.c.slot]||r.c.slot)} · item level ${r.c.itemLevel}${r.c.embellishment?` · <b>${escape(r.c.embellishment)}</b>`:''}</small>${bar(r.rank,max)}</td><td class="where">${r.c.sources.map(s=>`<small>${escape(s.label)}</small>`).join('')}</td><td class="num">${gain(r)}${r.uncertain?'<small class="noise">within noise</small>':''}</td></tr>`).join('')}</tbody></table>`
    :`<p class="note">No final-round candidate beat the current gear.</p>`;

  const pairs=pairRows(job,index,baselines[3]);
  const part=p=>{const c=candidates.get(p.key);return c?`${link(c.itemId,c.name,c.value)}<small>${escape(slotNames[p.slot]||p.slot)} · ${c.itemLevel}${c.embellishment?` · <b>${escape(c.embellishment)}</b>`:''}</small>`:escape(p.key);};
  const pairTable=pairs.length?`<h3>Embellishment pairs</h3><p class="lead">The best embellished upgrades worn two at a time, within the equip limit.</p><table><thead><tr><th>First</th><th>Second</th><th>${pairs[0].tanky?'Score':'vs current'}</th></tr></thead><tbody>${pairs.map(({r,pair,tanky,percent},i)=>`<tr${i===0?' class="first"':''}><td>${part(pair.parts[0])}</td><td>${part(pair.parts[1])}</td><td class="num">${tanky?`<b>${signed(r.score)}</b>`:`<b>${signed(percent)} %</b><small>${number(r.dps-baselines[3].dps)} DPS</small>`}</td></tr>`).join('')}</tbody></table>`:'';

  return `<section class="scenario">
    <p class="scenario-title"><b>${escape(scenario.style)} · ${scenario.targets} target${scenario.targets===1?'':'s'}</b>${base?` Current gear ${number(base.dps)} DPS${base.error95!=null?` ± ${number(base.error95)}`:''}`:''}</p>
    ${notes}
    <h3>Slot by slot</h3><div class="slots">${slotCards}</div>
    ${sources?`<h3>Best upgrade per source</h3><div class="sources">${sources}</div>`:''}
    <h3>Every measured upgrade <span>${upgrades.length}</span></h3>${table}
    ${pairTable}
  </section>`;
}

export function upgradeReportPage(job,{info={},equipped={},armory=false}={}){
  if(!job.upgrade)throw new Error('This job is not an Upgrade Finder run.');
  const color=classColors[info.class]||'#f3b754';
  const first=job.scenarios.map((s,i)=>measured(job,i));
  const base=first[0]?.baselines[2]||first[0]?.baselines[1];
  const top=first[0]?.upgrades[0];const tanky=first.some(m=>m.rows.some(r=>r.tanky));
  const found=first[0]?.upgrades.length||0;
  const when=new Date(job.finished||job.created).toISOString().slice(0,10);
  const screen=job.upgrade.screen;
  const stat=(value,label)=>`<div class="stat"><strong>${value}</strong><span>${escape(label)}</span></div>`;
  const name=info.name||job.name;const specText=[title(info.spec),classNames[info.class]].filter(Boolean).join(' ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${escape(name)} · Upgrade report · ${escape(job.upgrade.season?.name||'')}</title>
<script async src="https://wow.zamimg.com/js/tooltips.js"></script>
<style>
:root{color-scheme:dark;--bg:#0b0e15;--surface:#151a26;--raised:#1b2230;--line:#28303f;--muted:#94a1b6;--text:#e7ecf5;--amber:#f3b754;--green:#7fd7ad;--class:${escape(color)}}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1100px 560px at 80% -10%,color-mix(in srgb,var(--class) 16%,transparent),transparent 62%),radial-gradient(900px 520px at 4% 0%,rgba(84,142,243,.09),transparent 58%),var(--bg);color:var(--text);font:15px/1.55 Inter,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1180px;margin:auto;padding:0 20px 80px}
a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3,h4{margin:0}
.hero{padding:52px 0 28px;position:relative}
.hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,var(--class),transparent 72%)}
.eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:11px;letter-spacing:2.6px;text-transform:uppercase;color:var(--amber);font-weight:600}
.eyebrow:before{content:"";width:26px;height:1px;background:var(--amber)}
h1{font-size:clamp(34px,5.2vw,56px);line-height:1.02;letter-spacing:-2px;font-weight:800;margin:14px 0 0;color:var(--class)}
h1 span{display:block;font-size:.42em;letter-spacing:-.3px;color:var(--text);font-weight:600;margin-top:10px}
.lede{color:var(--muted);font-size:14px;line-height:1.75;max-width:80ch;margin:16px 0 0}
.tag{display:inline-block;margin-left:8px;font-size:11px;letter-spacing:.4px;padding:2px 9px;border:1px solid var(--line);border-radius:20px;color:#bcd2ea;vertical-align:middle}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:24px 0 0}
.stat{background:linear-gradient(180deg,var(--raised),var(--surface));border:1px solid var(--line);border-radius:12px;padding:12px 18px;min-width:120px}
.stat strong{display:block;font-size:22px;font-weight:700;letter-spacing:-.5px}
.stat.good strong{color:var(--green)}
.stat span{display:block;font-size:10.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-top:5px}
.scenario{margin-top:38px}
.scenario-title{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;font-size:13px;color:var(--muted);margin:0}
.scenario-title b{color:var(--text);font-size:16px}
h3{font-size:12px;letter-spacing:2.4px;text-transform:uppercase;color:#aebbd0;margin:34px 0 14px;font-weight:700;display:flex;align-items:center;gap:10px}
h3:after{content:"";flex:1;height:1px;background:var(--line)}
h3 span{color:var(--muted);font-weight:500;letter-spacing:0;order:1}
.lead{color:var(--muted);font-size:13px;margin:-6px 0 12px}
.note{margin:12px 0 0;padding:10px 13px;background:rgba(60,84,110,.22);border:1px solid #3d5e85;border-left-width:3px;border-radius:9px;color:#bcd2ea;font-size:12.5px}
.muted{color:var(--muted)}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.slot{background:linear-gradient(180deg,#171d29,#131821);border:1px solid var(--line);border-radius:13px;padding:12px 14px;display:grid;gap:8px;align-content:start}
.slot.up{border-color:color-mix(in srgb,var(--green) 40%,var(--line))}
.slot header{display:flex;justify-content:space-between;align-items:baseline;font-size:10.5px;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);font-weight:700}
.slot header em{font-style:normal;color:var(--green);font-size:14px;letter-spacing:0;text-transform:none}
.worn{display:grid;gap:3px;font-size:13px;color:#c3ccdb}
.best{display:flex;gap:8px;align-items:flex-start;font-size:13.5px;font-weight:600;padding-top:8px;border-top:1px dashed var(--line)}
.best .arrow{color:var(--green);font-weight:800}
.best small,td small,.item small{display:block;color:var(--muted);font-size:11px;font-weight:400;margin-top:2px}
.none{margin:0;font-size:12px;color:var(--muted);padding-top:8px;border-top:1px dashed var(--line)}
.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}
.origin{background:var(--surface);border:1px solid var(--line);border-radius:13px;padding:14px 16px}
.origin h4{font-size:13px;color:var(--amber);margin-bottom:8px}
.origin ol{list-style:none;margin:0;padding:0}
.origin li{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) 104px;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #222a38;font-size:13px}
.origin li:first-child{border-top:0}
.group{color:#c3ccdb}
.gain{text-align:right;font-size:12.5px}
.gain b,.num b{color:var(--green);font-weight:600}
.bar{display:block;height:3px;border-radius:3px;background:#242c3a;margin-top:6px;overflow:hidden}
.bar i{display:block;height:100%;background:linear-gradient(90deg,#4c8a70,var(--green))}
table{width:100%;border-collapse:collapse;font-size:13px;background:var(--surface);border:1px solid var(--line);border-radius:13px;overflow:hidden}
th{text-align:left;font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);font-weight:600;padding:11px 12px;border-bottom:1px solid var(--line)}
td{padding:11px 12px;border-bottom:1px solid #222a38;vertical-align:top}
tr:last-child td{border-bottom:0}
tr.first td{background:rgba(127,215,173,.06)}
td.n{color:var(--muted);width:36px}
td.where small{margin:0 0 2px}
td.num,th:last-child{text-align:right;white-space:nowrap}
.noise{color:var(--amber)!important}
footer{margin-top:50px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:11.5px;line-height:1.9}
footer a{color:var(--amber)}
@media(max-width:700px){.origin li{grid-template-columns:1fr 90px}.origin .group{grid-column:1/-1;font-size:11px;color:var(--muted)}td.where{display:none}}
@media print{body{background:#fff;color:#111}.slot,.origin,table,.stat{background:#fff;border-color:#ccc;break-inside:avoid}}
</style></head>
<body><main>
<header class="hero">
  <span class="eyebrow">${escape(job.upgrade.season?.name||'Upgrade Finder')} · Upgrade report</span>
  <h1>${escape(name)}<span>${escape(specText)}${armory?'<i class="tag">Armory import</i>':''}</span></h1>
  <p class="lede">Every candidate for your specialization from the sources you chose was simulated in its slot against the gear you wear. The most promising went through a final round at full precision; only final-round results count as upgrades below. ${tanky?'Ranked on a weighted score of damage and survival.':'Ranked on the change in DPS.'} Simulated locally with SimulationCraft ${escape(job.engine.version)} on WoW ${escape(job.engine.wowVersion)}.</p>
  <div class="stats">
    ${base?stat(number(base.dps),'current DPS'):''}
    ${top?`<div class="stat good"><strong>${signed(top.rank)}${tanky?'':' %'}</strong><span>best upgrade</span></div>`:''}
    ${stat(String(found),'upgrades found')}
    ${stat(String(job.upgrade.candidates.length),'candidates')}
    ${stat(when,'simulated')}
  </div>
</header>
${job.scenarios.map((s,i)=>scenarioSection(job,s,i,equipped)).join('')}
<footer>
Built by <a href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer">SimC Lab</a> · powered by <a href="https://github.com/simulationcraft/simc" target="_blank" rel="noopener noreferrer">SimulationCraft</a> · items link to Wowhead, and hovering one shows its tooltip.<br>
Screening: up to ${number(screen.iterations)} iterations at ${screen.targetError}% target error. Final round: up to ${job.upgrade.finalists} candidates at ${number(job.settings.iterations)} iterations and ${job.settings.targetError}% target error, ${job.settings.duration} sec fights. “Within noise” marks a gain inside the combined 95% uncertainty.<br>
Your enchant carries over to a new item, and gems carry over into sockets it already has. Rings and trinkets are tried in both slots and shown once, in the better one.${armory?' This character came from the Armory, which shows the gear from its last logout.':''}
</footer>
</main></body></html>`;
}
