import {slots as allSlots} from './profile.mjs';
import {fitsSlot} from './equipment.mjs';
import {placements,carried} from './upgrades.mjs';
import {trackOf} from './crests.mjs';

// Great Vault: the choices the official SimulationCraft addon exports, each simulated in its slot against the
// equipped gear, as Raidbots does. The addon writes them only while the vault has rewards to claim:
//   ### Weekly Reward Choices
//   #
//   # Loa Worshiper's Band (272)
//   # finger1=,id=251513,bonus_id=12806/6652
//   #
//   ### End of Weekly Reward Choices
export function readVaultChoices(text){
  const choices=[];let inside=false,label=null;
  for(const raw of String(text||'').split(/\r?\n/)){
    const line=raw.trim();
    if(/^###\s*Weekly Reward Choices/i.test(line)){inside=true;label=null;continue;}
    if(!inside)continue;
    if(/^###/.test(line))break;
    const comment=line.match(/^#\s*(.*)$/)?.[1];if(comment===undefined)continue;
    const gear=comment.match(/^([a-z_][a-z0-9_]*)=(,?id=\d+[^\s]*)$/);
    if(gear){
      const slot=({shoulders:'shoulder',wrists:'wrist'}[gear[1]]||gear[1]);
      if(allSlots.includes(slot)&&!choices.some(c=>c.slot===slot&&c.value===gear[2])){
        const named=label?.match(/^(.*?)\s*\((\d+)\)$/);
        choices.push({slot,value:gear[2].startsWith(',')?gear[2]:','+gear[2],itemId:Number(gear[2].match(/id=(\d+)/)[1]),name:named?named[1]:label||null,itemLevel:named?Number(named[2]):null});
      }
      label=null;
    }else if(comment)label=comment;
  }
  return choices.slice(0,9);
}

const bonusesOf=value=>(String(value).match(/(?:^|,)bonus_id=([^,]+)/)?.[1]||'').split('/').map(Number).filter(Boolean);
const withBonus=(value,from,to)=>value.replace(/((?:^|,)bonus_id=)([^,]+)/,(m,key,ids)=>key+ids.split('/').map(id=>Number(id)===from?to:id).join('/'));

// The slots a choice can go in. Rings and trinkets go in either slot, and only the better one is shown. A weapon of
// another kind than the one wielded (a two-hander for a sword and board) still goes in the main hand: taking it
// changes the weapon setup, and a two-hander clears the off-hand when the profileset is written.
function slotsFor(item,choice,profile,catalog){
  if(!item)return [choice.slot];
  const legal=placements(item,profile,catalog);
  if(legal.length)return legal;
  if(fitsSlot(item,'main_hand',profile.info))return ['main_hand'];
  return [];
}

export function buildVaultCandidates(profile,text,request,season,catalog){
  const options=request||{};
  const choices=readVaultChoices(text);
  if(!choices.length)throw new Error('The import has no Great Vault choices. The SimulationCraft addon exports them only while the vault has rewards to claim: open the Great Vault in the game after the weekly reset, then type /simc and import again.');
  const known=new Map((season?.entries||[]).map(e=>[e.item.id,e.item]));
  const list=[],items=[],skipped=[];
  for(const choice of choices){
    const item=known.get(choice.itemId)||catalog.items.get(choice.itemId)||null;
    const name=choice.name||item?.name||`Item ${choice.itemId}`;
    const at=season?.tracks?trackOf(choice.value,season.tracks):null;
    const itemLevel=choice.itemLevel??at?.level.itemLevel??null;
    const top=options.upgraded&&at&&at.level.level<at.level.max?at.track.levels.at(-1):null;
    const where=slotsFor(item,choice,profile,catalog);
    if(!where.length){skipped.push({itemId:choice.itemId,name,reason:'It cannot be worn with the weapons you have equipped.'});continue;}
    items.push({itemId:choice.itemId,name,slot:choice.slot,itemLevel,track:at?{name:at.track.name,level:at.level.level,max:at.level.max}:null,slots:where});
    for(const level of [null,top].filter((l,i)=>i===0||l)){
      const own=level?withBonus(choice.value,at.level.bonusId,level.bonusId):choice.value;
      // The vault piece arrives bare; the enchant and the gems of what it replaces carry over, as in Upgrade Finder.
      const bare=own.split(',').filter(p=>!/^(?:enchant_id|enchant|gem_id)=/.test(p)).join(',');
      for(const slot of where){
        const value=[bare,...carried(profile.gear[slot]?.value,item||{},bonusesOf(bare),season?.bonusSockets)].join(',');
        list.push({slot,itemId:choice.itemId,name,itemLevel:level?level.itemLevel:itemLevel,upgraded:!!level,...(level?{track:{name:at.track.name,level:level.level,max:level.max}}:at?{track:{name:at.track.name,level:at.level.level,max:at.level.max}}:{}),choice:items.length-1,value,line:`${slot}=${value}`});
      }
    }
  }
  if(!list.length)throw new Error('None of the Great Vault choices can be worn by this character.');
  list.forEach((c,i)=>c.key='v'+String(i+1).padStart(3,'0'));
  return {candidates:list,items,skipped,upgraded:!!options.upgraded};
}
