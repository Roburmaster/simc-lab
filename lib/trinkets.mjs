// Trinket Lab: one trinket tier list per specialization, the way Bloodmallet charts them. Every trinket in the active
// season's loot tables is worn alone by SimC's own reference character for that spec, with the second trinket slot
// left empty, at every chosen item level its source can reach. The gain over the same character wearing no trinket
// at all is the trinket's worth; the tier is read at the highest level the trinket can actually be had.
import {eligible,sourceKinds,carried} from './upgrades.mjs';
import {loadReferenceSpecs,dropLevels,craftedItemLevel,completedSet} from './weapons.mjs';
import {normalizeTank} from './tank.mjs';

export const limits={specs:48,candidates:8000,finalists:[16,32,64]};
export const trinketSlots=['trinket1','trinket2'];
const isTrinket=item=>item?.itemClass===4&&item?.inventoryType===12;

// The reference character without its trinkets: the baseline every trinket is measured against. Both slots go, so
// one trinket's worth never depends on which second trinket SimulationCraft's authors happened to pick.
export function withoutTrinkets(spec){
  const text=String(spec.text).split(/\r?\n/).filter(line=>!/^\s*trinket[12]\s*=/.test(line)).join('\n');
  const gear=Object.fromEntries(Object.entries(spec.gear||{}).filter(([slot])=>!trinketSlots.includes(slot)));
  return {...spec,text,gear,worn:trinketSlots.map(slot=>spec.gear?.[slot]?.id).filter(Boolean)};
}

// The item levels a trinket is shown at. Each is the top of an upgrade track, the level a player finishes a track
// on; `tracks` names which. A trinket gets every step below the level its own source can give it, and then that
// level itself, so a delve trinket stops at the top of the Hero track and a last raid boss's reaches its own drop.
// On equal footing every trinket gets every step, whatever its source.
export function levelSteps(season,tracks){
  const wanted=tracks===undefined?season.tracks.slice(-3).map(t=>t.id):tracks;
  if(!Array.isArray(wanted)||!wanted.length)throw new Error('Choose at least one item level to show trinkets at.');
  return wanted.map(id=>{
    const track=season.tracks.find(t=>t.id===Number(id));
    if(!track)throw new Error(`Unknown upgrade track ${id}.`);
    const top=track.levels.at(-1);
    return {track:track.id,bonusId:top.bonusId,itemLevel:top.itemLevel,label:`${track.name} ${top.level}/${top.max}`};
  }).sort((a,b)=>a.itemLevel-b.itemLevel).filter((s,i,list)=>i===0||s.itemLevel!==list[i-1].itemLevel);
}

// One row per trinket and item level. The same trinket can drop in more than one place: it is listed once, at the
// highest level any of its sources can give it, and the label names where that is.
export function trinketCandidates(spec,season,catalog,{drops,steps,equal=false}){
  const found=new Map();
  for(const {item,source} of season.entries){
    if(!isTrinket(item)||!eligible(item,spec.info,spec.specId,season.weaponSpecs))continue;
    const drop=drops[source.kind];
    if(!drop)continue;
    const cap=drop.of(source),label=`${sourceKinds[source.kind]} · ${source.groupName}`;
    const existing=found.get(item.id);
    if(existing){
      if(cap.itemLevel>existing.cap.itemLevel)Object.assign(existing,{cap,kind:source.kind,sources:[label,...existing.sources.filter(s=>s!==label)]});
      else if(!existing.sources.includes(label))existing.sources.push(label);
      continue;
    }
    found.set(item.id,{item,cap,kind:source.kind,sources:[label]});
  }
  const list=[];
  for(const {item,cap,kind,sources} of [...found.values()].sort((a,b)=>a.item.name.localeCompare(b.item.name))){
    // Crafted trinkets have no upgrade track; their level is set directly, as the game's own crafting does.
    const crafted=kind==='crafted'&&!equal;
    const levels=equal?steps:[...steps.filter(s=>s.itemLevel<cap.itemLevel).map(s=>crafted?{ilevel:s.itemLevel,itemLevel:s.itemLevel,label:`item level ${s.itemLevel}`}:s),cap];
    const set=completedSet(spec,'trinket1',item.id,catalog);
    levels.forEach((level,index)=>{
      const bonuses=[...(item.bonusLists||[]),...(level.bonusId?[level.bonusId]:[])];
      const value=[`,id=${item.id}`,...(bonuses.length?[`bonus_id=${bonuses.join('/')}`]:[]),...(level.ilevel?[`ilevel=${level.ilevel}`]:[]),...carried(null,item,bonuses,season.bonusSockets)].join(',');
      list.push({slot:'trinket1',itemId:item.id,name:item.name,itemLevel:level.itemLevel,levelLabel:level.label,value,line:`trinket1=${value}`,
        sources,onUse:!!item.onUseTrinket,top:index===levels.length-1,...(set?{set}:{})});
    });
  }
  list.forEach((c,i)=>c.key='t'+String(i+1).padStart(4,'0'));
  return list;
}

