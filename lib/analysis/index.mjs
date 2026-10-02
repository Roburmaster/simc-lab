// Rotation analysis from combat logs, one module per specialization. Fury Warrior is the first; a spec without a
// module is named so the page can say it is not analysed yet.
import * as fury from './fury.mjs';
export const analysers=[fury];
export const supported=analysers.map(a=>a.spec.label);
export function analyserFor(data){return analysers.find(a=>a.spec.id===data.spec)||analysers.find(a=>a.isFury?.(data))||null;}

// SimC's casts per minute by action from a finished simulation report, for the side-by-side comparison.
export function simCastsPerMinute(report){
  const player=report?.sim?.players?.[0];if(!player)return null;
  const minutes=(player.collected_data?.fight_length?.mean||0)/60;if(!minutes)return null;
  // What the action list pressed in the sample iteration; procs, ticks and heals have executes too but are not casts.
  const pressed=new Set([...(player.collected_data?.action_sequence||[]),...(player.collected_data?.action_sequence_precombat||[])].map(e=>e.name).filter(Boolean));
  const out={};
  for(const s of player.stats||[]){
    const executes=s.num_executes?.mean||0;
    // Only what the player presses: auto attacks and procs are not casts.
    if(executes>0&&pressed.has(s.name)&&!/^auto_attack/.test(s.name))out[s.name]=(out[s.name]||0)+executes/minutes;
  }
  return out;
}
// SimC's sample sequence of one iteration, and the action list it followed, for the rotation view.
export function simRotation(report,aplText=''){
  const player=report?.sim?.players?.[0];if(!player)return null;
  const cd=player.collected_data||{};
  const sequence=(cd.action_sequence||[]).filter(e=>e.name).map(e=>({t:Math.round(e.time*100)/100,name:e.name,spell:e.spell_name||e.name,target:e.target,rage:e.resources?.rage??null,buffs:(e.buffs||[]).map(b=>b.name)}));
  const precombat=(cd.action_sequence_precombat||[]).filter(e=>e.name).map(e=>e.name);
  const apl=String(aplText).split(/\r?\n/).filter(l=>/^actions/.test(l));
  return {player:player.name,specialization:player.specialization,precombat,sequence,apl,castsPerMinute:simCastsPerMinute(report)};
}
