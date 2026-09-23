// One page holding the whole Weapon Lab result: every class, every specialization, every weapon in its tier.
// It is built from a finished job and carries no script and no external file, so it reads the same inside the
// app and after it is saved and sent to someone else.
import {tiers} from './weapons.mjs';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const signed=(n,digits=2)=>`${n>=0?'+':''}${Number(n).toFixed(digits)}`;
const anchor=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const kindNames={main:'Main hand',offhand:'Off-hand weapon',shield:'Shield',held:'Held in off hand'};

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
  const chip=row=>{
    const c=byKey.get(row.key);
    if(!c)return '';
    const value=tanky?`${signed(row.score)} score`:`${number(row.dps)} DPS`;
    const behind=row.rank===1?'best':`−${row.behind.toFixed(2)}${tanky?'':' %'}${row.tied?' ~':''}`;
    return `<li class="chip${row.rank===1?' first':''}"><a href="${escape(itemUrl(c))}" data-wowhead="${escape(itemParams(c).join('&'))}" target="_blank" rel="noopener noreferrer">${escape(c.name)}</a>
      <span class="meta">${escape(kindNames[c.kind]||c.kind)}${c.craftedStat?` · ${escape(c.craftedStat)}`:''} · ${escape(c.sources[0]||'')}</span>
      <span class="value">${escape(value)}<b>${escape(behind)}</b>${row.screened?'<i>screened only</i>':''}</span></li>`;
  };
  return `<section class="spec" id="${escape(anchor(spec.key))}">
    <h3>${escape(spec.specName)}<span class="spec-meta">${escape(spec.className)} · ${rows.length} weapons · ${escape(spec.file.replace(/\.simc$/,''))}${spec.gear?` · gear at item level ${spec.gear.itemLevel}`:''}${baseline?` · reference ${number(baseline.dps)} DPS`:''}${tanky?' · ranked on DPS and survival':''}</span></h3>
    ${spec.stale?`<p class="warn">Ranked on last season's character: SimulationCraft has not rebuilt this profile for the current season, so its gear sits well below the others. The order here holds; the numbers do not belong next to another specialization's.</p>`:''}
    ${hands.map(hand=>`${hands.length>1?`<h4 class="hand">${escape(hand.name)} <span>${hand.rows.length} weapons</span></h4>`:''}${
      tiers.map(t=>({tier:t.tier,rows:hand.rows.filter(r=>r.tier===t.tier)})).filter(g=>g.rows.length)
        .map(g=>`<div class="tier-row"><span class="tier tier-${g.tier}">${g.tier}</span><ul class="chips">${g.rows.map(chip).join('')}</ul></div>`).join('')}`).join('')}
  </section>`;
}

