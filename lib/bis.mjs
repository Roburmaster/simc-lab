// Best in Slot: the best full set of gear a character can reach from the sources it can use (raid, Mythic+, crafted
// and what is already in its bags), simulated as a set rather than item by item.
//
// Item by item (Upgrade Finder) is the first half: every candidate is screened and the promising ones are simulated
// again, each in its slot against the gear that is worn. That says what each item is worth alone. The second half
// lives here. It builds the best set from those numbers, then lets SimC judge the set as a whole, because gear does
// not add up: stats trade against each other, the embellishment limit binds, and a tier set only pays once enough
// pieces are worn. The search is greedy and bounded: it starts from the best item per slot (and from the best way to
// reach each set bonus), then repeats "try the next best item in each slot, and each set bonus not yet reached" and
// keeps the best change while a change still beats the set by more than the noise. It is verified by simulation, not
// proven best, and the page says so.
import {slots as allSlots,applyOverrides} from './profile.mjs';
import {classIds,buildCandidates,eligible,placements,carried,bonusIdsOf,itemLimitsOf,equippedLimits,overLimit,clearedBy,selectFinalists,screenSettings} from './upgrades.mjs';

export const groupOf=slot=>String(slot).replace(/[12]$/,'');
export const slotsOf=group=>allSlots.filter(s=>groupOf(s)===group);
const pairs=['finger','trinket'];
const twinOf={finger1:'finger2',finger2:'finger1',trinket1:'trinket2',trinket2:'trinket1'};
// The most changes one refinement round makes at once (changes in different slot groups, each beyond the noise).
export const limits={adopt:3};
// How hard to search: the final round size and the most refinement rounds. Each round is one SimC run.
export const depths={quick:{finalists:48,rounds:2,label:'Quick'},standard:{finalists:96,rounds:4,label:'Standard'},thorough:{finalists:96,rounds:8,label:'Thorough'}};
// Screening, final round, the first sets, the refinement rounds and the check, per scenario.
export const bisSteps=(bis,scenarios)=>(4+bis.rounds)*scenarios;
export const stages={screen:1,final:2,sets:3,round:10,verify:99};

// Gains are in percent of the baseline's DPS, or the weighted score for a tank. Noise is the same quantity's 95% error.
export const gainOf=(row,base,tank)=>tank?.boss?row.score:100*(row.dps-base.dps)/Math.max(1,base.dps);
export const noiseOf=(row,base,tank)=>tank?.boss?(row.scoreError||0):100*Math.hypot(row.error95||0,base.error95||0)/Math.max(1,base.dps);

// The Upgrade Finder options a Best in Slot request stands for: every source fully upgraded, since the question is
// the ceiling, not what drops today. Crest costs are not counted.
export function upgradeOptions(request,season){
  const r=request||{},depth=depths[r.depth??'standard'];
  if(!depth)throw new Error('Choose a search depth.');
  const out={finalists:depth.finalists};
  // The page ticks whole sources; a request may also narrow one (bosses, dungeons, embellishments), which is how a
  // quick test run is kept small.
  if(r.raid?.enabled){
    const difficulty=season.difficulties.find(d=>d.track===Number(r.raid.difficulty));if(!difficulty)throw new Error('Raid: choose a difficulty.');
    out.raid={enabled:true,difficulty:difficulty.track,upgrade:season.tracks.find(t=>t.id===difficulty.track).levels.length,...(r.raid.encounters!==undefined?{encounters:r.raid.encounters}:{})};
  }
  if(r.mplus?.enabled)out.mplus={enabled:true,track:Number(r.mplus.track),level:Number(r.mplus.level),...(r.mplus.dungeons!==undefined?{dungeons:r.mplus.dungeons}:{})};
  if(r.crafted?.enabled)out.crafted={enabled:true,itemLevel:Number(r.crafted.itemLevel),stats:'all',...(r.crafted.embellishments!==undefined?{embellishments:r.crafted.embellishments}:{})};
  return out;
}

