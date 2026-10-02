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
// A fresh pull of five at full health was tried and left out: SimC ends a fixed-health fight when the first target
// dies, and its DungeonRoute pulls drop raid buffs and target debuffs, so neither measures the city's dummies.
export const silvermoon={npc:243208,name:'Cleave_Training_Dummy',count:5,health:3537050,heldAt:1};
export const dummyStyles={SilvermoonDummies:{label:'Silvermoon dummies · 5 in execute'}};
export const isDummyStyle=style=>Object.hasOwn(dummyStyles,style);

export function dummyLines(style){
  if(!isDummyStyle(style))return [];
  const lines=['target_level+=0'];
  for(let i=1;i<=silvermoon.count;i++)lines.push(`enemy=${silvermoon.name}_${i}`,`enemy_fixed_health_percentage=${silvermoon.heldAt}`,'actions=wait,sec=10');
  return lines;
}
// How many enemies are declared before the player in a fight of this style.
export const dummyCount=style=>isDummyStyle(style)?silvermoon.count:0;
// The dummies are always five; buffs and consumables are the environment's, as the user sets them.
export const dummyScenario={targets:silvermoon.count};
