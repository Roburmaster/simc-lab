// The website's form of a Trinket Lab job: the JSON mythicpersona.com's trinket pages read (the same shape its
// importer makes from a report page, schema 2), with each scenario's best pairs beside the tier list. Built from the
// job itself rather than from its HTML page, so a publisher can put one class at a time on the site and merge each
// into what is already there (mergeSiteReport).
import {trinketSeries,pairSeries,jobLevels,levelLabels,classColors,levelColors,itemUrl,pairValueText} from './trinketpage.mjs';
import {tiers} from './weapons.mjs';

const number=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const scenarioId=s=>s.preset||`${s.style}-${s.targets}${s.duration?`-${s.duration}`:''}`;
export const scenarioName=s=>s.label||`${s.style} · ${s.targets} target${s.targets===1?'':'s'}`;

// One trinket as the site lists it: the same text the report page shows.
function item(row,c,levels,{tanky,support}){
  const unit=tanky?' score':' %';
  const top=levels.at(-1)||{gain:row.gain,percent:row.percent};
  const value=Number.isFinite(top.gain)?(tanky?`+${top.gain.toFixed(2)} score`:`+${top.percent.toFixed(2)} % · +${number(top.gain)} ${support?'raid ':''}DPS`):'no gain measured';
  const gap=c.overLimit&&row.behind<0?`+${(-row.behind).toFixed(2)}${unit}, but not wearable beside this gear`:c.set&&row.behind<0?`+${(-row.behind).toFixed(2)}${unit} with the set`:row.behind<=0?'best trinket':`−${row.behind.toFixed(2)}${unit}`;
  const meta=[c.sources[0]||'',c.sources.length>1?`+${c.sources.length-1}`:''].filter(Boolean).join(' ')+` · ${c.itemLevel}${c.levelLabel?` ${c.levelLabel}`:''}${c.onUse?' · on use':''}`
    +(c.freed?` · worn in place of the ${c.freed.embellishment} on ${c.freed.item}`:'')+(c.overLimit?` · over the ${c.overLimit.join(', ')} limit`:'');
  return {name:c.name,href:itemUrl(c),rank:String(row.rank),meta,value,gap:gap+(row.tied?' ~':''),flag:row.screened?'screened only':'',
    set:c.set?`With the ${c.set.name} ${c.set.pieces}-set bonus, beside ${c.set.with.join(', ')}`:'',noset:c.setOff?`Without the ${c.setOff.name} set bonus: the trinket alone`:'',
    variant:c.setOff?'noset':c.set?'set':'',levels:levels.map(l=>({itemLevel:l.itemLevel,gain:Number(l.gain.toFixed(tanky?3:1)),percent:Number(l.percent.toFixed(3))}))};
}

function result(job,spec,s,shownPairs){
  const series=trinketSeries(job,spec,s);
  if(!series.length)return {meta:'',notes:[],tiers:[]};
  const tanky=series.some(x=>Number.isFinite(x.row.score));
  const stages=(job.stages||[]).filter(st=>st.spec===spec.key&&st.scenario===s);
  const baseline=stages.find(st=>st.stage===2&&st.baseline)?.baseline;
  const notes=[];
  if(spec.support)notes.push(`Ranked on the whole raid's damage: ${spec.specName} does most of its damage through its allies' buffs.`);
  if(spec.stale)notes.push("Ranked on last season's character: SimulationCraft has not rebuilt this profile for the current season.");
  if(spec.ours)notes.push("Carried by SimC Lab's own character: SimulationCraft has no profile for this specialization this season.");
  if(spec.statStick)notes.push(`Each trinket is worn beside a versatility stat stick at item level ${spec.statStick.itemLevel}.`);
  const pairs=pairSeries(job,spec,s).slice(0,shownPairs).map(({row,parts})=>({rank:String(row.rank),
    items:parts.map(c=>({name:c.name,href:itemUrl(c),itemLevel:c.itemLevel,onUse:!!c.onUse,...(c.freed?{freed:`in place of the ${c.freed.embellishment} on ${c.freed.item}`}:{})})),
    value:pairValueText(row,{tank:tanky,support:spec.support}),gap:(row.behind>0?`−${row.behind.toFixed(2)}${tanky?' score':' %'}`:'best pair')+(row.tied?' ~':''),
    ...(tanky?{dps:Number(row.dpsGain.toFixed(2)),survival:Number(row.survival.toFixed(2)),score:Number(row.score.toFixed(2))}:{percent:Number(row.percent.toFixed(3))})}));
  return {meta:`${series.length} trinkets${spec.gear?` · reference gear ${spec.gear.itemLevel} ilvl`:''}${baseline?` · ${number(baseline.dps)} ${spec.support?'raid ':''}DPS with no trinket`:''}${tanky?' · DPS and survival':''} · ${spec.file.replace(/\.simc$/,'')}`,
    notes,tiers:tiers.map(t=>({tier:t.tier,items:series.filter(x=>x.row.tier===t.tier).map(x=>item(x.row,x.candidate,x.levels,{tanky,support:spec.support}))})).filter(t=>t.items.length),
    ...(pairs.length?{pairs}:{})};
}