// What the character already owns: the gear from its bags in the addon export (not the vault choices, which are not
// owned yet). Offered in every slot it fits, with the enchant and gems of what it replaces, like any other item.
export function bagCandidates(profile,season,catalog,specId){
  const known=new Map(season.entries.map(e=>[e.item.id,e.item]));
  const equipped=equippedLimits(profile,season.itemLimits),worn=new Set(Object.values(profile.gear).map(g=>g.value)),out=[],seen=new Set();
  for(const alt of profile.alternatives||[]){
    if(!alt.slot||!/bag/i.test(alt.section||''))continue;
    const raw=alt.text.slice(alt.slot.length+1);
    const id=Number(raw.match(/(?:^|,)id=(\d+)/)?.[1]);
    if(!id||!catalog.items.has(id)||worn.has(raw))continue;
    const item=known.get(id)||catalog.items.get(id);
    if(known.has(id)&&!eligible(item,profile.info,specId,season.weaponSpecs))continue;
    const named=alt.name&&alt.name!==alt.slot?String(alt.name).match(/^(.*?)\s*\((\d+)\)\s*$/):null;
    const bonuses=bonusIdsOf(raw);
    // The item arrives as it is in the bag; the worn piece's enchant and gems carry over.
    const bare=raw.split(',').filter(p=>!/^(?:enchant_id|enchant|gem_id)=/.test(p)).join(',');
    const uses=itemLimitsOf(id,bonuses,season.itemLimits);
    for(const slot of placements(item,profile,catalog)){
      if(uses.size&&overLimit(equipped,{[slot]:uses},clearedBy(item,slot,profile).length?['off_hand']:[],season.itemLimits).length)continue;
      const value=[bare,...carried(profile.gear[slot]?.value,item,bonuses,season.bonusSockets)].join(',');
      const line=`${slot}=${value}`;if(seen.has(line))continue;seen.add(line);
      out.push({slot,itemId:id,name:named?named[1]:(alt.name&&alt.name!==alt.slot?alt.name:catalog.items.get(id)?.name||`Item ${id}`),itemLevel:named?Number(named[2]):(item.itemLevel??item.ilevel??0),value,line,...(uses.size?{limits:[...uses]}:{}),
        sources:[{origin:'bags',group:'bags:0',groupName:'Your bags',label:'Your bags'}]});
    }
  }
  out.forEach((c,i)=>c.key='b'+String(i+1).padStart(3,'0'));
  return out;
}

// All candidates of a request: the chosen sources through Upgrade Finder's own search, plus the bags.
export function buildBis(profile,request,season,catalog,specId){
  const depth=depths[request?.depth??'standard'];
  const upgrade=buildCandidates(profile,upgradeOptions(request,season),season,catalog,specId);
  const bags=request?.bags===false?[]:bagCandidates(profile,season,catalog,specId);
  upgrade.candidates.push(...bags);
  return {...upgrade,rounds:depth.rounds,depth:request?.depth??'standard',specId,bags:bags.length};
}

// The item sets that apply to this class and specialization and could be worn from what is on offer: each with the
// piece counts that switch a bonus on.
export function activeSets(catalog,info,specId,available){
  const classId=classIds[info.class],bySet=new Map();
  for(const b of catalog.setBonuses||[]){
    if(b.pieces<2||b.classId>0&&b.classId!==classId||b.specId>0&&b.specId!==specId)continue;
    const set=bySet.get(b.setId)||{setId:b.setId,name:b.name,items:new Set(),thresholds:new Set()};
    b.items.forEach(i=>set.items.add(i));set.thresholds.add(b.pieces);bySet.set(b.setId,set);
  }
  return [...bySet.values()].map(s=>({...s,thresholds:[...s.thresholds].sort((a,b)=>a-b)})).filter(s=>[...s.items].filter(i=>available.has(i)).length>=s.thresholds[0]);
}

// The numbers the search ranks on: the final round's where an item has one, else its screening number.
export function ranksFrom(screen,final,tank){
  const ranks=new Map();
  for(const [stage,result] of [[stages.screen,screen],[stages.final,final]]){
    if(!result)continue;
    for(const row of result.rows)ranks.set(row.key,{rank:gainOf(row,result.baseline,tank),noise:noiseOf(row,result.baseline,tank),stage});
  }
  return ranks;
}

