import {slots as allSlots} from './profile.mjs';

// Crest Planner: every equipped item on a season upgrade track is simulated at each higher level of that track,
// and the cost of getting there is counted in the track's own crests.
export const limits={candidates:120};

// Enum.ItemRedundancySlot, the slots the game keeps an upgrade high watermark for.
const redundancy={head:0,neck:1,shoulder:2,chest:3,waist:4,legs:5,feet:6,wrist:7,hands:8,finger1:9,finger2:9,trinket1:10,trinket2:10,back:11};
export function redundancySlot(slot,item){
  if(slot in redundancy)return redundancy[slot];
  const type=item?.inventoryType;
  if([17,15,26].includes(type))return 12;
  if(slot==='main_hand')return type===21?13:14;
  if(slot==='off_hand')return [13,22].includes(type)?15:16;
  return null;
}

// The official SimulationCraft addon writes these as comments:
//   # upgrade_currencies=c:3445:120/i:274476:2
//   # slot_high_watermarks=0:311:321/9:308:318   (slot:character:account)
//   # upgrade_achievements=62410/62411
export function readUpgradeState(text){
  const line=key=>String(text||'').match(new RegExp(`^\\s*#\\s*${key}=([^\\r\\n]*)$`,'m'))?.[1]?.trim();
  const currencies=line('upgrade_currencies'),watermarks=line('slot_high_watermarks'),achievements=line('upgrade_achievements');
  const owned={};
  for(const part of (currencies||'').split('/')){const m=part.match(/^c:(\d+):(\d+)$/);if(m)owned[m[1]]=Number(m[2]);}
  const marks={};
  for(const part of (watermarks||'').split('/')){const m=part.match(/^(\d+):(\d+):(\d+)$/);if(m)marks[m[1]]={character:Number(m[2]),account:Number(m[3])};}
  return {exported:currencies!==undefined,owned:currencies!==undefined?owned:null,watermarks:watermarks!==undefined?marks:null,achievements:(achievements||'').split('/').map(Number).filter(Boolean)};
}

export function trackOf(value,tracks){
  const bonuses=(String(value).match(/(?:^|,)bonus_id=([^,]+)/)?.[1]||'').split('/').map(Number);
  for(const track of tracks)for(const level of track.levels)if(bonuses.includes(level.bonusId))return {track,level};
  return null;
}

// One step costs its level's crests, unless the slot has already held that item level: the game then waives the
// crests by the level's discount scaling. The account watermark counts only with the crest's warband achievement.
export function stepCost(level,watermark,state,warband){
  if(!level.cost)return {currencyId:null,amount:0,full:0};
  const {currencyId,amount}=level.cost;
  const discount=level.discounts?.find(d=>d.currencyId===currencyId);
  const account=discount&&(discount.accountWide||state.achievements.includes(warband?.[currencyId]));
  const mark=watermark?Math.max(watermark.character||0,account?watermark.account||0:0):0;
  const paid=discount&&mark>=level.itemLevel?Math.round(amount*discount.scaling):amount;
  return {currencyId,amount:paid,full:amount};
}

