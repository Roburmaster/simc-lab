// Tank simulation: a calibrated boss replaces SimC's level-70 tank dummy, which never threatens a Midnight tank.
// The boss is tuned once per job against the imported gear, then kept identical for every variant, so stamina,
// armor, avoidance and self-healing change survival exactly as they change the damage the tank takes.
export const tankSpecs={deathknight:['blood'],demonhunter:['vengeance'],druid:['guardian'],monk:['brewmaster'],paladin:['protection'],warrior:['protection']};
export const isTank=info=>!!tankSpecs[info?.class]?.includes(info?.spec);

// pressure: sustained damage taken, % of max health per second. buster: average tank-buster hit after
// mitigation, % of max health, every 30 seconds. magic: share of sustained damage that is magic.
// healGap: seconds between healer top-ups to full health. deathTarget: share of fights the imported gear
// should lose; the buster is resized per character to reach it.
export const presets={
  dungeon:{name:'Mythic+ dungeon',pressure:3,buster:45,magic:30,healGap:5,deathTarget:25},
  heroic:{name:'Heroic raid',pressure:4,buster:50,magic:25,healGap:5,deathTarget:25},
  mythic:{name:'Mythic raid',pressure:5,buster:55,magic:25,healGap:5,deathTarget:25}
};
const limits={pressure:[0.5,20],buster:[0,150],magic:[0,100],healGap:[1,30],deathTarget:[5,60],weight:[0,100]};

export function normalizeTank(input,info){
  if(!isTank(info))return null;
  const options=input&&typeof input==='object'?input:{};
  const preset=options.preset??'mythic';if(!presets[preset])throw new Error('Choose a tank boss preset.');
  const result={preset,...presets[preset],weight:50};
  for(const key of Object.keys(limits)){
    if(options[key]===undefined||options[key]===null||options[key]==='')continue;
    const value=Number(options[key]),[min,max]=limits[key];
    if(!Number.isFinite(value)||value<min||value>max)throw new Error(`Tank ${key} must be ${min}–${max}.`);
    result[key]=value;
  }
  return result;
}

// Enemy lines go before the character so later gear lines apply to the player; profilesets then need
// profileset_main_actor_index=1 because the boss is actor 0.
export function bossLines(boss){
  const r=n=>Math.max(1,Math.round(n));
  const lines=['enemy=Tank_Boss','actions=/auto_attack,damage='+r(boss.auto)+',range='+r(boss.auto*0.1)+',attack_speed=2,aoe_tanks=1'];
  if(boss.buster>0)lines.push('actions+=/melee_nuke,damage='+r(boss.buster)+',range='+r(boss.buster*0.05)+',attack_speed=1,cooldown=30,aoe_tanks=1');
  if(boss.dot>0)lines.push('actions+=/spell_dot,damage='+r(boss.dot)+',range='+r(boss.dot*0.1)+',tick_time=2,dot_duration=30,cooldown=30,aoe_tanks=1');
  return lines;
}
export function survivalLines(boss){
  const lines=[];
  if(boss.healGap)lines.push(`raid_events+=/heal,name=tank_heal,to_pct=100,cooldown=${boss.healGap},duration=0,player_if=role.tank`);
  // Players have infinite health by default; tanks must be able to die for death risk to mean anything.
  if(!boss.immortal)lines.push('infinite_health=0');
  return lines;
}

const z=1.959963984540054;
export function actorTank(report){
  const p=report.sim?.players?.[0],c=p?.collected_data;if(!c?.dtps)return null;
  // Actor reports have no DTPS error; the DPS relative error of the same run stands in for it.
  const relative=Number.isFinite(c.dps?.mean_std_dev)&&c.dps.mean?c.dps.mean_std_dev/c.dps.mean:null;
  const length=c.fight_length?.mean||1,iterations=c.fight_length?.count||c.dps?.count||1;
  // A dead actor's fight length stops at its death, so alive time over simulation length is the share of the fight survived.
  const simulation=report.sim.statistics?.simulation_length?.mean||length;
  return {health:c.buffed_stats?.resources?.health||p.resources?.health||null,dtps:c.dtps.mean/length,hps:c.hps?.mean||0,aps:c.aps?.mean||0,deaths:Math.min(1,(c.deaths?.count||0)/iterations),alive:Math.min(1,length/simulation),aliveError:null,
    netError:relative===null?null:z*relative*c.dtps.mean/length};
}
function boss(report){
  const t=report.sim?.targets?.find(x=>x.name==='Tank_Boss');const stats=t?.stats||[];
  const pick=prefix=>stats.filter(s=>s.name.startsWith(prefix));
  const sum=list=>list.reduce((n,s)=>n+(s.compound_amount||0),0),execs=list=>list.reduce((n,s)=>n+(s.num_executes?.mean||0),0);
  const length=report.sim.players[0].collected_data.fight_length.mean;
  return {sustained:(sum(pick('melee_main_hand'))+sum(pick('spell_dot')))/length,buster:execs(pick('melee_nuke'))?sum(pick('melee_nuke'))/execs(pick('melee_nuke')):0};
}

