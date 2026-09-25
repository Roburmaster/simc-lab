import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {home} from './paths.mjs';

// Armory imports: SimC downloads the character through its own Blizzard API access, and the result is rewritten
// into the addon export's shape so every mode reads it the same way. The first comment line marks it, so it is
// never sent to the WoW addon: the game already knows its own characters better than the Armory does.
export const armoryMarker='# SimC Lab Armory import';
export const isArmoryProfile=text=>typeof text==='string'&&text.split(/\r?\n/,8).some(l=>l.startsWith(armoryMarker));
export const regions=['eu','us','kr','tw'];

// A realm as Blizzard's API slugs it: "Argent Dawn" -> argent-dawn, "Mal'Ganis" -> malganis.
export const realmSlug=realm=>String(realm||'').trim().toLowerCase().replace(/['’]/g,'').replace(/[\s_]+/g,'-');

// Region, realm and name, typed or read from a worldofwarcraft.com, Raider.IO or Warcraft Logs character link.
export function armoryTarget(input){
  let {region,realm,name,url}=input||{};
  if(url){
    let u;try{u=new URL(String(url).trim());}catch{throw new Error('That is not a character link.');}
    const parts=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const at=parts.findIndex(p=>/^characters?$/.test(p));
    let rest=at<0?[]:parts.slice(at+1);
    // worldofwarcraft.com puts the region in the locale (en-gb) and leaves it out of the path.
    if(rest.length===2){const locale=parts[0]?.match(/^[a-z]{2}-([a-z]{2})$/)?.[1];rest=[{gb:'eu',us:'us',kr:'kr',tw:'tw'}[locale]||(locale&&['de','fr','es','it','ru','pt'].includes(locale)?'eu':''),...rest];}
    if(rest.length<3)throw new Error('Paste a character link from worldofwarcraft.com, Raider.IO or Warcraft Logs.');
    [region,realm,name]=rest;
  }
  region=String(region||'').trim().toLowerCase();realm=realmSlug(realm);name=String(name||'').trim().toLowerCase();
  if(!regions.includes(region))throw new Error('Choose a region: EU, US, KR or TW.');
  if(!/^[\p{L}\p{N}-]{2,48}$/u.test(realm))throw new Error('Enter the realm the character is on.');
  if(!/^\p{L}{2,12}$/u.test(name))throw new Error('Character names are 2–12 letters.');
  return {region,realm,name};
}

const entities={'&quot;':'"','&amp;':'&','&lt;':'<','&gt;':'>','&#39;':"'",'&apos;':"'"};
const unescape=s=>s.replace(/&(?:quot|amp|lt|gt|apos|#39);/g,m=>entities[m]);

// SimC's profile writer prints gems and enchants of an Armory import as stat strings and names, which lose
// special gem effects and cannot be matched to the catalog. The report's Wowhead links still carry their IDs.
export function itemLinks(html){
  const links=[];
  for(const m of html.matchAll(/wowhead\.com\/item=(\d+)\?([^"'\s<>]*)/g)){
    const q=new URLSearchParams(unescape(m[2]));
    links.push({id:Number(m[1]),bonus:(q.get('bonus')||'').split(':').filter(Boolean).map(Number).sort((a,b)=>a-b).join('/'),enchant:q.get('ench'),gems:q.get('gems'),crafted:q.get('crafted-stats')});
  }
  return links;
}

export function profileFromReport(html,{region,realm,wow,now=new Date()}={}){
  const block=html.match(/<div class="player-section profile">[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1];
  if(!block)throw new Error('SimC returned no character profile.');
  const lines=unescape(block.replace(/<br\s*\/?>/g,'\n')).split('\n').map(l=>l.trim());
  const links=itemLinks(html);const used=new Set();
  const head=[],gear=[];let actor=null,spec='';
  for(const line of lines){
    const m=line.match(/^([a-z_0-9]+)=(.*)$/);if(!m||line.startsWith('#'))continue;
    const [,key,value]=m;
    if(/^(?:deathknight|demonhunter|druid|evoker|hunter|mage|monk|paladin|priest|rogue|shaman|warlock|warrior)$/.test(key)){actor=line;continue;}
    if(key==='spec')spec=value;
    if(['level','race','role','spec','talents','professions'].includes(key)){head.push(line);continue;}
    if(!/^(?:head|neck|shoulders?|back|chest|wrists?|hands|waist|legs|feet|finger[12]|trinket[12]|main_hand|off_hand)$/.test(key))continue;
    const parts=value.split(',');const id=Number(parts.find(p=>p.startsWith('id='))?.slice(3));
    const bonus=(parts.find(p=>p.startsWith('bonus_id='))?.slice(9)||'').split('/').filter(Boolean).map(Number).sort((a,b)=>a-b).join('/');
    const at=links.findIndex((l,i)=>!used.has(i)&&l.id===id&&l.bonus===bonus);
    const link=at<0?null:links[at];if(at>=0)used.add(at);
    // The item name goes, as in the addon export. Stats stay: SimC takes them from the Armory because catalyzed
    // items carry nothing else that tells their source item.
    const kept=parts.slice(1).filter(p=>!/^(?:gems|enchant|crafted_stats)=/.test(p)||!link);
    if(link?.enchant)kept.push(`enchant_id=${link.enchant}`);
    if(link?.gems)kept.push(`gem_id=${link.gems.split(':').join('/')}`);
    if(link?.crafted)kept.push(`crafted_stats=${link.crafted.split(':').join('/')}`);
    gear.push(`${key}=,${kept.join(',')}`);
  }
  if(!actor||!gear.length)throw new Error('SimC returned no character profile.');
  const name=actor.match(/="?([^"]*)"?$/)?.[1]||'';
  const stamp=now.toISOString().slice(0,16).replace('T',' ');
  return [
    `# ${name} - ${spec.split('_').map(w=>w&&w[0].toUpperCase()+w.slice(1)).join(' ')||'unknown'} - ${stamp} - ${region.toUpperCase()}/${realm}`,
    `${armoryMarker} (worldofwarcraft.com), ${stamp} UTC`,
    '# The Armory updates when the character logs out. Bags, Great Vault and crests need the /simc addon export.',
    ...(wow?[`# WoW ${wow}`]:[]),
    '',actor,...head.filter(l=>!l.startsWith('spec=')&&!l.startsWith('talents=')),`region=${region}`,`server=${realm}`,
    ...head.filter(l=>l.startsWith('spec=')||l.startsWith('talents=')),'',...gear,''
  ].join('\n');
}

// Runs the engine once, a single short iteration, only to get the report that carries the profile and its IDs.
export async function importArmory(input,{executable,timeout=90000}={}){
  if(!executable)throw new Error('SimC is not installed yet. Use Update SimC.');
  const target=armoryTarget(input);
  const dir=path.join(home,'armory',randomUUID());await fs.mkdir(dir,{recursive:true});
  try{
    // An input file keeps names with accents intact; Windows command lines are not UTF-8.
    await fs.writeFile(path.join(dir,'armory.simc'),[`armory=${target.region},${target.realm},${target.name}`,'iterations=1','threads=1','max_time=5','html=armory.html',''].join('\n'),'utf8');
    const log=await new Promise((resolve,reject)=>{
      const child=spawn(executable,['armory.simc'],{cwd:dir,windowsHide:true,shell:false});let out='';
      const timer=setTimeout(()=>{child.kill();reject(new Error('The Armory did not answer in time. Try again.'));},timeout);
      for(const s of [child.stdout,child.stderr])s.on('data',d=>{out=(out+d).slice(-20000);});
      child.on('error',e=>{clearTimeout(timer);reject(e);});
      child.on('close',()=>{clearTimeout(timer);resolve(out);});
    });
    let html;try{html=await fs.readFile(path.join(dir,'armory.html'),'utf8');}
    catch{
      const reason=log.split(/\r?\n/).map(l=>l.trim()).filter(l=>/error|unable|not found|failed|could not/i.test(l)).pop();
      throw new Error(`The Armory import failed${reason?`: ${reason.slice(0,300)}`:'.'} Check the name, realm and region.`);
    }
    const wow=log.match(/World of Warcraft (\d+\.\d+\.\d+\.\d+)/)?.[1]||null;
    const profile=profileFromReport(html,{...target,wow});
    return {...target,character:profile.match(/^[a-z]+="([^"]*)"$/m)?.[1]||target.name,profile};
  }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
