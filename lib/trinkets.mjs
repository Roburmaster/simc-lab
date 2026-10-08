// Trinket Lab: which trinkets, and which two together, are best for a specialization. Players wear two trinkets, so
// the answer that matters is a pair: SimC's own reference character wears two of the season's trinkets at once, each
// at the level its own source can really give it, and the pairs are ranked on what they do together.
//
// Every pair of every trinket is far too many runs, so the pairs are found in stages:
//   1. Isolated value: each trinket alone, the other slot empty, against the character wearing none. It is a
//      diagnostic and the pruning pass, never the pair ranking; it also gives each trinket its item level curve.
//   2. Pair pool: the best trinkets alone, everything close behind the cutoff, and the best on-use trinkets.
//   3. Pair screening: every legal pair in the pool at screening precision.
//   4. Pair final: the best pairs, and those screening could not tell apart from them, at full precision.
//   5. Resolution: pairs still statistically tied with the best, once more at high precision.
import {createHash} from 'node:crypto';
import {eligible,sourceKinds,carried,itemLimitsOf,bonusIdsOf,equippedLimits,overLimit,limitNames,freeableSlots} from './upgrades.mjs';
export {freeableSlots};
import {loadReferenceSpecs,dropLevels,craftedItemLevel,completedSet} from './weapons.mjs';
import {normalizeTank} from './tank.mjs';
import {trinketVariants} from './trinketoverrides.mjs';

