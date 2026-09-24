// Weapon Lab for healers. SimulationCraft cannot simulate healing, and for most healing specializations it cannot
// run them at all, so their weapons are not simulated: SimC reads each weapon's own stats at the level its source
// gives, and a stat score ranks them. The healing half uses QE Live's published stat weights for the chosen
// content; the damage half is our own model, below. Equip and use effects are in neither and are said to be missing.
import fs from 'node:fs/promises';
import path from 'node:path';
import {eligible,carried,weaponKinds,sourceKinds,classIds} from './upgrades.mjs';
import {appRoot} from './paths.mjs';
import {tiers} from './weapons.mjs';

export const hands={two:'Two-hand',one:'One-hand',off:'Off hand'};
export const contents={dungeon:'Mythic+',raid:'Raid'};
const ratings=['crit','haste','mastery','versatility'];
const ratingKeys={crit:'crit_rating',haste:'haste_rating',mastery:'mastery_rating',versatility:'versatility_rating'};

export async function healerWeights(){
  return JSON.parse(await fs.readFile(path.join(appRoot,'profiles/healers/weights.json'),'utf8'));
}
// A specialization with one set of weights per hero tree is scored on their mean: the tier list holds talents
// constant for every other specialization as well, and neither tree is the only one played.
export function contentWeights(entry,content){
  const sets=[entry[content]].flat();
  return Object.fromEntries(ratings.map(stat=>[stat,sets.reduce((n,s)=>n+s[stat],0)/sets.length]));
}

export async function healerSpecs(talentData,season){
  const data=await healerWeights();
  // A specialization the talent data does not know is left out, as an unreadable reference profile is.
  return data.specs.flatMap(entry=>{
    const info={class:entry.class,spec:entry.spec};let tree;
    try{tree=talentData.find(info);}catch{return [];}
    return [{key:`${entry.class}-${entry.spec}`,file:'healers/weights.json',className:tree.className,specName:tree.specName,specId:tree.specId,
      label:`${tree.specName} ${tree.className}`,class:entry.class,spec:entry.spec,tank:false,healer:true,info,gear:{},season,
      weights:{dungeon:contentWeights(entry,'dungeon'),raid:contentWeights(entry,'raid')},heroTrees:entry.heroTrees||null,
      provenance:{...data.source,file:entry.file}}];
  });
}

// A healer wields a two-hander, or a one-hander with something in the off hand; off-hand weapons need dual wield,
// which no healer has. Kinds follow Weapon Lab's own categories so the same checkboxes select them.
const handOf=item=>({two:'two',one:'one',shield:'off',held:'off'})[weaponKinds[item.inventoryType]]||null;
const kindOfHand=(item,hand)=>hand==='off'?(item.inventoryType===14?'shield':'held'):'main';

export function healerCandidates(spec,season,{drops,kinds:wanted,craftedStats=[]}){
  const found=new Map();
  for(const {item,source} of season.entries){
    if(![2,4].includes(item.itemClass)||item.inventoryType===22)continue;
    const hand=handOf(item);if(!hand)continue;
    const kind=kindOfHand(item,hand);if(!wanted.includes(kind))continue;
    if(!eligible(item,spec.info,spec.specId,season.weaponSpecs))continue;
    const drop=drops[source.kind];if(!drop)continue;
    const level=drop.of(source),slot=hand==='off'?'off_hand':'main_hand';
    for(const stat of source.kind==='crafted'?craftedStats:[null]){
      const bonuses=[...(item.bonusLists||[]),...(stat?[stat.bonusId]:[]),...(level.bonusId?[level.bonusId]:[])];
      const value=[`,id=${item.id}`,`bonus_id=${bonuses.join('/')}`,...(level.ilevel?[`ilevel=${level.ilevel}`]:[]),...carried(null,item,bonuses,season.bonusSockets)].join(',');
      const label=`${sourceKinds[source.kind]} · ${source.groupName}`,key=`${hand}|${item.id}|${stat?stat.bonusId:''}`,existing=found.get(key);
      if(existing){
        if(level.itemLevel>existing.itemLevel)Object.assign(existing,{itemLevel:level.itemLevel,levelLabel:level.label,value,line:`${slot}=${value}`,sources:[label,...existing.sources.filter(s=>s!==label)]});
        else if(!existing.sources.includes(label))existing.sources.push(label);
        continue;
      }
      found.set(key,{slot,hand,kind,itemId:item.id,name:item.name,itemLevel:level.itemLevel,levelLabel:level.label,weaponType:weaponKinds[item.inventoryType],value,line:`${slot}=${value}`,sources:[label],...(stat?{craftedStat:stat.name}:{})});
    }
  }
  const order=Object.keys(hands);
  const list=[...found.values()].sort((a,b)=>order.indexOf(a.hand)-order.indexOf(b.hand)||a.name.localeCompare(b.name)||String(a.craftedStat).localeCompare(String(b.craftedStat)));
  list.forEach((c,i)=>c.key='h'+String(i+1).padStart(3,'0'));
  return list;
}

// One SimC run reads every healer weapon: a Restoration Shaman carries each one, since it can hold every kind a
// healer wields, shields included, and SimC runs it. Ratings come from its report of the item. Intellect does not:
// a main-hand weapon gives more than its item line shows (a 334 staff lists 650 and gives 839), so it is read as
// what the carrier gained over an unarmed one. A caster reference profile rides along as the character the scores
// are measured against.
export function readoutInput(lines,reference,jsonPath){
  const actors=['shaman=unarmed\nspec=restoration\nlevel=90\nrace=troll',...lines.map(({key,line})=>`shaman=${key}\nspec=restoration\nlevel=90\nrace=troll\n${line}`)];
  const classLine=new RegExp(`^(${Object.keys(classIds).join('|')})=.*$`,'m');
  return `${actors.join('\n')}\n${reference?`\n${reference.replace(classLine,(m,cls)=>`${cls}=reference`)}\n`:''}\n# Controlled by SimC Lab\nptr=0\nitem_db_source=local\niterations=1\nthreads=1\nmax_time=5\noptimal_raid=0\ncalculate_scale_factors=0\njson2="${jsonPath.replaceAll('\\','/')}"\n`;
}

