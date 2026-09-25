import fs from 'node:fs/promises';
import path from 'node:path';
import {slotTypes,fitsSlot,hasTitansGrip} from './equipment.mjs';
import {slots as allSlots} from './profile.mjs';
import {actorTank,profilesetTank,tankComparison} from './tank.mjs';

export const classIds={warrior:1,paladin:2,hunter:3,rogue:4,priest:5,deathknight:6,shaman:7,mage:8,warlock:9,monk:10,druid:11,demonhunter:12,evoker:13};
const armorTypes={priest:1,mage:1,warlock:1,rogue:2,monk:2,druid:2,demonhunter:2,hunter:3,shaman:3,evoker:3,warrior:4,paladin:4,deathknight:4};
// Primary stat per specialization ID. Items carrying only other primary stats are never offered.
const primaryBySpec={71:'str',72:'str',73:'str',65:'int',66:'str',70:'str',253:'agi',254:'agi',255:'agi',259:'agi',260:'agi',261:'agi',256:'int',257:'int',258:'int',250:'str',251:'str',252:'str',262:'int',263:'agi',264:'int',62:'int',63:'int',64:'int',265:'int',266:'int',267:'int',268:'agi',269:'agi',270:'int',102:'int',103:'agi',104:'agi',105:'int',577:'agi',581:'agi',1480:'int',1467:'int',1468:'int',1473:'int'};
const primaryStats={3:['agi'],4:['str'],5:['int'],71:['agi','str','int'],72:['str','agi'],73:['agi','int'],74:['str','int']};
const armorInventory=new Set([1,3,5,6,7,8,9,10,20]);
const shieldClasses=new Set(['warrior','paladin','shaman']);
const statNames={32:'Critical Strike',36:'Haste',40:'Versatility',49:'Mastery'};
export const weaponKinds={17:'two',15:'two',26:'two',13:'one',21:'one',22:'one',14:'shield',23:'held'};
export const sourceKinds={raid:'Raid',mplus:'Mythic+',delves:'Delves',vault:'Great Vault',crafted:'Crafted'};
export const limits={candidates:800,finalists:[24,48,96]};

