// One page holding the whole Trinket Lab result: every class and specialization, each trinket as a bar of what it
// adds over wearing none, split at every item level it was simulated at, and sorted into its tier. Built like the
// weapon tier list: from a finished job, with no script of its own but Wowhead's tooltips, so it reads the same in
// the app, from a folder, and when the website imports it.
import {tiers} from './weapons.mjs';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const anchor=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const classColors={deathknight:'#C41E3A',demonhunter:'#A330C9',druid:'#FF7C0A',evoker:'#33937F',hunter:'#AAD372',mage:'#3FC7EB',monk:'#00FF98',paladin:'#F48CBA',priest:'#DFDFDF',rogue:'#FFF468',shaman:'#0070DD',warlock:'#8788EE',warrior:'#C69B6D'};
// One colour per item level, dark to bright, so the bright end of every bar is the highest level simulated.
const levelColors=['#3b4a63','#4f6b8f','#5f8fb8','#7fb6d6','#a6dcc1','#f3d27a','#f3b754','#ff9d4a'];

function itemParams(candidate){
  const params=[`item=${Number(candidate.itemId)}`];
  const bonus=candidate.value.match(/(?:^|,)bonus_id=([\d/]+)/)?.[1];
  if(bonus)params.push(`bonus=${bonus.replaceAll('/',':')}`);
  const ilevel=candidate.value.match(/(?:^|,)ilevel=(\d+)/)?.[1];
  if(ilevel)params.push(`ilvl=${ilevel}`);
  return params;
}
const itemUrl=candidate=>{const [item,...rest]=itemParams(candidate);return `https://www.wowhead.com/${item}${rest.length?`?${rest.join('&')}`:''}`;};

// Every item level any trinket in the job was simulated at, lowest first: the bar's colour key.
export function jobLevels(job){
  return [...new Set(job.trinkets.specs.flatMap(s=>s.candidates.map(c=>c.itemLevel)))].sort((a,b)=>a-b);
}

// One entry per ranked trinket of a spec and scenario: its ranked row (the top level) and the gain at every level
// the final round simulated, lowest first. A trinket screened out of the final round has its top level only.
export function trinketSeries(job,spec,scenario){
  const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
  const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===scenario&&!r.superseded&&r.status==='complete');
  return rows.filter(r=>Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank).map(row=>{
    const top=byKey.get(row.key);
    const levels=rows.filter(r=>byKey.get(r.key)?.itemId===top.itemId&&Number.isFinite(r.gain)&&r.stage===row.stage)
      .map(r=>({itemLevel:byKey.get(r.key).itemLevel,label:byKey.get(r.key).levelLabel,gain:r.gain,percent:r.percent}))
      .sort((a,b)=>a.itemLevel-b.itemLevel);
    return {row,candidate:top,levels};
  });
}

