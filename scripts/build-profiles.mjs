// Turns profiles/<key>.json into the .simc profile Weapon Lab carries for a specialization SimulationCraft has
// not rebuilt for the current season. Run it after editing the data, or after a season changes what the guide
// recommends: node scripts/build-profiles.mjs
//
// Nothing here is trusted on its word. Every item is looked up in the pinned catalog and has to exist, be from
// the current expansion and fit the slot it was listed under; gems have to be current gems; an enchant named by
// its item is matched back to our own enchant and raised to its highest rank, which is what the season profiles
// wear; crafted pieces are written the way SimulationCraft writes them, at the crafting cap rather than on a
// raid track; and the talents have to decode and pass the same legality check as an imported build.
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadCatalog} from '../lib/catalog.mjs';
import {enginePaths,readEngineMetadata,upstreamDir,appRoot} from '../lib/paths.mjs';
import {loadTalentData,decodeTalents,validateBuild,pointTotals} from '../lib/talents.mjs';
import {loadSeason} from '../lib/upgrades.mjs';
import {craftedItemLevel,dropLevels} from '../lib/weapons.mjs';
import {parseProfile} from '../lib/profile.mjs';

const dir=path.join(appRoot,'profiles');
const {source}=enginePaths(await readEngineMetadata());
const catalog=await loadCatalog(source);
const talentData=await loadTalentData(upstreamDir,source);
const season=await loadSeason(upstreamDir,catalog,source);
const craftedCap=await craftedItemLevel(source);
const equippable=JSON.parse(await fs.readFile(path.join(upstreamDir,'equippable-items.json'),'utf8'));
const meta=new Map(equippable.map(i=>[i.id,i]));
const enchantByItem=new Map(catalog.enchants.filter(e=>e.itemId).map(e=>[e.itemId,e]));
const gems=new Set(catalog.gems.map(g=>g.id));
const craftedStatIds=new Set(season.craftedStats.map(s=>s.bonusId));
// The guide says which item; the level it is worn at is ours to work out, from the same season data Weapon Lab
// uses. A bonus that only sets item level is dropped and replaced; sockets and effects are kept.
const itemLevelBonus=new Map();
for(const [level,ids] of Object.entries(JSON.parse(await fs.readFile(path.join(upstreamDir,'item-level-bonus-lookup.json'),'utf8'))))
  for(const id of ids)itemLevelBonus.set(id,Number(level));
const drops=dropLevels(season,{craftedCap}).of;
// Nothing in a best-in-slot set sits below the cap of the second-highest track; below that, the guide slipped.
const floor=(season.tracks.find(t=>t.name==='Hero')||season.tracks.at(-2)||season.tracks.at(-1)).levels.at(-1).itemLevel;
const bestLevel=new Map();
for(const {item,source} of season.entries){
  const level=drops[source.kind]?.of(source);
  if(!level)continue;
  const known=bestLevel.get(item.id);
  if(!known||level.itemLevel>known.itemLevel)bestLevel.set(item.id,level);
}
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
// The guide links whichever rank of an enchant it happens to link; the season profiles all wear the highest.
const topRank=enchant=>{
  const base=enchant.token.replace(/_\d+$/,'');
  return catalog.enchants.filter(e=>e.token.replace(/_\d+$/,'')===base).sort((a,b)=>b.rank-a.rank)[0]||enchant;
};