// Season pools come from the pinned client data: the active season's bonus-roll group names the raid
// encounters and Mythic+ dungeons, so no instance or item ID is hardcoded here.
export async function loadSeason(directory,catalog,source){
  const read=async name=>JSON.parse(await fs.readFile(path.join(directory,name+'.json'),'utf8'));
  const [seasons,instances,encounterItems,equippable,upgradeSets,craftedStats,weaponSpecs,levelLookup,bonusSockets]=await Promise.all(['seasons','instances','encounter-items','equippable-items','bonus-upgrade-sets','bonus-crafted-stats','weapon-specs','item-level-bonus-lookup','bonus-sockets'].map(read));
  const bonusText=source?await fs.readFile(path.join(source,'engine/dbc/generated/item_bonus.inc'),'utf8'):'';
  // Game data installed before crafting reagents were downloaded has no embellishments; everything else still works.
  const crafting=await read('crafting').catch(()=>null);
  const season=seasons.find(s=>s.active);if(!season)throw new Error('The client data has no active season.');
  const byInstance=new Map(instances.map(i=>[i.id,i]));
  const bonusRoll=byInstance.get(season.bonusRollGroupId),mplus=instances.find(i=>i.type==='mplus-chest');
  if(!bonusRoll||!mplus)throw new Error('The season data is missing its bonus-roll or Mythic+ group.');
  const dungeons=mplus.encounters.filter(e=>e.id>0&&bonusRoll.encounters.some(b=>b.id===e.id)).map(e=>({id:e.id,name:e.name}));
  const dungeonIds=new Set(dungeons.map(d=>d.id));
  const raidEncounters=new Set(bonusRoll.encounters.map(e=>e.id).filter(id=>!dungeonIds.has(id)));
  const raids=instances.filter(i=>i.type==='raid'&&i.id>0&&i.encounters.some(e=>raidEncounters.has(e.id))).map(i=>({id:i.id,name:i.name,encounters:i.encounters.map(e=>({id:e.id,name:e.name,sequence:e.trash?1:e.itemSequenceLevel||1}))}));
  const delves=instances.find(i=>i.type===`delve-${season.shortName}`)||null;
  const crafted=instances.find(i=>/^profession.*Epic$/.test(i.type))||null;
  const tracks=season.bonusListGroups.map(group=>{const levels=upgradeSets[group]||[];return {id:group,name:levels.find(l=>l.currency)?.currency.name.split(' ')[0]||`Track ${group}`,levels:levels.map(l=>({level:l.level,max:l.max,bonusId:l.bonusId,itemLevel:l.itemLevel,...(l.currency?{cost:{currencyId:l.currency.id,amount:l.currency.amount}}:{}),discounts:(l.highWatermarkDiscounts||[]).filter(d=>d.type==='currency').map(d=>({currencyId:d.id,scaling:d.scaling,accountWide:!!d.accountWide}))}))};}).filter(t=>t.levels.length);
  if(!tracks.length)throw new Error('The season data has no upgrade tracks.');
  // Last raid bosses on the top track drop above its final upgrade level. The engine data puts that bonus in the
  // track's upgrade group but outside the track's own ladder of IDs; its item level comes from the pinned lookup.
  const itemLevelOf=new Map(Object.entries(levelLookup).flatMap(([level,ids])=>ids.map(id=>[id,Number(level)])));
  for(const track of tracks){
    const first=track.levels[0].bonusId,members=new Set();
    for(const m of bonusText.matchAll(/\{\s*\d+,\s*(\d+),\s*34,\s*(\d+),/g))if(Number(m[2])===track.id)members.add(Number(m[1]));
    const outside=[...members].filter(id=>id<first||id>first+7&&itemLevelOf.get(id)>track.levels.at(-1).itemLevel).sort((a,b)=>itemLevelOf.get(b)-itemLevelOf.get(a));
    track.finalDrop=outside.length?{bonusId:outside[0],itemLevel:itemLevelOf.get(outside[0])}:null;
  }
  const difficulties=['Raid Finder','Normal','Heroic','Mythic'].slice(-tracks.length).map((name,i,list)=>({name,track:tracks[tracks.length-list.length+i].id}));
  const stats=Object.entries(craftedStats).filter(([,ids])=>ids.length===2&&ids.every(id=>statNames[id])).map(([bonusId,ids])=>({bonusId:Number(bonusId),name:ids.map(id=>statNames[id]).join(' / ')}));
  const items=new Map(equippable.map(i=>[i.id,i]));for(const item of encounterItems)items.set(item.id,{...items.get(item.id),...item});
  const expansion=catalog.expansion.id;
  const isOmni=token=>new Set(token.contains.map(id=>items.get(id)?.inventoryType).filter(Boolean).map(t=>t===20?5:t)).size>1;
  const tokenHome=(piece,raidId)=>{
    const raid=raids.find(r=>r.id===raidId);let best=0;
    for(const token of encounterItems)if(token.contains?.includes(piece.id)&&!isOmni(token))for(const s of token.sources||[])if(s.instanceId===raidId)best=Math.max(best,raid.encounters.find(e=>e.id===s.encounterId)?.sequence||0);
    return best||null;
  };
  const entries=[];
  const add=(item,source,token)=>{
    if(!catalog.items.has(item.id)||item.cosmetic||![2,4].includes(item.itemClass))return;
    // Older-expansion items are allowed only through the active season's own dungeon or raid pools.
    if(item.expansion!==expansion&&!(['mplus','raid'].includes(source.kind)))return;
    entries.push({item,source:token?{...source,token}:source});
  };
  for(const item of items.values())for(const s of item.sources||[]){
    let source=null;
    const raid=raids.find(r=>r.id===s.instanceId);
    if(raid&&raidEncounters.has(s.encounterId)||raid&&s.encounterId<0){const encounter=raid.encounters.find(e=>e.id===s.encounterId);source={kind:'raid',group:s.encounterId,groupName:encounter?.name||'Trash',instance:raid.name,sequence:encounter?.sequence||1,raid:raid.id};}
    else if(s.instanceId===-1&&dungeonIds.has(s.encounterId))source={kind:'mplus',group:s.encounterId,groupName:dungeons.find(d=>d.id===s.encounterId).name};
    else if(delves&&s.instanceId===delves.id)source={kind:'delves',group:delves.id,groupName:delves.name};
    else if(crafted&&s.instanceId===crafted.id)source={kind:'crafted',group:s.encounterId,groupName:crafted.encounters.find(e=>e.id===s.encounterId)?.name||'Profession'};
    if(!source)continue;
    if(item.contains?.length){
      for(const id of item.contains){const piece=items.get(id);if(!piece)continue;
        // An all-slot token drops each piece at the level of the boss whose own token gives that slot.
        const home=source.kind==='raid'&&isOmni(item)?tokenHome(piece,source.raid):null;
        add(piece,home?{...source,sequence:home}:source,item.name);}
      continue;
    }
    add(item,source);
  }
  // Crests are named by the upgrade levels that cost them; the warband achievements extend the slot discount account-wide.
  const crestNames=new Map(Object.values(upgradeSets).flat().filter(l=>l.currency).map(l=>[l.currency.id,{name:l.currency.name,icon:l.currency.icon}]));
  const crests={currencies:(season.crestCurrencies||[]).filter(id=>crestNames.has(id)).map(id=>({id,...crestNames.get(id)})),warband:Object.fromEntries(Object.entries(season.warbandCrestDiscountAchievements||{}).map(([k,v])=>[k,Number(v)]))};
  const {embellishments,limits:itemLimits}=embellishmentData(crafting,equippable,bonusText,expansion);
  return {season:{id:season.id,name:season.name},crests,tracks,difficulties,raids,dungeons,delves:delves?{id:delves.id,name:delves.name}:null,crafted:crafted?{id:crafted.id,name:crafted.name}:null,craftedStats:stats,entries,weaponSpecs,expansion,bonusSockets,embellishments,itemLimits,hasCraftingData:!!crafting};
}

// Embellishments are the reagents of the crafting slots named "Add Embellishment". Each carries an equip limit
// (category 512 is "Embellished", two per character; engineering tinkers have a category of their own), and SimC
// reads the effect from the bonus IDs the reagent adds. Only current-expansion reagents are offered, one per name at
// its best quality. Limits are counted from the client data: an item's own itemLimit (Loa Worshiper's Band is born
// embellished) and every bonus ID of type 35, which is how an added embellishment marks the item it is on.
export function embellishmentData(crafting,equippable,bonusText,expansion){
  const bonuses=new Map();
  for(const m of String(bonusText).matchAll(/\{\s*\d+,\s*(\d+),\s*35,\s*(\d+),/g))bonuses.set(Number(m[1]),Number(m[2]));
  const quantities=new Map(),items=new Map();
  const note=limit=>{if(limit?.category&&limit.quantity)quantities.set(limit.category,limit.quantity);};
  for(const item of equippable)if(item.itemLimit?.category){note(item.itemLimit);items.set(item.id,item.itemLimit.category);}
  const embellishments=[];
  if(crafting){
    const reagents=new Map((crafting.reagents||[]).map(r=>[r.id,r])),byName=new Map(),slots=new Map();
    for(const slot of Object.values(crafting.slots||{})){
      if(!/embellish/i.test(slot.name))continue;
      for(const id of slot.reagentIds||[]){
        const r=reagents.get(id);if(!r||r.expansion!==expansion||!r.itemLimit?.category||!r.craftingBonusIds?.length)continue;
        note(r.itemLimit);
        const best=byName.get(r.name);if(!best||(r.craftingQuality||0)>(best.craftingQuality||0))byName.set(r.name,r);
        if(!slots.has(r.name))slots.set(r.name,new Set());slots.get(r.name).add(slot.reagentSlotId);
      }
    }
    for(const r of [...byName.values()].sort((a,b)=>a.name.localeCompare(b.name)))
      embellishments.push({id:r.id,name:r.name,bonusIds:r.craftingBonusIds,category:r.itemLimit.category,slots:[...slots.get(r.name)]});
  }
  for(const [bonus,category] of bonuses)if(!quantities.has(category))bonuses.delete(bonus);
  return {embellishments,limits:{bonuses,items,quantities}};
}

// The limit categories one item uses, from its own itemLimit and from the bonus IDs on it. An item uses a category
// once however it got there: a born-embellished band carries the marker bonus as well.
export function itemLimitsOf(itemId,bonusIds,limits){
  const used=new Set();if(!limits)return used;
  const own=limits.items.get(itemId);if(own)used.add(own);
  for(const id of bonusIds)if(limits.bonuses.has(id))used.add(limits.bonuses.get(id));
  return used;
}
export const bonusIdsOf=value=>(String(value||'').match(/(?:^|,)bonus_id=([\d/:]+)/)?.[1]||'').split(/[/:]/).map(Number).filter(Boolean);

// What the equipped gear already uses of each limit, per slot.
export function equippedLimits(profile,limits){
  const out={};
  for(const [slot,g] of Object.entries(profile.gear||{})){if(!g?.id)continue;const used=itemLimitsOf(g.id,bonusIdsOf(g.value),limits);if(used.size)out[slot]=used;}
  return out;
}

// The limit categories that would overflow if `adds` (slot -> categories) replaced what those slots hold and the
// slots in `cleared` were emptied. An empty list means the combination can be worn.
export function overLimit(equipped,adds,cleared,limits){
  const count=new Map(),bump=used=>{for(const c of used)count.set(c,(count.get(c)||0)+1);};
  for(const [slot,used] of Object.entries(equipped))if(!(slot in adds)&&!cleared.includes(slot))bump(used);
  for(const used of Object.values(adds))bump(used);
  return [...count].filter(([c,n])=>n>(limits?.quantities.get(c)??Infinity)).map(([c])=>c);
}
export const limitNames={512:'Embellished'};

export function publicSources(data){
  const {entries,weaponSpecs,bonusSockets,itemLimits,embellishments=[],...rest}=data;
  return {...rest,embellishments:embellishments.map(e=>({id:e.id,name:e.name,limit:itemLimits?.quantities.get(e.category)??null,limitName:limitNames[e.category]||null})),kinds:sourceKinds,limits};
}

export function eligible(item,info,specId,weaponSpecs){
  const classId=classIds[info.class];
  if(!classId)return false;
  if(item.allowableClasses?.length&&!item.allowableClasses.includes(classId))return false;
  if(item.specs?.length&&!item.specs.includes(specId))return false;
  if(item.itemClass===4&&armorInventory.has(item.inventoryType)&&[1,2,3,4].includes(item.itemSubClass)&&item.itemSubClass!==armorTypes[info.class])return false;
  if(item.itemClass===4&&item.itemSubClass===6&&!shieldClasses.has(info.class))return false;
  if(item.itemClass===2&&!weaponSpecs.find(w=>w.itemClass===2&&w.itemSubClass===item.itemSubClass)?.specsCanUse.includes(specId))return false;
  const primary=primaryBySpec[specId];const offered=(item.stats||[]).flatMap(s=>primaryStats[s.id]||[]);
  if(primary&&offered.length&&!offered.includes(primary))return false;
  return true;
}

// Weapons are only compared like for like with what is equipped: no one-hander replaces a two-hander
// unless Titan's Grip allows both, and off-hand candidates need an equipped off-hand.
export function placements(item,profile,catalog){
  const info=profile.info,result=[];
  for(const slot of Object.keys(slotTypes)){
    if(!fitsSlot(item,slot,info))continue;
    const equipped=profile.gear[slot],equippedItem=equipped&&catalog.items.get(equipped.id);
    if(['main_hand','off_hand'].includes(slot)){
      const kind=weaponKinds[item.inventoryType],current=equippedItem?weaponKinds[equippedItem.inventoryType]:null;
      if(slot==='off_hand'&&!current)continue;
      const grip=hasTitansGrip(info)&&['one','two'].includes(current)&&['one','two'].includes(kind);
      if(current&&kind!==current&&!grip)continue;
    }
    const pair={finger1:'finger2',finger2:'finger1',trinket1:'trinket2',trinket2:'trinket1'}[slot];
    if(pair&&item.uniqueEquipped&&profile.gear[pair]?.id===item.id)continue;
    result.push(slot);
  }
  return result;
}

export function carried(value,item,bonuses,bonusSockets={}){
  const parts=[];const enchant=value?.match(/(?:^|,)(enchant_id=\d+|enchant=[^,]+)/)?.[1];if(enchant)parts.push(enchant);
  // Neck and ring sockets usually come from the item's default bonus list rather than its base data.
  const sockets=Math.max(item.socketInfo?.sockets?.length||0,bonuses.reduce((n,id)=>n+(bonusSockets[id]||0),0));const gems=(value?.match(/(?:^|,)gem_id=([^,]+)/)?.[1]||'').split('/').filter(g=>Number(g));
  if(sockets&&gems.length)parts.push('gem_id='+gems.slice(0,sockets).join('/'));
  return parts;
}

// Boss n of a raid drops at upgrade level n of the difficulty's track; the top track's last bosses use its final drop level.
export function raidDrop(track,sequence,upgrade=0){
  if(sequence>=4&&track.finalDrop)return {bonusId:track.finalDrop.bonusId,itemLevel:track.finalDrop.itemLevel,label:`item level ${track.finalDrop.itemLevel}`};
  const drop=track.levels[Math.min(sequence,track.levels.length)-1],level=track.levels[Math.max(drop.level,upgrade)-1];
  return {bonusId:level.bonusId,itemLevel:level.itemLevel,label:`${track.name} ${level.level}/${level.max}${level.level>drop.level?' (upgraded)':''}`};
}

export function trackLevel(data,choice,label){
  const track=data.tracks.find(t=>t.id===Number(choice?.track));const level=track?.levels.find(l=>l.level===Number(choice?.level));
  if(!level)throw new Error(`${label}: choose an upgrade track and level.`);
  return {track,level,label:`${track.name} ${level.level}/${level.max}`};
}

export function buildCandidates(profile,request,data,catalog,specId){
  const options=request||{};const wanted=options.slots===undefined?allSlots:options.slots;
  if(!Array.isArray(wanted)||!wanted.length||wanted.some(s=>!allSlots.includes(s)))throw new Error('Choose at least one equipment slot to search.');
  const finalists=Number(options.finalists??48);if(!limits.finalists.includes(finalists))throw new Error('Choose a supported final round size.');
  const pools=[];
  const ids=(list,valid,label)=>{if(list===undefined)return null;if(!Array.isArray(list)||!list.length)throw new Error(`${label}: select at least one.`);const set=new Set(list.map(Number));for(const id of set)if(!valid.has(id))throw new Error(`${label}: unknown selection ${id}.`);return set;};
  if(options.raid?.enabled){
    const difficulty=data.difficulties.find(d=>d.track===Number(options.raid.difficulty));if(!difficulty)throw new Error('Raid: choose a difficulty.');
    const track=data.tracks.find(t=>t.id===difficulty.track);const upgrade=Number(options.raid.upgrade??0);
    if(!Number.isInteger(upgrade)||upgrade<0||upgrade>track.levels.length)throw new Error('Raid: choose a supported upgrade level.');
    const groups=ids(options.raid.encounters,new Set(data.raids.flatMap(r=>r.encounters.map(e=>e.id))),'Raid bosses');
    pools.push({kinds:['raid'],groups,origin:'raid',drop:s=>raidDrop(track,s.sequence,upgrade),label:(s,d)=>`Raid · ${s.groupName} · ${difficulty.name} · ${d.label}`});
  }
  if(options.mplus?.enabled){const t=trackLevel(data,options.mplus,'Mythic+');const groups=ids(options.mplus.dungeons,new Set(data.dungeons.map(d=>d.id)),'Dungeons');pools.push({kinds:['mplus'],groups,bonus:t.level.bonusId,itemLevel:t.level.itemLevel,label:s=>`Mythic+ · ${s.groupName} · ${t.label}`,origin:'mplus'});}
  if(options.delves?.enabled){if(!data.delves)throw new Error('This season has no delve loot table.');const t=trackLevel(data,options.delves,'Delves');pools.push({kinds:['delves'],groups:null,bonus:t.level.bonusId,itemLevel:t.level.itemLevel,label:()=>`Delves · ${t.label}`,origin:'delves'});}
  if(options.vault?.enabled)for(const [row,kind,name] of [['raid','raid','Raid'],['mplus','mplus','Dungeons'],['delves','delves','World']]){
    const choice=options.vault[row];if(!choice?.enabled)continue;const t=trackLevel(data,choice,`Great Vault ${name}`);
    // Trash drops are not vault rewards.
    pools.push({kinds:[kind],groups:null,bossOnly:true,bonus:t.level.bonusId,itemLevel:t.level.itemLevel,label:s=>`Great Vault · ${name} · ${s.groupName} · ${t.label}`,origin:'vault'});
  }
  if(options.crafted?.enabled){
    if(!data.crafted)throw new Error('No crafted gear table is available.');
    const itemLevel=Number(options.crafted.itemLevel),stat=data.craftedStats.find(s=>s.bonusId===Number(options.crafted.stats));
    if(!Number.isInteger(itemLevel)||itemLevel<1||itemLevel>1000)throw new Error('Crafted item level must be between 1 and 1000.');
    if(!stat)throw new Error('Choose the two secondary stats for crafted gear.');
    // Every embellishment by default; an empty list means plain crafted gear only.
    const all=data.embellishments||[],wantedEmb=options.crafted.embellishments;
    if(wantedEmb!==undefined&&!Array.isArray(wantedEmb))throw new Error('Embellishments: send a list.');
    for(const id of wantedEmb||[])if(!all.some(e=>e.id===Number(id)))throw new Error(`Embellishments: unknown selection ${id}.`);
    const embellishments=wantedEmb===undefined?all:all.filter(e=>wantedEmb.map(Number).includes(e.id));
    pools.push({kinds:['crafted'],groups:null,crafted:{stat,itemLevel,embellishments},itemLevel,label:s=>`Crafted · ${s.groupName} · ${stat.name} · ${itemLevel}`,origin:'crafted'});
  }
  const equipped=equippedLimits(profile,data.itemLimits);const blocked=new Map();
  if(!pools.length)throw new Error('Select at least one gear source.');
  const candidates=new Map();
  for(const pool of pools)for(const {item,source} of data.entries){
    if(!pool.kinds.includes(source.kind)||pool.groups&&!pool.groups.has(source.group)||pool.bossOnly&&source.kind==='raid'&&source.group<0)continue;
    if(!eligible(item,profile.info,specId,data.weaponSpecs))continue;
    // A crafted piece is tried plain and with every chosen embellishment its crafting slots accept.
    const craftSlots=new Set((item.profession?.optionalCraftingSlots||[]).map(s=>s.id));
    const variants=pool.crafted?[null,...pool.crafted.embellishments.filter(e=>e.slots.some(id=>craftSlots.has(id)))]:[null];
    for(const slot of placements(item,profile,catalog))for(const emb of variants){
      if(!wanted.includes(slot))continue;
      const drop=pool.drop?.(source);
      // Drops keep their default bonus list: it carries effects such as Venomcursed and the jewelry socket.
      const bonuses=pool.crafted?[pool.crafted.stat.bonusId,...(emb?.bonusIds||[])]:[...(item.bonusLists||[]),drop?drop.bonusId:pool.bonus];
      const bonus=`bonus_id=${bonuses.join('/')}`+(pool.crafted?`,ilevel=${pool.crafted.itemLevel}`:'');
      const value=[`,id=${item.id}`,bonus,...carried(profile.gear[slot]?.value,item,bonuses,data.bonusSockets)].join(',');
      const key=`${slot}=${value}`;
      if(profile.gear[slot]?.value===value)continue;
      // Nothing that breaks an equip limit is offered: two embellishments at most, counting what stays equipped.
      const uses=itemLimitsOf(item.id,bonuses,data.itemLimits);
      if(uses.size){const over=overLimit(equipped,{[slot]:uses},clearedBy(item,slot,profile),data.itemLimits);if(over.length){blocked.set(`${item.id}|${emb?.id||0}`,over);continue;}}
      const label=pool.label(source,drop)+(emb?` · ${emb.name}`:'')+(source.token?` · ${source.token}`:'');
      const existing=candidates.get(key);
      if(existing){if(!existing.sources.some(s=>s.label===label))existing.sources.push({origin:pool.origin,group:`${pool.origin}:${source.group}`,groupName:source.groupName,label});continue;}
      candidates.set(key,{slot,itemId:item.id,name:item.name,itemLevel:drop?drop.itemLevel:pool.itemLevel,value,line:key,...(emb?{embellishment:emb.name}:{}),...(uses.size?{limits:[...uses]}:{}),sources:[{origin:pool.origin,group:`${pool.origin}:${source.group}`,groupName:source.groupName,label}]});
    }
  }
  const list=[...candidates.values()].sort((a,b)=>allSlots.indexOf(a.slot)-allSlots.indexOf(b.slot)||b.itemLevel-a.itemLevel||a.name.localeCompare(b.name));
  if(!list.length)throw new Error('No usable items were found in the selected sources for this character.');
  if(list.length>limits.candidates)throw new Error(`The selected sources produce ${list.length} candidates. Narrow the search to ${limits.candidates} or fewer.`);
  list.forEach((c,i)=>c.key='c'+String(i+1).padStart(3,'0'));
  // What already holds each limit, so a result can say why an embellished piece is missing.
  const holders=Object.entries(equipped).map(([slot,used])=>({slot,name:catalog.items.get(profile.gear[slot].id)?.name||`Item ${profile.gear[slot].id}`,limits:[...used]}));
  return {candidates:list,finalists,embellished:list.some(c=>c.limits),limitsUsed:holders,blocked:blocked.size};
}

// A two-hander in a single-wield main hand empties the off-hand.
const clearedBy=(item,slot,profile)=>slot==='main_hand'&&weaponKinds[item?.inventoryType]==='two'&&!hasTitansGrip(profile.info)&&profile.gear.off_hand?['off_hand']:[];

// A two-hander in a single-wield main hand must clear the equipped off-hand so SimC does not wield both.
export function candidateLines(candidate,profile,catalog){
  const lines=[candidate.line];
  if(clearedBy(catalog.items.get(candidate.itemId),candidate.slot,profile).length)lines.push('off_hand=');
  return lines;
}

// A pair is one profileset wearing both of its parts.
export function profilesetLines(candidates,profile,catalog){
  return candidates.flatMap(c=>(c.parts||[c]).flatMap(p=>candidateLines(p,profile,catalog)).map((line,i)=>`profileset."${c.key}"${i?'+=':'='}${line}`));
}

// Final round upgrades judged one at a time can each be worn, yet not all together: the embellishment limit binds
// only when two are chosen. So the best embellished upgrades are simulated again in every pair that can be worn at
// once, next to the gear that stays. Rings and trinkets pair across their two slots; one item never pairs with itself.
export function embellishmentPairs(candidates,rows,baseline,profile,data,catalog,{pick=6,tank}={}){
  const gain=r=>tank?.boss?r.score:r.dps-baseline.dps;
  const byKey=new Map(candidates.map(c=>[c.key,c]));
  const best=[],seen=new Set();
  for(const r of rows.filter(r=>byKey.get(r.key)?.limits&&Number.isFinite(gain(r))&&gain(r)>0).sort((a,b)=>gain(b)-gain(a))){
    const c=byKey.get(r.key),id=c.slot.replace(/[12]$/,'')+'|'+c.value;if(seen.has(id))continue;seen.add(id);best.push(c);if(best.length>=pick)break;
  }
  const equipped=equippedLimits(profile,data.itemLimits),pairs=[];
  for(let i=0;i<best.length;i++)for(let j=i+1;j<best.length;j++){
    const [a,b]=[best[i],best[j]];
    const twin={finger1:'finger2',finger2:'finger1',trinket1:'trinket2',trinket2:'trinket1'};
    let bSlot=b.slot;
    if(a.slot===b.slot){if(!twin[a.slot])continue;bSlot=twin[a.slot];}
    if(a.itemId===b.itemId)continue;
    const bPlaced=bSlot===b.slot?b:{...b,slot:bSlot,line:b.line.replace(/^[a-z_0-9]+=/,bSlot+'=')};
    const cleared=[a,bPlaced].flatMap(c=>clearedBy(catalog.items.get(c.itemId),c.slot,profile));
    if(cleared.includes(a.slot)||cleared.includes(bPlaced.slot))continue;
    if(overLimit(equipped,{[a.slot]:new Set(a.limits),[bPlaced.slot]:new Set(b.limits)},cleared,data.itemLimits).length)continue;
    pairs.push({key:'p'+String(pairs.length+1).padStart(3,'0'),parts:[a,bPlaced]});
  }
  return pairs;
}

export function screenSettings(settings){
  return {...settings,iterations:Math.min(settings.iterations,2000),targetError:Math.max(settings.targetError||0,0.5)};
}

// With `raid`, the run's metric is the whole raid's damage (a support specialization): the baseline is the raid's,
// and each row keeps the actor's own damage beside it.
export function profilesetResults(report,tank,{raid=false}={}){
  const base=raid?report.sim?.statistics?.raid_dps:report.sim?.players?.[0]?.collected_data?.dps;
  if(!Number.isFinite(base?.mean))throw new Error('The SimC report has no baseline DPS.');
  const z=1.959963984540054;
  const rows=(report.sim.profilesets?.results||[]).map(r=>({key:r.name,dps:r.mean,error95:Number.isFinite(r.mean_stddev)?z*r.mean_stddev:null,iterations:r.iterations??null,...(raid?{own:r.additional_metrics?.find(m=>m.metric==='Damage per Second')?.mean??null}:{}),...(tank?{tank:profilesetTank(r,report.sim.statistics?.simulation_length?.mean)}:{})}));
  // The actor report spells it mean_std_dev, profileset results spell it mean_stddev.
  const baseline={dps:base.mean,error95:Number.isFinite(base.mean_std_dev)?z*base.mean_std_dev:null,iterations:base.count??null,...(raid?{own:report.sim.players[0]?.collected_data?.dps?.mean??null}:{}),...(tank?{tank:actorTank(report)}:{})};
  if(tank?.boss)for(const row of rows)if(row.tank&&baseline.tank)Object.assign(row,tankComparison(row,baseline,tank.boss,tank.weight));
  return {baseline,rows};
}

// Final round: every candidate that could beat the baseline within screening noise, best few per slot.
// Rings and trinkets are screened in both slots, but only the better placement of an item is simulated again:
// the results show one placement per item anyway.
export function selectFinalists(candidates,screen,size,tank){
  const byKey=new Map(screen.rows.map(r=>[r.key,r]));const perGroup=new Map();
  const group=slot=>slot.replace(/[12]$/,'');
  // Tanks rank by the weighted DPS and survival score instead of DPS alone.
  const could=r=>tank?.boss?Number.isFinite(r.score)&&r.score+(r.scoreError||0)>=0:r.dps+Math.hypot(r.error95||0,screen.baseline.error95||0)>=screen.baseline.dps;
  const promising=candidates.map(c=>({c,r:byKey.get(c.key)})).filter(({r})=>r&&could(r)).sort((a,b)=>tank?.boss?b.r.score-a.r.score:b.r.dps-a.r.dps);
  const chosen=[],placed=new Set();
  for(const {c} of promising){
    const g=group(c.slot),item=`${g}|${c.value}`;if(placed.has(item))continue;
    const n=perGroup.get(g)||0;if(n>=Math.max(4,Math.ceil(size/8)))continue;
    placed.add(item);perGroup.set(g,n+1);chosen.push(c);if(chosen.length>=size)break;
  }
  return chosen;
}

// Screening and the final round per scenario, and the embellishment pairs when anything embellished is searched.
export const upgradeSteps=(upgrade,scenarios)=>(upgrade.embellished?3:2)*scenarios;
