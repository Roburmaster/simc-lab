// Weapon Lab: one tier list per specialization. Every weapon, off-hand, shield and held item in the active
// season's loot tables is placed on SimC's own reference character for that spec, at one shared item level, so
// the ranking measures the weapon itself and not where it dropped.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseProfile} from './profile.mjs';
import {eligible,placements,carried,weaponKinds,trackLevel,raidDrop,sourceKinds,classIds} from './upgrades.mjs';
import {seasonProfileDirs,appRoot} from './paths.mjs';
import {isTank,normalizeTank} from './tank.mjs';
import {healerSpecs,healerCandidates,contents as healerContents} from './healers.mjs';

export const kinds={main:'Main hand',offhand:'Off-hand weapon',shield:'Shield',held:'Held in off hand'};
export const limits={specs:48,candidates:2400,finalists:[12,24,48]};
// Distance behind the best result in the same list: percent of DPS, or score points for tanks.
export const tiers=[{tier:'S',behind:0.5},{tier:'A',behind:1.5},{tier:'B',behind:3},{tier:'C',behind:5},{tier:'D',behind:Infinity}];

const kindOf=(item,slot)=>slot==='main_hand'?'main':item.itemClass===4?(item.inventoryType===14?'shield':'held'):'offhand';

// One reference profile per specialization: the newest season folder that has one, and within it the base build
// rather than a hero-talent variant (those differ only in talents, which this mode holds constant).
const cache=new Map();
export function clearReferenceCache(){cache.clear();craftedCache.clear();}

// The profiles we write ourselves, in profiles/, one per specialization SimulationCraft has left behind. Each
// .simc sits beside the .json it was built from, which names the guide it came from and when it was read.
export async function ownProfiles(talentData){
  const dir=path.join(appRoot,'profiles');
  const files=await fs.readdir(dir).catch(()=>[]);
  const out=[];
  for(const file of files.filter(f=>f.endsWith('.simc')).sort()){
    const raw=await fs.readFile(path.join(dir,file),'utf8');
    const text=raw.split(/\r?\n/).filter(l=>!l.startsWith('actions')&&!l.startsWith('#')).join('\n');
    let profile,tree;
    try{profile=parseProfile(text,{reference:true});tree=talentData.find(profile.info);}catch{continue;}
    if(!profile.gear.main_hand)continue;
    const data=await fs.readFile(path.join(dir,file.replace(/\.simc$/,'.json')),'utf8').then(JSON.parse,()=>({}));
    out.push({key:`${profile.info.class}-${profile.info.spec}`,file,className:tree.className,specName:tree.specName,specId:tree.specId,
      label:`${tree.specName} ${tree.className}`,class:profile.info.class,spec:profile.info.spec,tank:isTank(profile.info),
      text:profile.text,gear:profile.gear,info:profile.info,ours:true,provenance:data.source||null});
  }
  return out;
}
export async function loadReferenceSpecs(source,talentData){
  if(cache.has(source))return cache.get(source);
  const found=new Map();
  for(const season of await seasonProfileDirs(source)){
    for(const file of (await fs.readdir(season.dir)).filter(f=>f.endsWith('.simc')&&!/_Raid\.simc$/.test(f))){
      // The stored action list is generated for the equipped weapon; SimC writes a fresh default list instead.
      const text=(await fs.readFile(path.join(season.dir,file),'utf8')).split(/\r?\n/).filter(l=>!l.startsWith('actions')&&!l.startsWith('#')).join('\n');
      let profile,tree;
      try{profile=parseProfile(text,{reference:true});tree=talentData.find(profile.info);}catch{continue;}
      if(!profile.gear.main_hand)continue;
      const key=`${profile.info.class}-${profile.info.spec}`,existing=found.get(key);
      if(existing&&(existing.season!==season.name||existing.file.length<=file.length))continue;
      found.set(key,{key,file,season:season.name,className:tree.className,specName:tree.specName,specId:tree.specId,label:`${tree.specName} ${tree.className}`,
        class:profile.info.class,spec:profile.info.spec,tank:isTank(profile.info),text:profile.text,gear:profile.gear,info:profile.info});
    }
  }
  const seasons=[...found.values()].map(s=>s.season).sort((a,b)=>Number(b.match(/\d+$/)[0])-Number(a.match(/\d+$/)[0]));
  const newest=seasons[0];
  // Where SimulationCraft has not rebuilt a specialization for the current season, we carry one of our own. It
  // stands down the moment the engine ships its own: a profile from the newest season always wins.
  for(const spec of await ownProfiles(talentData)){
    const engine=found.get(spec.key);
    if(engine&&engine.season===newest)continue;
    found.set(spec.key,{...spec,season:newest});
  }
  // Healing specializations have no SimC profile and never will; they are ranked on stats instead (healers.mjs).
  for(const spec of await healerSpecs(talentData,newest))if(!found.has(spec.key))found.set(spec.key,spec);
  const list=[...found.values()].sort((a,b)=>a.className.localeCompare(b.className)||a.specName.localeCompare(b.specName));
  if(!list.length)throw new Error('The SimC engine has no usable reference profiles.');
  // A specialization on an older season's profile keeps that season's character, tens of item levels below the
  // rest. Its own ranking still holds, but it is not the same character as the others.
  for(const spec of list)spec.stale=!spec.healer&&spec.season!==newest;
  cache.set(source,list);
  return list;
}