export function tierListPage(job){
  if(!job.weapons)throw new Error('This job is not a Weapon Lab run.');
  const specs=job.weapons.specs;
  const classes=[];
  for(const spec of specs){
    const existing=classes.find(c=>c.name===spec.className);
    if(existing)existing.specs.push(spec);else classes.push({name:spec.className,specs:[spec]});
  }
  // A class appears in a scenario only when one of its specializations has results there.
  const scenarios=job.scenarios.map((scenario,index)=>{
    const present=classes.map(c=>({name:c.name,sections:c.specs.map(spec=>specSection(job,spec,index)).join('')})).filter(c=>c.sections);
    return present.length?{scenario,index,present}:null;
  }).filter(Boolean);
  const when=new Date(job.finished||job.created).toISOString().slice(0,10);
  const level=job.weapons.level;
  const title=`Weapon tier list · ${escape(job.weapons.season?.name||'')} · item level ${level.itemLevel}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${title}</title>
<!-- Wowhead's own tooltip script, the one thing on this page that is not in the file: it turns the item links
     into previews on hover. Without a network the links still work, they just do not pop up. -->
<script async src="https://wow.zamimg.com/js/tooltips.js"></script>
<style>
:root{color-scheme:dark;--bg:#10131b;--surface:#181d28;--line:#2b3343;--muted:#99a5b8;--amber:#f3b754;--green:#85d9b2}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:#e5eaf3;font:16px/1.5 Inter,"Segoe UI",sans-serif}
main{max-width:1180px;margin:auto;padding:32px 20px 64px}
a{color:inherit;text-decoration:none}
a:hover{text-decoration:underline}
h1{font-size:34px;letter-spacing:-1px;margin:0 0 10px;font-weight:650}
h1 span{color:var(--amber)}
h2{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:var(--amber);margin:38px 0 14px;font-weight:650}
h3{font-size:17px;margin:0 0 14px;font-weight:600;display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.lede{color:var(--muted);font-size:14px;margin:0 0 6px;max-width:80ch}
.index{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0 8px;padding:14px;background:var(--surface);border:1px solid var(--line);border-radius:10px}
.index a{font-size:13px;padding:5px 10px;border:1px solid var(--line);border-radius:20px;color:#c7d2e3}
.index a:hover{border-color:var(--amber);color:var(--amber);text-decoration:none}
.scenario{margin-top:34px;padding-top:6px}
.scenario>.title{font-size:14px;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:10px}
.spec{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:14px}
.spec-meta{font-size:12px;color:var(--muted);font-weight:400}
.warn{margin:0 0 12px;padding:10px 12px;background:#352923;border:1px solid #7c5540;border-radius:7px;color:#f3ceb1;font-size:12px;line-height:1.6}
.hand{font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#c7d2e3;margin:16px 0 4px;font-weight:650}
.hand span{color:var(--muted);font-weight:400;letter-spacing:0;text-transform:none}
.hand:first-of-type{margin-top:4px}
.tier-row{display:flex;gap:14px;align-items:flex-start;padding:10px 0;border-top:1px solid #222a38}
.tier-row:first-of-type{border-top:0}
.hand+.tier-row{border-top:0}
.tier{flex:0 0 34px;text-align:center;padding:5px 0;border-radius:6px;font-weight:700;font-size:14px;border:1px solid}
.tier-S{background:#3a2f1c;border-color:#8a6a2f;color:#ffd181}
.tier-A{background:#1e3328;border-color:#3f7a58;color:var(--green)}
.tier-B{background:#1d2b3d;border-color:#3d5e85;color:#a8c8ef}
.tier-C{background:#242a36;border-color:#3d475a;color:#b6c0d0}
.tier-D{background:#2c2429;border-color:#5b4450;color:#c3aab4}
.chips{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin:0;padding:0;flex:1}
.chip{background:#141a25;border:1px solid var(--line);border-radius:7px;padding:9px 11px;font-size:13px}
.chip.first{border-color:#6a5326}
.chip a{font-weight:600}
.chip .meta{display:block;color:var(--muted);font-size:11px;margin-top:3px}
.chip .value{display:flex;gap:8px;align-items:baseline;margin-top:6px;font-size:12px;color:#c3ccdb}
.chip .value b{color:var(--amber);font-weight:600}
.chip .value i{color:var(--muted);font-style:normal;font-size:11px}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;line-height:1.8}
@media(max-width:640px){.tier-row{flex-direction:column}.tier{flex:0 0 auto;width:34px}}
</style></head>
<body><main>
<h1>Weapon tier list<span>.</span></h1>
<p class="lede">${escape(job.weapons.season?.name||'')} · every candidate at item level ${level.itemLevel} (${escape(level.label)}), so the ranking measures the weapon and not where it dropped. ${specs.length} specializations, simulated locally with SimulationCraft ${escape(job.engine.version)} on WoW ${escape(job.engine.wowVersion)}, ${when}.</p>
<p class="lede">A tier is the distance behind the best weapon of the same specialization: S under ${tiers[0].behind}, A under ${tiers[1].behind}, B under ${tiers[2].behind}, C under ${tiers[3].behind}, then D — in percent of DPS, or in score points where a tank is ranked on damage and survival. A “~” marks a weapon whose distance to the best is inside the combined 95% uncertainty. Numbers compare weapons within one specialization; they are not a ranking between classes.</p>
${scenarios.map(s=>`<div class="scenario">
  <p class="title">${escape(s.scenario.style)} · ${s.scenario.targets} target${s.scenario.targets===1?'':'s'} · ${job.settings.duration} sec · ${number(job.settings.iterations)} iterations</p>
  <nav class="index">${s.present.map(c=>`<a href="#${escape(anchor(c.name+'-'+s.index))}">${escape(c.name)}</a>`).join('')}</nav>
  ${s.present.map(c=>`<section class="class" id="${escape(anchor(c.name+'-'+s.index))}"><h2>${escape(c.name)}</h2>${c.sections}</section>`).join('')}</div>`).join('')}
<footer>
Built by <a href="https://mythicpersona.com/simc-lab" target="_blank" rel="noopener noreferrer">SimC Lab</a> · powered by <a href="https://github.com/simulationcraft/simc" target="_blank" rel="noopener noreferrer">SimulationCraft</a> · items link to Wowhead, and hovering one shows its tooltip from there.<br>
Each hand is ranked on its own: a weapon is only ever compared with what could take the same hand, because what the reference character holds in the other hand decides how much a swap is worth.<br>
Reference characters are SimulationCraft's own profiles, one per specialization — the gear, gems and enchants its authors assembled for the season, so what surrounds the weapon is theirs and not yours.${specs.some(s=>s.stale)?` ${specs.filter(s=>s.stale).map(s=>escape(s.label)).join(', ')} are marked: their profile is a season behind.`:''} Crafted weapons are shown at the secondary stats that served them best. Weapons are compared like for like with what the reference profile wields.<br>
${number(job.settings.iterations)} iterations at ${job.settings.targetError}% target error${job.weapons.screen?`; screening at ${number(job.weapons.screen.iterations)} iterations and ${job.weapons.screen.targetError}%`:''}. Small differences need more precision before they mean anything.
</footer>
</main></body></html>`;
}
