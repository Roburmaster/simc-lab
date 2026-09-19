// Turns finished jobs into the data the SimCLab WoW addon reads, and builds Data.lua from every sim sent so far.
// The addon validates schemaVersion before it trusts anything, so any change to the shape below must raise it.
import {parseProfile,slots} from './profile.mjs';
import {toLua} from './lua.mjs';

export const schemaVersion=1;
export const sendableModes={upgrades:'Upgrade Finder',talents:'Talent Search',compare:'Gear Compare'};
export const limits={keep:[1,10],defaultKeep:5,itemResults:60,otherResults:20,characters:50,text:200,talents:600,bytes:1536*1024};
const classIds={warrior:1,paladin:2,hunter:3,rogue:4,priest:5,deathknight:6,shaman:7,mage:8,warlock:9,monk:10,druid:11,demonhunter:12,evoker:13};
const vaultRows={Raid:'Raid',Dungeons:'Dungeons',World:'World'};

// Character keys must come out the same in JavaScript and in the addon's Lua: ASCII letters lowercased, ASCII
// digits and letters kept, every non-ASCII character kept as is, everything else (spaces, apostrophes,
// underscores, hyphens) dropped. "Twilight's Hammer", "twilights_hammer" and "TwilightsHammer" all agree.
export function normalizeKey(text){
  let out='';
  for(const ch of String(text??''))if(/[A-Z]/.test(ch))out+=ch.toLowerCase();else if(/[a-z0-9]/.test(ch)||ch.codePointAt(0)>=128)out+=ch;
  return out;
}
export const characterKey=(name,realm)=>`${normalizeKey(name)}-${normalizeKey(realm)}`;

const cut=(text,max=limits.text)=>text===undefined||text===null?undefined:String(text).slice(0,max);
const unix=iso=>{const t=Date.parse(iso);return Number.isFinite(t)?Math.floor(t/1000):undefined;};
const round=(n,digits=2)=>Number.isFinite(n)?Number(n.toFixed(digits)):undefined;
const ids=text=>(text||'').split('/').map(Number).filter(n=>Number.isInteger(n)&&n>0);

// One gear line from a SimC profile: the parts the addon compares against what is equipped.
export function itemFromValue(value){
  if(typeof value!=='string'||value==='none')return null;
  const field=name=>value.match(new RegExp(`(?:^|,)${name}=([^,]*)`))?.[1];
  const itemId=Number(field('id'));if(!Number.isInteger(itemId)||itemId<=0)return null;
  const item={itemId,bonusIds:ids(field('bonus_id'))};
  const enchant=Number(field('enchant_id'));if(enchant>0)item.enchant=enchant;
  const gems=ids(field('gem_id'));if(gems.length)item.gems=gems;
  const ilevel=Number(field('ilevel'));if(ilevel>0)item.itemLevel=ilevel;
  return item;
}

export function identity(profileText,talentData){
  const profile=parseProfile(profileText);
  const realm=profileText.match(/^server=(.+)$/m)?.[1]?.trim();
  if(!realm)throw new Error('The profile has no realm (server=). Send results from a character imported with /simc.');
  const region=profileText.match(/^region=(.+)$/m)?.[1]?.trim();
  let specId;try{specId=talentData?.find(profile.info)?.specId;}catch{}
  if(!Number.isInteger(specId))throw new Error(`Unknown specialization: ${profile.info.spec} ${profile.info.class}.`);
  const gear={};for(const [slot,g] of Object.entries(profile.gear)){const item=itemFromValue(g.value);if(item)gear[slot]=item;}
  return {profile,key:characterKey(profile.info.name,realm),name:cut(profile.info.name,64),realm:cut(realm,64),region:cut(region,8),class:profile.info.class,classId:classIds[profile.info.class],spec:profile.info.spec,specId,gear};
}

// Upgrade tracks by bonus ID, so the addon can read "Myth 1/6" off any item link. Final raid drops sit
// outside the ladder and carry only their item level.
export function trackTable(season){
  const table={};
  for(const t of season?.tracks||[]){
    for(const l of t.levels)table[l.bonusId]={name:cut(t.name,32),level:l.level,max:l.max,itemLevel:l.itemLevel};
    if(t.finalDrop)table[t.finalDrop.bonusId]={name:cut(t.name,32),final:true,itemLevel:t.finalDrop.itemLevel};
  }
  return table;
}

