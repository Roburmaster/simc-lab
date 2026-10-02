// Fury Warrior: what a combat log says about the rotation, and what to change. Spell IDs, not names, so any client
// language works. Every finding names the number it is based on, so the advice can be checked against the log.
export const spec={id:72,key:'fury',label:'Fury Warrior'};
const ids={
  rampage:[184367],bloodthirst:[23881],bloodbath:[335096],ragingBlow:[85288],crushingBlow:[335097],execute:[5308,280735],
  whirlwind:[190411],recklessness:[1719],odynsFury:[385059],bladestorm:[446035,227847],avatar:[107574],thunderousRoar:[384318],
  ravager:[228920],championsSpear:[376079]
};
const buffs={enrage:[184362],recklessness:[1719],suddenDeath:[52437,280776],whirlwind:[85739],bladestorm:[446035,227847]};
const has=(list,id)=>list.includes(id);
const followUps=[385060,385061,385062];
// Casts that hit one target only; with the Whirlwind buff they cleave, so on several targets they want it up.
const singleTarget=[...ids.rampage,...ids.bloodthirst,...ids.bloodbath,...ids.ragingBlow,...ids.crushingBlow,...ids.execute];
const majorCooldowns=[...ids.bladestorm,...ids.odynsFury,...ids.avatar,...ids.thunderousRoar,...ids.ravager,...ids.championsSpear];

export function isFury(data){
  if(data.spec===spec.id)return true;
  const cast=new Set(data.casts.map(c=>c.id));
  return [...ids.rampage,...ids.bloodthirst,...ids.ragingBlow,...ids.bloodbath].filter(id=>cast.has(id)).length>=2;
}

// When a buff was up, from its applied/removed events, clipped to the fight.
export function intervals(auras,list,start,end){
  const out=[];let since=null;
  for(const a of auras){
    if(!has(list,a.id))continue;
    if((a.event==='APPLIED'||a.event==='REFRESH'||a.event==='APPLIED_DOSE')&&since===null)since=Math.max(a.time,start);
    if(a.event==='REMOVED'){out.push([since??start,Math.min(a.time,end)]);since=null;}
  }
  if(since!==null)out.push([since,end]);
  return out.filter(([a,b])=>b>a);
}
const total=list=>list.reduce((n,[a,b])=>n+b-a,0);
const upAt=(list,time)=>list.some(([a,b])=>time>=a-0.05&&time<=b+0.05);
const pct=(part,whole)=>whole>0?Math.round(1000*part/whole)/10:0;
const round=(n,d=1)=>Math.round(n*10**d)/10**d;