// How far a crafted piece can be upgraded this season. The catalog does not carry it — a crafted item sits at
// its base level there — but SimulationCraft's own season profiles all wear crafted gear at the cap, so the
// number is read from them and follows the season without a rule of ours.
const craftedCache=new Map();
export async function craftedItemLevel(source){
  if(craftedCache.has(source))return craftedCache.get(source);
  const [newest]=await seasonProfileDirs(source);
  let cap=null;
  for(const file of (await fs.readdir(newest.dir)).filter(f=>f.endsWith('.simc'))){
    for(const line of (await fs.readFile(path.join(newest.dir,file),'utf8')).split(/\r?\n/)){
      if(!line.includes('crafted_stats='))continue;
      const level=Number(line.match(/(?:^|,)ilevel=(\d+)/)?.[1]);
      if(level>(cap||0))cap=level;
    }
  }
  craftedCache.set(source,cap);
  return cap;
}

// The item level the reference character actually wears, read from SimC's own report of the baseline actor.
export function actorGear(report){
  const gear=Object.values(report?.sim?.players?.[0]?.gear||{}).filter(item=>item?.ilevel>0).map(item=>item.ilevel);
  if(!gear.length)return null;
  return {pieces:gear.length,itemLevel:Math.round(10*gear.reduce((a,b)=>a+b,0)/gear.length)/10,min:Math.min(...gear),max:Math.max(...gear)};
}

// Public view of a spec: the simulated profile text stays on the server.
export const publicSpec=s=>({key:s.key,label:s.label,class:s.class,spec:s.spec,className:s.className,specName:s.specName,season:s.season,stale:!!s.stale,ours:!!s.ours,provenance:s.provenance||null,file:s.file,tank:s.tank,healer:!!s.healer});

