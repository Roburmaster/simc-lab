// EXPERIMENTAL, MADE BY AI: written by an AI assistant (Claude) and not yet validated against Mythic+ combat logs.
// Treat its numbers as a comparison between choices on the same route, not as a forecast of a real run.
// Mythic+ routes: a whole dungeon as SimC's DungeonRoute fight style, one pull event per pull, built from what is on
// this PC and never shipped with the app:
// - Mythic Dungeon Tools (installed addon): every enemy's health at keystone level 1, its enemy forces and whether it
//   is a boss, and the player's own routes from its saved variables. MDT's health formula is used as it is; checked
//   against a +14 combat log, it matched the log's maximum health to 0.1%.
// - Raider.IO (installed addon): replays of the player's own recent runs, which hold when every enemy-forces mob
//   died (with its forces) and when every boss was pulled and killed. That is the run's real pace.
// SimC only simulates the player, but five players kill the mobs. So every mob gets the player's share of its health:
// either a share the user sets, or the share that makes the simulated bosses last as long as they did in the run.
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseLua} from './lua.mjs';

export const routeStyle='MythicPlusRoute';
export const isRouteStyle=style=>style===routeStyle;
// Bloodlust's debuff lasts ten minutes, so a group can lust again on the first pull after that.
export const lustCooldown=600;
// Kills further apart than this are separate pulls in a replay: the first kill of a new pull takes longer than this
// from the last of the one before, while a big pull's kills come closer together.
export const pullGap=20;
export const defaults={share:25,gap:10,level:10};

// MDT 6.2: health at a keystone level. Fortified and Tyrannical are both on from +10 in Midnight; from +11 Xal'atath's
// Guile scales by 10% a level instead of 7%. The scaling is rounded to two decimals first, as MDT does.
export function healthAt(base,level,boss){
  let mult=1;
  if(level>=10)mult*=boss?1.25:1.2;
  const scaling=Math.round(mult*1.07**Math.min(level-1,9)*1.1**Math.max(0,level-10)*100)/100;
  return Math.round(scaling*base);
}

// A Lua table constructor that follows `marker`, cut out with its braces balanced (strings and comments skipped).
export function tableAfter(text,marker){
  const at=text.indexOf(marker);if(at<0)return null;
  let i=text.indexOf('{',at);if(i<0)return null;
  const start=i;let depth=0;
  for(;i<text.length;i++){
    const c=text[i];
    if(c==='"'||c==="'"){for(i++;i<text.length&&text[i]!==c;i++)if(text[i]==='\\')i++;continue;}
    if(c==='-'&&text[i+1]==='-'){while(i<text.length&&text[i]!=='\n')i++;continue;}
    if(c==='{')depth++;
    else if(c==='}'&&--depth===0)return text.slice(start,i+1);
  }
  return null;
}
// parseLua gives arrays for 1..n tables and objects otherwise; MDT's indices are 1-based either way.
const at=(table,i)=>Array.isArray(table)?table[i-1]:table?.[i];
const list=table=>Array.isArray(table)?table:Object.values(table||{});
const entries=table=>Array.isArray(table)?table.map((v,i)=>[i+1,v]):Object.entries(table||{}).map(([k,v])=>[Number(k),v]);