// No cap on how much a job may simulate: the app runs on your own PC, and a long job is your call to make. A pool or
// pair round size of 0 means all of them.
export const limits={specs:48,finalists:[16,32,64],pool:[8,12,16,24,32,0],pairFinalists:[10,20,40,0]};
// Three answers to three questions: which two trinkets to wear (pairs), what one trinket does alone (single, the
// other slot empty), and what one trinket is worth beside a neutral second trinket (statstick: Bloodmallet's control,
// with this app's realistic item levels), which gives every trinket the same stat level around it.
// The tier list is always each trinket alone beside a stat stick, Bloodmallet's control: every trinket has the same
// stats around it, so every number compares with every other. `pairs` adds the best pairs on top (two real trinkets,
// against the character wearing none). Jobs from before 1.28.0 may carry `single`, the other slot left empty; they
// still show, but it is no longer offered.
export const models={pairs:'Stat stick tier list and best pairs',statstick:'Stat stick tier list only'};
// A trinket's worth depends on the fight, so Trinket Lab ranks each scenario on its own. Mythic+ pulls are short:
// an on-use trinket with a two-minute cooldown is pressed once per pull, not every two minutes, and a stacking effect
// never reaches its peak, so those pulls run for their own length rather than the job's.
export const scenarioPresets=[
  {id:'raid_st',label:'Raid · single target',style:'Patchwerk',targets:1},
  {id:'raid_move',label:'Raid · movement',style:'LightMovement',targets:1},
  {id:'raid_cleave',label:'Raid · cleave',style:'Patchwerk',targets:2},
  // A small pull gets neither Bloodlust nor a potion: both are saved for the pulls that need them, like a large one.
  {id:'mplus_small',label:'Mythic+ · small pull',style:'Patchwerk',targets:3,duration:40,bloodlust:false,potion:false},
  {id:'mplus_large',label:'Mythic+ · large pull',style:'Patchwerk',targets:5,duration:60},
  {id:'dungeon',label:'Mythic+ · dungeon route',style:'DungeonSlice',targets:1},
  {id:'casting',label:'Casting Patchwerk · validation',style:'CastingPatchwerk',targets:1}
];
export function presetScenarios(ids){
  if(!Array.isArray(ids)||!ids.length)throw new Error('Choose at least one scenario.');
  return ids.map(id=>{
    const preset=scenarioPresets.find(p=>p.id===id);
    if(!preset)throw new Error(`Unknown scenario ${id}.`);
    const {id:key,...rest}=preset;
    return {preset:key,...rest};
  });
}
export const pairStages={screen:6,final:7,resolve:8};
export const isPairStage=stage=>stage>=6&&stage<=8;
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
// With `parity` every trinket is built the way Bloodmallet builds it: item ID and item level, no bonus IDs but a
// stat or mode choice, at every step, with no set variant.
export function trinketCandidates(spec,season,catalog,{drops,steps,equal=false,parity=false}){
  if(parity)equal=true;
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
    const levels=(equal?steps:[...steps.filter(s=>s.itemLevel<cap.itemLevel).map(s=>crafted?{ilevel:s.itemLevel,itemLevel:s.itemLevel,label:`item level ${s.itemLevel}`}:s),cap])
      .map(l=>parity?{ilevel:l.itemLevel,itemLevel:l.itemLevel,label:`item level ${l.itemLevel}`}:l);
    // A trinket that completes an item set with the reference gear is shown twice: with the set's bonus, as the
    // character would wear it, and with the bonus switched off, as the trinket alone. Each is its own entry.
    const set=completedSet(spec,'trinket1',item.id,catalog);
    const variants=set?[{group:`${item.id}`,set},...(parity?[]:[{group:`${item.id}|noset`,setOff:{name:set.name,pieces:set.pieces},extra:set.option?[`set_bonus=${set.option}_${set.pieces}pc=0`]:[]}])]:[{group:`${item.id}`}];
    // A trinket that rolls a stat or has a mode (trinketoverrides.mjs) is one entry per choice.
    const base=parity?[]:[...(item.bonusLists||[])];
    for(const choice of trinketVariants(item.id,base))for(const variant of variants)levels.forEach((level,index)=>{
      const bonuses=[...choice.bonuses,...(level.bonusId&&!parity?[level.bonusId]:[])];
      const value=[`,id=${item.id}`,...(bonuses.length?[`bonus_id=${bonuses.join('/')}`]:[]),...(level.ilevel?[`ilevel=${level.ilevel}`]:[]),...(parity?[]:carried(null,item,bonuses,season.bonusSockets))].join(',');
      const uses=itemLimitsOf(item.id,bonuses,season.itemLimits);
      const extra=[...(variant.extra||[]),...choice.options];
      // `item` is the full construction SimC is given, so a result can be reproduced from the job alone.
      list.push({slot:'trinket1',itemId:item.id,name:choice.label?`${item.name} (${choice.label})`:item.name,itemLevel:level.itemLevel,levelLabel:level.label,value,line:`trinket1=${value}`,
        item:{id:item.id,itemLevel:level.itemLevel,bonusIds:bonuses,...(level.ilevel?{ilevel:level.ilevel}:{}),...(choice.options.length?{options:choice.options}:{})},
        sources,onUse:!!item.onUseTrinket,...(uses.size?{limits:[...uses]}:{}),top:index===levels.length-1,...variant,
        ...(choice.label?{choice:choice.label,group:`${variant.group}|${choice.label}`}:{}),...(extra.length?{extra}:{extra:undefined})});
    });
  }
  list.forEach((c,i)=>c.key='t'+String(i+1).padStart(4,'0'));
  return list;
}

// The Great Vault gives Mythic+ loot on a higher track than the dungeon's own chest: in Midnight Season 2 the vault
// reaches the Myth track, the chest stops at Hero. With the vault on, a Mythic+ trinket runs up to the vault's level
// and keeps the chest's level as one of its steps. `choice` is {track, level}; the default is the top track's top.
export function vaultLevel(season,choice){
  if(choice===false||choice?.enabled===false)return null;
  const track=season.tracks.find(t=>t.id===Number(choice?.track))||season.tracks.at(-1);
  const level=track.levels.find(l=>l.level===Number(choice?.level))||track.levels.at(-1);
  return {bonusId:level.bonusId,itemLevel:level.itemLevel,label:`Great Vault · ${track.name} ${level.level}/${level.max}`,track:track.id,level:level.level};
}
export function withVault(drops,vault){
  if(!vault||!drops.of.mplus)return drops;
  const chest=drops.of.mplus;
  const mplus={of:source=>{const own=chest.of(source);return vault.itemLevel>own.itemLevel?vault:own;}};
  return {...drops,of:{...drops.of,mplus},public:{...drops.public,vault:{track:vault.track,level:vault.level,label:vault.label,itemLevel:vault.itemLevel}}};
}