// Candidate sources carry the app's own grouping ("raid:2895"); the addon wants journal IDs.
function sourceOf(src,season,request){
  const [origin,rawGroup]=String(src.group||'').split(':');const group=Number(rawGroup);
  const kind=src.origin||origin;
  const out={kind,name:cut(src.groupName,80),label:cut(src.label)};
  const raid=season?.raids?.find(r=>r.encounters.some(e=>e.id===group));
  const dungeon=season?.dungeons?.find(d=>d.id===group);
  if(kind==='raid'||kind==='vault'&&raid){
    if(raid){out.instanceId=raid.id;out.instance=cut(raid.name,80);}
    if(group>0)out.encounterId=group;
    if(kind==='raid'){const d=season?.difficulties?.find(d=>d.track===Number(request?.upgrades?.raid?.difficulty));if(d)out.difficulty=d.name;}
  }
  if((kind==='mplus'||kind==='vault')&&dungeon)out.instanceId=dungeon.id;
  if(kind==='vault')out.row=vaultRows[String(src.label||'').split(' · ')[1]]||undefined;
  return out;
}

function upgradeScenario(job,s,season,request,tracks){
  const candidates=new Map((job.upgrade?.candidates||[]).map(c=>[c.key,c]));
  const stages=(job.stages||[]).filter(r=>r.scenario===s);
  const baselines={};for(const st of stages)if(st.baseline)baselines[st.stage]=st.baseline;
  const best=new Map();
  for(const row of job.results.filter(r=>r.scenario===s&&r.status==='complete')){
    const c=candidates.get(row.key),base=baselines[row.stage];if(!c||!base||!Number.isFinite(row.dps))continue;
    const tank=Number.isFinite(row.score);
    const gain=tank&&Number.isFinite(row.dpsGain)?row.dpsGain:100*(row.dps-base.dps)/Math.max(1,base.dps);
    const error=row.error95!==null&&base.error95!==null&&Number.isFinite(row.error95)&&Number.isFinite(base.error95)?100*Math.hypot(row.error95,base.error95)/Math.max(1,base.dps):undefined;
    const rank=tank?row.score:gain;
    // Rings and trinkets are simulated in both slots; keep one placement per item, preferring the final round.
    const id=c.slot.replace(/[12]$/,'')+'|'+c.value;const previous=best.get(id);
    if(previous&&(previous.stage>row.stage||previous.stage===row.stage&&previous.rank>=rank))continue;
    best.set(id,{stage:row.stage,rank,row,c,gain,error,tank});
  }
  const rows=[...best.values()].filter(e=>e.stage===2||e.rank>0).sort((a,b)=>b.rank-a.rank).slice(0,limits.itemResults);
  const base=baselines[2]||baselines[1];
  return {
    metric:rows.some(e=>e.tank)?'score':'dps',
    baseline:base?{dps:round(base.dps,0),error:round(base.error95,0)}:undefined,
    results:rows.map(({stage,row,c,gain,error,tank})=>{
      const item=itemFromValue(c.value)||{itemId:c.itemId,bonusIds:[]};
      const track=item.bonusIds.find(id=>tracks[id]);
      return {itemId:c.itemId,name:cut(c.name,120),slot:c.slot,itemLevel:c.itemLevel,bonusIds:item.bonusIds,track,
        gain:round(gain,3),score:tank?round(row.score,3):undefined,scoreError:tank?round(row.scoreError,3):undefined,survival:tank?round(row.survival,3):undefined,
        error:round(error,3),dps:round(row.dps,0),screening:stage===1||undefined,
        sources:(c.sources||[]).slice(0,6).map(src=>sourceOf(src,season,request))};
    })
  };
}

// Talent Search and Gear Compare push one row per variant per scenario, in variant order.
function variantScenario(job,s,request){
  const rows=job.results.filter(r=>r.scenario===s);
  const base=rows.find(r=>r.baseline&&r.status==='complete');
  const texts=job.mode==='compare'?[null,...(request?.variants||[]).map(v=>v.text)]:[];
  const tank=!!job.settings?.tank;
  const results=rows.map((row,v)=>({row,text:texts[v]})).filter(({row})=>!row.baseline&&row.status==='complete'&&Number.isFinite(row.dps)).map(({row,text})=>{
    const gain=base?100*(row.dps-base.dps)/Math.max(1,base.dps):undefined;
    const error=base&&Number.isFinite(row.error95)&&Number.isFinite(base.error95)?100*Math.hypot(row.error95,base.error95)/Math.max(1,base.dps):undefined;
    const out={name:cut(row.name,120),gain:round(gain,3),score:tank?round(row.score,3):undefined,error:round(error,3),dps:round(row.dps,0),talents:job.mode==='talents'?cut(row.talents,limits.talents):undefined};
    if(text){
      // A variant that swaps exactly one item doubles as an item result, so the tooltip finds bag items too.
      const items=String(text).split(/\r?\n/).map(l=>l.trim().match(/^([a-z_0-9]+)=(.*)$/)).filter(m=>m&&slots.includes(m[1])).map(m=>({slot:m[1],...itemFromValue(m[2])})).filter(i=>i.itemId).slice(0,16);
      if(items.length)out.items=items;
      if(items.length===1)Object.assign(out,{itemId:items[0].itemId,bonusIds:items[0].bonusIds,slot:items[0].slot,itemLevel:items[0].itemLevel});
    }
    return out;
  }).sort((a,b)=>(tank?(b.score??-Infinity)-(a.score??-Infinity):(b.gain??-Infinity)-(a.gain??-Infinity))).slice(0,limits.otherResults);
  return {metric:tank?'score':'dps',baseline:base?{dps:round(base.dps,0),error:round(base.error95,0)}:undefined,results};
}