// One dungeon file from MDT's Midnight folder.
export function readMdtDungeon(text){
  const index=Number(/local dungeonIndex\s*=\s*(\d+)/.exec(text)?.[1]);
  const name=/englishName\s*=\s*"([^"]+)"/.exec(text)?.[1];
  const table=tableAfter(text,'MDT.dungeonEnemies[dungeonIndex]');
  if(!index||!name||!table)return null;
  const total=Number(/dungeonTotalCount\[dungeonIndex\]\s*=\s*\{\s*normal\s*=\s*(\d+)/.exec(text)?.[1])||null;
  const enemies=entries(parseLua(`e=${table}`).e).map(([i,e])=>({index:i,name:e.name,id:e.id,count:e.count||0,health:e.health||0,boss:!!e.isBoss,encounter:e.encounterID||null,
    clones:entries(e.clones).map(([c,v])=>({index:c,x:v.x,y:v.y,group:v.g??null}))}));
  return {index,name,total,enemies};
}
// Routes from MDT's saved variables, per dungeon index; only routes with at least one enemy in them.
export function readMdtRoutes(text){
  const db=parseLua(text).MythicDungeonToolsDB;const routes=new Map();
  for(const [index,presets] of entries(db?.global?.presets)){
    for(const [n,preset] of entries(presets)){
      const pulls=list(preset?.value?.pulls).map(pull=>entries(pull).filter(([k])=>Number.isInteger(k)).map(([enemy,clones])=>({enemy,clones:list(clones).map(Number)})));
      if(!pulls.some(p=>p.some(e=>e.clones.length)))continue;
      if(!routes.has(index))routes.set(index,[]);
      routes.get(index).push({id:`mdt-${index}-${n}`,name:preset.text||`Route ${n}`,level:preset.difficulty||null,pulls});
    }
  }
  return routes;
}
// Raider.IO's replays: kills (time and forces), boss pulls and deaths, in seconds from the key's start.
export function readReplays(text){
  const data=parseLua(text.replace(/^\s*local\s+_\s*,\s*ns\s*=\s*\.\.\.\s*$/m,'').replace(/\bns\.REPLAYS\s*=/,'REPLAYS =')).REPLAYS;
  return list(data).filter(r=>r?.dungeon&&r.events).map(r=>{
    const events=list(r.events).map(list);
    const bosses=list(r.encounters).map(e=>({journal:e.journal_encounter_id,ordinal:e.ordinal,start:null,end:null,killed:false}));
    for(const [t,type,ordinal,,,success] of events){
      const boss=bosses.find(b=>b.ordinal===ordinal);if(!boss)continue;
      if(type===3)boss.start=t/1000;
      if(type===4){boss.end=t/1000;boss.killed=!!success;}
    }
    return {id:`rio-${r.keystone_run_id}`,dungeon:r.dungeon.name,short:r.dungeon.short_name,level:r.mythic_level,clearTime:r.clear_time_ms/1000,date:r.date,
      kills:events.filter(e=>e[1]===2).map(([t,,count])=>({t:t/1000,count})),deaths:events.filter(e=>e[1]===1).map(e=>e[0]/1000),bosses};
  });
}