// A trinket entry: the item, or the item without its set bonus.
export const groupOf=c=>c.group||String(c.itemId);
export const trinketCount=spec=>new Set(spec.candidates.map(groupOf)).size;

export async function prepareTrinkets(request,catalog,season,talentData,source,scenarios=1){
  const options=request.trinkets||{};
  const available=(await loadReferenceSpecs(source,talentData)).filter(s=>!s.healer);
  const finalists=Number(options.finalists??64);
  if(!limits.finalists.includes(finalists))throw new Error('Choose a supported final round size.');
  const parity=!!options.parity;
  const model=parity?'statstick':options.model??'pairs';
  if(!models[model])throw new Error('Choose trinket pairs or single trinkets.');
  const pool=Number(options.pool??16),pairFinalists=Number(options.pairFinalists??20);
  if(!limits.pool.includes(pool))throw new Error('Choose a supported pair pool size.');
  if(!limits.pairFinalists.includes(pairFinalists))throw new Error('Choose a supported final pair round size.');
  const equal=parity||!!options.equal;
  const steps=levelSteps(season,options.steps);
  const drops=withVault(dropLevels(season,{sources:options.sources,craftedCap:await craftedItemLevel(source)}),equal?null:vaultLevel(season,options.vault));
  const keys=options.specs===undefined?available.map(s=>s.key):options.specs;
  if(!Array.isArray(keys)||!keys.length)throw new Error('Choose at least one specialization.');
  if(keys.length>limits.specs)throw new Error(`Choose at most ${limits.specs} specializations.`);
  const specs=[],skipped=[];
  for(const key of keys){
    const reference=available.find(s=>s.key===key);
    if(!reference)throw new Error(`Unknown specialization ${key}.`);
    const bare=withoutTrinkets(reference);
    // The stat stick sits at the lowest level on the chart, as Bloodmallet's does: one constant for every trinket.
    // The pair rounds wear two real trinkets on the bare character, so it is kept beside the stat stick one.
    const spec=parity?parityProfile(bare,steps[0].itemLevel):['statstick','pairs'].includes(model)?{...statStickProfile(bare,steps[0].itemLevel),bareText:bare.text}:bare;
    let candidates=trinketCandidates(bare,season,catalog,{drops:drops.of,steps,equal,parity});
    if(!candidates.length){skipped.push({key,label:spec.label,reason:'No trinket in the season can be worn by this specialization.'});continue;}
    const equipped=equippedLimits(spec,season.itemLimits);
    // Bloodmallet ignores equip limits, so a parity run does too.
    if(!parity)candidates=resolveOverLimit(candidates,{equipped,itemLimits:season.itemLimits,free:freeableSlots(bare,season,catalog)});
    // Bloodmallet ranks tanks on damage alone, so a parity run does too.
    specs.push({...spec,candidates,tank:parity?null:normalizeTank(request.tank,spec.info),profile:referenceMeta(reference,spec),equipped,itemLimits:season.itemLimits,...(parity?{parity:spec.parity}:{}),...(spec.statStick?{statStick:spec.statStick}:{})});
  }
  if(!specs.length)throw new Error('No selected specialization has a trinket to rank.');
  const total=specs.reduce((n,s)=>n+s.candidates.length,0);
  const levels=specs.flatMap(s=>s.candidates.map(c=>c.itemLevel));
  const plan={season:season.season,sources:equal?{equal:true,steps:steps.map(s=>s.label)}:drops.public,equal,parity,steps,finalists,model,pool,pairFinalists,specs,skipped,candidates:total,
    trinkets:specs.reduce((n,s)=>n+trinketCount(s),0),levels:{min:Math.min(...levels),max:Math.max(...levels)}};
  plan.estimate=estimate(plan,scenarios);
  return plan;
}

