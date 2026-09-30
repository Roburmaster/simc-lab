// One page holding the whole Trinket Lab result: every class and specialization, each trinket as a bar of what it
// adds over wearing none, split at every item level it was simulated at, and sorted into its tier. It wears the
// website's weapon tier list design (mythicpersona.com/weapon-tier-list): the same type, colours, tier badges and
// cards, with the site's two fonts carried inside the file.
// There is no script of its own but Wowhead's tooltips, so it reads the same in the app, from a folder, and when
// the website imports it. The 1, 3 and 5 target results sit side by side and are switched with radio buttons and
// CSS alone.
import fs from 'node:fs';
import path from 'node:path';
import {tiers} from './weapons.mjs';
import {appRoot} from './paths.mjs';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const anchor=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const classColors={deathknight:'#C41E3A',demonhunter:'#A330C9',druid:'#FF7C0A',evoker:'#33937F',hunter:'#AAD372',mage:'#3FC7EB',monk:'#00FF98',paladin:'#F48CBA',priest:'#DFDFDF',rogue:'#FFF468',shaman:'#0070DD',warlock:'#8788EE',warrior:'#C69B6D'};
// One colour per item level, dark to bright, so the bright end of every bar is the highest level simulated.
const levelColors=['#3b4a63','#4f6b8f','#5f8fb8','#7fb6d6','#a6dcc1','#f3d27a','#f3b754','#ff9d4a'];
// The website's tier colours.
const tierColors={S:'#f3bd65',A:'#7edcb0',B:'#8bbffa',C:'#c2cbd9',D:'#d1a6b6'};

// The site's two fonts (SIL Open Font License, beside them in public/fonts), inlined once so a saved page keeps them.
let fontFaces=null;
function fonts(){
  if(fontFaces!==null)return fontFaces;
  const face=(family,file)=>{
    try{return `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${fs.readFileSync(path.join(appRoot,'public','fonts',file)).toString('base64')}) format("truetype");font-weight:400;font-display:swap}`;}
    catch{return '';}
  };
  fontFaces=face('Oswald','Oswald-Regular.ttf')+face('Roboto Mono','RobotoMono-Regular.ttf');
  return fontFaces;
}

function itemParams(candidate){
  const params=[`item=${Number(candidate.itemId)}`];
  const bonus=candidate.value.match(/(?:^|,)bonus_id=([\d/]+)/)?.[1];
  if(bonus)params.push(`bonus=${bonus.replaceAll('/',':')}`);
  const ilevel=candidate.value.match(/(?:^|,)ilevel=(\d+)/)?.[1];
  if(ilevel)params.push(`ilvl=${ilevel}`);
  return params;
}
const itemUrl=candidate=>{const [item,...rest]=itemParams(candidate);return `https://www.wowhead.com/${item}${rest.length?`?${rest.join('&')}`:''}`;};
const groupOf=c=>c.group||String(c.itemId);

// Every item level any trinket in the job was simulated at, lowest first: the bar's colour key.
export function jobLevels(job){
  return [...new Set(job.trinkets.specs.flatMap(s=>s.candidates.map(c=>c.itemLevel)))].sort((a,b)=>a-b);
}

// One entry per ranked trinket of a spec and scenario: its ranked row (the top level) and the gain at every level
// the final round simulated, lowest first. A trinket screened out of the final round has its top level only. A set
// trinket is two entries, with and without its set bonus.
export function trinketSeries(job,spec,scenario){
  const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
  const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===scenario&&!r.superseded&&!r.pair&&r.status==='complete');
  return rows.filter(r=>Number.isFinite(r.rank)).sort((a,b)=>a.rank-b.rank).map(row=>{
    const top=byKey.get(row.key);
    const levels=rows.filter(r=>byKey.has(r.key)&&groupOf(byKey.get(r.key))===groupOf(top)&&Number.isFinite(r.gain)&&r.stage===row.stage)
      .map(r=>({itemLevel:byKey.get(r.key).itemLevel,label:byKey.get(r.key).levelLabel,gain:r.gain,percent:r.percent}))
      .sort((a,b)=>a.itemLevel-b.itemLevel);
    return {row,candidate:top,levels};
  });
}

