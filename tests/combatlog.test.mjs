import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseLine,scanLog,readPlayer,logPath,listLogs} from '../lib/combatlog.mjs';
import {analyserFor,simCastsPerMinute} from '../lib/analysis/index.mjs';
import {intervals,simKey} from '../lib/analysis/fury.mjs';

const me='Player-1329-0408D637',name='"Roburevolved-Ravencrest-EU"',flags='0x511,0x80000000';
const dummy=i=>`Creature-0-3891-0-88154-243208-0000${i}F3A3A`;
const stamp=s=>{const t=new Date(Date.UTC(2026,9,2,8,53,0)+s*1000);return `10/2/2026 ${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}:${String(t.getUTCSeconds()).padStart(2,'0')}.${String(t.getUTCMilliseconds()).padStart(3,'0')}0`;};
// The advanced block (17 fields of the unit, then the position) as 12.x writes it.
const block=guid=>`${guid},0000000000000000,1,3537050,0,0,1470,0,0,0,1,0,0,0,8172.79,-4354.56,2393,0.2616,90`;
const hit=(s,spell,label,target,amount,crit=0)=>`${stamp(s)}  SPELL_DAMAGE,${me},${name},${flags},${dummy(target)},"Cleave Training Dummy",0x10a28,0x80000000,${spell},"${label}",0x1,${block(dummy(target))},${amount},${amount},-1,1,0,0,0,${crit},nil,nil,nil,ST`;
const cast=(s,spell,label)=>`${stamp(s)}  SPELL_CAST_SUCCESS,${me},${name},${flags},${dummy(1)},"Cleave Training Dummy",0x10a28,0x80000000,${spell},"${label}",0x1,${block(me)}`;
const aura=(s,event,spell,label)=>`${stamp(s)}  SPELL_AURA_${event},${me},${name},${flags},${me},${name},${flags},${spell},"${label}",0x1,BUFF`;
const rage=(s,amount,over)=>`${stamp(s)}  SPELL_ENERGIZE,${me},${name},${flags},${me},${name},${flags},23881,"Bloodthirst",0x1,${block(me)},${amount},${over},1,1300`;

async function sampleLog(){
  const lines=['10/2/2026 08:52:57.6472  COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,12.1.0,PROJECT_ID,1'];
  lines.push(aura(0,'APPLIED',184362,'Enrage'),aura(0,'APPLIED',85739,'Whirlwind'),cast(0.5,1719,'Recklessness'),aura(0.5,'APPLIED',1719,'Recklessness'));
  for(let s=1;s<=60;s+=1.5){
    lines.push(cast(s,s%3<1.5?184367:23881,s%3<1.5?'Rampage':'Bloodthirst'));
    for(let t=1;t<=5;t++)lines.push(hit(s,184367,'Rampage',t,20000,t===1?1:0));
  }
  lines.push(cast(2,446035,'Bladestorm'),aura(30,'REMOVED',184362,'Enrage'),aura(36,'APPLIED',184362,'Enrage'));
  lines.push(aura(10,'APPLIED',52437,'Sudden Death'),aura(18,'REMOVED',52437,'Sudden Death'),rage(5,20,0),rage(6,20,10));
  lines.push(aura(3,'APPLIED',1236994,'Liquid Luster'));
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-log-'));const file=path.join(dir,'WoWCombatLog-100226_085257.txt');
  // A real log is in time order.
  lines.sort((a,b)=>a.slice(0,24).localeCompare(b.slice(0,24)));
  await fs.writeFile(file,lines.join('\r\n')+'\r\n');return {dir,file};
}

test('a log line keeps quoted commas and bracketed lists whole',()=>{
  const p=parseLine('10/2/2026 08:53:15.0802  SPELL_CAST_SUCCESS,Player-1,"Name, Odd-Realm",0x511,0x0,0000,nil,0x0,0x0,385059,"Odyn\'s Fury",0x1');
  assert.equal(p.event,'SPELL_CAST_SUCCESS');assert.equal(p.fields[2],'Name, Odd-Realm');assert.equal(p.fields[10],"Odyn's Fury");
  assert.equal(parseLine('9/25/2026 19:35:41.1272  COMBATANT_INFO,Player-1,0,[(1,2,1),(3,4,1)],266').fields[3],'[(1,2,1),(3,4,1)]');
  assert.equal(parseLine('no timestamp here'),null);
  assert.throws(()=>logPath('C:/Logs','../secret.txt'),/combat log/);
});

test('the scan finds a player’s fight, and its slice of the file reads back the same events',async()=>{
  const {dir,file}=await sampleLog();
  assert.equal((await listLogs(dir))[0].name,'WoWCombatLog-100226_085257.txt');
  const scan=await scanLog(file);
  assert.equal(scan.fights.length,1);const fight=scan.fights[0];
  assert.equal(fight.kind,'activity');assert.equal(fight.name,'Roburevolved-Ravencrest-EU');assert.equal(fight.length,58.5);assert.equal(fight.damage,40*5*20000);
  const data=await readPlayer(file,fight,me);
  assert.equal(data.damage.get(184367).hits,200);assert.equal(data.targets.size,5);assert.ok(data.casts.length>=40);
});

test('Fury analysis: uptimes, wasted rage, expired procs and potions, with SimC beside it',async()=>{
  const {file}=await sampleLog();const scan=await scanLog(file);const data=await readPlayer(file,scan.fights[0],me);
  const fury=analyserFor(data);assert.equal(fury?.spec.label,'Fury Warrior');
  const r=fury.analyse(data,{potions:['Liquid Luster'],sim:{rampage:30,bloodthirst:5,raging_blow:8}});
  assert.equal(r.dps,Math.round(40*5*20000/58.5));
  assert.equal(r.uptime.enrage,Math.round(1000*(58.5-6)/58.5)/10,'down from 30 s to 36 s');
  assert.deepEqual(r.rage,{gained:40,wasted:10});
  const title=t=>r.findings.find(f=>f.title===t);
  assert.equal(title('Enrage uptime').severity,'tip','89.7% is just under the 90% aim');
  assert.match(title('Sudden Death').detail,/1 of 1 Sudden Death procs ran out unused/);
  assert.equal(title('Rage over the cap').severity,'warning');
  assert.equal(title('Potion timing').severity,'good','drunk inside Recklessness');
  assert.ok(title('Raging Blow not used'),'SimC presses something the player never did');
  assert.equal(r.abilities.find(a=>a.name==='Rampage').simCpm,30);
  assert.equal(r.cooldowns[0].with[0],'Bladestorm');
});

test('buff windows and SimC names',()=>{
  const auras=[{time:1,event:'APPLIED',id:7},{time:5,event:'REMOVED',id:7},{time:8,event:'APPLIED',id:7}];
  assert.deepEqual(intervals(auras,[7],0,10),[[1,5],[8,10]]);
  assert.equal(simKey("Odyn's Fury"),'odyns_fury');assert.equal(simKey('Raging Blow'),'raging_blow');
  // Only what the action list pressed counts as a cast, not ticks and procs.
  const report={sim:{players:[{collected_data:{fight_length:{mean:120},action_sequence:[{name:'rampage'},{name:'auto_attack'}]},stats:[{name:'rampage',num_executes:{mean:50}},{name:'rend_dot',num_executes:{mean:100}},{name:'auto_attack',num_executes:{mean:1}}]}]}};
  assert.deepEqual(simCastsPerMinute(report),{rampage:25});
});
