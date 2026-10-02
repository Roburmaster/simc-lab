// WoW combat logs (Logs/WoWCombatLog-*.txt, advanced logging): finding the fights in a file, and reading one player's
// part of one fight for the rotation analysis (see analysis/).
//
// A file can be gigabytes, so it is read as a stream. A scan finds the fights once (boss encounters, and for training
// dummies and open-world play, stretches where a player keeps dealing damage) and remembers where each one starts
// and ends in bytes, so reading a fight later touches only its own part of the file.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

// A pause longer than this ends an activity stretch: the player stopped attacking.
const pause=10;
// Shorter stretches are not fights worth analysing.
const minimumLength=20;
// A stretch is read from this many seconds before its first hit: the opener (Recklessness, Charge, buffs) comes first.
const lead=6;

export async function logsDir(wowDir){return wowDir?path.join(wowDir,'_retail_','Logs'):null;}
export async function listLogs(dir){
  if(!dir)return [];
  const files=[];
  for(const name of await fsp.readdir(dir).catch(()=>[])){
    if(!/^WoWCombatLog.*\.txt$/i.test(name))continue;
    const stat=await fsp.stat(path.join(dir,name)).catch(()=>null);if(stat?.isFile())files.push({name,size:stat.size,modified:stat.mtime.toISOString()});
  }
  return files.sort((a,b)=>b.modified.localeCompare(a.modified));
}
// Only a file in the logs folder, by its plain name.
export function logPath(dir,name){
  if(!dir||typeof name!=='string'||!/^WoWCombatLog[\w.-]*\.txt$/i.test(name))throw new Error('Choose a combat log from the list.');
  return path.join(dir,name);
}

// One log line: "10/2/2026 08:52:57.6472  EVENT,field,field,...". Quoted fields keep their commas; brackets (talent
// and gear lists) stay as raw text.
export function parseLine(line){
  const gap=line.indexOf('  ');if(gap<0)return null;
  const stamp=line.slice(0,gap).match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+(?:\.\d+)?)/);if(!stamp)return null;
  const time=Date.UTC(+stamp[3],+stamp[1]-1,+stamp[2],+stamp[4],+stamp[5])/1000+Number(stamp[6]);
  const fields=[];let current='',quoted=false,depth=0;const text=line.slice(gap+2);
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'&&depth===0){quoted=!quoted;continue;}
    if(!quoted){if(c==='['||c==='(')depth++;else if(c===']'||c===')')depth--;}
    if(c===','&&!quoted&&depth===0){fields.push(current);current='';}else current+=c;
  }
  fields.push(current);
  return {time,event:fields[0],fields};
}

// Where the advanced-logging block of a damage, heal or energize line starts: after the spell (id, name, school)
// for spell events, right after the target for swings.
export const advancedStart=event=>event.startsWith('SWING')?9:12;
// The amount of a damage event; the advanced block is 19 fields long in this log version (12.x).
export function damageOf(p){const at=advancedStart(p.event)+19;return Number(p.fields[at])||0;}
const isPlayer=guid=>typeof guid==='string'&&guid.startsWith('Player-');
const damageEvent=e=>e==='SWING_DAMAGE'||e==='SPELL_DAMAGE'||e==='SPELL_PERIODIC_DAMAGE'||e==='RANGE_DAMAGE';

async function* lines(file,start=0,end=Infinity){
  const stream=fs.createReadStream(file,{start,...(Number.isFinite(end)?{end:end-1}:{}),encoding:'utf8'});
  const reader=readline.createInterface({input:stream,crlfDelay:Infinity});
  let offset=start;
  // Byte length of each line plus its CRLF, so a stretch can be read back from its offsets.
  for await(const line of reader){const next=offset+Buffer.byteLength(line)+2;yield {line,offset,next};offset=next;}
}