let failed=0;
for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith('.json')).sort()){
  const data=JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));
  const problems=[],notes=[],lines=[],levels=[];
  const tree=talentData.find({class:data.class,spec:data.spec});
  try{
    const build=decodeTalents(data.talents,tree);
    const errors=validateBuild(build,tree,{budgets:{class:34,spec:34,hero:13},entries:talentData.entries});
    if(errors.length)problems.push(`talents: ${errors.join('; ')}`);
    else{const p=pointTotals(build,tree);if(p.class!==34||p.spec!==34||p.hero!==13)problems.push(`talents spend ${JSON.stringify(p)}`);}
  }catch(e){problems.push(`talents: ${e.message}`);}
  for(const g of data.gear){
    const item=catalog.items.get(g.item),info=meta.get(g.item);
    if(!item){problems.push(`${g.slot}: item ${g.item} is not in the catalog`);continue;}
    // Older-expansion gear is allowed only where the app already allows it: reissued in the active season's own
    // raid or Mythic+ loot tables, which is how a dungeon from an older expansion can be worn this season.
    if(info&&info.expansion!==catalog.expansion.id){
      const reissued=season.entries.find(e=>e.item.id===g.item&&['raid','mplus'].includes(e.source.kind));
      if(reissued)notes.push(`${g.slot}: ${item.name} is from expansion ${info.expansion}, reissued in ${reissued.source.groupName}`);
      else problems.push(`${g.slot}: ${item.name} is from expansion ${info.expansion} and is not in this season's raid or Mythic+ tables`);
    }
    const parts=[`,id=${g.item}`];
    const crafted=/crafted/i.test(g.from||'');
    // The guide dresses a fully geared character, vault and all, so the level it lists stands — as long as the
    // pinned data agrees it is a real level and not one no best-in-slot set would wear. A number that means
    // nothing (a typo) or that sits below the Hero cap is treated as an error, and the season data decides.
    const keep=(g.bonus||[]).filter(b=>!itemLevelBonus.has(b)&&(!crafted||!craftedStatIds.has(b)));
    const theirs=(g.bonus||[]).filter(b=>itemLevelBonus.has(b));
    const listed=theirs.length?Math.max(...theirs.map(b=>itemLevelBonus.get(b))):null;
    const sound=listed!==null&&listed>=floor;
    const own=bestLevel.get(g.original)||bestLevel.get(g.item);
    const bonus=[...keep];
    if(crafted){
      if(!craftedCap)problems.push(`${g.slot}: no crafted cap could be read from the season profiles`);
      const pair=(g.bonus||[]).find(b=>craftedStatIds.has(b));
      if(bonus.length)parts.push(`bonus_id=${bonus.join('/')}`);
      if(craftedCap)parts.push(`ilevel=${craftedCap}`);
      if(pair)parts.push(`crafted_stats=${season.craftedStats.find(s=>s.bonusId===pair).name.split(' / ').map(n=>({'Critical Strike':32,Haste:36,Versatility:40,Mastery:49})[n]).join('/')}`);
    }else if(sound){
      if((g.bonus||[]).length)parts.push(`bonus_id=${g.bonus.join('/')}`);
    }else if(own?.bonusId){
      // Once we set the level ourselves, the rest of the guide's bonus list goes too: a stray one can shift the
      // level again. The line is built the way the app builds any other — the item's own bonuses plus our level.
      parts.push(`bonus_id=${[...(info?.bonusLists||[]),own.bonusId].join('/')}`);
      notes.push(`${g.slot}: ${item.name} listed at ${listed===null?'no item level':`item level ${listed}`}, which no best-in-slot set would wear — using ${own.itemLevel} from the season data (${own.label})`);
    }else{
      problems.push(`${g.slot}: ${item.name} has no sound item level — the guide gives ${listed===null?'none':listed}, and the season tables do not cover it`);
    }
    if(g.original){
      if(!catalog.items.has(g.original))problems.push(`${g.slot}: catalyst original ${g.original} is not in the catalog`);
      else parts.push(`redirected_base_stats=${g.original}`);
    }
    for(const gem of g.gems||[])if(!gems.has(gem))problems.push(`${g.slot}: gem ${gem} is not a current gem`);
    if((g.gems||[]).length)parts.push(`gem_id=${g.gems.join('/')}`);
    if(g.enchant){
      const found=enchantByItem.get(g.enchant);
      if(!found)problems.push(`${g.slot}: enchant item ${g.enchant} has no enchant in the catalog`);
      else{
        const best=topRank(found);
        const compatible=catalog.forItem(g.item,data.class).some(e=>e.id===best.id);
        if(!compatible)problems.push(`${g.slot}: ${best.label} does not fit ${item.name}`);
        else parts.push(`enchant_id=${best.id}`);
      }
    }
    lines.push(`${g.slot}=${slug(item.name)}${parts.join(',')}`);
    levels.push(g.slot);
  }
  const head=[
    `# ${data.label} — SimC Lab's own reference profile.`,
    '#',
    `# SimulationCraft has no profile for this specialization in the current season, so this one stands in for it.`,
    `# It is dropped the moment SimulationCraft publishes its own: nothing here overrides the engine.`,
    '#',
    `# Gear and talents: ${data.source.name}, patch ${data.source.patch}, read ${data.source.readAt}.`,
    `#   ${data.source.gear}`,
    `#   ${data.source.talents}`,
    `# ${data.source.note}`,
    `# Item levels, enchant ranks and the crafting cap come from the pinned game data, not from the guide.`,
    `# Written by scripts/build-profiles.mjs from profiles/${file} — edit that, not this file.`,
    ''
  ];
  const body=[
    `${data.class}="MPC_${data.label.replace(/\s+/g,'_')}"`,
    `spec=${data.spec}`,
    `level=${data.level}`,
    `race=${data.race}`,
    `role=${data.role}`,
    `position=${data.position}`,
    `talents=${data.talents}`,
    '',
    ...Object.entries(data.consumables).map(([key,value])=>`${key}=${value}`),
    '',
    ...lines,
    ''
  ];
  const text=[...head,...body].join('\n');
  // The profile has to survive the same reader an imported character goes through.
  try{
    const parsed=parseProfile(text.split('\n').filter(l=>!l.startsWith('#')).join('\n'),{reference:true});
    if(Object.keys(parsed.gear).length!==data.gear.length)problems.push(`parsed ${Object.keys(parsed.gear).length} gear slots, expected ${data.gear.length}`);
  }catch(e){problems.push(`profile does not parse: ${e.message}`);}
  const out=path.join(dir,`${data.key}.simc`);
  if(problems.length){
    failed++;
    console.log(`\n${data.key}: ${problems.length} problem${problems.length===1?'':'s'}`);
    for(const p of problems)console.log('  -',p);
  }else{
    await fs.writeFile(out,text);
    console.log(`${data.key}: ${lines.length} slots written to profiles/${data.key}.simc`);
    for(const n of notes)console.log('   note:',n);
  }
}
if(failed){console.error(`\n${failed} profile(s) were not written.`);process.exitCode=1;}