function specSection(job,spec,scenario,palette){
  const series=trinketSeries(job,spec,scenario);
  if(!series.length)return '';
  const tanky=series.some(s=>Number.isFinite(s.row.score));
  const stages=(job.stages||[]).filter(s=>s.spec===spec.key&&s.scenario===scenario);
  const baseline=stages.find(s=>s.stage===2&&s.baseline)?.baseline||stages.find(s=>s.baseline)?.baseline;
  const share=stages.find(s=>s.idle&&s.status==='complete')?.share;
  const most=Math.max(...series.flatMap(s=>s.levels.map(l=>l.gain)),0)||1;
  const unit=tanky?' score':' %';
  const bar=entry=>{
    let before=0;
    return entry.levels.map(level=>{
      const width=Math.max(0,Math.min(level.gain,most)-Math.max(before,0));
      const left=Math.max(before,0);before=Math.max(before,level.gain);
      return width>0?`<i style="left:${(100*left/most).toFixed(2)}%;width:${(100*width/most).toFixed(2)}%;background:${palette.get(level.itemLevel)}" title="${escape(`${level.itemLevel}: +${tanky?level.gain.toFixed(2):number(level.gain)}${tanky?' score':` DPS (+${level.percent.toFixed(2)} %)`}`)}"></i>`:'';
    }).join('');
  };
  const chip=({row,candidate:c,levels})=>{
    const top=levels.at(-1)||{gain:row.gain,percent:row.percent,itemLevel:c.itemLevel};
    const gain=Number.isFinite(top.gain)?(tanky?`+${top.gain.toFixed(2)} score`:`+${top.percent.toFixed(2)} % · +${number(top.gain)} ${spec.support?'raid ':''}DPS`):'no gain measured';
    const behind=c.set&&row.behind<0?`+${(-row.behind).toFixed(2)}${unit} with the set`:row.behind<=0?'best trinket':`−${row.behind.toFixed(2)}${unit}`;
    const data=levels.map(l=>`${l.itemLevel}:${l.gain.toFixed(tanky?3:1)}:${l.percent.toFixed(3)}`).join('|');
    return `<li class="trinket${row.rank===1?' first':''}" data-item="${Number(c.itemId)}" data-levels="${escape(data)}">
      <span class="rank">${row.rank}</span>
      <span class="body">
        <a href="${escape(itemUrl(c))}" data-wowhead="${escape(itemParams(c).join('&'))}" target="_blank" rel="noopener noreferrer">${escape(c.name)}</a>
        <span class="meta">${escape(c.sources[0]||'')}${c.sources.length>1?` <em>+${c.sources.length-1}</em>`:''} · <b>${c.itemLevel}</b>${c.levelLabel?` ${escape(c.levelLabel)}`:''}${c.onUse?' · on use':''}</span>
        <span class="chart">${bar({levels})}</span>
        <span class="value"><b>${escape(gain)}</b><span class="gap">${escape(behind)}${row.tied?' <em>~</em>':''}</span>${row.screened?'<span class="flag">screened only</span>':''}</span>
        ${c.set?`<span class="set">${escape(c.set.name)} ${c.set.pieces}-set with ${escape(c.set.with.join(', '))}</span>`:''}
      </span></li>`;
  };
  return `<section class="spec" id="${escape(anchor(spec.key))}" style="--class:${escape(classColors[spec.class]||'#f3b754')}">
    <header class="spec-head">
      <h3>${escape(spec.specName)}<span>${escape(spec.className)}</span></h3>
      <p class="spec-meta">${series.length} trinkets${spec.gear?` · reference gear ${spec.gear.itemLevel} ilvl`:''}${baseline?` · ${number(baseline.dps)} ${spec.support?'raid ':''}DPS with no trinket`:''}${tanky?' · DPS and survival':''} · ${escape(spec.file.replace(/\.simc$/,''))}</p>
    </header>
    ${spec.support?`<p class="ours">Ranked on the whole raid's damage: ${escape(spec.specName)} does most of its damage through its allies' buffs, so the gains are percent of what it adds to SimulationCraft's simplified raid${share?` (${number(share)} DPS)`:''}.</p>`:''}
    ${spec.stale?`<p class="warn">Ranked on last season's character: SimulationCraft has not rebuilt this profile for the current season, so its gear sits well below the others. The order here holds; the numbers do not belong next to another specialization's.</p>`:''}
    ${spec.ours?`<p class="ours">Carried by SimC Lab's own character: SimulationCraft has no profile for this specialization this season${spec.provenance?`, so its gear and talents come from ${escape(spec.provenance.name)}'s best in slot for patch ${escape(spec.provenance.patch)}, read ${escape(spec.provenance.readAt)}`:''}. Item levels, enchant ranks and the crafting cap are taken from the game data, not from the guide.</p>`:''}
    ${tiers.map(t=>({tier:t.tier,list:series.filter(s=>s.row.tier===t.tier)})).filter(g=>g.list.length)
      .map(g=>`<div class="tier-row tier-${g.tier}"><span class="tier">${g.tier}</span><ul class="trinkets">${g.list.map(chip).join('')}</ul></div>`).join('')}
  </section>`;
}

export function trinketListPage(job){
  if(!job.trinkets)throw new Error('This job is not a Trinket Lab run.');
  const lab=job.trinkets,specs=lab.specs;
  const levels=jobLevels(job);
  const palette=new Map(levels.map((level,i)=>[level,levelColors[Math.round(i*(levelColors.length-1)/Math.max(1,levels.length-1))]]));
  const classes=[];
  for(const spec of specs){
    const existing=classes.find(c=>c.name===spec.className);
    if(existing)existing.specs.push(spec);else classes.push({name:spec.className,key:spec.class,specs:[spec]});
  }
  const scenarios=job.scenarios.map((scenario,index)=>{
    const present=classes.map(c=>({...c,sections:c.specs.map(spec=>specSection(job,spec,index,palette)).join('')})).filter(c=>c.sections);
    return present.length?{scenario,index,present}:null;
  }).filter(Boolean);
  const when=new Date(job.finished||job.created).toISOString().slice(0,10);
  const range=lab.levels||{min:levels[0],max:levels.at(-1)};
  const levelText=range.min===range.max?`item level ${range.max}`:`item level ${range.min}–${range.max}`;
  const ranked=new Set(job.results.filter(r=>Number.isFinite(r.rank)).map(r=>`${r.scenario}|${r.spec}|${r.key}`)).size;
  const src=lab.sources||{};
  const stat=(value,label)=>`<div class="stat"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>Trinket tier list · ${escape(lab.season?.name||'')} · ${escape(levelText)}</title>
<!-- Wowhead's own tooltip script, the one thing on this page that is not in the file. -->
<script async src="https://wow.zamimg.com/js/tooltips.js"></script>
<style>
:root{color-scheme:dark;--bg:#0b0e15;--surface:#151a26;--raised:#1b2230;--line:#28303f;--muted:#94a1b6;--text:#e7ecf5;--amber:#f3b754;--green:#7fd7ad;--class:var(--amber)}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:radial-gradient(1200px 620px at 78% -8%,rgba(243,183,84,.11),transparent 62%),radial-gradient(900px 520px at 6% 2%,rgba(84,142,243,.10),transparent 58%),var(--bg);color:var(--text);font:16px/1.55 Inter,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1240px;margin:auto;padding:0 20px 80px}
a{color:inherit;text-decoration:none}
h1,h2,h3{margin:0}
.hero{padding:56px 0 30px;position:relative}
.hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,var(--amber),rgba(243,183,84,0) 72%)}
.eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:11px;letter-spacing:2.6px;text-transform:uppercase;color:var(--amber);font-weight:600}
.eyebrow:before{content:"";width:26px;height:1px;background:var(--amber)}
h1{font-size:clamp(34px,5.4vw,58px);line-height:1.02;letter-spacing:-2px;font-weight:800;margin:16px 0 0}
h1 em{font-style:normal;background:linear-gradient(94deg,#ffd68a,#f3b754 42%,#cf8b3a);-webkit-background-clip:text;background-clip:text;color:transparent}
.lede{color:var(--muted);font-size:14.5px;line-height:1.75;max-width:80ch;margin:18px 0 0}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0 0}
.stat{background:linear-gradient(180deg,var(--raised),var(--surface));border:1px solid var(--line);border-radius:12px;padding:12px 18px;min-width:118px}
.stat strong{display:block;font-size:22px;font-weight:700;letter-spacing:-.5px}
.stat span{display:block;font-size:10.5px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-top:5px}
.legend{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:22px 0 0;font-size:12px;color:var(--muted)}
.legend .swatch{display:inline-flex;align-items:center;gap:6px}
.legend .swatch i{width:14px;height:10px;border-radius:3px;display:inline-block}
.legend b{display:inline-grid;place-content:center;width:24px;height:22px;border-radius:6px;font-size:12px;font-weight:800;color:#12161f}
.scenario{margin-top:40px}
.scenario>.title{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);font-weight:600}
.scenario>.title b{color:var(--text);font-size:15px;letter-spacing:-.2px;text-transform:none}
.index{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:7px;margin:14px 0 8px;padding:12px;background:rgba(11,14,21,.86);backdrop-filter:blur(9px);border:1px solid var(--line);border-radius:13px}
.index a{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;padding:6px 12px;border:1px solid var(--line);border-radius:30px;color:#cbd5e6}
.index a:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--dot)}
.index a:hover{background:#1d2534;border-color:var(--dot);color:#fff}
.class{margin-top:30px;scroll-margin-top:74px}
.class>h2{font-size:13px;letter-spacing:3px;text-transform:uppercase;color:var(--dot);font-weight:700;display:flex;align-items:center;gap:12px;margin-bottom:14px}
.class>h2:after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--dot),transparent 80%);opacity:.5}
.spec{position:relative;background:linear-gradient(180deg,var(--surface),#12161f);border:1px solid var(--line);border-radius:16px;padding:20px 22px 18px;margin-bottom:14px;overflow:hidden;scroll-margin-top:74px}
.spec:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(180deg,var(--class),transparent)}
.spec-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 14px;margin-bottom:4px}
.spec-head h3{font-size:20px;font-weight:700;letter-spacing:-.4px;color:var(--class);display:flex;align-items:baseline;gap:9px}
.spec-head h3 span{font-size:11.5px;letter-spacing:1.8px;text-transform:uppercase;color:var(--muted);font-weight:600}
.spec-meta{margin:0;font-size:11.5px;color:var(--muted)}
.warn{margin:12px 0 0;padding:11px 13px;background:rgba(124,85,64,.22);border:1px solid #7c5540;border-left-width:3px;border-radius:9px;color:#f3ceb1;font-size:12px;line-height:1.65}
.ours{margin:12px 0 0;padding:11px 13px;background:rgba(60,84,110,.22);border:1px solid #3d5e85;border-left-width:3px;border-radius:9px;color:#bcd2ea;font-size:12px;line-height:1.65}
.tier-row{display:flex;gap:14px;align-items:flex-start;padding:9px 0}
.tier{flex:0 0 46px;height:46px;display:grid;place-content:center;border-radius:12px;font-weight:800;font-size:20px;color:#11151d;position:sticky;top:78px}
.tier-S .tier{background:linear-gradient(160deg,#ffe2a6,#f3b754 52%,#c98a30)}
.tier-A .tier{background:linear-gradient(160deg,#b6f0d2,#7fd7ad 52%,#48a37d)}
.tier-B .tier{background:linear-gradient(160deg,#bcd9f7,#86b3e4 52%,#5480ad)}
.tier-C .tier{background:linear-gradient(160deg,#ccd3df,#9aa6b8 52%,#6c7788)}
.tier-D .tier{background:linear-gradient(160deg,#d8c0c8,#a98d98 52%,#7a636d)}
.trinkets{list-style:none;display:grid;gap:7px;margin:0;padding:0;flex:1;min-width:0}
.trinket{display:flex;gap:11px;background:linear-gradient(180deg,#171d29,#141922);border:1px solid var(--line);border-radius:12px;padding:10px 13px}
.trinket.first{border-color:rgba(243,183,84,.55);background:linear-gradient(180deg,#221d16,#171921)}
.rank{flex:0 0 24px;text-align:center;font-size:13px;font-weight:700;color:var(--muted);padding-top:1px}
.first .rank{color:var(--amber)}
.body{flex:1;min-width:0;display:grid;grid-template-columns:minmax(180px,300px) 1fr;grid-template-areas:"name chart" "meta value" "set set";gap:2px 16px;align-items:center}
.body>a{grid-area:name;font-weight:600;font-size:14px;line-height:1.3}
.body>a:hover{text-decoration:underline}
.meta{grid-area:meta;color:var(--muted);font-size:10.5px;line-height:1.5}
.meta b{color:#c3d0e4;font-weight:500}
.meta em{font-style:normal;opacity:.7}
.chart{grid-area:chart;position:relative;display:block;height:14px;border-radius:4px;background:#1f2633;overflow:hidden}
.chart i{position:absolute;top:0;bottom:0}
.value{grid-area:value;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;font-size:11.5px;color:#c3ccdb}
.value b{font-weight:600;color:var(--text)}
.gap{color:var(--amber)}
.first .gap{color:var(--green)}
.gap em{font-style:normal;color:var(--muted)}
.flag{font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:20px;padding:1px 7px}
.set{grid-area:set;display:block;margin-top:4px;font-size:10.5px;color:#e9cf9c}
.set:before{content:"◆ ";color:var(--amber)}
footer{margin-top:52px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:11.5px;line-height:1.9}
footer a{color:var(--amber)}
@media(max-width:700px){
  .hero{padding-top:34px}
  .tier-row{flex-direction:column;gap:8px}
  .tier{position:static;width:46px}
  .index{position:static}
  .body{grid-template-columns:1fr;grid-template-areas:"name" "meta" "chart" "value" "set"}
}
</style></head>
<body><main>
<header class="hero">
  <span class="eyebrow">${escape(lab.season?.name||'Trinket Lab')}</span>
  <h1>Trinket <em>tier list</em></h1>
  <p class="lede">${src.equal
    ? `Every trinket at every chosen item level (${escape((src.steps||[]).join(', '))}), equal footing: this answers what a trinket is worth, not what you can reach with it.`
    : `Each trinket up to the level its own source can give it: ${escape([src.raid&&`raid ${src.raid.label}`,src.mplus&&`Mythic+ ${src.mplus.label}`,src.delves&&`delves ${src.delves.label}`,src.crafted&&`crafted ${src.crafted.label}`].filter(Boolean).join(', '))}. A trinket's tier is read at the highest of those levels.`}
    Each trinket is worn alone, the second slot empty, and the bar is what it adds over the same character with no trinket at all. Simulated locally with SimulationCraft ${escape(job.engine.version)} on WoW ${escape(job.engine.wowVersion)}.</p>
  <div class="stats">
    ${stat(String(specs.length),'specializations')}
    ${stat(String(ranked),'trinkets ranked')}
    ${stat(range.min===range.max?String(range.max):`${range.min}–${range.max}`,'item level')}
    ${stat(number(job.settings.iterations),'iterations')}
    ${stat(when,'simulated')}
  </div>
  <p class="legend">Item level:${levels.map(level=>`<span class="swatch"><i style="background:${palette.get(level)}"></i>${level}</span>`).join('')}</p>
  <p class="legend">Distance behind the best trinket of the same specialization:${tiers.map((t,i)=>`<b class="tier-${t.tier}" style="background:${['linear-gradient(160deg,#ffe2a6,#f3b754)','linear-gradient(160deg,#b6f0d2,#7fd7ad)','linear-gradient(160deg,#bcd9f7,#86b3e4)','linear-gradient(160deg,#ccd3df,#9aa6b8)','linear-gradient(160deg,#d8c0c8,#a98d98)'][i]}">${t.tier}</b>${Number.isFinite(t.behind)?`under ${t.behind}${i<tiers.length-1?',':''}`:'and beyond'}`).join(' ')} — in percent of DPS, or in score points where a tank is ranked on damage and survival. “~” marks a gap inside the combined 95% uncertainty.</p>
</header>
${scenarios.map(s=>`<div class="scenario">
  <p class="title"><b>${escape(s.scenario.style)} · ${s.scenario.targets} target${s.scenario.targets===1?'':'s'}</b> ${job.settings.duration} sec · ${number(job.settings.iterations)} iterations · ${job.settings.targetError}% target error</p>
  <nav class="index">${s.present.map(c=>`<a style="--dot:${escape(classColors[c.key]||'#f3b754')}" href="#${escape(anchor(c.name+'-'+s.index))}">${escape(c.name)}</a>`).join('')}</nav>
  ${s.present.map(c=>`<section class="class" id="${escape(anchor(c.name+'-'+s.index))}" style="--dot:${escape(classColors[c.key]||'#f3b754')}"><h2>${escape(c.name)}</h2>${c.sections}</section>`).join('')}</div>`).join('')}
<footer>
Built by <a href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer">SimC Lab</a> · powered by <a href="https://github.com/simulationcraft/simc" target="_blank" rel="noopener noreferrer">SimulationCraft</a> · items link to Wowhead, and hovering one shows its tooltip from there.<br>
Reference characters are SimulationCraft's own profiles, one per specialization, with both trinkets taken off: the gear, gems and enchants around the trinket are theirs and not yours.${specs.some(s=>s.stale)?` ${specs.filter(s=>s.stale).map(s=>escape(s.label)).join(', ')} are marked: their profile is a season behind.`:''} Healing specializations are not ranked: SimulationCraft cannot simulate healing, and a trinket is mostly its effect, which no stat score can value. A trinket that completes an item set with the reference gear is marked ◆: its lead is the set's bonus.<br>
${number(job.settings.iterations)} iterations at ${job.settings.targetError}% target error${lab.screen?`; screening at ${number(lab.screen.iterations)} iterations and ${lab.screen.targetError}%`:''}. Numbers compare trinkets within one specialization; they are not a ranking between classes, and a pair of trinkets is not the sum of two bars.
</footer>
</main></body></html>`;
}