// The ranked trinket pairs of a spec and scenario, best first: each row with the two trinkets it wore.
export function pairSeries(job,spec,scenario){
  const entry=spec.pairs?.[scenario];
  if(!entry)return [];
  const byKey=new Map(spec.candidates.map(c=>[c.key,c])),pairs=new Map(entry.pairs.map(p=>[p.key,p]));
  return job.results.filter(r=>r.spec===spec.key&&r.scenario===scenario&&r.pair&&!r.superseded&&r.status==='complete'&&Number.isFinite(r.rank))
    .sort((a,b)=>a.rank-b.rank).map(row=>({row,parts:(pairs.get(row.key)?.keys||[]).map(k=>byKey.get(k)).filter(Boolean)})).filter(x=>x.parts.length===2);
}
// What a pair adds over no trinket, as text: percent and DPS, or for a tank its damage and survival apart.
export function pairValueText(row,{tank,support}={}){
  if(tank||Number.isFinite(row.score))return `${signed(row.dpsGain)} % DPS · ${signed(row.survival)} % survival`;
  return Number.isFinite(row.gain)?`+${row.percent.toFixed(2)} % · +${number(row.gain)} ${support?'raid ':''}DPS`:'no gain measured';
}
const signed=n=>Number.isFinite(n)?`${n>=0?'+':'−'}${Math.abs(n).toFixed(2)}`:'—';

function pairBlock(job,spec,scenario,shown=5){
  const list=pairSeries(job,spec,scenario);
  if(!list.length)return '';
  const tanky=list.some(x=>Number.isFinite(x.row.score));
  const link=c=>`<a href="${escape(itemUrl(c))}" data-wowhead="${escape(itemParams(c).join('&'))}" target="_blank" rel="noopener noreferrer">${escape(c.name)}</a>`;
  return `<div class="pairs"><h4>Best pairs <span>two trinkets worn together · ${list.length} ranked</span></h4><ol>${list.slice(0,shown).map(({row,parts})=>`<li class="pair${row.rank===1?' first':''}">
      <span class="rank">${row.rank}</span>
      <span class="body">${parts.map(link).join(' <em>+</em> ')}<span class="meta">${parts.map(c=>`${c.itemLevel}${c.onUse?' on use':''}`).join(' + ')}${row.screened?' · screened only':''}</span></span>
      <span class="value"><b>${escape(pairValueText(row,{tank:tanky,support:spec.support}))}</b><span class="gap">${tanky?`score ${signed(row.score)}`:''}${row.behind>0?`${tanky?' · ':''}−${row.behind.toFixed(2)}${tanky?'':' %'}`:tanky?'':'best pair'}${row.tied?' <em>~</em>':''}</span></span></li>`).join('')}</ol></div>`;
}

// "Patchwerk · 1 target", or just "1 target" when every scenario shares one fight style.
const scenarioName=(s,shared)=>s.label||`${shared?'':`${s.style} · `}${s.targets} target${s.targets===1?'':'s'}`;