// Two rounds scale the raw boss numbers until the baseline takes the requested pressure and tank-buster size
// after its own mitigation. Healers then top the tank up on a fixed rhythm.
export async function calibrate(tank,simulate){
  // SimC reports max health only for resources the actor lost, so the probe must actually hurt.
  // How hard the probe has to swing depends on the character: a tank whose talents absorb and mitigate heavily
  // can swallow a small probe whole, take nothing, and report no health at all. So it is raised until something
  // lands rather than assumed to be enough.
  let swing=200000,probe=null;
  for(let step=0;step<8&&!probe?.health;step++){
    probe=actorTank(await simulate({auto:swing,buster:0,dot:0,heal:0,immortal:true},{iterations:20}));
    if(!probe?.health)swing*=8;
  }
  if(!probe?.health)throw new Error(`The tank calibration could not read the character’s health: nothing reached it, even swinging for ${Math.round(swing/8).toLocaleString('en-US')}.`);
  const hp=probe.health;
  let raw={sustained:hp*tank.pressure/100*6,buster:hp*tank.buster/100*6};
  let measured;
  for(let round=0;round<2;round++){
    let report;
    // The same guard on the way in: if nothing lands, the boss is not yet hitting hard enough to measure.
    for(let step=0;step<8;step++){
      const current={auto:raw.sustained*(1-tank.magic/100)*2,dot:raw.sustained*tank.magic/100*2,buster:raw.buster,heal:0,immortal:true};
      report=await simulate(current,{iterations:600});measured=boss(report);
      if(measured.sustained>0)break;
      raw={sustained:raw.sustained*8,buster:raw.buster*8};
    }
    if(!(measured.sustained>0))throw new Error('The tank calibration measured no damage taken, however hard the boss swung.');
    raw={sustained:raw.sustained*(hp*tank.pressure/100)/measured.sustained,buster:measured.buster>0?raw.buster*(hp*tank.buster/100)/measured.buster:0};
  }
  const result={auto:raw.sustained*(1-tank.magic/100)*2,dot:raw.sustained*tank.magic/100*2,buster:raw.buster,healGap:tank.healGap,immortal:false};
  // SimC does not time defensives to tank-busters, so a fixed buster size either kills a spec every time or
  // never. Resizing the buster until the imported gear dies in about deathTarget % of fights keeps death risk
  // sensitive to gear for every tank spec.
  const target=tank.deathTarget/100,low=target*0.6,high=Math.min(0.95,target*1.4);
  let scale=1,below=0,above=null,deaths=null;
  for(let step=0;step<7;step++){
    deaths=actorTank(await simulate({...result,buster:raw.buster*scale},{iterations:300})).deaths;
    if(deaths>=low&&deaths<=high)break;
    if(deaths>high)above=scale;else below=scale;
    scale=above===null?scale*1.6:(below+above)/2;
  }
  return {...result,buster:raw.buster*scale,health:hp,pressure:tank.pressure,
    measured:{sustained:measured.sustained/hp*100,buster:measured.buster*scale/hp*100,deaths:deaths*100,deathTarget:tank.deathTarget,reached:deaths>=low&&deaths<=high}};
}

// Survival change in percent: net damage taken relative to the boss pressure, plus the change in the share of the
// fight survived. Profilesets report death times rather than death rates, so survived time is the common measure.
export function survivalGain(candidate,baseline,boss){
  const pressure=boss.health*boss.pressure/100;
  // Damage taken is already after the tank’s own absorbs, so only its own healing is subtracted.
  const net=m=>m.dtps-m.hps;
  return 100*(net(baseline)-net(candidate))/pressure+100*(candidate.alive-baseline.alive);
}
export function combinedScore(dpsGain,survival,weight){return (1-weight/100)*dpsGain+weight/100*survival;}

export const tankMetricList='dps,dtps,hps,aps,time';
export function profilesetTank(result,simulation){
  const extra=Object.fromEntries((result.additional_metrics||[]).map(m=>[m.metric,m]));
  const get=name=>extra[name]?.mean??0;
  if(!extra['Damage Taken per Second'])return null;
  const time=extra['Fight Length'];
  return {dtps:get('Damage Taken per Second'),hps:get('Healing per Second'),aps:get('Absorb per Second'),alive:time&&simulation?Math.min(1,time.mean/simulation):1,aliveError:time&&simulation&&Number.isFinite(time.mean_stddev)?z*time.mean_stddev/simulation:null,netError:Number.isFinite(extra['Damage Taken per Second'].mean_stddev)?z*extra['Damage Taken per Second'].mean_stddev:null};
}

// One comparison against the baseline of the same run. Errors are approximate 95% intervals combined in quadrature.
export function tankComparison(row,base,boss,weight){
  const pressure=boss.health*boss.pressure/100;
  const dpsGain=100*(row.dps-base.dps)/base.dps,survival=survivalGain(row.tank,base.tank,boss),score=combinedScore(dpsGain,survival,weight);
  const dpsError=100*Math.hypot(row.error95||0,base.error95||0)/base.dps;
  // SimC gives no usable error for survived time; a death-or-not bound (at most the binomial spread) stands in.
  const aliveError=(m,n)=>m.aliveError||(n?z*Math.sqrt(Math.max(m.alive*(1-m.alive),1/n)/n):0);
  const survivalError=Math.hypot(100*Math.hypot(row.tank.netError||0,base.tank.netError||0)/pressure,100*Math.hypot(aliveError(row.tank,row.iterations),aliveError(base.tank,base.iterations)));
  return {dpsGain,survival,score,scoreError:Math.hypot((1-weight/100)*dpsError,weight/100*survivalError)};
}