// ---- Bloodmallet parity --------------------------------------------------------------------------------------------
// A debugging mode, never the ranking: the same controlled experiment Bloodmallet runs (bloodytools'
// trinket_simulator.py), so a difference between the two can be traced to its cause. Bloodmallet keeps a versatility
// stat stick in the second slot at its lowest item level and forces a potion; each trinket goes in the first slot as
// item ID and item level only, on Casting Patchwerk at 60,000 iterations and 0.1% target error (see engine.mjs).
// Parity is only claimed when the SimC commit matches the one Bloodmallet used, which the job compares if given.
export const parity={fightStyle:'CastingPatchwerk',targets:1,duration:300,iterations:60000,targetError:0.1,potion:'lights_potential_2',statStickBonus:607};
const mainStat={deathknight:'strength',warrior:'strength',paladin:{protection:'strength',retribution:'strength'},demonhunter:'agility',rogue:'agility',hunter:'agility',
  monk:{brewmaster:'agility',windwalker:'agility'},druid:{feral:'agility',guardian:'agility'},shaman:{enhancement:'agility'}};
export const primaryStat=info=>{const m=mainStat[info?.class];return (typeof m==='string'?m:m?.[info?.spec])||'intellect';};
// Bloodmallet's stat sticks, one per primary stat: Legion trinkets with nothing but versatility at bonus 607.
export const statSticks={agility:142506,intellect:142507,strength:142508};
// The reference character with a stat stick in the second slot: a trinket of the spec's primary stat that carries
// nothing but versatility, so the baseline and every candidate share the same neutral second trinket.
export function statStickProfile(spec,itemLevel){
  const stick=statSticks[primaryStat(spec.info)];
  const trinket2=`,id=${stick},bonus_id=${parity.statStickBonus},ilevel=${itemLevel}`;
  return {...spec,text:`${spec.text}\ntrinket2=${trinket2}`,statStick:{trinket2,stick,itemLevel}};
}
export function parityProfile(spec,itemLevel){
  const stuck=statStickProfile(spec,itemLevel);
  return {...stuck,text:`${stuck.text}\npotion=${parity.potion}`,parity:{...stuck.statStick,potion:parity.potion}};
}

// A trinket that breaks an equip limit beside the reference gear, such as a born embellished trinket next to a profile
// that already wears two embellishments, is worn the way a player would make room for it: once for each embellishment
// in the gear that could be taken off, with that piece worn plain in the same profileset, so the number already pays for
// what was given up. The ranking keeps the best of those (`freed` says which). Only a trinket no swap can make room
// for keeps `overLimit`: it is listed, marked, and never paired.
export function resolveOverLimit(candidates,{equipped,itemLimits,free=[]}){
  const out=[];
  for(const c of candidates){
    if(!c.limits||!overLimit(equipped,{trinket1:new Set(c.limits)},[],itemLimits).length){out.push(c);continue;}
    const swaps=free.filter(f=>!overLimit(equipped,{trinket1:new Set(c.limits)},[f.slot],itemLimits).length);
    if(!swaps.length){out.push({...c,overLimit:overLimit(equipped,{trinket1:new Set(c.limits)},[],itemLimits).map(id=>limitNames[id]||`limit ${id}`)});continue;}
    for(const f of swaps)out.push({...c,freed:{slot:f.slot,item:f.item,embellishment:f.embellishment},extra:[...(c.extra||[]),f.line]});
  }
  out.forEach((c,i)=>c.key='t'+String(i+1).padStart(4,'0'));
  return out;
}