// What a weapon is worth depends on the level you can actually reach with it, and that is decided by where it
// drops: a delve weapon cannot be pushed onto the Myth track however many crests you carry. `drops` holds one
// upgrade level per source kind; a raid drop follows its own boss, so the last bosses keep their higher level.
export function weaponCandidates(spec,season,catalog,{drops,kinds:wanted,craftedStats=[]}){
  const found=new Map();
  for(const {item,source} of season.entries){
    if(![2,4].includes(item.itemClass)||!weaponKinds[item.inventoryType])continue;
    if(!eligible(item,spec.info,spec.specId,season.weaponSpecs))continue;
    const drop=drops[source.kind];
    if(!drop)continue;
    const level=drop.of(source);
    for(const slot of placements(item,spec,catalog)){
      if(!['main_hand','off_hand'].includes(slot))continue;
      const kind=kindOf(item,slot);
      if(!wanted.includes(kind))continue;
      // Crafted gear carries no secondary stats of its own: without the chosen pair it loses several percent
      // of its damage and ranks far below what it is really worth. One candidate per selected pair.
      const stats=source.kind==='crafted'?craftedStats:[null];
      for(const stat of stats){
        const bonuses=[...(item.bonusLists||[]),...(stat?[stat.bonusId]:[]),...(level.bonusId?[level.bonusId]:[])];
        const value=[`,id=${item.id}`,`bonus_id=${bonuses.join('/')}`,...(level.ilevel?[`ilevel=${level.ilevel}`]:[]),...carried(spec.gear[slot]?.value,item,bonuses,season.bonusSockets)].join(',');
        const line=`${slot}=${value}`,label=`${sourceKinds[source.kind]} · ${source.groupName}`;
        // The same weapon can drop in more than one place. It is listed once, at the highest level any of its
        // own sources can give it, and the label names where that is.
        const key=`${slot}|${item.id}|${stat?stat.bonusId:''}`;
        const existing=found.get(key);
        if(existing){
          if(level.itemLevel>existing.itemLevel)Object.assign(existing,{itemLevel:level.itemLevel,levelLabel:level.label,value,line,sources:[label,...existing.sources.filter(s=>s!==label)]});
          else if(!existing.sources.includes(label))existing.sources.push(label);
          continue;
        }
        const set=completedSet(spec,slot,item.id,catalog);
        found.set(key,{slot,kind,itemId:item.id,name:item.name,itemLevel:level.itemLevel,levelLabel:level.label,weaponType:weaponKinds[item.inventoryType],value,line,sources:[label],...(stat?{craftedStat:stat.name}:{}),...(set?{set}:{})});
      }
    }
  }
  const list=[...found.values()].sort((a,b)=>a.slot.localeCompare(b.slot)||a.name.localeCompare(b.name)||String(a.craftedStat).localeCompare(String(b.craftedStat)));
  list.forEach((c,i)=>c.key='w'+String(i+1).padStart(3,'0'));
  return list;
}

// A weapon that completes an item set with the rest of the reference gear brings that set's bonus with it, and
// every other weapon in the same hand loses it: SimC's Fury and Arms profiles wear Zul'jin's Guillotine Technique
// beside Maze'roa, so the Bite of Zul'jan bonus alone put seven percent between Maze'roa and every other main hand.
// Returns the largest bonus the weapon switches on, or null. An item already worn in another slot counts once.
export function completedSet(spec,slot,itemId,catalog){
  const classId=classIds[spec.info?.class];
  const others=new Set(Object.entries(spec.gear||{}).filter(([s])=>s!==slot).map(([,g])=>g?.id).filter(Boolean));
  let found=null;
  for(const bonus of catalog.setBonuses||[]){
    if(!bonus.items.includes(itemId))continue;
    if(bonus.classId>0&&bonus.classId!==classId)continue;
    if(bonus.specId>0&&bonus.specId!==spec.specId)continue;
    const worn=bonus.items.filter(id=>others.has(id));
    if(worn.length>=bonus.pieces||worn.includes(itemId)||worn.length+1<bonus.pieces)continue;
    if(!found||bonus.pieces>found.pieces)found={name:bonus.name,pieces:bonus.pieces,with:worn.map(id=>catalog.items.get(id)?.name||`item ${id}`)};
  }
  return found;
}