export const trinketCount=spec=>new Set(spec.candidates.map(c=>c.itemId)).size;

export async function prepareTrinkets(request,catalog,season,talentData,source,scenarios=1){
  const options=request.trinkets||{};
  const available=(await loadReferenceSpecs(source,talentData)).filter(s=>!s.healer);
  const finalists=Number(options.finalists??64);
  if(!limits.finalists.includes(finalists))throw new Error('Choose a supported final round size.');
  const equal=!!options.equal;
  const steps=levelSteps(season,options.steps);
  const drops=dropLevels(season,{sources:options.sources,craftedCap:await craftedItemLevel(source)});
  const keys=options.specs===undefined?available.map(s=>s.key):options.specs;
  if(!Array.isArray(keys)||!keys.length)throw new Error('Choose at least one specialization.');
  if(keys.length>limits.specs)throw new Error(`Choose at most ${limits.specs} specializations.`);
  const specs=[],skipped=[];
  for(const key of keys){
    const reference=available.find(s=>s.key===key);
    if(!reference)throw new Error(`Unknown specialization ${key}.`);
    const spec=withoutTrinkets(reference);
    const candidates=trinketCandidates(spec,season,catalog,{drops:drops.of,steps,equal});
    if(!candidates.length){skipped.push({key,label:spec.label,reason:'No trinket in the season can be worn by this specialization.'});continue;}
    specs.push({...spec,candidates,tank:normalizeTank(request.tank,spec.info)});
  }
  if(!specs.length)throw new Error('No selected specialization has a trinket to rank.');
  const total=specs.reduce((n,s)=>n+s.candidates.length,0);
  if(total*scenarios>limits.candidates)throw new Error(`The selection produces ${total} trinket and item level pairs across ${scenarios} scenario${scenarios===1?'':'s'}. Narrow it to ${limits.candidates} runs or fewer.`);
  const levels=specs.flatMap(s=>s.candidates.map(c=>c.itemLevel));
  return {season:season.season,sources:equal?{equal:true,steps:steps.map(s=>s.label)}:drops.public,equal,steps,finalists,specs,skipped,candidates:total,
    trinkets:specs.reduce((n,s)=>n+trinketCount(s),0),levels:{min:Math.min(...levels),max:Math.max(...levels)}};
}

// Steps the job will report: one or two profileset runs per spec and scenario, the idle run of a support
// specialization, and one boss calibration per tank spec.
export const specSteps=(s,finalists,scenarios)=>scenarios*((trinketCount(s)>finalists?2:1)+(s.support?1:0))+(s.tank?1:0);
export const trinketSteps=(plan,scenarios)=>plan.specs.reduce((n,s)=>n+specSteps(s,plan.finalists,scenarios),0);

// Screening runs each trinket once, at its top level. The best go on to the final round at every level; the rest
// keep their screened number and show no curve.
export const topRows=spec=>spec.candidates.filter(c=>c.top);
export function selectTopTrinkets(candidates,screen,size,tank){
  const byKey=new Map(screen.rows.map(r=>[r.key,r]));
  const metric=r=>tank?.boss?(Number.isFinite(r.score)?r.score:-Infinity):(Number.isFinite(r.dps)?r.dps:-Infinity);
  const chosen=new Set(candidates.filter(c=>c.top&&byKey.has(c.key)).sort((a,b)=>metric(byKey.get(b.key))-metric(byKey.get(a.key))).slice(0,size).map(c=>c.itemId));
  return candidates.filter(c=>chosen.has(c.itemId));
}

// What a row adds over the character with no trinket: DPS, the raid's DPS for a support specialization, or the
// tank score, which is already measured against that baseline. `percent` is of the baseline, or of a support
// specialization's share of the raid when that is known.
export function gainOf(row,baseline,{tank,share}={}){
  if(tank?.boss)return Number.isFinite(row.score)?{gain:row.score,percent:row.score}:null;
  if(!Number.isFinite(row.dps)||!Number.isFinite(baseline?.dps))return null;
  const gain=row.dps-baseline.dps;
  return {gain,percent:100*gain/Math.max(1,share||baseline.dps)};
}
