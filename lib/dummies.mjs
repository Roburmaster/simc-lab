// The five Cleave Training Dummies in Silvermoon City (NPC 243208), measured from a combat log taken beside them on
// WoW 12.1.0 (2026-10-02):
// - five dummies stacked within 4 yards, 3,537,050 health each, level 90 like the player;
// - armor 1,470: every physical hit lost exactly 30%, which SimC already gives (armor 1,470 against the attacker's
//   level-90 constant 3,430), so armor needs no option;
// - they cannot die. Busy as they always are, each sat at 1 health 78% of the time and never rose above 8%, so
//   every execute effect is up the whole fight;
// - nothing but the player's own effects raised the damage they took: no Mystic Touch, Chaos Brand or Hunter's
//   Mark; the player had no Fortitude either (maximum health exactly 5% under SimC's), and no Bloodlust or potion;
// - they never attack (SimC's default enemy hits the player, which feeds damage-taken procs, so they only wait).
// So the page starts this fight with every buff, debuff and consumable off (environment.js, bare()); the user turns
// on what they had, and nothing here forces any of it.
// SimC creates extra targets with its defaults, so every dummy is declared on its own, before the player: options
// that follow belong to the player again, and the player becomes actor `count` for profilesets.
//
// Health has two modes:
// - 'held': at 1% the whole fight, as the busy city dummies were;
// - 'falling': each dummy starts at 100% and the player's own damage takes it down to 1%, where it stays because it
//   cannot die. SimC cannot do that directly (real health ends the fight when the first target dies, and the other
//   four would die at 0), so it is measured: short calibration runs hold the dummies in each health band that
//   changes a rotation (above 80%, above 35%, above 20%, execute) and read how much damage each dummy takes per
//   second there (SimC reports damage taken only for tanks, hence role=tank, which changes nothing else). From those
//   rates every dummy gets its own health timeline, in shares of the fight as SimC counts it.
export const silvermoon={npc:243208,name:'Cleave_Training_Dummy',count:5,health:3537050,heldAt:1};
export const dummyStyles={SilvermoonDummies:{label:'Silvermoon dummies'}};
export const isDummyStyle=style=>Object.hasOwn(dummyStyles,style);
export const dummyHealthModes=['held','falling'];
// The bands a falling dummy passes through, and the health it is held at to measure each one.
export const bands=[{from:100,to:80,at:90},{from:80,to:35,at:50},{from:35,to:20,at:30},{from:20,to:silvermoon.heldAt,at:silvermoon.heldAt}];

export function normalizeDummyHealth(input){
  const mode=input?.mode??'held';
  if(!dummyHealthModes.includes(mode))throw new Error('Choose how the dummies’ health behaves.');
  return {mode};
}
export const needsCalibration=scenario=>isDummyStyle(scenario?.style)&&scenario.dummyHealth?.mode==='falling'&&!scenario.dummyHealth.timelines;

// One dummy's timeline from its damage taken per second in each band (`rates`, in bands order) over `duration`.
// Returns the SimC option value and the second it reaches 1% (null when the fight ends first).
export function fallTimeline(rates,duration){
  const points=[[100,0]];let t=0,reached=null;
  for(const [i,band] of bands.entries()){
    const rate=Math.max(1,rates[i]);const span=(band.from-band.to)/100*silvermoon.health/rate;
    if(t+span>=duration){points.push([band.from-(band.from-band.to)*(duration-t)/span,1]);t=duration;break;}
    t+=span;points.push([band.to,t/duration]);
    if(band.to===silvermoon.heldAt)reached=t;
  }
  // The last point must be at 1.0, or SimC adds one at 0% health.
  if(points.at(-1)[1]<1)points.push([silvermoon.heldAt,1]);
  return {timeline:points.map(([h,s])=>`${Number(h.toFixed(2))}:${Number(s.toFixed(4))}`).join('/'),reached:reached===null?null:Math.round(reached*10)/10};
}
// From the calibration reports (one per band, in bands order): every dummy's timeline.
export function calibrate(reports,duration){
  const perBand=reports.map(r=>r.sim.targets.slice(0,silvermoon.count).map(t=>(t.collected_data?.dtps?.mean||0)/Math.max(1,t.collected_data?.fight_length?.mean||duration)));
  const fits=Array.from({length:silvermoon.count},(_,i)=>fallTimeline(perBand.map(b=>b[i]),duration));
  return {mode:'falling',timelines:fits.map(f=>f.timeline),reached:fits.map(f=>f.reached),rates:perBand.map(b=>b.map(Math.round))};
}

function healthLines(health,i){
  if(health?.calibrate!==undefined)return [`enemy_fixed_health_percentage=${health.calibrate}`,'role=tank'];
  if(health?.mode==='falling'&&health.timelines)return [`enemy_custom_health_timeline=${health.timelines[i]}`];
  return [`enemy_fixed_health_percentage=${silvermoon.heldAt}`];
}
export function dummyLines(style,health=null){
  if(!isDummyStyle(style))return [];
  const lines=['target_level+=0'];
  for(let i=0;i<silvermoon.count;i++)lines.push(`enemy=${silvermoon.name}_${i+1}`,...healthLines(health,i),'actions=wait,sec=10');
  return lines;
}
// How many enemies are declared before the player in a fight of this style.
export const dummyCount=style=>isDummyStyle(style)?silvermoon.count:0;
// The dummies are always five; buffs and consumables are the environment's, as the user sets them.
export const dummyScenario={targets:silvermoon.count};