// Stats of each carried item and the reference character, from the readout report. Rating conversions come from
// the carriers: a lone weapon stays far below diminishing returns, so its rating over its percentage is exact.
export function readoutStats(report){
  const players=report?.sim?.players||[];
  const items=new Map(),conversion={};
  const intellect=p=>p?.collected_data?.buffed_stats?.attribute?.intellect;
  const unarmed=intellect(players.find(p=>p.name==='unarmed'));
  if(!Number.isFinite(unarmed))throw new Error('The weapon readout has no unarmed carrier to measure intellect against.');
  for(const p of players){
    if(['reference','unarmed'].includes(p.name))continue;
    const gear=Object.values(p.gear||{})[0];if(!gear)continue;
    items.set(p.name,{itemLevel:gear.ilevel,intellect:intellect(p)-unarmed,...Object.fromEntries(ratings.map(s=>[s,gear[ratingKeys[s]]||0]))});
    const st=p.collected_data?.buffed_stats?.stats||{};
    const pct={crit:(st.crit_pct??st.spell_crit)-0.05,haste:st.haste_pct,versatility:st.damage_versatility};
    for(const s of ['crit','haste','versatility'])if(!conversion[s]&&gear[ratingKeys[s]]>0&&pct[s]>0)conversion[s]=gear[ratingKeys[s]]/pct[s];
  }
  const ref=players.find(p=>p.name==='reference')?.collected_data?.buffed_stats;
  const reference=ref?{intellect:ref.attribute?.intellect,crit:ref.stats?.crit_pct??ref.stats?.spell_crit,haste:ref.stats?.haste_pct,versatility:ref.stats?.damage_versatility,
    ratings:Object.fromEntries(ratings.map(s=>[s,ref.stats?.[ratingKeys[s]]||0]))}:null;
  return {items,conversion,reference};
}

// Our damage model. A healer's damage is cast by cast, so it scales with intellect (spell power), with crit, haste
// and versatility each as a multiplier of its own: damage ∝ int × (1+crit) × (1+haste) × (1+vers). Every healing
// mastery works on healing alone, so it adds no damage. The weight of a rating point is its marginal gain over that
// of an intellect point, at the reference character's own stats.
export function damageWeights(reference,conversion){
  const w={mastery:0};
  for(const s of ['crit','haste','versatility'])w[s]=conversion[s]?reference.intellect/(conversion[s]*(1+(reference[s]||0))):0;
  return w;
}

// A score is the weapon's intellect plus its ratings times their weights, as a share of the whole reference
// character scored the same way, so it reads in percent of throughput like the damage lists do.
export function scoreItem(stats,weights){
  return stats.intellect+ratings.reduce((n,s)=>n+(weights[s]||0)*(stats[s]||0),0);
}
export function characterScore(reference,weights){
  return reference.intellect+ratings.reduce((n,s)=>n+(weights[s]||0)*(reference.ratings[s]||0),0);
}

export function healerRows(spec,readout,{content,weight}){
  const heal=spec.weights[content],damage=damageWeights(readout.reference,readout.conversion);
  const healTotal=characterScore(readout.reference,heal),damageTotal=characterScore(readout.reference,damage);
  const share=weight/100;
  return spec.candidates.map(c=>{
    const stats=readout.items.get(c.key);
    if(!stats)return {spec:spec.key,scenario:0,stage:2,key:c.key,status:'failed',error:'SimC did not report this item.'};
    const healing=100*scoreItem(stats,heal)/healTotal,dps=100*scoreItem(stats,damage)/damageTotal;
    return {spec:spec.key,scenario:0,stage:2,key:c.key,status:'complete',healer:true,stats,healing,damage:dps,score:share*healing+(1-share)*dps,scoreError:0};
  });
}

// Each hand is its own list. A two-hander carries the stats of both hands, so it is set against the best one-hand
// and off-hand pair rather than against either alone.
export function rankHealerRows(rows,candidates){
  const byKey=new Map(candidates.map(c=>[c.key,c]));
  const out={};
  for(const hand of Object.keys(hands)){
    const list=rows.filter(r=>r.status==='complete'&&byKey.get(r.key)?.hand===hand).sort((a,b)=>b.score-a.score);
    const ranked=[],seen=new Set();
    for(const row of list){
      const item=byKey.get(row.key).itemId;
      if(seen.has(item)){row.variant=true;continue;}
      seen.add(item);row.variant=false;ranked.push(row);
    }
    const best=ranked[0];
    for(const [index,row] of ranked.entries()){
      row.rank=index+1;
      // Scores are already percent of the whole character, so the gap is what the swap costs it, as for damage.
      row.behind=best.score-row.score;
      row.behindFirst=row.behind;
      row.tier=tiers.find(t=>row.behind<t.behind).tier;
      row.tied=false;row.set=false;
    }
    out[hand]=ranked;
  }
  const pair=out.one?.[0]&&out.off?.[0]?out.one[0].score+out.off[0].score:null,staff=out.two?.[0]?.score??null;
  return {hands:out,compare:pair!==null&&staff!==null?{two:out.two[0].key,one:out.one[0].key,off:out.off[0].key,twoScore:staff,pairScore:pair,lead:staff-pair}:null};
}
