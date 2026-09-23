// One page holding the whole Weapon Lab result: every class, every specialization, every weapon in its tier.
// It is built from a finished job and everything but Wowhead's tooltip script lives in the file, so it reads
// the same inside the app and after it is saved and sent to someone else. No script of its own: the page has
// to survive the app's content policy, and a tier list should still be a tier list with scripts turned off.
import {tiers} from './weapons.mjs';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const signed=(n,digits=2)=>`${n>=0?'+':''}${Number(n).toFixed(digits)}`;
const anchor=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const kindNames={main:'Main hand',offhand:'Off-hand weapon',shield:'Shield',held:'Held in off hand'};
// The colours the game gives each class. They carry the page: a reader finds their class by colour first.
const classColors={deathknight:'#C41E3A',demonhunter:'#A330C9',druid:'#FF7C0A',evoker:'#33937F',hunter:'#AAD372',mage:'#3FC7EB',monk:'#00FF98',paladin:'#F48CBA',priest:'#DFDFDF',rogue:'#FFF468',shaman:'#0070DD',warlock:'#8788EE',warrior:'#C69B6D'};
const medals={1:'①',2:'②',3:'③'};

// Wowhead takes the bonus IDs from the candidate's own SimC line, so both the link and the tooltip show the
// item as it was simulated rather than its base version.
function itemParams(candidate){
  const params=[`item=${Number(candidate.itemId)}`];
  for(const [key,target] of [['bonus_id','bonus'],['gem_id','gems'],['enchant_id','ench']]){
    const raw=candidate.value.match(new RegExp(`(?:^|,)${key}=([\\d/]+)`))?.[1];
    if(raw)params.push(`${target}=${raw.replaceAll('/',':')}`);
  }
  return params;
}
const itemUrl=candidate=>`https://www.wowhead.com/${itemParams(candidate)[0]}?${itemParams(candidate).slice(1).join('&')}`.replace(/\?$/,'');

function specSection(job,spec,scenario){
  const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
  const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===scenario&&!r.superseded&&!r.variant&&Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank);
  if(!rows.length)return '';
  const tanky=rows.some(r=>Number.isFinite(r.score));
  const stages=(job.stages||[]).filter(s=>s.spec===spec.key&&s.scenario===scenario);
  const baseline=stages.find(s=>s.stage===2&&s.baseline)?.baseline||stages.find(s=>s.baseline)?.baseline;
  // One list per hand: what the profile wields in the other hand decides what a swap is worth, so a single list
  // across both hands would rank the hands rather than the weapons.
  const hands=[['main_hand','Main hand'],['off_hand','Off hand']]
    .map(([slot,name])=>({slot,name,rows:rows.filter(r=>byKey.get(r.key)?.slot===slot)})).filter(h=>h.rows.length);
  const chip=(row,worst)=>{
    const c=byKey.get(row.key);
    if(!c)return '';
    const value=tanky?`${signed(row.score)} score`:`${number(row.dps)} DPS`;
    const behind=row.rank===1?'best in hand':`−${row.behind.toFixed(2)}${tanky?'':' %'}`;
    // How much of the field a weapon keeps: full bar for the best, empty for the one furthest behind.
    const fill=Math.max(5,Math.round(100*(1-row.behind/(worst||1))));
    return `<li class="chip${row.rank===1?' first':''}${row.rank<=3?' podium':''}">
      <span class="rank">${medals[row.rank]||row.rank}</span>
      <span class="body">
        <a href="${escape(itemUrl(c))}" data-wowhead="${escape(itemParams(c).join('&'))}" target="_blank" rel="noopener noreferrer">${escape(c.name)}</a>
        <span class="meta">${escape(kindNames[c.kind]||c.kind)}${c.craftedStat?` · <b>${escape(c.craftedStat)}</b>`:''} · ${escape(c.sources[0]||'')}${c.sources.length>1?` <em>+${c.sources.length-1}</em>`:''}</span>
        <span class="bar"><i style="width:${fill}%"></i></span>
        <span class="value"><b>${escape(value)}</b><span class="gap">${escape(behind)}${row.tied?' <em>~</em>':''}</span>${row.screened?'<span class="flag">screened only</span>':''}</span>
      </span></li>`;
  };
  return `<section class="spec" id="${escape(anchor(spec.key))}" style="--class:${escape(classColors[spec.class]||'#f3b754')}">
    <header class="spec-head">
      <h3>${escape(spec.specName)}<span>${escape(spec.className)}</span></h3>
      <p class="spec-meta">${rows.length} weapons${spec.gear?` · reference gear ${spec.gear.itemLevel} ilvl`:''}${baseline?` · ${number(baseline.dps)} DPS`:''}${tanky?' · DPS and survival':''} · ${escape(spec.file.replace(/\.simc$/,''))}</p>
    </header>
    ${spec.stale?`<p class="warn">Ranked on last season's character: SimulationCraft has not rebuilt this profile for the current season, so its gear sits well below the others. The order here holds; the numbers do not belong next to another specialization's.</p>`:''}
    ${hands.map(hand=>{
      const worst=Math.max(...hand.rows.map(r=>r.behind),0.01);
      return `${hands.length>1?`<h4 class="hand">${escape(hand.name)} <span>${hand.rows.length} weapons</span></h4>`:''}${
        tiers.map(t=>({tier:t.tier,rows:hand.rows.filter(r=>r.tier===t.tier)})).filter(g=>g.rows.length)
          .map(g=>`<div class="tier-row tier-${g.tier}"><span class="tier">${g.tier}</span><ul class="chips">${g.rows.map(row=>chip(row,worst)).join('')}</ul></div>`).join('')}`;
    }).join('')}
  </section>`;
}