// The level each source can actually give a weapon. Raid drops follow their own boss and difficulty, so the
// last bosses keep their higher level; dungeon and delve loot stops at the top of its own track, which is why
// a delve weapon can never be shown on the Myth track. "Equal footing" drops the rule on purpose and pins
// everything to one level, to answer what a weapon is worth rather than what you can reach with it.
export function dropLevels(season,options={}){
  const top=name=>season.tracks.find(t=>t.name===name)||season.tracks.at(-1);
  const levelOf=(track,wanted)=>track.levels.find(l=>l.level===Number(wanted))||track.levels.at(-1);
  const trackById=id=>season.tracks.find(t=>t.id===Number(id));
  if(options.equal){
    const {track,level,label}=trackLevel(season,options,'Weapon Lab');
    const fixed={bonusId:level.bonusId,itemLevel:level.itemLevel,label};
    const of=Object.fromEntries(Object.keys(sourceKinds).map(kind=>[kind,{of:()=>fixed}]));
    return {of,equal:true,public:{equal:true,track:track.id,level:level.level,itemLevel:level.itemLevel,label}};
  }
  const chosen=options.sources||{};
  const difficulties=season.difficulties||[];
  const raidTrack=trackById(chosen.raid?.track)||(difficulties.length?trackById(difficulties.at(-1).track):season.tracks.at(-1));
  if(!raidTrack)throw new Error('Raid: choose a difficulty.');
  const difficulty=difficulties.find(d=>d.track===raidTrack.id)?.name||raidTrack.name;
  const cap=track=>levelOf(track,chosen.level);
  const mplusTrack=trackById(chosen.mplus?.track)||top('Hero'),delveTrack=trackById(chosen.delves?.track)||top('Hero');
  const mplus=levelOf(mplusTrack,chosen.mplus?.level??mplusTrack.levels.at(-1).level);
  const delves=levelOf(delveTrack,chosen.delves?.level??delveTrack.levels.at(-1).level);
  // A crafted weapon is shown fully upgraded, at the cap its own crafting reaches — never on a raid track.
  const craftedLevel=Number(chosen.crafted?.itemLevel??options.craftedCap??top('Hero').levels.at(-1).itemLevel);
  if(!Number.isInteger(craftedLevel)||craftedLevel<1||craftedLevel>1000)throw new Error('Crafted item level must be between 1 and 1000.');
  const fixed=(level,track)=>({bonusId:level.bonusId,itemLevel:level.itemLevel,label:`${track.name} ${level.level}/${level.max}`});
  const of={
    // Fully upgraded: what the boss drops raised to the top of its own track, and the last bosses above it.
    raid:{of:source=>{const drop=raidDrop(raidTrack,source.sequence||1,raidTrack.levels.length);return {bonusId:drop.bonusId,itemLevel:drop.itemLevel,label:drop.label};}},
    mplus:{of:()=>fixed(mplus,mplusTrack)},
    delves:{of:()=>fixed(delves,delveTrack)},
    crafted:{of:()=>({ilevel:craftedLevel,itemLevel:craftedLevel,label:'crafted, fully upgraded'})}
  };
  return {of,equal:false,public:{equal:false,
    raid:{track:raidTrack.id,name:difficulty,label:`${difficulty} · up to ${raidTrack.name} ${raidTrack.levels.at(-1).level}/${raidTrack.levels.at(-1).max}${raidTrack.finalDrop?` (last bosses ${raidTrack.finalDrop.itemLevel})`:''}`,itemLevel:raidTrack.finalDrop?.itemLevel||raidTrack.levels.at(-1).itemLevel},
    mplus:{track:mplusTrack.id,level:mplus.level,label:`${mplusTrack.name} ${mplus.level}/${mplus.max}`,itemLevel:mplus.itemLevel},
    delves:{track:delveTrack.id,level:delves.level,label:`${delveTrack.name} ${delves.level}/${delves.max}`,itemLevel:delves.itemLevel},
    crafted:{itemLevel:craftedLevel,label:`fully upgraded, item level ${craftedLevel}`}}};
}