export function buildCrestCandidates(profile,text,request,season,catalog){
  const options=request||{};const wanted=options.slots===undefined?allSlots:options.slots;
  if(!Array.isArray(wanted)||!wanted.length||wanted.some(s=>!allSlots.includes(s)))throw new Error('Choose at least one equipment slot.');
  const levels=options.levels||'all';if(!['all','max'].includes(levels))throw new Error('Choose which upgrade levels to simulate.');
  const state=readUpgradeState(text);const list=[],items=[];
  // What may be spent: the typed crests, else the export's. With a known budget, only upgrades it pays for are
  // simulated, so the run and the spending order stay within what the character can afford.
  const budget=normalizeBudget(options.budget,season)||state.owned;const affordable=options.affordable!==false&&!!budget;
  const pays=(amount,currencyId)=>!affordable||!amount||(budget[currencyId]??0)>=amount;let cheapest=null;
  for(const slot of allSlots){
    const equipped=profile.gear[slot];if(!equipped?.id||!wanted.includes(slot))continue;
    // An item level override hides the real upgrade level, and the fixed stats of an Armory import would not grow
    // with it, so such an item cannot be upgraded here.
    if(/(?:^|,)(?:ilevel|stats)=/.test(equipped.value))continue;
    const at=trackOf(equipped.value,season.tracks);if(!at)continue;
    const item=catalog.items.get(equipped.id);const name=item?.name||`Item ${equipped.id}`;
    const {track,level:from}=at;const mark=state.watermarks?.[redundancySlot(slot,item)]||null;
    let crests=0,full=0,currencyId=null,reach=from,open=true;const steps=[];
    for(const to of track.levels.filter(l=>l.level>from.level)){
      const cost=stepCost(to,mark,state,season.crests?.warband);crests+=cost.amount;full+=cost.full;currencyId??=cost.currencyId;
      if(open&&pays(crests,currencyId)){reach=to;steps.push({to,crests,full});}
      else if(open){open=false;if(!cheapest||crests<cheapest.crests)cheapest={crests,currencyId};}
    }
    // "Fully upgraded only" becomes the highest level the crests reach.
    for(const {to,crests,full} of steps){
      if(levels==='max'&&to!==reach)continue;
      const value=equipped.value.replace(/((?:^|,)bonus_id=)([^,]+)/,(m,key,ids)=>key+ids.split('/').map(id=>Number(id)===from.bonusId?to.bonusId:id).join('/'));
      list.push({slot,itemId:equipped.id,name,track:{id:track.id,name:track.name},from:from.level,to:to.level,max:to.max,fromItemLevel:from.itemLevel,itemLevel:to.itemLevel,currencyId,crests,fullCrests:full,value,line:`${slot}=${value}`});
    }
    items.push({slot,itemId:equipped.id,name,track:track.name,level:from.level,max:from.max,itemLevel:from.itemLevel,crests,fullCrests:full,currencyId,reach:reach.level});
  }
  if(!items.length&&Object.values(profile.gear).some(g=>/(?:^|,)stats=/.test(g.value)))throw new Error('Crest Planner needs the /simc addon export. An Armory import fixes each item’s stats, so an upgrade would not change them.');
  if(!items.length)throw new Error('None of the equipped items is on one of this season’s upgrade tracks.');
  if(!list.length&&cheapest)throw new Error(`Nothing is affordable with these crests. The cheapest upgrade needs ${cheapest.crests} ${season.crests?.currencies.find(c=>c.id===cheapest.currencyId)?.name||'crests'}.`);
  if(!list.length)throw new Error('Every equipped item on an upgrade track is already fully upgraded.');
  if(list.length>limits.candidates)throw new Error(`${list.length} upgrades to simulate. Choose fewer slots or only fully upgraded items (at most ${limits.candidates}).`);
  list.forEach((c,i)=>c.key='u'+String(i+1).padStart(3,'0'));
  return {candidates:list,items,levels,affordable,state:{exported:state.exported,watermarks:!!state.watermarks},budget:budget||null,currencies:season.crests?.currencies||[]};
}

export function normalizeBudget(budget,season){
  if(budget===undefined||budget===null)return null;
  if(typeof budget!=='object')throw new Error('Crests to spend: enter whole numbers.');
  const known=new Set((season.crests?.currencies||[]).map(c=>String(c.id)));const result={};
  for(const [id,value] of Object.entries(budget)){
    if(value===''||value===null)continue;
    const n=Number(value);if(!known.has(String(id)))throw new Error(`Unknown crest ${id}.`);
    if(!Number.isInteger(n)||n<0||n>100000)throw new Error('Crests to spend: enter whole numbers from 0.');
    result[id]=n;
  }
  return Object.keys(result).length?result:null;
}