// Set pieces matter in combination, so a piece that lost on its own can still win once its set bonus is on. The final
// round therefore also takes the best screened version of every piece of a set that could be completed.
export function selectBisFinalists(all,screen,size,tank,ctx){
  const chosen=selectFinalists(all,screen,size,tank),have=new Set(chosen.map(c=>c.key));
  const rows=new Map(screen.rows.map(r=>[r.key,r])),best=new Map();
  for(const set of ctx.sets)for(const c of all){
    const row=rows.get(c.key);if(!set.items.has(c.itemId)||!row)continue;
    const id=`${groupOf(c.slot)}|${c.itemId}`,rank=gainOf(row,screen.baseline,tank),previous=best.get(id);
    if(!previous||rank>previous.rank)best.set(id,{c,rank});
  }
  for(const {c} of best.values())if(!have.has(c.key)){chosen.push(c);have.add(c.key);}
  return chosen;
}

const reslot=(c,slot)=>({...c,slot,line:c.line.replace(/^[a-z_0-9]+=/,slot+'=')});

// Options per group: every final-round item with its rank, and the item that is worn. A ring or trinket is one option
// that either slot can take; the same item with another embellishment, stat pair or freed embellishment is another.
export function buildPool(finalists,ranks,ctx){
  const options=new Map(),kept=new Map();
  const list=group=>{if(!options.has(group))options.set(group,[]);return options.get(group);};
  for(const slot of ctx.slots){
    const g=ctx.profile.gear[slot];if(!g?.id)continue;
    const option={id:'kept|'+slot,kept:true,slot,itemId:g.id,name:`${ctx.catalog.items.get(g.id)?.name||`Item ${g.id}`} (worn)`,rank:0,noise:0,limits:[...ctx.limitsOf(g.id,g.value)]};
    kept.set(slot,option);list(groupOf(slot)).push(option);
  }
  const byId=new Map();
  for(const c of finalists){
    const r=ranks.get(c.key);if(!r||r.stage!==stages.final)continue;
    const id=`${c.itemId}|${c.value}|${c.freed?.slot||''}`;
    let option=byId.get(id);
    // The same crafted piece in another stat pair or with another embellishment is another option, so its name says which.
    if(!option){option={id,kept:false,itemId:c.itemId,name:c.name+(c.craftedStat?` (${c.craftedStat})`:'')+(c.embellishment?` + ${c.embellishment}`:''),rank:-Infinity,noise:0,limits:c.limits||[],byslot:{},rep:c};byId.set(id,option);list(groupOf(c.slot)).push(option);}
    option.byslot[c.slot]=c;
    if(r.rank>option.rank){option.rank=r.rank;option.noise=r.noise;option.rep=c;}
  }
  // Best first; the item you wear wins a tie.
  for(const opts of options.values())opts.sort((a,b)=>worthy(b)-worthy(a)||(b.kept?1:0)-(a.kept?1:0));
  return {options,kept};
}

// What an option counts for when the set is built. A gain inside its own noise is not a gain: picking the best of many
// noisy numbers picks the luckiest, and a set made of them can come out worse than what is worn. Such an option sorts
// below the item you wear, which stays unless something clearly beats it.
export const worthy=o=>o.kept?0:o.rank>o.noise?o.rank:Math.min(o.rank,-1e-9);
const placeable=(o,slot)=>o.kept?o.slot===slot:!!(o.byslot[slot]||twinOf[slot]&&o.byslot[twinOf[slot]]);
export const optionsFor=(pool,slot)=>(pool.options.get(groupOf(slot))||[]).filter(o=>placeable(o,slot));
export function pickOf(o,slot){
  if(o.kept)return {slot,option:o,kept:true,itemId:o.itemId,rank:0};
  return {slot,option:o,kept:false,itemId:o.itemId,rank:o.rank,cand:o.byslot[slot]||reslot(o.rep,slot)};
}

