import fs from 'node:fs/promises';
import path from 'node:path';
import {upstreamDir} from './paths.mjs';
export async function restrictExpansion(catalog,source){
  const directory=upstreamDir;
  const read=async name=>JSON.parse(await fs.readFile(path.join(directory,name+'.json'),'utf8'));
  const metadata=await read('metadata');const buildInfo=await fs.readFile(path.join(source,'SpellDataDump/build_info.txt'),'utf8');
  if(!buildInfo.includes(`World of Warcraft ${metadata.wowBuild} Live`))throw new Error('Catalog data and SimC live build do not match. Run the data refresh script.');
  const expansion=Number(metadata.wowBuild.split('.')[0])-1;
  if(expansion!==11)throw new Error('Review expansion and talent rules before enabling a new expansion.');
  const [items,enchants,gems,...consumableLists]=await Promise.all(['equippable-items','enchantments','gems','flasks','potions','foods','temp-enchants','augments'].map(read));
  const byId=new Map(items.map(i=>[i.id,i]));const enchantById=new Map(enchants.map(e=>[e.id,e]));
  for(const item of catalog.items.values())item.expansion=byId.get(item.id)?.expansion ?? null;
  catalog.expansion={id:expansion,name:'Midnight',wowBuild:metadata.wowBuild,generatedAt:metadata.generatedAt,source:'https://www.raidbots.com/developers',contentHash:metadata.contentHash};
  catalog.enchants=catalog.enchants.filter(e=>enchantById.get(e.id)?.expansion===expansion);
  for(const enchant of catalog.enchants)enchant.itemId=enchantById.get(enchant.id)?.itemId;
  const allowed=new Set(catalog.enchants.map(e=>e.id));const original=catalog.forItem;
  catalog.forItem=(id,playerClass)=>original(id,playerClass).filter(e=>allowed.has(e.id));
  catalog.gems=gems.filter(g=>enchantById.get(g.enchantId)?.expansion===expansion&&catalog.items.has(g.id)).map(g=>({...g,expansion,rank:enchantById.get(g.enchantId).craftingQuality||0}));
  catalog.currentItems=items.filter(i=>i.expansion===expansion&&!i.cosmetic&&catalog.items.has(i.id)&&(i.itemClass===2||i.itemClass===4));
  catalog.consumables=Object.fromEntries(['flask','potion','food','temporary_enchant','augmentation'].map((key,i)=>[key,consumableLists[i].filter(v=>v.expansion===expansion)]));
  catalog.assertCurrent=(id,kind='item')=>{if(kind==='gem'?!catalog.gems.some(g=>g.id===id):byId.get(id)?.expansion!==expansion)throw new Error(`${kind} ${id} is not a verified Midnight choice.`);};
  catalog.validateChanges=(profile,patch)=>{
    for(const [slot,item] of Object.entries(patch.gear)){
      const original=profile.gear[slot];if(item.value==='none')continue;
      const core=s=>(s||'').split(',').filter(v=>!/^enchant(?:_id)?=|^gem_id=/.test(v)).join(',');
      if(!original||core(original.value)!==core(item.value))catalog.assertCurrent(item.id);
      const previous=Object.fromEntries((original?.value||'').split(',').map(p=>p.split('=')));
      const values=Object.fromEntries(item.value.split(',').map(p=>p.split('=')));
      for(const key of ['enchant','enchant_id'])if(values[key]&&values[key]!==previous[key]&&!['0','none'].includes(values[key])){
        const compatible=catalog.forItem(item.id,profile.info.class);
        const valid=key==='enchant_id'?compatible.some(e=>e.id===Number(values[key])):compatible.some(e=>[e.token+(e.rank?'_'+e.rank:''),e.token.replace(/^enchant_[a-z]+__/, '')+(e.rank?'_'+e.rank:'')].includes(values[key]));
        if(!valid)throw new Error(`The enchant selected for ${slot} is not a compatible Midnight enchant.`);
      }
      if(values.gem_id!==previous.gem_id){const old=(previous.gem_id||'').split('/');for(const [index,g] of (values.gem_id||'').split('/').entries())if(Number(g)&&g!==old[index])catalog.assertCurrent(Number(g),'gem');}
      if(values.gems&&values.gems!==previous.gems)throw new Error('Use verified Midnight gem IDs rather than manual gem stats.');
    }
    for(const line of patch.text.split('\n')){
      const index=line.indexOf('='),key=line.slice(0,index),value=line.slice(index+1);
      if(!catalog.consumables[key]||['none','0','disabled'].includes(value))continue;
      const values=key==='temporary_enchant'?value.split('/').map(v=>v.split(':').at(-1)):[value];
      for(const v of values)if(!catalog.consumables[key].some(c=>[c.value,c.value+'_augment_rune'].includes(v)))throw new Error(`${key}: select a verified Midnight consumable.`);
    }
  };
  return catalog;
}