export async function prepareWeapons(request,catalog,season,talentData,source,scenarios=1){
  const options=request.weapons||{};
  const available=await loadReferenceSpecs(source,talentData);
  const wantedKinds=options.kinds===undefined?Object.keys(kinds):options.kinds;
  if(!Array.isArray(wantedKinds)||!wantedKinds.length||wantedKinds.some(k=>!kinds[k]))throw new Error('Choose at least one weapon category.');
  const finalists=Number(options.finalists??24);
  if(!limits.finalists.includes(finalists))throw new Error('Choose a supported final round size.');
  const drops=dropLevels(season,{...options,craftedCap:await craftedItemLevel(source)});
  // Crafted weapons pick their own two secondary stats. Every selected pair is simulated, and the results keep
  // the best pair per item, so a crafted weapon is ranked by what it is worth at its best rather than at a guess.
  const wantedStats=options.craftedStats===undefined?season.craftedStats.map(s=>s.bonusId):options.craftedStats;
  if(!Array.isArray(wantedStats)||!wantedStats.length)throw new Error('Choose at least one pair of secondary stats for crafted weapons.');
  const craftedStats=wantedStats.map(id=>{
    const stat=season.craftedStats.find(s=>s.bonusId===Number(id));
    if(!stat)throw new Error(`Unknown crafted stat pair ${id}.`);
    return stat;
  });
  const keys=options.specs===undefined?available.map(s=>s.key):options.specs;
  if(!Array.isArray(keys)||!keys.length)throw new Error('Choose at least one specialization.');
  if(keys.length>limits.specs)throw new Error(`Choose at most ${limits.specs} specializations.`);
  const healer=normalizeHealer(options.healer);
  const specs=[],skipped=[];
  for(const key of keys){
    const spec=available.find(s=>s.key===key);
    if(!spec)throw new Error(`Unknown specialization ${key}.`);
    const candidates=spec.healer?healerCandidates(spec,season,{drops:drops.of,kinds:wantedKinds,craftedStats}):weaponCandidates(spec,season,catalog,{drops:drops.of,kinds:wantedKinds,craftedStats});
    if(!candidates.length){skipped.push({key,label:spec.label,reason:'No item in the selected categories fits what this reference profile wields.'});continue;}
    specs.push({...spec,candidates,tank:spec.healer?null:normalizeTank(request.tank,spec.info)});
  }
  if(!specs.length)throw new Error('No selected specialization can use the chosen weapon categories.');
  // Healer weapons are read once rather than simulated per scenario, so they do not count against the limit.
  const total=specs.reduce((n,s)=>n+s.candidates.length,0),simulated=specs.filter(s=>!s.healer).reduce((n,s)=>n+s.candidates.length,0);
  if(simulated*scenarios>limits.candidates)throw new Error(`The selection produces ${simulated} simulated candidates across ${scenarios} scenario${scenarios===1?'':'s'}. Narrow it to ${limits.candidates} candidate runs or fewer.`);
  // Healer scores are measured against a whole character: SimC's own Shadow Priest, an intellect caster of the
  // season, stands in for the healer's other gear. Its text stays on the server like every reference profile's.
  const standIn=specs.some(s=>s.healer)?available.find(s=>s.key==='priest-shadow')||available.find(s=>!s.healer&&['mage','warlock'].includes(s.class)):null;
  if(specs.some(s=>s.healer)&&!standIn)throw new Error('Healer weapons need an intellect caster reference profile to be measured against.');
  if(standIn)Object.assign(healer,{reference:{key:standIn.key,label:standIn.label,file:standIn.file}});
  return {season:season.season,sources:drops.public,referenceText:standIn?.text,equal:drops.equal,levels:{min:Math.min(...specs.flatMap(s=>s.candidates.map(c=>c.itemLevel))),max:Math.max(...specs.flatMap(s=>s.candidates.map(c=>c.itemLevel)))},kinds:wantedKinds,craftedStats,finalists,specs,skipped,candidates:total,...(specs.some(s=>s.healer)?{healer}:{})};
}

// Healers are scored, not simulated: how much of the score is healing (the rest is damage), and whose stat weights
// the healing half uses.
export function normalizeHealer(options={}){
  const weight=Number(options?.weight??70),content=options?.content??'dungeon';
  if(!Number.isInteger(weight)||weight<0||weight>100)throw new Error('Healer weighting must be a whole percentage between 0 and 100.');
  if(!healerContents[content])throw new Error('Choose Mythic+ or Raid for the healer stat weights.');
  return {weight,content};
}