export function siteReport(job,{shownPairs=10}={}){
  if(!job.trinkets)throw new Error('This job is not a Trinket Lab run.');
  const lab=job.trinkets,levels=jobLevels(job),labels=levelLabels(job);
  const palette=new Map(levels.map((level,i)=>[level,levelColors[Math.round(i*(levelColors.length-1)/Math.max(1,levels.length-1))]]));
  const classes=[];
  for(const spec of lab.specs){
    let c=classes.find(x=>x.name===spec.className);
    if(!c)classes.push(c={name:spec.className,slug:slug(spec.className),color:classColors[spec.class]||'#33e5ff',specs:[]});
    c.specs.push({name:spec.specName,slug:slug(spec.specName),scenarios:job.scenarios.map((_,s)=>result(job,spec,s,shownPairs))});
  }
  const date=new Date(job.finished||job.created).toISOString().slice(0,10);
  return {schemaVersion:2,kind:'trinket-lab',source:{job:job.id,app:job.engine?.version?`SimulationCraft ${job.engine.version}`:null,simcSha:lab.repro?.simcSha||job.engine?.commit||null,wowBuild:job.engine?.wowVersion||null},
    date,season:lab.season?.name||'',model:lab.model||'statstick',
    scenarios:job.scenarios.map(s=>({id:scenarioId(s),name:scenarioName(s),detail:`${s.style} · ${s.targets} target${s.targets===1?'':'s'} · ${s.duration||job.settings.duration} sec · ${number(job.settings.iterations)} iterations · ${job.settings.targetError}% target error`,date})),
    itemLevel:levels.length?(levels[0]===levels.at(-1)?String(levels[0]):`${levels[0]}–${levels.at(-1)}`):'',
    description:lab.specs[0]?.statStick?`Each trinket beside a stat stick (a versatility-only trinket at item level ${lab.specs[0].statStick.itemLevel}) on SimulationCraft's reference character for each specialization, as Bloodmallet charts them, at every item level its source can reach${lab.model==='pairs'?'; above the tier list, the best two trinkets worn together':''}.`:lab.model==='pairs'?'Two trinkets worn together by SimulationCraft\'s reference character for each specialization, each at the item level its own source can give it; the tier list below is each trinket alone with the other slot empty.':'Each trinket worn alone by SimulationCraft\'s reference character for each specialization, at every item level its source can reach.',
    legend:'Distance behind the best trinket of the same specialization: S under 0.5, A under 1.5, B under 3, C under 5, D beyond — in percent of DPS, or in score points where a tank is ranked on damage and survival. "~" marks a gap inside the combined 95% uncertainty.',
    levels:levels.map(l=>({itemLevel:l,color:palette.get(l),...(labels.get(l)?{label:labels.get(l)}:{})})),
    methodology:['Simulated with SimC Lab on SimulationCraft\'s own reference profiles, one per specialization, with both trinkets taken off.','An embellished trinket beside gear that already wears two embellishments is shown in place of the embellishment it costs least to give up.','Healing specializations are not ranked: SimulationCraft cannot simulate healing.'],
    classes};
}

// Puts `part` (one or more classes, one or more scenarios) into `base`. Scenarios are matched by id and keep the
// order they first appeared in; a class or specialization in `part` replaces its results for part's scenarios only.
export function mergeSiteReport(base,part){
  if(!base)return structuredClone(part);
  const out=structuredClone(base);
  for(const s of part.scenarios){
    const at=out.scenarios.findIndex(x=>x.id===s.id);
    if(at<0){out.scenarios.push(s);for(const c of out.classes)for(const sp of c.specs)sp.scenarios.push({meta:'',notes:[],tiers:[]});}
    else out.scenarios[at]=s;
  }
  for(const c of part.classes){
    let target=out.classes.find(x=>x.slug===c.slug);
    if(!target){out.classes.push(target={...c,specs:[]});out.classes.sort((a,b)=>a.name.localeCompare(b.name));}
    for(const sp of c.specs){
      let spec=target.specs.find(x=>x.slug===sp.slug);
      if(!spec){target.specs.push(spec={name:sp.name,slug:sp.slug,scenarios:out.scenarios.map(()=>({meta:'',notes:[],tiers:[]}))});target.specs.sort((a,b)=>a.name.localeCompare(b.name));}
      part.scenarios.forEach((s,i)=>{spec.scenarios[out.scenarios.findIndex(x=>x.id===s.id)]=sp.scenarios[i];});
    }
  }
  const levels=new Map(out.levels.map(l=>[l.itemLevel,l]));
  for(const l of part.levels)levels.set(l.itemLevel,{...levels.get(l.itemLevel),...l});
  out.levels=[...levels.values()].sort((a,b)=>a.itemLevel-b.itemLevel);
  const all=out.levels.map(l=>l.itemLevel);
  out.itemLevel=all.length?(all[0]===all.at(-1)?String(all[0]):`${all[0]}–${all.at(-1)}`):'';
  Object.assign(out,{date:part.date,season:part.season,source:part.source,model:part.model});
  return out;
}