// A set can be worn when the embellishment limit holds and no ring or trinket is worn twice.
export function legal(picks,ctx){
  const adds={},cleared=[];
  for(const [slot,p] of picks){
    if(p.kept)continue;
    if(p.cand.limits?.length)adds[slot]=new Set(p.cand.limits);
    if(p.cand.freed)cleared.push(p.cand.freed.slot);
    cleared.push(...clearedBy(ctx.catalog.items.get(p.cand.itemId),slot,ctx.profile));
  }
  if(Object.keys(adds).length&&overLimit(ctx.equippedLimits,adds,cleared,ctx.itemLimits).length)return false;
  for(const g of pairs){const ids=slotsOf(g).map(s=>picks.get(s)?.itemId).filter(Boolean);if(new Set(ids).size<ids.length)return false;}
  return true;
}

// What every slot holds once the set is on, as the SimC value after `slot=`. A piece that frees an embellishment puts
// the worn piece back plain, unless the set replaces that slot anyway; a two-hander empties the off-hand.
export function effective(picks,ctx){
  const eff={};
  for(const [slot,g] of Object.entries(ctx.profile.gear))if(g?.id)eff[slot]=g.value;
  for(const [slot,p] of picks)if(!p.kept)eff[slot]=p.cand.value;
  for(const [slot,p] of picks){
    if(p.kept)continue;
    for(const line of p.cand.extra||[]){const m=line.match(/^([a-z_0-9]+)=([\s\S]*)$/);if(m&&(!picks.get(m[1])||picks.get(m[1]).kept))eff[m[1]]=m[2];}
    for(const cleared of clearedBy(ctx.catalog.items.get(p.cand.itemId),slot,ctx.profile))if(!picks.get(cleared)||picks.get(cleared).kept)eff[cleared]='';
  }
  return eff;
}
// Two sets are the same when each group holds the same pieces; the two ring slots and the two trinket slots are one.
export function signature(picks,ctx){
  const eff=effective(picks,ctx),parts=[];
  for(const slot of allSlots){const g=groupOf(slot);if(pairs.includes(g)&&slot.endsWith('2'))continue;
    parts.push(pairs.includes(g)?[g,...slotsOf(g).map(s=>eff[s]??'').sort()].join('|'):`${slot}|${eff[slot]??''}`);}
  return parts.join('\n');
}
export function diffLines(from,to){
  const out=[];
  for(const slot of allSlots){const a=from[slot]??'',b=to[slot]??'';if(a!==b)out.push({slot,line:`${slot}=${b}`});}
  return out;
}
// The profile text and gear of the character wearing a set: the actor a refinement round compares its neighbours to.
export function baseActor(picks,ctx){
  const eff=effective(picks,ctx),gear={};
  for(const [slot,value] of Object.entries(eff))if(value)gear[slot]={slot,value,id:Number(value.match(/(?:^|,)id=(\d+)/)?.[1]||0)};
  return {text:applyOverrides(ctx.profile.text,diffLines(ctx.worn,eff).map(l=>l.line).join('\n')),gear,info:ctx.profile.info};
}
// One profileset: a set written as the lines that differ from `from` (the effective gear it is compared with).
export const listItem=(key,picks,from,ctx)=>({key,parts:diffLines(from,effective(picks,ctx))});

// The greedy set: slot by slot, best group first, each slot takes its best option that keeps the set wearable.
// `forced` slots are placed first and left alone.
export function assemble(pool,ctx,{forced=[],start=null}={}){
  let picks=start?new Map(start):new Map(ctx.slots.filter(s=>pool.kept.has(s)).map(s=>[s,pickOf(pool.kept.get(s),s)]));
  const fixed=new Set();
  for(const {option,slot} of forced){const trial=new Map(picks);trial.set(slot,pickOf(option,slot));if(legal(trial,ctx)){picks=trial;fixed.add(slot);}}
  const top=slot=>Math.max(-Infinity,...optionsFor(pool,slot).filter(o=>!o.kept).map(worthy));
  for(const slot of [...ctx.slots].sort((a,b)=>top(b)-top(a))){
    if(fixed.has(slot))continue;
    for(const o of optionsFor(pool,slot)){
      const trial=new Map(picks);trial.set(slot,pickOf(o,slot));
      if(legal(trial,ctx)){picks=trial;break;}
    }
  }
  return picks;
}