// Marks, without resolving, every trinket over an equip limit beside the reference gear.
export function markOverLimit(candidates,equipped,itemLimits){
  for(const c of candidates){
    if(!c.limits)continue;
    const over=overLimit(equipped,{trinket1:new Set(c.limits)},[],itemLimits);
    if(over.length)c.overLimit=over.map(id=>limitNames[id]||`limit ${id}`);
  }
  return candidates;
}

// What the job will be asked to reproduce a result: which profile, exactly, with which talents. The hash is of the
// text SimC is given (the reference profile without its trinkets), so two jobs on the same hash wore the same gear.
export function referenceMeta(reference,spec){
  return {source:reference.ours?'simc-lab':'simulationcraft',file:reference.file,season:reference.season,
    // SimulationCraft ships one profile per specialization, built for a raid boss; every scenario uses it.
    profileType:'raid',hash:createHash('sha256').update(String(spec.text)).digest('hex').slice(0,16),
    talents:String(reference.text).match(/^talents=(\S+)/m)?.[1]||null};
}

// Steps the job will report: one or two isolated runs per spec and scenario, three pair rounds (screening, final,
// resolution; each reported even when it is skipped), the idle run of a support specialization, and one boss
// calibration per tank spec.
const pairRounds=3;
export const specSteps=(s,finalists,scenarios,model='statstick')=>scenarios*((trinketCount(s)>finalists?2:1)+(model==='pairs'?pairRounds:0)+(s.support?1:0))+(s.tank?1:0);
export const trinketSteps=(plan,scenarios)=>plan.specs.reduce((n,s)=>n+specSteps(s,plan.finalists,scenarios,plan.model),0);

// Unordered pairs of n trinkets.
export const pairCount=n=>n*(n-1)/2;
// How much the job will simulate, stated before it starts: every profileset of every round, per spec and scenario.
// The pair pool is only known after the isolated round, so it is estimated at its chosen size (all trinkets for 0).
export function estimate(plan,scenarios=1){
  const specs=plan.specs.map(s=>{
    const count=trinketCount(s),isolated=(count>plan.finalists?topRows(s).length:0)+(count>plan.finalists?s.candidates.filter(c=>groupsOf(s,plan.finalists).has(groupOf(c))).length:s.candidates.length);
    const pool=plan.model==='pairs'?Math.min(plan.pool||count,count):0,pairs=pairCount(pool);
    const finals=plan.pairFinalists&&pairs>plan.pairFinalists?plan.pairFinalists:0;
    return {key:s.key,trinkets:count,isolated,pool,pairs,finals,profilesets:scenarios*(isolated+pairs+finals)};
  });
  return {specs,scenarios,profilesets:specs.reduce((n,s)=>n+s.profilesets,0),pairs:specs.reduce((n,s)=>n+s.pairs*scenarios,0),runs:trinketSteps(plan,scenarios)};
}
// The groups a screened spec takes to its final round: as many as the round holds (which ones is known only later).
const groupsOf=(spec,size)=>new Set([...new Set(spec.candidates.map(groupOf))].slice(0,size));