// Where MDT and Raider.IO keep their data, below WoW's _retail_ folder.
export async function readSources(retail){
  const addons=path.join(retail,'Interface','AddOns');
  const dungeons=new Map(),routes=new Map();let replays=[];const missing=[];
  const mdt=path.join(addons,'MythicDungeonTools','Midnight');
  const files=await fs.readdir(mdt).catch(()=>null);
  if(!files)missing.push('Mythic Dungeon Tools is not installed, so there is no enemy health or route data.');
  for(const file of (files||[]).filter(f=>f.endsWith('.lua'))){
    try{const d=readMdtDungeon(await fs.readFile(path.join(mdt,file),'utf8'));if(d)dungeons.set(d.index,d);}catch{}
  }
  for(const account of await fs.readdir(path.join(retail,'WTF','Account')).catch(()=>[])){
    const text=await fs.readFile(path.join(retail,'WTF','Account',account,'SavedVariables','MythicDungeonTools.lua'),'utf8').catch(()=>null);
    if(!text)continue;
    try{for(const [index,list] of readMdtRoutes(text))routes.set(index,[...(routes.get(index)||[]),...list.map(r=>({...r,id:`${r.id}-${account}`}))]);}catch{}
  }
  const rio=await fs.readFile(path.join(addons,'RaiderIO','db','db_client_replays.lua'),'utf8').catch(()=>null);
  if(rio)try{replays=readReplays(rio);}catch{}
  else missing.push('Raider.IO is not installed, so there are no runs to take the pace from.');
  return {dungeons,routes,replays,missing};
}
// The season's dungeons: the game data's Mythic+ list names them, and each name is an instance with its encounters.
export async function seasonPool(upstream){
  const instances=JSON.parse(await fs.readFile(path.join(upstream,'instances.json'),'utf8'));
  const names=instances.find(i=>i.id===-1)?.encounters||[];
  return names.map(n=>instances.find(i=>i.id>0&&i.name===n.name)).filter(Boolean);
}
export async function loadRoutes(retail,upstream){
  const sources=await readSources(retail);
  return {sources,season:seasonDungeons(await seasonPool(upstream),sources)};
}
// The season's dungeons, by name from the game data's Mythic+ list, matched to MDT's files, with each boss encounter
// tied to MDT's enemies (see attachBosses).
const flat=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function seasonDungeons(instances,sources){
  return instances.map(({name,encounters})=>{
    const d=[...sources.dungeons.values()].find(x=>flat(x.name)===flat(name));
    if(d&&!d.bosses)attachBosses(d,encounters||[]);
    const replays=sources.replays.filter(r=>flat(r.dungeon)===flat(name)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    return {name,index:d?.index??null,total:d?.total??null,bosses:d?.bosses||[],routes:d?(sources.routes.get(d.index)||[]):[],replays};
  });
}
// MDT's encounter IDs are not reliable for new dungeons (every boss of Altar of Fangs says 2880), so encounters are
// matched by name first: a shared word that is not a title ("Dazar, The First King" and King Dazar). An MDT boss
// with no encounter at all is a mini-boss and counts as trash. The rest are placed by where they stand: next to a
// matched boss of the encounter MDT names (Dazar's T'zala), or as one group per encounter no name matched (the
// Lightblossom Trinity, the Council of Tribes).
const titles=new Set(['the','and','of','king','queen','lord','lady','first','high','avatar','council','tribes']);
const words=name=>String(name).toLowerCase().split(/[^a-z']+/).map(w=>w.replace(/'/g,'')).filter(w=>w.length>=4&&!titles.has(w));
const near=(a,b)=>a.clones.some(c=>b.clones.some(d=>Math.hypot(c.x-d.x,c.y-d.y)<60));
export function attachBosses(dungeon,encounters){
  const bosses=encounters.map(e=>({journal:e.id,name:e.name,enemies:[]}));
  const left=[];
  for(const e of dungeon.enemies.filter(x=>x.boss&&x.encounter)){
    const mine=new Set(words(e.name));
    const match=bosses.find(b=>flat(b.name).includes(flat(e.name))||flat(e.name).includes(flat(b.name))||words(b.name).some(w=>mine.has(w)));
    if(match)match.enemies.push(e);else left.push(e);
  }
  const groups=[];
  for(const e of left){
    const beside=bosses.find(b=>b.journal===e.encounter&&b.enemies.some(x=>near(x,e)));
    if(beside){beside.enemies.push(e);continue;}
    const group=groups.find(g=>g.some(x=>near(x,e)));if(group)group.push(e);else groups.push([e]);
  }
  const open=bosses.filter(b=>!b.enemies.length);
  if(open.length===groups.length)open.forEach((b,i)=>b.enemies.push(...groups[i]));
  else for(const g of groups){const b=open.find(o=>o.journal===g[0].encounter&&!o.enemies.length);if(b)b.enemies.push(...g);}
  dungeon.bosses=bosses.map(b=>({journal:b.journal,name:b.name,enemies:b.enemies.map(e=>e.index)}));
  const of=new Map(dungeon.bosses.flatMap(b=>b.enemies.map(i=>[i,b.journal])));
  for(const e of dungeon.enemies)e.journal=of.get(e.index)??null;
  return dungeon.bosses;
}

const centre=mobs=>({x:mobs.reduce((s,m)=>s+m.x,0)/mobs.length,y:mobs.reduce((s,m)=>s+m.y,0)/mobs.length});
// A mob in a pull. `boss` is MDT's flag, which decides between Tyrannical and Fortified health; `journal` is the boss
// encounter it belongs to, if any.
const mob=(e,clone)=>({name:e.name,id:e.id,count:e.count,health:e.health,boss:e.boss,journal:e.journal??null,...(clone?{x:clone.x,y:clone.y}:{})});
// A boss encounter's enemies (a council is several) and where it stands.
function bossPull(dungeon,journal){
  const b=dungeon.bosses?.find(x=>x.journal===journal);
  const mobs=(b?.enemies||[]).map(i=>at(dungeon.enemies,i)).filter(Boolean).flatMap(e=>e.clones.length?e.clones.map(c=>mob(e,c)):[mob(e,{x:0,y:0})]);
  return {boss:journal,name:b?.name||mobs.map(m=>m.name).join(' & '),mobs};
}
// An MDT route as pulls. Routes usually leave the bosses out; each missing boss goes after the pull nearest to it.
export function routeFromMdt(dungeon,route){
  const pulls=route.pulls.map(p=>({mobs:p.flatMap(({enemy,clones})=>{const e=at(dungeon.enemies,enemy);return e?clones.map(c=>mob(e,e.clones.find(x=>x.index===c))):[];})})).filter(p=>p.mobs.length);
  for(const p of pulls){const boss=p.mobs.find(m=>m.journal);if(boss){p.boss=boss.journal;p.name=dungeon.bosses.find(b=>b.journal===boss.journal)?.name||boss.name;}}
  for(const encounter of (dungeon.bosses||[]).filter(b=>b.enemies.length).map(b=>b.journal).filter(e=>!pulls.some(p=>p.boss===e))){
    const boss=bossPull(dungeon,encounter),where=centre(boss.mobs);
    let best=-1,distance=Infinity;
    for(const [i,p] of pulls.entries()){const placed=p.mobs.filter(m=>m.x!==undefined);if(!placed.length)continue;const c=centre(placed);const d=Math.hypot(c.x-where.x,c.y-where.y);if(d<distance){distance=d;best=i;}}
    pulls.splice(best+1,0,boss);
  }
  return {source:'mdt',id:route.id,name:route.name,pulls:pulls.map(({mobs,...p})=>({...p,mobs:mobs.map(({x,y,...m})=>m)}))};
}
// The enemies a replay kill was. Raider.IO adds up the forces of mobs that die at the same moment (two 5s make a
// 10), so a count no enemy has is split: into mobs of one kind if it divides evenly, else into the fewest mobs that
// add up to it. Each is the most common enemy with that many forces. Enemies worth no forces never show in a
// replay, so a replay pull misses them.
function enemiesFor(dungeon,count){
  const pool=dungeon.enemies.filter(e=>!e.journal&&e.count>0);
  const byCount=new Map();
  for(const e of pool){const best=byCount.get(e.count);if(!best||e.clones.length>best.clones.length||e.clones.length===best.clones.length&&e.health>best.health)byCount.set(e.count,e);}
  const counts=[...byCount.keys()].sort((x,y)=>y-x);
  if(byCount.has(count))return [mob(byCount.get(count))];
  const even=counts.find(k=>count%k===0);
  if(even)return Array.from({length:count/even},()=>mob(byCount.get(even)));
  const fewest=[[]];
  for(let c=1;c<=count;c++){let best=null;for(const k of counts)if(k<=c&&fewest[c-k]&&(!best||fewest[c-k].length+1<best.length))best=[...fewest[c-k],k];fewest[c]=best;}
  if(fewest[count])return fewest[count].map(k=>mob(byCount.get(k)));
  const near=pool.sort((x,y)=>Math.abs(x.count-count)-Math.abs(y.count-count))[0];
  return near?[{...mob(near),health:Math.round(near.health*count/Math.max(1,near.count)),guessed:true}]:[];
}
// A replay that kept too few of its kills (some hold none at all) can still pace a route, but is no route itself.
export const replayHasRoute=(replay,total)=>replay.kills.reduce((s,k)=>s+k.count,0)>=0.5*(total||1);
// A Raider.IO run as pulls: boss pulls as they happened, and the kills between them grouped into pulls wherever more
// than `pullGap` seconds pass without one. Each pull keeps when it ended in the run (bosses also when they started).
export function routeFromReplay(dungeon,replay){
  const windows=replay.bosses.filter(b=>b.start!==null);
  const inBoss=t=>windows.some(b=>t>=b.start&&t<=(b.end??Infinity)+1);
  const pulls=[];let current=null;
  for(const kill of replay.kills.filter(k=>!inBoss(k.t))){
    if(!current||kill.t-current.end>pullGap){current={mobs:[],first:kill.t,end:kill.t};pulls.push(current);}
    current.mobs.push(...enemiesFor(dungeon,kill.count));current.end=kill.t;
  }
  for(const b of windows){
    const boss=bossPull(dungeon,b.journal);
    if(boss.mobs.length)pulls.push({...boss,mobs:boss.mobs.map(({x,y,...m})=>m),start:b.start,end:b.end??replay.clearTime,killed:b.killed});
  }
  pulls.sort((a,b)=>a.end-b.end);
  return {source:'replay',id:replay.id,name:`+${replay.level} ${replay.short||replay.dungeon} · ${String(replay.date).slice(0,10)}`,level:replay.level,clearTime:replay.clearTime,deaths:replay.deaths.length,pulls:pulls.filter(p=>p.mobs.length)};
}

// Names SimC accepts in an enemies= string.
const simName=(name,boss)=>(boss?'BOSS_':'')+(String(name).normalize('NFKD').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'')||'Enemy');
// Each mob's health for the player: its health at the key level times the player's share.
export const pullHealth=(pull,level,share)=>pull.mobs.map(m=>Math.max(1,Math.round(healthAt(m.health,level,m.boss)*share)));
// A pull's share: bosses and trash each have their own once a run has paced them.
export const shareOf=(route,i)=>route.shares?.[i]??route.share;
export function routeLines(route){
  const {pulls,level,delays,lust}=route;
  return pulls.map((p,i)=>{
    const health=pullHealth(p,level,shareOf(route,i));
    const enemies=p.mobs.map((m,j)=>`${simName(m.name,!!m.journal)}:${health[j]}`).join('|');
    return `raid_events+=/pull,pull=${String(i+1).padStart(2,'0')},bloodlust=${lust[i]?1:0},delay=${Math.max(0,Math.round((delays[i]||0)*10)/10)},enemies=${enemies}`;
  });
}
// Bloodlust on the first pull and then on the first pull that starts once the debuff has run out.
export function lustPlan(starts){
  const lust=starts.map(()=>false);let last=-Infinity;
  for(const [i,t] of starts.entries())if(t-last>=lustCooldown){lust[i]=true;last=t;}
  return lust;
}
// When each pull starts, from the delays before them and the pull lengths.
export function timeline(delays,lengths){
  const starts=[];let t=0;
  for(const [i,d] of delays.entries()){t+=d||0;starts.push(t);t+=lengths[i]||0;}
  return {starts,end:t};
}
// The mean length of every pull, from SimC's HTML report ("Pull 3 (35.8): …"); the JSON only has the last iteration's.
export function pullLengths(html){
  const lengths=[];
  for(const m of String(html).matchAll(/Pull (\d+) \(([\d.]+)\)/g))lengths[Number(m[1])-1]=Number(m[2]);
  return lengths;
}

