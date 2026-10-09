// Tank Sim's gear: what to try on a tank, from three sources that Upgrade Finder, Gear Compare and Crest Planner each know
// one of. Every source ends up as the same kind of candidate, so one screening round and one final round can rank all of
// them together, with the tank's own score (survival and DPS) in each fight.
import {slots as allSlots} from './profile.mjs';
import {buildCandidates,equippedLimits,overLimit,itemLimitsOf,bonusIdsOf,limits as upgradeLimits} from './upgrades.mjs';
import {buildCrestCandidates} from './crests.mjs';

// Items the addon export lists beside the equipped gear: bags, the Great Vault, anything saved. Equipped gear is the
// baseline and always runs, so it is never a candidate of its own.
export function bagCandidates(profile,season,catalog){
  const out=[];let blocked=0;
  const limits=season?.itemLimits,equipped=equippedLimits(profile,limits);
  for(const alt of profile.alternatives||[]){
    const slot=alt.slot;if(!slot||!allSlots.includes(slot))continue;
    const value=String(alt.text).slice(slot.length+1);
    const id=Number(value.match(/(?:^|,)id=(\d+)/)?.[1]);if(!id||profile.gear[slot]?.value===value)continue;
    const item=catalog.items.get(id);
    // A bag item that would break an equip limit next to what is worn is left out, as in Upgrade Finder.
    const uses=itemLimitsOf(id,bonusIdsOf(value),limits);
    if(uses.size&&overLimit(equipped,{[slot]:uses},[],limits).length){blocked++;continue;}
    // The addon names each bag item with its item level, "Pledgebearer's Girdle (295)"; an override in the line wins.
    const level=Number(value.match(/(?:^|,)ilevel=(\d+)/)?.[1])||Number(String(alt.name).match(/\((\d+)\)\s*$/)?.[1])||'?';
    const section=alt.section||'Bags';
    out.push({slot,itemId:id,name:item?.name||String(alt.name).replace(/\s*\(\d+\)\s*$/,'')||`Item ${id}`,itemLevel:level,value,line:`${slot}=${value}`,...(uses.size?{limits:[...uses]}:{}),
      sources:[{origin:'bags',group:`bags:${section}`,groupName:section,label:`${section} · item level ${level}`}]});
  }
  return {list:out,blocked};
}

// Each equipped item at every higher level of its upgrade track, within the crests that can be spent.
export function crestCandidates(profile,text,request,season,catalog){
  const crest=buildCrestCandidates(profile,text,request,season,catalog);
  const list=crest.candidates.map(c=>({slot:c.slot,itemId:c.itemId,name:c.name,itemLevel:c.itemLevel,value:c.value,line:c.line,
    upgrade:{track:c.track.name,from:c.from,to:c.to,max:c.max,fromItemLevel:c.fromItemLevel,crests:c.crests,fullCrests:c.fullCrests,currencyId:c.currencyId},
    sources:[{origin:'crests',group:`crests:${c.slot}`,groupName:`Upgrading ${c.name}`,label:`${c.track.name} ${c.from}/${c.max} to ${c.to}/${c.max} · ${c.crests} crest${c.crests===1?'':'s'}`}]}));
  return {list,budget:crest.budget,currencies:crest.currencies};
}

// The three sources of a tank job, merged. `request` is {loot, bags, crests, finalists}: a source is on when its key is
// there. Returns null when none is asked for, which leaves the job as plain fights.
export function buildTankGear(profile,text,request,season,catalog,specId){
  const asked=request&&typeof request==='object'?request:null;
  if(!asked||!(asked.loot||asked.bags||asked.crests))return null;
  if(!season)throw new Error('Season loot data is not loaded.');
  const finalists=Number(asked.finalists??48);if(!upgradeLimits.finalists.includes(finalists))throw new Error('Choose a supported final round size.');
  const warnings=[],counts={loot:0,bags:0,crests:0};let blocked=0,freed=0;
  const pool=[];
  if(asked.loot){
    const loot=buildCandidates(profile,{...asked.loot,finalists},season,catalog,specId);
    pool.push(...loot.candidates);blocked+=loot.blocked;freed+=loot.freed;counts.loot=loot.candidates.length;
  }
  if(asked.bags){
    const bags=bagCandidates(profile,season,catalog);
    pool.push(...bags.list);blocked+=bags.blocked;counts.bags=bags.list.length;
    if(!bags.list.length)warnings.push((profile.alternatives||[]).some(a=>a.slot)?'Every bag item is already worn, or would break an equip limit, so there is nothing from your bags to try.':'This export lists no bag gear. Export again with the SimulationCraft addon and bags open to try what you carry.');
  }
  if(asked.crests){
    // A character whose gear is not on an upgrade track cannot be upgraded; with other sources on, that is a note, not a failure.
    try{const crests=crestCandidates(profile,text,asked.crests,season,catalog);pool.push(...crests.list);counts.crests=crests.list.length;}
    catch(e){if(!asked.loot&&!asked.bags)throw e;warnings.push(`Crest upgrades: ${e.message}`);}
  }
  // The same item line from two places is one candidate with both sources.
  const byLine=new Map();
  for(const c of pool){
    const id=c.freed?`${c.line}|${c.freed.slot}`:c.line,known=byLine.get(id);
    if(!known)byLine.set(id,c);
    else for(const s of c.sources)if(!known.sources.some(x=>x.label===s.label))known.sources.push(s);
  }
  const list=[...byLine.values()].sort((a,b)=>allSlots.indexOf(a.slot)-allSlots.indexOf(b.slot)||(Number(b.itemLevel)||0)-(Number(a.itemLevel)||0)||a.name.localeCompare(b.name));
  if(!list.length)throw new Error(warnings.length?warnings.join(' '):'No usable items were found in the selected sources for this character.');
  list.forEach((c,i)=>c.key='c'+String(i+1).padStart(3,'0'));
  const equipped=equippedLimits(profile,season.itemLimits);
  const holders=Object.entries(equipped).map(([slot,used])=>({slot,name:catalog.items.get(profile.gear[slot].id)?.name||`Item ${profile.gear[slot].id}`,limits:[...used]}));
  return {candidates:list,finalists,embellished:list.some(c=>c.limits),limitsUsed:holders,blocked,freed,counts,warnings};
}