export function simEntry(job,request,{season,tracks}){
  if(!sendableModes[job.mode])throw new Error('Only Upgrade Finder, Talent Search and Gear Compare results can be sent to WoW.');
  if(!['complete','partial'].includes(job.status))throw new Error('Only finished jobs can be sent to WoW.');
  const scenarios=job.scenarios.slice(0,8).map((sc,s)=>({style:cut(sc.style,40),targets:sc.targets,...(job.mode==='upgrades'?upgradeScenario(job,s,season,request,tracks):variantScenario(job,s,request))}));
  if(!scenarios.some(sc=>sc.baseline))throw new Error('The job has no completed baseline to send.');
  const tank=job.settings?.tank;
  return {
    id:job.id,mode:job.mode,title:sendableModes[job.mode],created:unix(job.created),finished:unix(job.finished),
    simc:cut(job.engine?.version,40),wow:cut(job.engine?.wowVersion,40),
    settings:{iterations:job.settings?.iterations,targetError:job.settings?.targetError,duration:job.settings?.duration,season:cut(job.upgrade?.season?.name,80),tank:tank?{preset:cut(tank.preset,20),weight:tank.weight}:undefined},
    scenarios
  };
}

// The store is the source of truth: every sim sent, per character and specialization, newest first.
export function addSim(store,who,entry,keep=limits.defaultKeep){
  store.characters||={};
  const character=store.characters[who.key]||={specs:{}};
  Object.assign(character,{name:who.name,realm:who.realm,region:who.region,class:who.class,classId:who.classId,updated:Math.floor(Date.now()/1000)});
  const spec=character.specs[who.specId]||={spec:who.spec,sims:[]};
  spec.spec=who.spec;
  spec.sims=[{...entry,gear:who.gear},...spec.sims.filter(s=>s.id!==entry.id)].sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,keep);
  return store;
}

export function removeSim(store,id){
  for(const [key,character] of Object.entries(store.characters||{})){
    for(const [specId,spec] of Object.entries(character.specs)){spec.sims=spec.sims.filter(s=>s.id!==id);if(!spec.sims.length)delete character.specs[specId];}
    if(!Object.keys(character.specs).length)delete store.characters[key];
  }
  return store;
}

const header=when=>`-- SimC Lab data for the SimCLab addon, generated ${when}.\n-- SimC Lab rewrites this file whenever results are sent to WoW; edits here are lost.\n`;

// Data.lua for every character in the store. When the file would exceed the size limit, the oldest sims go
// first, so what the addon loads stays bounded however long the app is used.
export function dataFile(store,{tracks={},app='',now=new Date(),keep=limits.defaultKeep,maxBytes=limits.bytes}={}){
  const characters=structuredClone(store.characters||{});
  for(const c of Object.values(characters))for(const spec of Object.values(c.specs))spec.sims=spec.sims.slice(0,keep);
  const ranked=Object.entries(characters).sort((a,b)=>(b[1].updated||0)-(a[1].updated||0));
  for(const [key] of ranked.slice(limits.characters))delete characters[key];
  const render=()=>{
    const data={schemaVersion,generated:Math.floor(now.getTime()/1000),app:cut(app,40),tracks,characters:{}};
    for(const [key,c] of Object.entries(characters)){
      const specs={};for(const [id,spec] of Object.entries(c.specs))if(spec.sims.length)specs[id]={spec:spec.spec,sims:spec.sims};
      if(Object.keys(specs).length)data.characters[key]={name:c.name,realm:c.realm,region:c.region,class:c.class,classId:c.classId,specs};
    }
    return `${header(now.toISOString())}local _, ns = ...\nns.data = ${toLua(data)}\n`;
  };
  let text=render();let dropped=0;
  while(Buffer.byteLength(text,'utf8')>maxBytes){
    let oldest=null;
    for(const c of Object.values(characters))for(const spec of Object.values(c.specs))for(const sim of spec.sims)if(!oldest||(sim.created||0)<(oldest.sim.created||0))oldest={spec,sim};
    if(!oldest)throw new Error('Data.lua is too large even without sims.');
    oldest.spec.sims=oldest.spec.sims.filter(s=>s!==oldest.sim);dropped++;text=render();
  }
  return {text,bytes:Buffer.byteLength(text,'utf8'),dropped};
}