// Screening runs each trinket once, at its top level. The best go on to the final round at every level; the rest
// keep their screened number and show no curve.
export const topRows=spec=>spec.candidates.filter(c=>c.top);
export function selectTopTrinkets(candidates,screen,size,tank){
  const byKey=new Map(screen.rows.map(r=>[r.key,r]));
  const metric=r=>tank?.boss?(Number.isFinite(r.score)?r.score:-Infinity):(Number.isFinite(r.dps)?r.dps:-Infinity);
  const chosen=new Set(candidates.filter(c=>c.top&&byKey.has(c.key)).sort((a,b)=>metric(byKey.get(b.key))-metric(byKey.get(a.key))).slice(0,size).map(groupOf));
  return candidates.filter(c=>chosen.has(groupOf(c)));
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

// ---- Trinket pairs ----------------------------------------------------------------------------------------------

// A trinket as SimC is given it: item, bonus IDs, a set item level if it has one, and any option lines of its own.
// Two rows with the same construction are the same trinket, whichever slot or run they came from.
export const constructionKey=c=>{const i=c.item||{id:c.itemId,bonusIds:bonusIdsOf(c.value)};return [i.id,(i.bonusIds||[]).join(':'),i.ilevel||'',...(c.extra||[])].join('/');};
// The same two trinkets in either slot are one pair.
export const pairKey=(a,b)=>[constructionKey(a),constructionKey(b)].sort().join('+');

// Whether two trinkets can be worn together. The same trinket twice never can: nearly every trinket is unique-equipped,
// and the few the item data does not flag (alchemist stones, PvP medallions) share a limit category the data does not
// fully carry, so a pair of one item is never offered. Equip limits (embellishments) count the rest of the gear.
export function pairLegal(a,b,{equipped={},itemLimits}={}){
  if(a.itemId===b.itemId)return false;
  if(itemLimits&&(a.limits||b.limits)){
    // A trinket worn in place of an embellishment frees that piece; two that free the same piece free it once.
    const cleared=[...new Set([a.freed?.slot,b.freed?.slot].filter(Boolean))];
    const over=overLimit(equipped,{trinket1:new Set(a.limits||[]),trinket2:new Set(b.limits||[])},cleared,itemLimits);
    if(over.length)return false;
  }
  return true;
}

// Every legal pair of a pool, each once. Slot order does not change what a passive trinket does, but with two on-use
// trinkets the action list decides by slot which to press first and how to line them up, so such a pair is also
// simulated the other way round; the two orders share a pair key and only the better is ranked.
export function trinketPairs(pool,{legal={},prefix='p'}={}){
  const out=[],seen=new Set();
  const place=(c,slot)=>({...c,slot,line:`${slot}=${c.value}`});
  const add=(a,b,id)=>out.push({key:`${prefix}${String(out.length+1).padStart(4,'0')}`,pairKey:id,keys:[a.key,b.key],onUse:[a.onUse,b.onUse].filter(Boolean).length,parts:[place(a,'trinket1'),place(b,'trinket2')]});
  const ordered=[...pool].sort((a,b)=>a.key.localeCompare(b.key));
  for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
    const [a,b]=[ordered[i],ordered[j]];
    if(!pairLegal(a,b,legal))continue;
    const id=pairKey(a,b);
    if(seen.has(id))continue;
    seen.add(id);
    add(a,b,id);
    if(a.onUse&&b.onUse)add(b,a,id);
  }
  return out;
}

// The pair pool of one spec and scenario, from the ranked isolated rows. It is a computing shortcut, not a ranking:
// a trinket that is ordinary alone can still be good beside another, so besides the best `size` it keeps everything
// within `margin` (percent of damage, or score points for a tank) of the cutoff, and the best `onUse` on-use
// trinkets, whose worth alone says least about their worth beside a second on-use trinket. A set trinket takes part
// as the character would wear it, with its set bonus; the variant without it stays a diagnostic. A trinket the
// character cannot wear beside its own gear (see markOverLimit) takes no place in the pool, and a trinket with a stat
// or mode to choose takes part with its best choice only.
export function pairPool(candidates,rows,{size=16,margin=0.5,onUse=2}={}){
  const byKey=new Map(candidates.map(c=>[c.key,c])),items=new Set();
  const ranked=rows.filter(r=>Number.isFinite(r.rank)&&Number.isFinite(r.percent)&&byKey.get(r.key)&&!byKey.get(r.key).setOff&&!byKey.get(r.key).overLimit).sort((a,b)=>b.percent-a.percent)
    .filter(r=>{const id=byKey.get(r.key).itemId;if(items.has(id))return false;items.add(id);return true;});
  if(!size||size>=ranked.length)return ranked.map(r=>byKey.get(r.key));
  const cutoff=ranked[size-1].percent;
  const kept=ranked.filter((r,i)=>i<size||r.percent>=cutoff-margin);
  for(const r of ranked.filter(r=>byKey.get(r.key).onUse&&!kept.includes(r)).slice(0,Math.max(0,onUse-kept.filter(k=>byKey.get(k.key).onUse).length)))kept.push(r);
  return kept.map(r=>byKey.get(r.key));
}