// The route a scenario asks for, with its data read from the sources: dungeon, pulls and the run it is paced from.
export function resolveRoute(input,sources){
  const dungeon=sources.dungeons.get(Number(input?.dungeon));
  if(!dungeon)throw new Error('Choose a dungeon that Mythic Dungeon Tools knows.');
  const level=Number(input.level??defaults.level);
  if(!Number.isInteger(level)||level<2||level>40)throw new Error('Keystone level must be 2–40.');
  const replay=id=>sources.replays.find(r=>r.id===id&&flat(r.dungeon)===flat(dungeon.name));
  let route;
  if(String(input.route||'').startsWith('rio-')){
    const r=replay(input.route);if(!r)throw new Error('That Raider.IO run is no longer in the addon’s data.');
    if(!replayHasRoute(r,dungeon.total))throw new Error('Raider.IO kept too few of that run’s kills to rebuild its route. Use it for the pace with an MDT route instead.');
    route=routeFromReplay(dungeon,r);
  }
  else{const r=(sources.routes.get(dungeon.index)||[]).find(x=>x.id===input.route);if(!r)throw new Error('Choose a route: one of your Raider.IO runs or a route saved in Mythic Dungeon Tools.');route=routeFromMdt(dungeon,r);}
  if(!route.pulls.length)throw new Error('That route has no pulls.');
  const pace=input.pace==='share'?{mode:'share'}:replay(input.pace)?{mode:'replay',run:input.pace}:null;
  if(!pace)throw new Error('Choose how fast the group goes: one of your runs in this dungeon, or a share of the group’s damage.');
  const share=Number(input.share??defaults.share),gap=Number(input.gap??defaults.gap);
  if(!(share>=1&&share<=100))throw new Error('Your share of the group’s damage must be 1–100%.');
  if(!(gap>=0&&gap<=300))throw new Error('Time between pulls must be 0–300 seconds.');
  const paced=pace.mode==='replay'?replay(pace.run):null;
  return {dungeon:dungeon.index,dungeonName:dungeon.name,level,source:route.source,routeId:route.id,routeName:route.name,lust:input.lust!==false,
    pace:{...pace,...(paced?{level:paced.level,clearTime:paced.clearTime,bosses:paced.bosses.filter(b=>b.start!==null&&b.end!==null).map(b=>({journal:b.journal,length:b.end-b.start,killed:b.killed}))}:{})},
    shareSet:share/100,gap,pulls:route.pulls,...(route.clearTime?{run:{clearTime:route.clearTime,deaths:route.deaths,level:route.level}}:{})};
}