// Steps the job will report: one or two profileset runs per spec and scenario, plus one boss calibration per tank
// spec. Healers add one step between them, the run that reads their weapons' stats.
export const weaponSteps=(plan,scenarios)=>plan.specs.reduce((n,s)=>s.healer?n:n+scenarios*(s.candidates.length>plan.finalists?2:1)+(s.tank?1:0),0)+(plan.specs.some(s=>s.healer)?1:0);

// A tier list ranks every candidate, so the final round takes the best of the screening run rather than only
// those that could beat the reference gear.
// The stat pairs of one crafted weapon compete for a single place, so the final round is not spent simulating
// six versions of the same item. Each hand gets its own share of the round as well: a profile whose main hand
// already outclasses its off hand would otherwise spend every place on off-hand candidates and leave the main
// hand with screening numbers.
export function selectTop(candidates,screen,size,tank){
  const byKey=new Map(screen.rows.map(r=>[r.key,r]));
  const metric=r=>tank?.boss?(Number.isFinite(r.score)?r.score:-Infinity):(Number.isFinite(r.dps)?r.dps:-Infinity);
  const ranked=candidates.map(c=>({c,r:byKey.get(c.key)})).filter(x=>x.r).sort((a,b)=>metric(b.r)-metric(a.r));
  const bySlot=new Map();const seen=new Set();
  for(const {c} of ranked){
    const item=`${c.slot}|${c.itemId}`;
    if(seen.has(item))continue;
    seen.add(item);
    if(!bySlot.has(c.slot))bySlot.set(c.slot,[]);
    bySlot.get(c.slot).push(c);
  }
  const slots=[...bySlot.keys()];
  const quota=Math.max(1,Math.floor(size/slots.length));
  const chosen=[];
  for(const slot of slots)chosen.push(...bySlot.get(slot).slice(0,quota));
  // Places a hand could not fill go to the best of what is left, whichever hand it belongs to.
  if(chosen.length<size){
    const taken=new Set(chosen);
    for(const {c} of ranked){
      if(chosen.length>=size)break;
      if(!taken.has(c)&&bySlot.get(c.slot)?.includes(c))chosen.push(c);
    }
  }
  return chosen.slice(0,size);
}

// Ranks the merged rows of one spec and scenario in place: distance behind the best, its tier, and whether the
// difference is inside the combined 95% uncertainty. Tanks rank on the weighted DPS and survival score.
// `inSet` marks rows whose weapon completes an item set with the reference gear. Their lead is the set bonus, not
// the weapon, so the tiers are measured from the best weapon without one; a set weapon ahead of it is S with a
// negative distance, which is its lead. `behindFirst` is always the distance to rank 1.
// `group` names the item a row belongs to; only its best row is ranked, so a crafted weapon appears once, at the
// stat pair that served it best. Its other pairs are marked as variants rather than dropped.
export function rankWeaponRows(rows,tank,group,inSet=()=>false){
  const value=r=>tank?.boss?r.score:r.dps,error=r=>(tank?.boss?r.scoreError:r.error95)||0;
  const complete=rows.filter(r=>r.status==='complete'&&Number.isFinite(value(r))).sort((a,b)=>value(b)-value(a));
  const ranked=[],seen=new Set();
  for(const row of complete){
    const key=group?group(row):row.key;
    if(seen.has(key)){row.variant=true;continue;}
    seen.add(key);row.variant=false;ranked.push(row);
  }
  const first=ranked[0],best=ranked.find(r=>!inSet(r))||first;
  const distance=(from,row)=>{const gap=value(from)-value(row);return tank?.boss?gap:100*gap/Math.max(1,value(from));};
  for(const [index,row] of ranked.entries()){
    const gap=value(best)-value(row);
    row.rank=index+1;
    row.behind=distance(best,row);
    row.behindFirst=distance(first,row);
    row.tier=tiers.find(t=>row.behind<t.behind).tier;
    row.tied=row!==best&&Math.abs(gap)<=Math.hypot(error(best),error(row));
    row.set=!!inSet(row);
  }
  return ranked;
}
