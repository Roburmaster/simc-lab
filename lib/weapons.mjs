// Weapon Lab: one tier list per specialization. Every weapon, off-hand, shield and held item in the active
// season's loot tables is placed on SimC's own reference character for that spec, at one shared item level, so
// the ranking measures the weapon itself and not where it dropped.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseProfile} from './profile.mjs';
import {eligible,placements,carried,weaponKinds,trackLevel,sourceKinds} from './upgrades.mjs';
import {seasonProfileDirs} from './paths.mjs';
import {isTank,normalizeTank} from './tank.mjs';

export const kinds={main:'Main hand',offhand:'Off-hand weapon',shield:'Shield',held:'Held in off hand'};
export const limits={specs:48,candidates:2400,finalists:[12,24,48]};
// Distance behind the best result in the same list: percent of DPS, or score points for tanks.
export const tiers=[{tier:'S',behind:0.5},{tier:'A',behind:1.5},{tier:'B',behind:3},{tier:'C',behind:5},{tier:'D',behind:Infinity}];

const kindOf=(item,slot)=>slot==='main_hand'?'main':item.itemClass===4?(item.inventoryType===14?'shield':'held'):'offhand';

// One reference profile per specialization: the newest season folder that has one, and within it the base build
// rather than a hero-talent variant (those differ only in talents, which this mode holds constant).
const cache=new Map();
export function clearReferenceCache(){cache.clear();}
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
  const list=[...found.values()].sort((a,b)=>a.className.localeCompare(b.className)||a.specName.localeCompare(b.specName));
  if(!list.length)throw new Error('The SimC engine has no usable reference profiles.');
  cache.set(source,list);
  return list;
}

// Public view of a spec: the simulated profile text stays on the server.
export const publicSpec=s=>({key:s.key,label:s.label,class:s.class,spec:s.spec,className:s.className,specName:s.specName,season:s.season,file:s.file,tank:s.tank});

export function weaponCandidates(spec,season,catalog,{level,kinds:wanted}){
  const found=new Map();
  for(const {item,source} of season.entries){
    if(![2,4].includes(item.itemClass)||!weaponKinds[item.inventoryType])continue;
    if(!eligible(item,spec.info,spec.specId,season.weaponSpecs))continue;
    for(const slot of placements(item,spec,catalog)){
      if(!['main_hand','off_hand'].includes(slot))continue;
      const kind=kindOf(item,slot);
      if(!wanted.includes(kind))continue;
      // Every candidate is pinned to the same upgrade level, so item level cannot decide the ranking.
      const bonuses=[...(item.bonusLists||[]),level.bonusId];
      const value=[`,id=${item.id}`,`bonus_id=${bonuses.join('/')}`,...carried(spec.gear[slot]?.value,item,bonuses,season.bonusSockets)].join(',');
      const line=`${slot}=${value}`,label=`${sourceKinds[source.kind]} · ${source.groupName}`;
      const existing=found.get(line);
      if(existing){if(!existing.sources.includes(label))existing.sources.push(label);continue;}
      found.set(line,{slot,kind,itemId:item.id,name:item.name,itemLevel:level.itemLevel,weaponType:weaponKinds[item.inventoryType],value,line,sources:[label]});
    }
  }
  const list=[...found.values()].sort((a,b)=>a.slot.localeCompare(b.slot)||a.name.localeCompare(b.name));
  list.forEach((c,i)=>c.key='w'+String(i+1).padStart(3,'0'));
  return list;
}

export async function prepareWeapons(request,catalog,season,talentData,source,scenarios=1){
  const options=request.weapons||{};
  const available=await loadReferenceSpecs(source,talentData);
  const wantedKinds=options.kinds===undefined?Object.keys(kinds):options.kinds;
  if(!Array.isArray(wantedKinds)||!wantedKinds.length||wantedKinds.some(k=>!kinds[k]))throw new Error('Choose at least one weapon category.');
  const finalists=Number(options.finalists??24);
  if(!limits.finalists.includes(finalists))throw new Error('Choose a supported final round size.');
  const level=trackLevel(season,options,'Weapon Lab');
  const keys=options.specs===undefined?available.map(s=>s.key):options.specs;
  if(!Array.isArray(keys)||!keys.length)throw new Error('Choose at least one specialization.');
  if(keys.length>limits.specs)throw new Error(`Choose at most ${limits.specs} specializations.`);
  const specs=[],skipped=[];
  for(const key of keys){
    const spec=available.find(s=>s.key===key);
    if(!spec)throw new Error(`Unknown specialization ${key}.`);
    const candidates=weaponCandidates(spec,season,catalog,{level:level.level,kinds:wantedKinds});
    if(!candidates.length){skipped.push({key,label:spec.label,reason:'No item in the selected categories fits what this reference profile wields.'});continue;}
    specs.push({...spec,candidates,tank:normalizeTank(request.tank,spec.info)});
  }
  if(!specs.length)throw new Error('No selected specialization can use the chosen weapon categories.');
  const total=specs.reduce((n,s)=>n+s.candidates.length,0);
  if(total*scenarios>limits.candidates)throw new Error(`The selection produces ${total} candidates across ${scenarios} scenario${scenarios===1?'':'s'}. Narrow it to ${limits.candidates} candidate runs or fewer.`);
  return {season:season.season,level:{track:level.track.id,level:level.level.level,itemLevel:level.level.itemLevel,label:level.label},kinds:wantedKinds,finalists,specs,skipped,candidates:total};
}

// Steps the job will report: one or two profileset runs per spec and scenario, plus one boss calibration per tank spec.
export const weaponSteps=(plan,scenarios)=>plan.specs.reduce((n,s)=>n+scenarios*(s.candidates.length>plan.finalists?2:1)+(s.tank?1:0),0);

// A tier list ranks every candidate, so the final round takes the best of the screening run rather than only
// those that could beat the reference gear.
export function selectTop(candidates,screen,size,tank){
  const byKey=new Map(screen.rows.map(r=>[r.key,r]));
  const metric=r=>tank?.boss?(Number.isFinite(r.score)?r.score:-Infinity):(Number.isFinite(r.dps)?r.dps:-Infinity);
  return candidates.map(c=>({c,r:byKey.get(c.key)})).filter(x=>x.r).sort((a,b)=>metric(b.r)-metric(a.r)).slice(0,size).map(x=>x.c);
}

// Ranks the merged rows of one spec and scenario in place: distance behind the best, its tier, and whether the
// difference is inside the combined 95% uncertainty. Tanks rank on the weighted DPS and survival score.
export function rankWeaponRows(rows,tank){
  const value=r=>tank?.boss?r.score:r.dps,error=r=>(tank?.boss?r.scoreError:r.error95)||0;
  const ranked=rows.filter(r=>r.status==='complete'&&Number.isFinite(value(r))).sort((a,b)=>value(b)-value(a));
  const best=ranked[0];
  for(const [index,row] of ranked.entries()){
    const gap=value(best)-value(row);
    row.rank=index+1;
    row.behind=tank?.boss?gap:100*gap/Math.max(1,value(best));
    row.tier=tiers.find(t=>row.behind<t.behind).tier;
    row.tied=gap<=Math.hypot(error(best),error(row));
  }
  return ranked;
}