// Finds every fight: boss encounters (ENCOUNTER_START/END) and stretches of continuous damage per player.
// `progress(fraction)` is told how far the scan has come.
export async function scanLog(file,progress=()=>{}){
  const size=(await fsp.stat(file)).size;
  const fights=[],stretches=new Map(),names=new Map(),specs=new Map();let encounter=null,lastReport=0,first=null,last=null;
  // Where each recent second of the file starts, to begin a stretch `lead` seconds early.
  const marks=[];const earlier=time=>{for(const [t,o] of marks)if(t>=time-lead)return o;return marks.at(-1)?.[1]??0;};
  const closeStretch=(guid,s)=>{if(s.end-s.start>=minimumLength)fights.push({kind:'activity',player:guid,start:s.start,end:s.end,startOffset:s.startOffset,endOffset:s.endOffset,damage:s.damage,targets:[...s.targets].slice(0,8)});};
  for await(const {line,offset,next} of lines(file)){
    if(offset-lastReport>8*1048576){lastReport=offset;progress(offset/size);}
    const p=parseLine(line);if(!p)continue;first??=p.time;last=p.time;
    if(!marks.length||p.time-marks.at(-1)[0]>=1){marks.push([p.time,offset]);while(marks.length&&p.time-marks[0][0]>lead+1)marks.shift();}
    const f=p.fields;
    if(p.event==='ENCOUNTER_START'){encounter={kind:'encounter',name:f[2],difficulty:Number(f[3]),start:p.time,startOffset:offset,players:new Map()};continue;}
    if(p.event==='ENCOUNTER_END'&&encounter){fights.push({...encounter,end:p.time,endOffset:next,success:f[5]==='1',players:[...encounter.players.entries()].map(([guid,damage])=>({guid,damage}))});encounter=null;continue;}
    if(p.event==='COMBATANT_INFO'){const bracket=f.findIndex(x=>x.startsWith('['));if(bracket>1)specs.set(f[1],Number(f[bracket-1]));continue;}
    if(!damageEvent(p.event)||!isPlayer(f[1]))continue;
    names.set(f[1],f[2]);
    // Pets and guardians count for their owner when the line says who that is; players are their own source.
    const amount=damageOf(p);
    if(encounter)encounter.players.set(f[1],(encounter.players.get(f[1])||0)+amount);
    let s=stretches.get(f[1]);
    if(s&&p.time-s.end>pause){closeStretch(f[1],s);s=null;}
    if(!s){s={start:p.time,end:p.time,startOffset:earlier(p.time),endOffset:next,damage:0,targets:new Set()};stretches.set(f[1],s);}
    s.end=p.time;s.endOffset=next;s.damage+=amount;if(s.targets.size<8)s.targets.add(f[6]);
  }
  for(const [guid,s] of stretches)closeStretch(guid,s);
  progress(1);
  const label=guid=>names.get(guid)||guid;
  return {size,start:first,end:last,players:[...names].map(([guid,name])=>({guid,name,spec:specs.get(guid)||null})),
    fights:fights.sort((a,b)=>a.start-b.start).map((fight,id)=>({id,...fight,length:Math.round((fight.end-fight.start)*10)/10,...(fight.player?{name:label(fight.player)}:{}),...(fight.players?{players:fight.players.map(x=>({...x,name:label(x.guid)})).sort((a,b)=>b.damage-a.damage)}:{})}))};
}

// One player's part of one fight: casts, damage per spell, buffs on them, resource gains, and what they hit.
export async function readPlayer(file,fight,guid){
  const out={guid,name:null,start:null,end:null,casts:[],damage:new Map(),auras:[],energize:[],targets:new Map(),spec:null};
  for await(const {line} of lines(file,fight.startOffset,fight.endOffset)){
    const p=parseLine(line);if(!p)continue;const f=p.fields;
    if(p.event==='COMBATANT_INFO'&&f[1]===guid){const bracket=f.findIndex(x=>x.startsWith('['));if(bracket>1)out.spec=Number(f[bracket-1]);continue;}
    const fromPlayer=f[1]===guid,toPlayer=f[5]===guid;
    if(!fromPlayer&&!toPlayer)continue;
    if(fromPlayer)out.name??=f[2];
    if(p.event==='SPELL_CAST_SUCCESS'&&fromPlayer){out.casts.push({time:p.time,id:Number(f[9]),name:f[10],target:f[6]});continue;}
    if(p.event.startsWith('SPELL_AURA_')&&toPlayer&&f[12]==='BUFF'){out.auras.push({time:p.time,event:p.event.slice(11),id:Number(f[9]),name:f[10],stacks:Number(f[13])||1,source:f[2]});continue;}
    if(p.event.endsWith('_ENERGIZE')&&toPlayer&&fromPlayer){
      // ...,amount,overEnergize,powerType,maxPower at the end of the line.
      const n=f.length;out.energize.push({time:p.time,id:Number(f[9]),name:f[10],amount:Number(f[n-4])||0,over:Number(f[n-3])||0,type:Number(f[n-2])});continue;
    }
    if(damageEvent(p.event)&&fromPlayer){
      const swing=p.event==='SWING_DAMAGE';const id=swing?6603:Number(f[9]);const name=swing?'Melee':f[10];
      const amount=damageOf(p);const at=advancedStart(p.event);
      const d=out.damage.get(id)||{id,name,amount:0,hits:0,crits:0};d.amount+=amount;d.hits++;if(f[at+26]==='1')d.crits++;out.damage.set(id,d);
      out.start??=p.time;out.end=p.time;
      const t=out.targets.get(f[5])||{guid:f[5],name:f[6],hits:0,times:[]};t.hits++;if(t.times.length<4000)t.times.push(p.time);out.targets.set(f[5],t);
    }
  }
  out.start??=fight.start;out.end??=fight.end;
  return out;
}