const wornIds=picks=>new Set([...picks.values()].map(p=>p.itemId));
// For each item set not yet at a bonus: the set with the cheapest pieces added to reach it. A piece's cost is what the
// slot loses by changing to it; slots that already hold a piece of the set are left alone.
export function setMoves(base,pool,ctx){
  const out=[],worn=wornIds(base);
  for(const set of ctx.sets){
    const have=[...worn].filter(id=>set.items.has(id)).length,avail=[];
    for(const [group,opts] of pool.options)for(const o of opts){
      if(o.kept||!set.items.has(o.itemId)||worn.has(o.itemId))continue;
      for(const slot of slotsOf(group)){
        const cur=base.get(slot);
        if(!cur||!placeable(o,slot)||set.items.has(cur.itemId))continue;
        avail.push({o,slot,delta:o.rank-cur.rank});
      }
    }
    avail.sort((a,b)=>b.delta-a.delta);
    for(const t of set.thresholds.filter(t=>t>have)){
      const chosen=[],slots=new Set(),ids=new Set();
      for(const a of avail){if(slots.has(a.slot)||ids.has(a.o.itemId))continue;slots.add(a.slot);ids.add(a.o.itemId);chosen.push(a);if(chosen.length===t-have)break;}
      if(chosen.length<t-have)continue;
      const picks=new Map(base);for(const a of chosen)picks.set(a.slot,pickOf(a.o,a.slot));
      out.push({picks,label:`${set.name} · ${t} pieces`,changes:chosen.map(a=>a.slot),set:true});
    }
  }
  return out;
}

const slotNames={head:'Head',neck:'Neck',shoulder:'Shoulders',back:'Back',chest:'Chest',wrist:'Wrists',hands:'Hands',waist:'Waist',legs:'Legs',feet:'Feet',finger1:'Ring 1',finger2:'Ring 2',trinket1:'Trinket 1',trinket2:'Trinket 2',main_hand:'Main hand',off_hand:'Off hand'};
// Every set one change away from `base`: the next best items in each slot, and each item set bonus not yet reached.
export function neighbors(base,pool,ctx,{per=2}={}){
  const out=[],seen=new Set([signature(base,ctx)]);
  const add=n=>{if(!n.picks.size)return;const sig=signature(n.picks,ctx);if(seen.has(sig)||!legal(n.picks,ctx))return false;seen.add(sig);out.push(n);return true;};
  for(const slot of ctx.slots){
    const cur=base.get(slot);let taken=0;
    for(const o of optionsFor(pool,slot)){
      if(cur&&o.id===cur.option.id)continue;
      const picks=new Map(base);picks.set(slot,pickOf(o,slot));
      if(add({picks,label:`${slotNames[slot]}: ${cur?.option.name||'empty'} → ${o.name}`,changes:[slot]}))taken++;
      if(taken>=per)break;
    }
  }
  for(const move of setMoves(base,pool,ctx))add(move);
  return out;
}

// The best option per source for each group, from the final round's single-item numbers. Different players can reach
// different pieces, so this answers "what if I cannot get that one".
export function bestBySource(pool){
  const out={};
  for(const [group,opts] of pool.options)for(const o of opts){
    if(o.kept)continue;
    for(const source of new Set(o.rep.sources.map(s=>s.origin))){
      const slot=Object.keys(o.byslot)[0];
      const best=out[group]?.[source];
      if(!best||o.rank>best.rank)(out[group]||={})[source]={key:o.byslot[slot].key,slot,rank:o.rank,noise:o.noise};
    }
  }
  return out;
}

export function bisContext(plan,catalog){
  const {profile,bis}=plan;
  const slots=allSlots.filter(s=>profile.gear[s]?.id||bis.candidates.some(c=>c.slot===s));
  const available=new Set([...bis.candidates.map(c=>c.itemId),...Object.values(profile.gear).map(g=>g.id)]);
  const ctx={profile,catalog,itemLimits:bis.itemLimits,equippedLimits:equippedLimits(profile,bis.itemLimits),slots,
    limitsOf:(id,value)=>itemLimitsOf(id,bonusIdsOf(value),bis.itemLimits),sets:activeSets(catalog,profile.info,bis.specId,available)};
  ctx.worn=effective(new Map(),ctx);
  return ctx;
}