// Settings for the pair rounds. Screening is coarser than the final round but finer than the isolated screening:
// pairs sit closer together, and a pair dropped here is gone for good.
export const pairScreenSettings=settings=>({...settings,iterations:Math.min(settings.iterations,5000),targetError:Math.max(settings.targetError||0,0.3)});
export const resolveSettings=settings=>({...settings,iterations:Math.max(settings.iterations,100000),targetError:settings.targetError>0?Math.min(settings.targetError,0.05):0.05});

const pairValue=(r,tank)=>tank?.boss?(Number.isFinite(r.score)?r.score:-Infinity):(Number.isFinite(r.dps)?r.dps:-Infinity);
const pairError=(r,tank)=>(tank?.boss?r.scoreError:r.error95)||0;

// The pairs that go on from screening: the best `size` pair keys, and those whose uncertainty reaches the last of
// them, up to twice the size. Both orders of an on-use pair go on together. A size of 0 takes every pair.
export function selectPairs(pairs,screen,size,tank){
  if(!size)return pairs;
  const byKey=new Map(screen.rows.map(r=>[r.key,r]));
  const best=new Map();
  for(const p of pairs){const r=byKey.get(p.key);if(!r)continue;const v=pairValue(r,tank);if(!best.has(p.pairKey)||v>best.get(p.pairKey).v)best.set(p.pairKey,{v,e:pairError(r,tank)});}
  const ranked=[...best].sort((a,b)=>b[1].v-a[1].v);
  if(ranked.length<=size)return pairs.filter(p=>best.has(p.pairKey));
  const last=ranked[size-1][1];
  const chosen=new Set(ranked.filter(([,x],i)=>i<size||(i<2*size&&x.v+Math.hypot(x.e,last.e)>=last.v)).map(([k])=>k));
  return pairs.filter(p=>chosen.has(p.pairKey));
}

// The pairs still tied with the best after the final round: within the combined 95% uncertainty of the leader.
// A lone leader needs no resolution.
export function tiedPairs(pairs,rows,tank,max=10){
  const byKey=new Map(rows.map(r=>[r.key,r]));
  const ranked=pairs.map(p=>({p,r:byKey.get(p.key)})).filter(x=>x.r&&Number.isFinite(pairValue(x.r,tank))).sort((a,b)=>pairValue(b.r,tank)-pairValue(a.r,tank));
  if(!ranked.length)return [];
  const lead=ranked[0].r;
  const keys=new Set();
  for(const {p,r} of ranked){
    if(keys.size>=max&&!keys.has(p.pairKey))break;
    if(pairValue(lead,tank)-pairValue(r,tank)<=Math.hypot(pairError(lead,tank),pairError(r,tank)))keys.add(p.pairKey);
  }
  return keys.size>1?pairs.filter(p=>keys.has(p.pairKey)):[];
}

// Each trinket's best partner: the other half of the best-ranked pair it is in. `ranked` is ranked pair rows, best
// first; `pairs` the pair list they came from.
export function bestPartners(ranked,pairs){
  const byKey=new Map(pairs.map(p=>[p.key,p])),out=new Map();
  for(const row of ranked){
    const pair=byKey.get(row.key);if(!pair)continue;
    for(const [i,key] of pair.keys.entries())if(!out.has(key))out.set(key,{key,partner:pair.keys[1-i],pair:row.key,rank:row.rank,tied:!!row.tied});
  }
  return [...out.values()];
}
