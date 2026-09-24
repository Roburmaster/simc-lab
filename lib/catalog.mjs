import {restrictExpansion} from './expansion.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function loadCatalog(source) {
  const dbc = path.join(source,'engine/dbc/generated');
  const [enchantsText,itemsText] = await Promise.all([fs.readFile(path.join(dbc,'permanent_enchant.inc'),'utf8'),fs.readFile(path.join(dbc,'item_data.inc'),'utf8')]);
  const enchants = [...enchantsText.matchAll(/\{\s*(\d+),\s*(\d+),\s*(\d+),\s*(0x[0-9a-f]+),\s*(0x[0-9a-f]+),\s*"([^"]+)"/g)].map(m=>({id:+m[1],rank:+m[2],itemClass:+m[3],inventoryMask:Number(m[4]),subclassMask:Number(m[5]),token:m[6],label:m[6].replace(/^enchant_[a-z]+__/,'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())+(+m[2] ? ` · Rank ${m[2]}` : '')}));
  const items = new Map();
  for (const line of itemsText.split(/\r?\n/)) {
    const match = line.match(/^\s*\{\s*"((?:[^"\\]|\\.)*)",\s*(\d+),(.+)$/);
    if (!match) continue;
    const fields = match[3].split(',').slice(0,11).map(v=>Number(v.trim()));
    items.set(+match[2],{id:+match[2],name:match[1].replace(/\\"/g,'"'),ilevel:fields[3],inventoryType:fields[8],itemClass:fields[9],subclass:fields[10]});
  }
  if (!items.size || !enchants.length) throw new Error('Could not read SimC item data.');
  // Item sets as SimC defines them: one row per class and bonus threshold, with the items that count toward it.
  // An engine installed before this file was carried simply knows no sets, which is what the app did before.
  const setsText = await fs.readFile(path.join(dbc,'item_set_bonus.inc'),'utf8').catch(()=>'');
  const setBonuses = parseSetBonuses(setsText);
  const catalog = {items,enchants,setBonuses,forItem(id,playerClass) {
    const item=items.get(id); if (!item) return [];
    return enchants.filter(e=> e.itemClass===item.itemClass && (!e.inventoryMask || (e.inventoryMask & (1 << item.inventoryType))) && (!e.subclassMask || (e.subclassMask & (1 << item.subclass))) && (!e.token.startsWith('rune_of_') || playerClass==='deathknight'));
  }};
  return restrictExpansion(catalog,source);
}

// { "Bite of Zul'jan", "bite_of_zuljan", "MID_BOZ", 28, 2070, 2, 1, -1, -1, 1291726, { 270173, 268209, 268213, 0 } }
// name, option name, tier, enum, set id, pieces, class, spec, trait tree, spell, items
export function parseSetBonuses(text){
  const out=[];
  for(const line of String(text).split(/\r?\n/)){
    const match=line.match(/^\s*\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,([^{]+)\{([^}]*)\}/);
    if(!match)continue;
    const [,setId,pieces,classId,specId,,spellId]=match[2].split(',').map(v=>Number(v.trim()));
    const items=match[3].split(',').map(v=>Number(v.trim())).filter(Boolean);
    if(items.length&&pieces>0)out.push({name:match[1].replace(/\\"/g,'"'),setId,pieces,classId,specId,spellId,items});
  }
  return out;
}