const setRecord=(picks)=>[...picks.entries()].map(([slot,p])=>({slot,key:p.kept?null:p.cand.key,itemId:p.itemId}));

// One scenario of a Best in Slot job. `sim(stage,list,settings,{base,title})` runs one SimC profileset run and gives
// {baseline,rows} (or null if it failed); `run` is the record of this scenario in the job; `step(n)` counts finished steps.
export async function searchBis(env){
  const {plan,catalog,run,sim,step,cancelled,save,settings,tank}=env,{bis}=plan;
  const ctx=bisContext(plan,catalog),skip=async(n,why)=>{run.notes.push(why);step(n);await save();};
  const total=3+bis.rounds+1;
  const screen=await sim(stages.screen,bis.candidates,screenSettings(settings),{title:'Screening'});
  if(cancelled())return;
  if(!screen)return skip(total-1,'Screening failed, so there was no search.');
  const finalists=selectBisFinalists(bis.candidates,screen,bis.finalists,tank,ctx);
  if(!finalists.length)return skip(total-1,'No candidate could beat the gear you wear within screening uncertainty, so nothing measurably beats what you wear in these sources.');
  const final=await sim(stages.final,finalists,settings,{title:'Final round'});
  if(cancelled())return;
  if(!final)return skip(total-2,'The final round failed, so there was no search.');
  const ranks=ranksFrom(screen,final,tank),pool=buildPool(finalists,ranks,ctx);
  run.bySource=bestBySource(pool);
  // The first sets: the best item per slot, and the best way to reach each set bonus from there.
  const first=assemble(pool,ctx),candidates=[{label:'Best item in every slot',picks:first,changes:[]},...setMoves(first,pool,ctx)];
  const seen=new Set(),sets=[];
  for(const c of candidates){const sig=signature(c.picks,ctx);if(!seen.has(sig)){seen.add(sig);sets.push(c);}}
  const list=sets.map((c,i)=>listItem('s'+String(i+1).padStart(2,'0'),c.picks,ctx.worn,ctx));
  let picks=new Map(ctx.slots.filter(s=>pool.kept.has(s)).map(s=>[s,pickOf(pool.kept.get(s),s)]));
  if(list.every(l=>!l.parts.length)){
    run.variants=[];run.set=setRecord(picks);run.final={same:true};await skip(2+bis.rounds,'No set of the sources beats what you wear by more than the noise, so nothing measurably beats what you wear in them.');return;
  }
  const result=await sim(stages.sets,list.filter(l=>l.parts.length),settings,{title:'Assembling the best set'});
  if(cancelled())return;
  run.variants=sets.map((c,i)=>({key:list[i].key,label:c.label,set:setRecord(c.picks)}));
  if(result){
    const best=result.rows.map(r=>({r,gain:gainOf(r,result.baseline,tank)})).sort((a,b)=>b.gain-a.gain)[0];
    run.variants.forEach(v=>{const row=result.rows.find(r=>r.key===v.key);if(row)Object.assign(v,{gain:gainOf(row,result.baseline,tank),noise:noiseOf(row,result.baseline,tank),dps:row.dps});});
    // A set that loses to what you wear is not a start: refine from the gear you wear instead.
    if(best&&best.gain>0)picks=sets[run.variants.findIndex(v=>v.key===best.r.key)].picks;
    run.start=best&&best.gain>0?best.r.key:null;
  }else run.notes.push('The first sets could not be simulated, so the search starts from the gear you wear.');
  await save();
  // Refinement: while a change beats the set by more than the noise, make it. Changes in different slot groups usually
  // add up, so up to `limits.adopt` of the best ones are made together; the next round then also tries undoing all but
  // the best, because they do not always add up, and keeps whichever set is better.
  let rounds=0,fallback=null;
  for(let round=1;round<=bis.rounds&&!cancelled();round++){
    const near=neighbors(picks,pool,ctx);
    if(fallback&&legal(fallback.picks,ctx)&&signature(fallback.picks,ctx)!==signature(picks,ctx))near.push({picks:fallback.picks,label:fallback.label,changes:[],back:true});
    if(!near.length){run.notes.push('There was no change left to try.');break;}
    const from=effective(picks,ctx);
    const listing=near.map((n,i)=>listItem(`r${round}-${String(i+1).padStart(2,'0')}`,n.picks,from,ctx));
    const res=await sim(stages.round+round,listing,settings,{base:baseActor(picks,ctx),title:`Refinement round ${round}`});
    rounds++;
    if(cancelled())return;
    if(!res){run.notes.push(`Refinement round ${round} failed.`);break;}
    const scored=res.rows.map(r=>({r,gain:gainOf(r,res.baseline,tank),noise:noiseOf(r,res.baseline,tank),n:near[listing.findIndex(l=>l.key===r.key)]})).filter(x=>x.n).sort((a,b)=>b.gain-a.gain);
    const wins=scored.filter(x=>x.gain>x.noise&&x.gain>0);
    // The best change, then the next best that touches other slot groups and still leaves a wearable set.
    let next=wins[0]?.n.picks;const taken=wins.slice(0,1);
    if(wins[0]&&!wins[0].n.back){
      const touched=new Set(wins[0].n.changes.map(groupOf));
      for(const w of wins.slice(1)){
        if(taken.length>=limits.adopt)break;
        if(w.n.back||w.n.changes.some(s=>touched.has(groupOf(s))))continue;
        const trial=new Map(next);for(const s of w.n.changes)trial.set(s,w.n.picks.get(s));
        if(!legal(trial,ctx))continue;
        next=trial;taken.push(w);w.n.changes.forEach(s=>touched.add(groupOf(s)));
      }
    }
    run.rounds.push({round,stage:stages.round+round,tried:near.length,baseline:{dps:res.baseline.dps,error95:res.baseline.error95},...(taken.length?{adopted:taken.map(w=>({label:w.n.label,changes:w.n.changes,gain:w.gain,noise:w.noise}))}:{})});
    if(!taken.length){run.notes.push(`After ${round===1?'one round':round+' rounds'}, none of the ${near.length} changes tried beat the set by more than the noise.`);await save();break;}
    fallback=taken.length>1?{picks:wins[0].n.picks,label:`Undo all but: ${wins[0].n.label}`}:null;
    picks=next;await save();
  }
  step(bis.rounds-rounds);
  run.set=setRecord(picks);
  // Check: the set against the gear you wear, and what each changed slot is worth in the set.
  const effNow=effective(picks,ctx),changed=[...picks].filter(([,p])=>!p.kept).map(([slot])=>slot);
  if(!changed.length){run.final={same:true};step(1);await save();return;}
  const checks=[{key:'v-current',parts:diffLines(effNow,ctx.worn)}];
  for(const slot of changed){
    if(!pool.kept.has(slot))continue;
    const trial=new Map(picks);trial.set(slot,pickOf(pool.kept.get(slot),slot));
    checks.push({key:'v-'+slot,slot,parts:diffLines(effNow,effective(trial,ctx))});
  }
  const verify=await sim(stages.verify,checks,settings,{base:baseActor(picks,ctx),title:'Checking the set'});
  if(cancelled())return;
  if(!verify){run.notes.push('The final check failed, so the set is not compared with the gear you wear.');await save();return;}
  const current=verify.rows.find(r=>r.key==='v-current');
  run.final={dps:verify.baseline.dps,error95:verify.baseline.error95,
    ...(current?{current:{dps:current.dps,error95:current.error95},gain:tank?.boss?-gainOf(current,verify.baseline,tank):100*(verify.baseline.dps-current.dps)/Math.max(1,current.dps),noise:noiseOf(current,verify.baseline,tank)}:{}),
    slots:changed.map(slot=>{const row=verify.rows.find(r=>r.key==='v-'+slot);return {slot,key:picks.get(slot).cand.key,...(row?{worth:-gainOf(row,verify.baseline,tank),noise:noiseOf(row,verify.baseline,tank)}:{})};})};
  await save();
}