export function tierListPage(job){
  if(!job.weapons)throw new Error('This job is not a Weapon Lab run.');
  const specs=job.weapons.specs;
  const classes=[];
  for(const spec of specs){
    const existing=classes.find(c=>c.name===spec.className);
    if(existing)existing.specs.push(spec);else classes.push({name:spec.className,key:spec.class,specs:[spec]});
  }
  // A class appears in a scenario only when one of its specializations has results there.
  const scenarios=job.scenarios.map((scenario,index)=>{
    const present=classes.map(c=>({...c,sections:c.specs.map(spec=>specSection(job,spec,index)).join('')})).filter(c=>c.sections);
    return present.length?{scenario,index,present}:null;
  }).filter(Boolean);
  const when=new Date(job.finished||job.created).toISOString().slice(0,10);
  const level=job.weapons.level;
  const ranked=new Set(job.results.filter(r=>Number.isFinite(r.rank)).map(r=>`${r.spec}|${r.key}`)).size;
  const title=`Weapon tier list · ${escape(job.weapons.season?.name||'')} · item level ${level.itemLevel}`;
  const stat=(value,label)=>`<div class="stat"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${title}</title>
<!-- No web font: the app's content policy allows a stylesheet from itself only, and a page that must also work
     from a folder should not depend on one. The stack below is what the app itself uses. -->
<!-- Wowhead's own tooltip script, the one thing on this page that is not in the file: it turns the item links
     into previews on hover. Without a network the links still work, they just do not pop up. -->
<script async src="https://wow.zamimg.com/js/tooltips.js"></script>
<style>
:root{color-scheme:dark;--bg:#0b0e15;--surface:#151a26;--raised:#1b2230;--line:#28303f;--muted:#94a1b6;--text:#e7ecf5;--amber:#f3b754;--green:#7fd7ad;--class:var(--amber)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:
  radial-gradient(1200px 620px at 78% -8%,rgba(243,183,84,.11),transparent 62%),
  radial-gradient(900px 520px at 6% 2%,rgba(84,142,243,.10),transparent 58%),
  var(--bg);
  color:var(--text);font:16px/1.55 Inter,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1240px;margin:auto;padding:0 20px 80px}
a{color:inherit;text-decoration:none}
h1,h2,h3,h4{margin:0}

/* Header */
.hero{padding:56px 0 30px;position:relative}
.hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,var(--amber),rgba(243,183,84,0) 72%)}
.eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:11px;letter-spacing:2.6px;text-transform:uppercase;color:var(--amber);font-weight:600}
.eyebrow:before{content:"";width:26px;height:1px;background:var(--amber)}
h1{font-size:clamp(34px,5.4vw,58px);line-height:1.02;letter-spacing:-2px;font-weight:800;margin:16px 0 0}
h1 em{font-style:normal;background:linear-gradient(94deg,#ffd68a,#f3b754 42%,#cf8b3a);-webkit-background-clip:text;background-clip:text;color:transparent}
.lede{color:var(--muted);font-size:14.5px;line-height:1.75;max-width:78ch;margin:18px 0 0}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0 0}
.stat{background:linear-gradient(180deg,var(--raised),var(--surface));border:1px solid var(--line);border-radius:12px;padding:12px 18px;min-width:118px}
.stat strong{display:block;font-size:22px;font-weight:700;letter-spacing:-.5px}
.stat span{display:block;font-size:10.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-top:5px}
.legend{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:22px 0 0;font-size:12px;color:var(--muted)}
.legend b{display:inline-grid;place-content:center;width:24px;height:22px;border-radius:6px;font-size:12px;font-weight:800;color:#12161f}

/* Scenario and navigation */
.scenario{margin-top:40px}
.scenario>.title{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);font-weight:600}
.scenario>.title b{color:var(--text);font-size:15px;letter-spacing:-.2px;text-transform:none}
.index{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:7px;margin:14px 0 8px;padding:12px;background:rgba(11,14,21,.86);backdrop-filter:blur(9px);border:1px solid var(--line);border-radius:13px}
.index a{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;padding:6px 12px;border:1px solid var(--line);border-radius:30px;color:#cbd5e6;transition:border-color .15s,color .15s,background .15s}
.index a:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--dot)}
.index a:hover{background:#1d2534;border-color:var(--dot);color:#fff}

/* Class and specialization */
.class{margin-top:30px;scroll-margin-top:74px}
.class>h2{font-size:13px;letter-spacing:3px;text-transform:uppercase;color:var(--dot);font-weight:700;display:flex;align-items:center;gap:12px;margin-bottom:14px}
.class>h2:after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--dot),transparent 80%);opacity:.5}
.spec{position:relative;background:linear-gradient(180deg,var(--surface),#12161f);border:1px solid var(--line);border-radius:16px;padding:20px 22px 18px;margin-bottom:14px;overflow:hidden;scroll-margin-top:74px}
.spec:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(180deg,var(--class),transparent)}
.spec:target{border-color:var(--class)}
.spec-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px;margin-bottom:4px}
.spec-head h3{font-size:20px;font-weight:700;letter-spacing:-.4px;color:var(--class);display:flex;align-items:baseline;gap:9px}
.spec-head h3 span{font-size:11.5px;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);font-weight:600}
.spec-meta{margin:0;font-size:11.5px;color:var(--muted)}
.warn{margin:12px 0 0;padding:11px 13px;background:rgba(124,85,64,.22);border:1px solid #7c5540;border-left-width:3px;border-radius:9px;color:#f3ceb1;font-size:12px;line-height:1.65}
.hand{font-size:11px;letter-spacing:2.2px;text-transform:uppercase;color:#aebbd0;margin:20px 0 8px;font-weight:700;display:flex;align-items:center;gap:10px}
.hand:after{content:"";flex:1;height:1px;background:var(--line)}
.hand span{color:var(--muted);font-weight:400;letter-spacing:0;text-transform:none;font-size:11.5px;order:1}

/* Tiers */
.tier-row{display:flex;gap:14px;align-items:flex-start;padding:9px 0}
.tier{flex:0 0 46px;height:46px;display:grid;place-content:center;border-radius:12px;font-weight:800;font-size:20px;letter-spacing:-.5px;color:#11151d;position:sticky;top:78px}
.tier-S .tier{background:linear-gradient(160deg,#ffe2a6,#f3b754 52%,#c98a30);box-shadow:0 0 0 1px rgba(255,214,138,.45),0 6px 20px -8px rgba(243,183,84,.8)}
.tier-A .tier{background:linear-gradient(160deg,#b6f0d2,#7fd7ad 52%,#48a37d)}
.tier-B .tier{background:linear-gradient(160deg,#bcd9f7,#86b3e4 52%,#5480ad)}
.tier-C .tier{background:linear-gradient(160deg,#ccd3df,#9aa6b8 52%,#6c7788)}
.tier-D .tier{background:linear-gradient(160deg,#d8c0c8,#a98d98 52%,#7a636d)}
.chips{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:9px;margin:0;padding:0;flex:1}
.chip{display:flex;gap:11px;background:linear-gradient(180deg,#171d29,#141922);border:1px solid var(--line);border-radius:12px;padding:11px 13px;transition:transform .14s ease,border-color .14s ease,box-shadow .14s ease}
.chip:hover{transform:translateY(-2px);border-color:#3d4a60;box-shadow:0 10px 24px -14px #000}
.chip.podium{border-color:#3a4457}
.chip.first{border-color:rgba(243,183,84,.55);background:linear-gradient(180deg,#221d16,#171921)}
.rank{flex:0 0 22px;text-align:center;font-size:13px;font-weight:700;color:var(--muted);padding-top:1px}
.chip.first .rank,.chip.podium .rank{color:var(--amber);font-size:15px}
.body{flex:1;min-width:0}
.body>a{font-weight:600;font-size:14px;line-height:1.3;display:inline-block}
.body>a:hover{text-decoration:underline}
.meta{display:block;color:var(--muted);font-size:10.5px;line-height:1.5;margin-top:3px}
.meta b{color:#c3d0e4;font-weight:500}
.meta em{font-style:normal;opacity:.7}
.bar{display:block;height:3px;border-radius:3px;background:#242c3a;margin:8px 0 6px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#4c5a72,#8aa0c2)}
.first .bar i{background:linear-gradient(90deg,#c98a30,#ffd68a)}
.value{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;font-size:11.5px;color:#c3ccdb}
.value b{font-weight:600;color:var(--text)}
.gap{color:var(--amber)}
.first .gap{color:var(--green)}
.gap em{font-style:normal;color:var(--muted)}
.flag{font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:20px;padding:1px 7px}

footer{margin-top:52px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:11.5px;line-height:1.9}
footer a{color:var(--amber)}
footer a:hover{text-decoration:underline}
@media(max-width:700px){
  .hero{padding-top:34px}
  .tier-row{flex-direction:column;gap:8px}
  .tier{position:static;flex:0 0 auto;width:46px}
  .index{position:static}
}
@media print{
  body{background:#fff;color:#111}
  .index,.chip:hover{display:revert;transform:none}
  .spec,.chip,.stat{break-inside:avoid;background:#fff;border-color:#ccc}
  h1 em{color:#a06a12;-webkit-text-fill-color:#a06a12}
}
</style></head>
<body><main>
<header class="hero">
  <span class="eyebrow">${escape(job.weapons.season?.name||'Weapon Lab')}</span>
  <h1>Weapon <em>tier list</em></h1>
  <p class="lede">Every candidate pinned to item level ${level.itemLevel} (${escape(level.label)}), so the ranking measures the weapon and not where it dropped. Each hand is ranked on its own, against what could take the same hand. Simulated locally with SimulationCraft ${escape(job.engine.version)} on WoW ${escape(job.engine.wowVersion)}.</p>
  <div class="stats">
    ${stat(String(specs.length),'specializations')}
    ${stat(String(ranked),'weapons ranked')}
    ${stat(String(level.itemLevel),'item level')}
    ${stat(number(job.settings.iterations),'iterations')}
    ${stat(when,'simulated')}
  </div>
  <p class="legend">Distance behind the best weapon of the same hand:${tiers.map((t,i)=>`<b class="tier-${t.tier}" style="background:${['linear-gradient(160deg,#ffe2a6,#f3b754)','linear-gradient(160deg,#b6f0d2,#7fd7ad)','linear-gradient(160deg,#bcd9f7,#86b3e4)','linear-gradient(160deg,#ccd3df,#9aa6b8)','linear-gradient(160deg,#d8c0c8,#a98d98)'][i]}">${t.tier}</b>${Number.isFinite(t.behind)?`under ${t.behind}${i<tiers.length-1?',':''}`:'and beyond'}`).join(' ')} — in percent of DPS, or in score points where a tank is ranked on damage and survival. “~” marks a gap inside the combined 95% uncertainty.</p>
</header>
${scenarios.map(s=>`<div class="scenario">
  <p class="title"><b>${escape(s.scenario.style)} · ${s.scenario.targets} target${s.scenario.targets===1?'':'s'}</b> ${job.settings.duration} sec · ${number(job.settings.iterations)} iterations · ${job.settings.targetError}% target error</p>
  <nav class="index">${s.present.map(c=>`<a style="--dot:${escape(classColors[c.key]||'#f3b754')}" href="#${escape(anchor(c.name+'-'+s.index))}">${escape(c.name)}</a>`).join('')}</nav>
  ${s.present.map(c=>`<section class="class" id="${escape(anchor(c.name+'-'+s.index))}" style="--dot:${escape(classColors[c.key]||'#f3b754')}"><h2>${escape(c.name)}</h2>${c.sections}</section>`).join('')}</div>`).join('')}
<footer>
Built by <a href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer">SimC Lab</a> · powered by <a href="https://github.com/simulationcraft/simc" target="_blank" rel="noopener noreferrer">SimulationCraft</a> · items link to Wowhead, and hovering one shows its tooltip from there.<br>
Reference characters are SimulationCraft's own profiles, one per specialization — the gear, gems and enchants its authors assembled for the season, so what surrounds the weapon is theirs and not yours.${specs.some(s=>s.stale)?` ${specs.filter(s=>s.stale).map(s=>escape(s.label)).join(', ')} are marked: their profile is a season behind.`:''} Crafted weapons are shown at the secondary stats that served them best. Weapons are compared like for like with what the reference profile wields.<br>
${number(job.settings.iterations)} iterations at ${job.settings.targetError}% target error${job.weapons.screen?`; screening at ${number(job.weapons.screen.iterations)} iterations and ${job.weapons.screen.targetError}%`:''}. Numbers compare weapons within one hand of one specialization; they are not a ranking between classes. Small differences need more precision before they mean anything.
</footer>
</main></body></html>`;
}