function specSection(job,spec,scenario,palette){
  const series=trinketSeries(job,spec,scenario);
  if(!series.length)return '';
  const tanky=series.some(s=>Number.isFinite(s.row.score));
  const stages=(job.stages||[]).filter(s=>s.spec===spec.key&&s.scenario===scenario);
  const baseline=stages.find(s=>s.stage===2&&s.baseline)?.baseline||stages.find(s=>s.baseline)?.baseline;
  const share=stages.find(s=>s.idle&&s.status==='complete')?.share;
  const most=Math.max(...series.flatMap(s=>s.levels.map(l=>l.gain)),0)||1;
  const unit=tanky?' score':' %';
  const bar=levels=>{
    let before=0;
    return levels.map(level=>{
      const width=Math.max(0,Math.min(level.gain,most)-Math.max(before,0));
      const left=Math.max(before,0);before=Math.max(before,level.gain);
      return width>0?`<i style="left:${(100*left/most).toFixed(2)}%;width:${(100*width/most).toFixed(2)}%;background:${palette.get(level.itemLevel)}" title="${escape(`${level.itemLevel}: +${tanky?level.gain.toFixed(2):number(level.gain)}${tanky?' score':` DPS (+${level.percent.toFixed(2)} %)`}`)}"></i>`:'';
    }).join('');
  };
  const item=({row,candidate:c,levels})=>{
    const top=levels.at(-1)||{gain:row.gain,percent:row.percent,itemLevel:c.itemLevel};
    const gain=Number.isFinite(top.gain)?(tanky?`+${top.gain.toFixed(2)} score`:`+${top.percent.toFixed(2)} % · +${number(top.gain)} ${spec.support?'raid ':''}DPS`):'no gain measured';
    const behind=c.set&&row.behind<0?`+${(-row.behind).toFixed(2)}${unit} with the set`:row.behind<=0?'best trinket':`−${row.behind.toFixed(2)}${unit}`;
    const data=levels.map(l=>`${l.itemLevel}:${l.gain.toFixed(tanky?3:1)}:${l.percent.toFixed(3)}`).join('|');
    return `<li class="trinket${row.rank===1?' first':''}" data-item="${Number(c.itemId)}" data-levels="${escape(data)}"${c.setOff?' data-variant="noset"':c.set?' data-variant="set"':''}>
      <span class="rank">${row.rank}</span>
      <span class="body">
        <a href="${escape(itemUrl(c))}" data-wowhead="${escape(itemParams(c).join('&'))}" target="_blank" rel="noopener noreferrer">${escape(c.name)}</a>
        <span class="meta">${escape(c.sources[0]||'')}${c.sources.length>1?` <em>+${c.sources.length-1}</em>`:''} · ${c.itemLevel}${c.levelLabel?` ${escape(c.levelLabel)}`:''}${c.onUse?' · on use':''}${c.overLimit?` · over the ${escape(c.overLimit.join(', '))} limit beside the reference gear, so never paired`:''}</span>
        <span class="chart">${bar(levels)}</span>
        ${row.screened?'<span class="flag">screened only</span>':''}
        ${c.set?`<span class="set">With the ${escape(c.set.name)} ${c.set.pieces}-set bonus, beside ${escape(c.set.with.join(', '))}</span>`:''}
        ${c.setOff?`<span class="noset">Without the ${escape(c.setOff.name)} set bonus: the trinket alone</span>`:''}
      </span>
      <span class="value"><b>${escape(gain)}</b><span class="gap">${escape(behind)}${row.tied?' <em>~</em>':''}</span></span></li>`;
  };
  return `<section class="spec" id="${escape(anchor(`${spec.key}-${scenario}`))}" style="--class:${escape(classColors[spec.class]||'#33e5ff')}">
    <header class="spec-head">
      <h3>${escape(spec.specName)}<span>${escape(spec.className)}</span></h3>
      <p class="spec-meta">${series.length} trinkets${spec.gear?` · reference gear ${spec.gear.itemLevel} ilvl`:''}${baseline?` · ${number(baseline.dps)} ${spec.support?'raid ':''}DPS with no trinket`:''}${tanky?' · DPS and survival':''} · ${escape(spec.file.replace(/\.simc$/,''))}</p>
    </header>
    ${pairBlock(job,spec,scenario)}
    ${spec.support?`<p class="ours">Ranked on the whole raid's damage: ${escape(spec.specName)} does most of its damage through its allies' buffs, so the gains are percent of what it adds to SimulationCraft's simplified raid${share?` (${number(share)} DPS)`:''}.</p>`:''}
    ${spec.stale?`<p class="warn">Ranked on last season's character: SimulationCraft has not rebuilt this profile for the current season, so its gear sits well below the others. The order here holds; the numbers do not belong next to another specialization's.</p>`:''}
    ${spec.ours?`<p class="ours">Carried by SimC Lab's own character: SimulationCraft has no profile for this specialization this season${spec.provenance?`, so its gear and talents come from ${escape(spec.provenance.name)}'s best in slot for patch ${escape(spec.provenance.patch)}, read ${escape(spec.provenance.readAt)}`:''}. Item levels, enchant ranks and the crafting cap are taken from the game data, not from the guide.</p>`:''}
    ${tiers.map(t=>({tier:t.tier,list:series.filter(s=>s.row.tier===t.tier)})).filter(g=>g.list.length)
      .map(g=>`<div class="tier-row tier-${g.tier}"><span class="tier">${g.tier}</span><ul class="trinkets">${g.list.map(item).join('')}</ul></div>`).join('')}
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
  const shared=new Set(job.scenarios.map(s=>s.style)).size===1;
  const scenarios=job.scenarios.map((scenario,index)=>{
    const present=classes.map(c=>({...c,sections:c.specs.map(spec=>specSection(job,spec,index,palette)).join('')})).filter(c=>c.sections);
    return present.length?{scenario,index,present}:null;
  }).filter(Boolean);
  const when=new Date(job.finished||job.created).toISOString().slice(0,10);
  const range=lab.levels||{min:levels[0],max:levels.at(-1)};
  const levelText=range.min===range.max?`item level ${range.max}`:`item level ${range.min}–${range.max}`;
  const ranked=new Set(job.results.filter(r=>Number.isFinite(r.rank)&&!r.pair&&r.scenario===scenarios[0]?.index).map(r=>`${r.spec}|${r.key}`)).size;
  const src=lab.sources||{};
  const stat=(value,label)=>`<div class="stat"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
  // One radio per scenario, before everything it switches: the checked one shows its results and lights its tab.
  const switchCss=scenarios.map((s,i)=>`#scn-${i}:checked~.targets label[for="scn-${i}"]{background:var(--surface-2);color:var(--ink);border-bottom-color:var(--brand)}#scn-${i}:checked~.scenarios>.scenario[data-scenario="${i}"]{display:block}`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>Trinket tier list · ${escape(lab.season?.name||'')} · ${escape(levelText)}</title>
<!-- Wowhead's own tooltip script, the one thing on this page that is not in the file. -->
<script async src="https://wow.zamimg.com/js/tooltips.js"></script>
<style>
${fonts()}
:root{--bg:#07080b;--bg-raise:#0c0e13;--surface:#11141a;--surface-2:#161a22;--line:rgba(255,255,255,.09);--line-strong:rgba(255,255,255,.16);--ink:#e9ecf3;--ink-soft:#aab3c2;--ink-dim:#6f7889;--brand:#33e5ff;
  --display:"Oswald","Bebas Neue","Franklin Gothic Medium",sans-serif;--mono:"Roboto Mono",ui-monospace,"Cascadia Mono",Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:5rem}
body{margin:0;background:radial-gradient(1200px 700px at 78% -8%,rgba(51,229,255,.09),transparent 62%),radial-gradient(900px 600px at 6% 12%,rgba(224,128,58,.06),transparent 58%),var(--bg);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{font-family:var(--display);font-weight:400;letter-spacing:.01em;line-height:1.08;margin:0;text-transform:uppercase}
p{margin:0}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--brand);outline-offset:4px}
.top{display:flex;flex-wrap:wrap;align-items:center;gap:18px;width:min(1180px,92vw);margin:0 auto;padding:.7rem 0;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:baseline;gap:.15rem;color:var(--ink);font:1.3rem var(--display)}
.brand:hover{text-decoration:none}
.brand b{color:var(--brand);font-weight:400}
.top nav{display:flex;flex-wrap:wrap;gap:24px;font-size:13px;margin-left:auto}
.top nav a{color:var(--ink-soft)}
main{width:min(1180px,92vw);margin:0 auto;padding:30px 0 80px}
.hero{padding:12px 0 28px;border-bottom:1px solid var(--line-strong)}
.eyebrow{display:block;color:var(--brand);text-transform:uppercase;letter-spacing:2.3px;font-size:11px;margin-bottom:20px}
.hero h1{font-size:clamp(38px,5.8vw,76px);line-height:1.08;letter-spacing:-.02em}
.hero h1>span{display:block}
.hero h1 .accent{color:var(--ink-soft)}
.lede,.copy{font-size:13px;color:var(--ink-soft);line-height:1.8}
.lede{max-width:760px;margin-top:20px}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:20px;margin-top:32px}
.stat{border-left:2px solid var(--brand);padding-left:16px}
.stat strong{display:block;font:400 19px var(--mono)}
.stat span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:var(--ink-soft);margin-top:5px}
.notice{display:flex;align-items:center;gap:20px;padding:22px;margin:26px 0 30px;border:1px solid #715627;border-left:3px solid #f3bd65;border-radius:10px;background:#201b12}
.notice-icon{display:grid;place-items:center;flex:0 0 32px;height:32px;color:#f3bd65;border:1px solid #80632f;border-radius:50%;font-size:20px}
.notice strong{color:#ffdaa0;font-size:16px}
.notice p{color:#d0c1a9;font-size:12px;line-height:1.8;margin-top:4px;max-width:720px}
.button{display:inline-flex;align-items:center;flex-shrink:0;padding:.68rem 1.15rem;border:1px solid #715627;border-radius:6px;background:transparent;color:#ffdaa0;font:12px var(--display);letter-spacing:.05em}
.button:hover{border-color:var(--brand);text-decoration:none}
.scn{position:absolute;opacity:0;pointer-events:none}
.targets{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 20px}
.targets>span{color:var(--ink-soft);font-size:11px;text-transform:uppercase;letter-spacing:1.4px;margin-right:6px}
.targets label{padding:8px 16px;border:1px solid var(--line-strong);border-bottom-width:3px;border-radius:6px;color:var(--ink-soft);font-size:13px;cursor:pointer}
.targets label:hover{color:var(--ink)}
.scn:focus-visible~.targets{outline:2px solid var(--brand);outline-offset:4px}
${switchCss}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:0 0 12px;font-size:12px;color:var(--ink-soft)}
.legend .swatch{display:inline-flex;align-items:center;gap:6px}
.legend .swatch i{display:inline-block;width:14px;height:10px;border-radius:2px}
.legend b{display:inline-block;background:var(--surface);border:1px solid var(--line);border-radius:5px;padding:2px 9px;color:var(--tier);font-weight:700}
${Object.entries(tierColors).map(([t,c])=>`.tier-${t},.legend .t-${t}{--tier:${c}}`).join('')}
.scenario{display:none}
.scenario>.title{margin:26px 0 10px;font-size:12px;color:var(--ink-soft)}
.scenario>.title b{font:400 20px var(--display);color:var(--ink);text-transform:uppercase;margin-right:10px}
.index{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 10px}
.index a{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--line-strong);border-radius:6px;color:var(--ink-soft);font-size:13px}
.index a:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--dot)}
.index a:hover{color:var(--ink);border-color:var(--dot);text-decoration:none}
.class{margin-top:34px}
.class>h2{display:flex;align-items:center;gap:14px;font-size:27px;color:var(--dot);margin-bottom:16px}
.class>h2:after{content:"";flex:1;height:1px;background:var(--line-strong)}
.spec{position:relative;padding:22px 24px 12px;margin-bottom:18px;border:1px solid var(--line-strong);border-top:3px solid var(--class);border-radius:8px;background:linear-gradient(135deg,var(--surface-2),var(--bg-raise))}
.spec-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;margin-bottom:16px}
.spec-head h3{display:flex;align-items:baseline;gap:10px;font-size:29px;color:var(--ink)}
.spec-head h3 span{font-size:11px;letter-spacing:1.4px;color:var(--class)}
.spec-meta{font-size:12px;color:var(--ink-soft)}
.ours,.warn{font-size:13px;padding:14px 18px;border-radius:8px;margin-bottom:16px}
.ours{background:#142231;border:1px solid #30485d;color:#c4d9ec}
.warn{background:#201b12;border:1px solid #715627;color:#f3d9b1}
.tier-row{display:grid;grid-template-columns:50px minmax(0,1fr);align-items:start;gap:16px;margin-bottom:16px}
.tier{display:grid;place-items:center;height:50px;background:var(--tier);color:#101319;font:bold 24px var(--sans);border-radius:8px}
.trinkets{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.trinket{display:flex;align-items:center;gap:16px;background:var(--surface);padding:16px 18px;border:1px solid var(--line);border-left:2px solid var(--tier);border-radius:7px}
.rank{flex:0 0 25px;color:var(--tier);font:14px var(--mono)}
.body{flex:1;min-width:0}
.body>a{color:var(--ink);font-size:14px;font-weight:600;overflow-wrap:anywhere}
.meta{display:block;color:var(--ink-soft);font-size:11px;margin-top:4px;line-height:1.8}
.meta em{font-style:normal;opacity:.7}
.chart{position:relative;display:block;height:12px;margin-top:8px;border-radius:3px;background:var(--bg);border:1px solid var(--line);overflow:hidden}
.chart i{position:absolute;top:0;bottom:0}
.flag{display:inline-block;font-size:10px;color:#d8c6a4;border:1px solid #665636;border-radius:4px;padding:1px 6px;margin-top:6px}
.set,.noset{display:block;font-size:12px;margin-top:6px}
.set{color:#f3bd65}
.set:before{content:"◆ "}
.noset{color:var(--ink-soft)}
.noset:before{content:"◇ "}
.pairs{margin:0 0 18px;padding:14px 16px;border:1px solid var(--line);border-radius:8px;background:var(--bg-raise)}
.pairs h4{font-size:15px;color:var(--ink);margin-bottom:10px}
.pairs h4 span{font:11px var(--sans);text-transform:none;color:var(--ink-soft);margin-left:8px}
.pairs ol{list-style:none;padding:0;margin:0;display:grid;gap:6px}
.pair{display:flex;align-items:center;gap:16px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);--tier:var(--brand)}
.pair.first{border-color:var(--brand)}
.pair .body>a{color:var(--ink);font-size:13px;font-weight:600}
.pair .body>em{font-style:normal;color:var(--ink-dim)}
.value{min-width:170px;text-align:right;flex-shrink:0;font-size:12px}
.value b{display:block;font:400 13px var(--mono)}
.gap{display:block;color:var(--tier);margin-top:4px;font-size:11px}
.gap em{font-style:normal;color:var(--ink-soft)}
footer{border-top:1px solid var(--line-strong);margin-top:44px;padding-top:22px;font-size:13px;color:var(--ink-soft);line-height:1.9}
footer strong{display:block;font:400 17px var(--display);color:var(--ink);text-transform:uppercase;margin-bottom:8px}
@media(max-width:900px){.stats{grid-template-columns:repeat(3,1fr)}.notice{flex-wrap:wrap}}
@media(max-width:580px){
  .top nav{margin-left:0;gap:16px}
  .stats{grid-template-columns:repeat(2,1fr)}
  .spec{padding:16px 14px 6px}
  .tier-row{grid-template-columns:32px minmax(0,1fr);gap:8px}
  .tier{height:34px;font-size:18px}
  .trinket{padding:12px;gap:8px;flex-wrap:wrap}
  .rank{flex-basis:20px}
  .value{width:100%;min-width:0;padding-left:28px;text-align:left}
  .value b,.gap{display:inline;margin-right:10px}
  .notice{padding:16px;gap:12px}
  .notice-icon{display:none}
}
@media print{.scenario{display:block}.targets,.index{display:none}}
</style></head>
<body>
<header class="top"><a class="brand" href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer"><b>SimC</b> Lab</a>
  <nav aria-label="Links"><a href="https://mythicpersona.com/weapon-tier-list" target="_blank" rel="noopener noreferrer">Weapon tier lists</a><a href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer">SimC Lab</a></nav></header>
<main>
<header class="hero">
  <span class="eyebrow">${escape(lab.season?.name||'Trinket Lab')}</span>
  <h1><span>Trinket</span><span class="accent">tier list.</span></h1>
  <p class="lede">${src.equal
    ? `Every trinket at every chosen item level (${escape((src.steps||[]).join(', '))}), equal footing: this answers what a trinket is worth, not what you can reach with it.`
    : `Each trinket up to the level its own source can give it: ${escape([src.raid&&`raid ${src.raid.label}`,src.mplus&&`Mythic+ ${src.mplus.label}`,src.vault&&`Mythic+ through the Great Vault ${src.vault.label.replace(/^Great Vault · /,'')}`,src.delves&&`delves ${src.delves.label}`,src.crafted&&`crafted ${src.crafted.label}`].filter(Boolean).join(', '))}. A trinket's tier is read at the highest of those levels.`}
    ${lab.model==='pairs'?'The best pairs are two trinkets worn together, ranked on what they add over the same character with no trinket. Below them, each trinket alone with the other slot empty: its isolated value, which shows how it scales but not how it works beside a second trinket.':'Each trinket is worn alone, the second slot empty, and the bar is what it adds over the same character with no trinket at all.'} Simulated locally with SimulationCraft ${escape(job.engine.version)} on WoW ${escape(job.engine.wowVersion)}.</p>
  <div class="stats">
    ${stat(when,'simulated')}
    ${stat(String(specs.length),'specializations')}
    ${stat(String(ranked),'trinkets ranked')}
    ${stat(range.min===range.max?String(range.max):`${range.min}–${range.max}`,'item level')}
    ${stat(number(job.settings.iterations),'iterations')}
  </div>
</header>
<aside class="notice" aria-label="Simulation reminder"><span class="notice-icon" aria-hidden="true">!</span><div><strong>Always sim your own character.</strong><p>${lab.model==='pairs'?'These results are SimulationCraft\'s reference character, not you.':'These bars are one trinket on a reference character with the other slot empty.'} Your gear, talents and second trinket change the order; sim the pair you would actually wear before you spend on one.</p></div><a class="button" href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer">Sim with SimC Lab →</a></aside>
${scenarios.map((s,i)=>`<input class="scn" type="radio" name="scenario" id="scn-${i}"${i===0?' checked':''} aria-label="${escape(scenarioName(s.scenario,false))}">`).join('')}
${scenarios.length>1?`<nav class="targets" aria-label="Targets"><span>${shared?escape(scenarios[0].scenario.style):'Scenario'}</span>${scenarios.map((s,i)=>`<label for="scn-${i}">${escape(scenarioName(s.scenario,shared))}</label>`).join('')}</nav>`:''}
<p class="legend">Item level:${levels.map(level=>`<span class="swatch"><i style="background:${palette.get(level)}"></i>${level}</span>`).join('')}</p>
<p class="legend">Distance behind the best trinket of the same specialization:${tiers.map((t,i)=>`<b class="t-${t.tier}">${t.tier}</b>${Number.isFinite(t.behind)?`under ${t.behind}${i<tiers.length-1?',':''}`:'and beyond'}`).join(' ')} — in percent of DPS, or in score points where a tank is ranked on damage and survival. “~” marks a gap inside the combined 95% uncertainty.</p>
<div class="scenarios">
${scenarios.map((s,i)=>`<div class="scenario" data-scenario="${i}">
  <p class="title"><b>${escape(s.scenario.label||`${s.scenario.style} · ${s.scenario.targets} target${s.scenario.targets===1?'':'s'}`)}</b> ${s.scenario.label?`${escape(s.scenario.style)} · ${s.scenario.targets} target${s.scenario.targets===1?'':'s'} · `:''}${s.scenario.duration||job.settings.duration} sec · ${number(job.settings.iterations)} iterations · ${job.settings.targetError}% target error</p>
  <nav class="index">${s.present.map(c=>`<a style="--dot:${escape(classColors[c.key]||'#33e5ff')}" href="#${escape(anchor(c.name+'-'+s.index))}">${escape(c.name)}</a>`).join('')}</nav>
  ${s.present.map(c=>`<section class="class" id="${escape(anchor(c.name+'-'+s.index))}" style="--dot:${escape(classColors[c.key]||'#33e5ff')}"><h2>${escape(c.name)}</h2>${c.sections}</section>`).join('')}</div>`).join('')}
</div>
<footer><strong>The simulation context</strong>
Built by <a href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer">SimC Lab</a> · powered by <a href="https://github.com/simulationcraft/simc" target="_blank" rel="noopener noreferrer">SimulationCraft</a> · items link to Wowhead, and hovering one shows its tooltip from there.<br>
Reference characters are SimulationCraft's own profiles, one per specialization, with both trinkets taken off: the gear, gems and enchants around the trinket are theirs and not yours.${specs.some(s=>s.stale)?` ${specs.filter(s=>s.stale).map(s=>escape(s.label)).join(', ')} are marked: their profile is a season behind.`:''} Healing specializations are not ranked: SimulationCraft cannot simulate healing, and a trinket is mostly its effect, which no stat score can value.<br>
A trinket that completes an item set with the reference gear is shown twice: ◆ with the set's bonus, as that character would wear it, and ◇ without it, the trinket alone. The rest of the list is measured from the best trinket without a set bonus.<br>
${number(job.settings.iterations)} iterations at ${job.settings.targetError}% target error${lab.screen?`; screening at ${number(lab.screen.iterations)} iterations and ${lab.screen.targetError}%`:''}. Numbers compare trinkets within one specialization; they are not a ranking between classes, and a pair of trinkets is not the sum of two bars.<br>
Oswald and Roboto Mono are used under the SIL Open Font License.
</footer>
</main></body></html>`;
}