// The first, shorter run measures how long each pull lasts at a trial share; from it come the shares, the delays
// between pulls and where Bloodlust goes. A pull's length is its health over the player's damage per second, so it
// scales with the share.
// - Pace from a run: bosses and trash apart, because a group is relatively stronger on trash, where everyone hits
//   everything. Every boss killed in the run gets the share that makes it last as long as it did there, which
//   carries its own mechanics and downtime; a boss of the route the run did not kill gets their overall share
//   (`share`, all their time over all their simulated time). The trash share
//   makes the trash take the rest of the run's time, after the boss fights and `gap` seconds of walking before every
//   pull. Both are measured at the run's own level, so a different key level keeps the group's pace and only the
//   health changes.
// - Replay routes put each pull where it ended in the run (a boss where it was pulled); MDT routes spread the time
//   out of combat evenly.
export function trialRoute(route){
  const share=route.pace.mode==='replay'?0.25:route.shareSet;
  const level=route.pace.mode==='replay'?route.pace.level:route.level;
  return {...route,level,share,shares:null,delays:route.pulls.map((p,i)=>i?route.gap:0),lust:route.pulls.map((p,i)=>route.lust&&i===0)};
}
const sum=list=>list.reduce((a,b)=>a+b,0);
const clampShare=x=>Math.min(1,Math.max(0.02,x));
export function finishRoute(route,trial,lengths){
  if(lengths.length<route.pulls.length||route.pulls.some((p,i)=>!(lengths[i]>0)))throw new Error('The trial run did not report every pull’s length.');
  let share=route.shareSet,trashShare=route.shareSet,shares=route.pulls.map(()=>route.shareSet),scaled=lengths;
  if(route.pace.mode==='replay'){
    let sim=0,real=0;const own=new Map();
    for(const b of route.pace.bosses.filter(b=>b.killed)){const i=route.pulls.findIndex(p=>p.boss===b.journal);if(i>=0&&b.length>0){sim+=lengths[i];real+=b.length;own.set(i,clampShare(trial.share*b.length/lengths[i]));}}
    if(!(sim>0))throw new Error('The run has no killed boss to take the pace from.');
    share=clampShare(trial.share*real/sim);
    const trash=route.pulls.map((p,i)=>p.boss?0:lengths[i]);
    const trashTime=route.pace.clearTime-sum(route.pace.bosses.map(b=>b.length))-route.gap*route.pulls.length;
    trashShare=trashTime>0&&sum(trash)>0?clampShare(trial.share*trashTime/sum(trash)):share;
    shares=route.pulls.map((p,i)=>p.boss?own.get(i)??share:trashShare);
    scaled=lengths.map((l,i)=>l*shares[i]/trial.share);
  }
  // Health at the chosen level: a higher key makes every pull longer by its health.
  const levelScale=p=>route.level===trial.level?1:sum(pullHealth(p,route.level,1))/Math.max(1,sum(pullHealth(p,trial.level,1)));
  const expected=scaled.map((l,i)=>l*levelScale(route.pulls[i]));
  let delays=route.pulls.map((p,i)=>i?route.gap:0);
  if(route.pace.mode==='replay'&&route.source==='replay'&&route.routeId===route.pace.run){
    let end=0;
    delays=route.pulls.map((p,i)=>{const start=p.start??(p.end-scaled[i]);const d=Math.max(0,start-end);end=Math.max(end,start)+scaled[i];return d;});
  }else if(route.pace.mode==='replay'){
    const out=Math.max(0,route.pace.clearTime-sum(scaled));
    delays=route.pulls.map(()=>out/route.pulls.length);
  }
  const {starts,end}=timeline(delays,expected);
  return {...route,share,trashShare,shares,delays,lust:route.lust?lustPlan(starts):route.pulls.map(()=>false),expected:{lengths:expected,starts,end}};
}
// What a finished run says about the route: every pull's mean length, the health it had and the player's damage per
// second in it (the player is the only one hitting, so a pull's damage is its health), and the totals.
export function routeResult(route,lengths,runLength){
  const pulls=route.pulls.map((p,i)=>{
    const health=sum(pullHealth(p,route.level,shareOf(route,i)));
    const length=lengths[i]||null;
    return {name:p.name||summary(p.mobs),boss:!!p.boss,mobs:p.mobs.length,share:shareOf(route,i),health,realHealth:sum(pullHealth(p,route.level,1)),length,dps:length?health/length:null,lust:!!route.lust[i],delay:route.delays[i]||0,...(p.end!==undefined&&route.source==='replay'?{runEnd:p.end}:{})};
  });
  const combat=sum(pulls.map(p=>p.length||0)),damage=sum(pulls.map(p=>p.health));
  return {pulls,combat,run:runLength,activeDps:combat?damage/combat:null,share:route.share,trashShare:route.trashShare??route.share};
}
export function summary(mobs){
  const counts=new Map();for(const m of mobs)counts.set(m.name,(counts.get(m.name)||0)+1);
  return [...counts].sort((a,b)=>b[1]-a[1]).map(([n,c])=>c>1?`${c}× ${n}`:n).join(', ');
}