// `sim`: casts per minute by SimC action name from a simulation of the same character, when one is chosen.
// `potions`: the current expansion's potion names, to recognise one in the log.
export function analyse(data,{sim=null,potions=[]}={}){
  const start=data.start,end=data.end,length=Math.max(1,end-start),minutes=length/60;
  const findings=[];const add=(severity,title,detail,value=null)=>findings.push({severity,title,detail,value});
  const damage=[...data.damage.values()].reduce((n,d)=>n+d.amount,0);
  // A few seconds before the first hit: the opener (Recklessness, Charge) belongs to the fight.
  // One press of Odyn's Fury also logs its follow-up hits as casts (385060-385062); only the press counts.
  const casts=data.casts.filter(c=>c.time>=start-5&&c.time<=end+1&&!followUps.includes(c.id)).sort((a,b)=>a.time-b.time);
  const castsOf=list=>casts.filter(c=>has(list,c.id));

  // Enrage drives Fury's mastery and haste; nearly all of a fight should be spent enraged.
  const enrage=intervals(data.auras,buffs.enrage,start,end),enrageUp=pct(total(enrage),length);
  if(enrageUp>=90)add('good','Enrage uptime',`Enraged ${enrageUp}% of the fight.`,enrageUp);
  else add(enrageUp>=80?'tip':'warning','Enrage uptime',`Enraged ${enrageUp}% of the fight; aim for 90% or more. Rampage enrages you, so use it before Enrage runs out, and Bloodthirst or Bloodbath can refresh it too.`,enrageUp);

  // Rage spent is damage; rage over the cap is lost.
  const rage=data.energize.filter(e=>e.type===1);const gained=rage.reduce((n,e)=>n+e.amount,0),wasted=rage.reduce((n,e)=>n+e.over,0);
  const wastedPct=pct(wasted,gained+wasted);
  if(gained>0){
    if(wastedPct<=3)add('good','Rage over the cap',`${Math.round(wasted)} rage (${wastedPct}%) lost to the cap.`,wastedPct);
    else add(wastedPct<=8?'tip':'warning','Rage over the cap',`${Math.round(wasted)} rage (${wastedPct}%) was lost to the cap. Spend on Rampage before you reach it, especially before Bloodthirst, Raging Blow or Recklessness add more.`,wastedPct);
  }

  // Sudden Death: a free Execute; a proc that expires unused is lost damage.
  const sd=data.auras.filter(a=>has(buffs.suddenDeath,a.id));
  const executes=castsOf(ids.execute).map(c=>c.time);
  const procs=sd.filter(a=>a.event==='APPLIED'||a.event==='APPLIED_DOSE').length;
  const expired=sd.filter(a=>(a.event==='REMOVED'||a.event==='REMOVED_DOSE')&&!executes.some(t=>Math.abs(t-a.time)<=0.4)).length;
  if(procs){
    if(expired===0)add('good','Sudden Death',`All ${procs} Sudden Death procs were used.`,0);
    else add(expired/procs>0.15?'warning':'tip','Sudden Death',`${expired} of ${procs} Sudden Death procs ran out unused. Execute is free with the proc; use it before it expires.`,expired);
  }

  // On several targets, single-target attacks without the Whirlwind buff hit only one of them.
  const ww=intervals(data.auras,buffs.whirlwind,start,end);
  const targetsAt=time=>[...data.targets.values()].filter(t=>t.times.some(x=>Math.abs(x-time)<=3)).length;
  const spenders=casts.filter(c=>has(singleTarget,c.id));
  const multi=spenders.filter(c=>targetsAt(c.time)>=2);
  if(multi.length>=10){
    const without=multi.filter(c=>!upAt(ww,c.time)).length,share=pct(without,multi.length);
    if(share<=5)add('good','Whirlwind on several targets',`${100-share}% of your single-target attacks on several targets had the Whirlwind buff.`,share);
    else add(share<=15?'tip':'warning','Whirlwind on several targets',`${without} of ${multi.length} single-target attacks (${share}%) were used on several targets without the Whirlwind buff, so they hit only one. Cast Whirlwind when the buff is down and there is more than one target.`,share);
  }

  // Time without a cast, outside Bladestorm's channel.
  const storm=intervals(data.auras,buffs.bladestorm,start,end);let idle=0;const gaps=[];
  for(let i=1;i<casts.length;i++){
    const a=casts[i-1].time,b=casts[i].time,gap=b-a;
    if(gap>2&&!storm.some(([s,e])=>s<b&&e>a)){idle+=gap-1.5;if(gaps.length<5)gaps.push({at:round(a-start),seconds:round(gap)});}
  }
  const idlePct=pct(idle,length);
  if(idlePct<=3)add('good','Always casting',`Only ${round(idle)} s without a cast.`,idlePct);
  else add(idlePct<=8?'tip':'warning','Time without a cast',`${round(idle)} s (${idlePct}%) passed without a cast, longest at ${gaps.map(g=>`${g.at} s (${g.seconds} s)`).join(', ')}. Keep the global cooldown rolling; when nothing else is ready, Whirlwind or Raging Blow.`,idlePct);

  // Recklessness and what went with it.
  const reck=castsOf(ids.recklessness);const reckUp=intervals(data.auras,buffs.recklessness,start,end);
  const cooldowns=reck.map(r=>({time:round(r.time-start),with:casts.filter(c=>has(majorCooldowns,c.id)&&c.time>=r.time-3&&c.time<=r.time+10).map(c=>c.name)}));
  if(reck.length){
    const first=reck[0].time-start;
    if(first>6)add('tip','First Recklessness',`Recklessness was first used ${round(first)} s in. Opening with it, after a Rampage or Bloodthirst to enrage, gives its full value while everything else is ready too.`,round(first));
    const alone=cooldowns.filter(c=>!c.with.length).length;
    if(alone)add('tip','Cooldowns together',`${alone} of ${reck.length} Recklessness casts had no Bladestorm, Odyn's Fury or other major cooldown within 10 s. They are stronger together.`,alone);
    else add('good','Cooldowns together','Every Recklessness went with a major cooldown.',0);
  }else if(length>60)add('warning','Recklessness',`Recklessness was not used in ${Math.round(length)} s.`,0);

  // Potions: recognised by name, from the auras on the player or the casts.
  const potionName=name=>/potion/i.test(name)||potions.some(p=>name.toLowerCase().startsWith(p.toLowerCase()));
  const potionUses=[...data.auras.filter(a=>a.event==='APPLIED'&&potionName(a.name)),...casts.filter(c=>potionName(c.name))]
    .sort((a,b)=>a.time-b.time).filter((x,i,list)=>!i||x.time-list[i-1].time>5)
    .map(x=>({time:round(x.time-start),name:x.name,withRecklessness:upAt(reckUp,x.time)}));
  if(potionUses.length){
    const off=potionUses.filter(p=>!p.withRecklessness).length;
    if(off)add('tip','Potion timing',`${off} of ${potionUses.length} potions were used outside Recklessness. Drink it with Recklessness (and Bloodlust) so the burst lines up.`,off);
    else add('good','Potion timing','Every potion went with Recklessness.',0);
  }else if(length>=60)add('tip','No potion',`No potion was used in this ${Math.round(length)} s fight. On a boss, drink one at the pull with Recklessness and again near the end or in execute.`,0);

  // Casts per ability, beside SimC's when a simulation is chosen.
  const byName=new Map();
  for(const c of casts){const r=byName.get(c.name)||{name:c.name,id:c.id,casts:0};r.casts++;byName.set(c.name,r);}
  const abilities=[...byName.values()].map(r=>{
    const key=simKey(r.name),simCpm=sim?.[key]??null;
    const dmg=[...data.damage.values()].filter(d=>d.name===r.name).reduce((n,d)=>n+d.amount,0);
    return {...r,cpm:round(r.casts/minutes,2),simCpm:simCpm===null?null:round(simCpm,2),damage:dmg,share:pct(dmg,damage)};
  }).sort((a,b)=>b.casts-a.casts);
  if(sim){
    for(const a of abilities){
      if(a.simCpm===null)continue;
      const diff=a.cpm-a.simCpm;
      if(Math.abs(diff)>=1&&Math.abs(diff)/Math.max(a.simCpm,0.5)>=0.25)add('tip',`${a.name}: ${diff<0?'fewer':'more'} than SimC`,`You cast ${a.name} ${a.cpm} times a minute; SimC casts it ${a.simCpm}. ${diff<0?'It ranks higher in SimC’s priority than in yours.':'SimC spends those global cooldowns on something stronger.'}`,round(diff,2));
    }
    for(const [key,cpm] of Object.entries(sim))if(cpm>=1&&!abilities.some(a=>simKey(a.name)===key))add('tip',`${title(key)} not used`,`SimC casts ${title(key)} ${round(cpm,2)} times a minute; you did not cast it.`,null);
  }
  // The end on a dummy: after the last cast, bleeds and other damage over time tick on. A meter counts that time
  // too, so its DPS is lower than while attacking; the sim's "Stop at the end, let bleeds run out" matches it.
  const lastCast=casts.length?casts.at(-1).time:end,tailSeconds=Math.max(0,end-lastCast);
  const attacking=Math.max(1,lastCast-start+1.5),attackingDamage=data.hits.filter(([t])=>t<=lastCast+1.5).reduce((n,[,a])=>n+a,0);
  const attackingDps=Math.round(attackingDamage/attacking);
  if(tailSeconds>=5)add('tip','Bleeds after you stopped',`Your last cast was ${round(tailSeconds)} s before the last tick. That time counts in the ${Math.round(damage/length).toLocaleString('en-US')} DPS; while attacking it was ${attackingDps.toLocaleString('en-US')}. To compare with a sim, turn on “Stop at the end, let bleeds run out” for ${Math.round(tailSeconds)} s.`,round(tailSeconds));
  const order={warning:0,tip:1,good:2};findings.sort((a,b)=>order[a.severity]-order[b.severity]);
  const spells=[...data.damage.values()].sort((a,b)=>b.amount-a.amount).map(d=>({name:d.name,id:d.id,amount:d.amount,share:pct(d.amount,damage),hits:d.hits,crit:pct(d.crits,d.hits)}));
  return {spec:spec.label,name:data.name,length:round(length),dps:Math.round(damage/length),damage,targets:data.targets.size,
    uptime:{enrage:enrageUp,recklessness:pct(total(reckUp),length),whirlwind:pct(total(ww),length)},rage:{gained:Math.round(gained),wasted:Math.round(wasted)},
    tail:{seconds:round(tailSeconds),attackingDps},findings,abilities,spells,cooldowns,potions:potionUses,casts:casts.map(c=>({t:round(c.time-start,2),name:c.name,id:c.id}))};
}
// SimC names actions after the spell: "Odyn's Fury" is odyns_fury.
export const simKey=name=>String(name).toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
const title=key=>key.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
