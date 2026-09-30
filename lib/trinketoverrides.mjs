// Trinkets SimulationCraft cannot simulate from item and item level alone. Some roll one of several stats (the
// bonus ID decides which), and some have a mode the player chooses, which SimC takes as an option line. Each such
// trinket is simulated once per choice, as its own entry, so a result never depends on which one the loot table
// happened to list first. Kept in one place: nothing else in the app names a trinket.
//
// `bonusIds` are the item's choice bonuses; a variant's `bonusId` replaces whichever of them the item carries.
// `options` are SimC option lines added to the profileset that wears the variant.
const stats=ids=>['Crit','Haste','Mastery','Versatility'].map((label,i)=>({label,bonusId:ids[i]}));
export const trinketOverrides=new Map([
  // Drum of Renewed Bonds rolls one secondary stat.
  [248583,{bonusIds:[13183,13184,13185,13186],variants:stats([13183,13184,13185,13186])}],
  // Forgotten Farstrider's Insignia rolls one secondary stat.
  [250462,{bonusIds:[606,604,605,607],variants:stats([606,604,605,607])}],
  // Ruby Whelp Shell (reissued in Mythic+): the whelp is trained to one of four behaviours, six times.
  [193757,{variants:[
    {label:'Fire Shot',options:['dragonflight.player.ruby_whelp_shell_training=fire_shot:6']},
    {label:'Lobbing Fire Nova',options:['dragonflight.player.ruby_whelp_shell_training=lobbing_fire_nova:6']},
    {label:'Under Red Wings',options:['dragonflight.player.ruby_whelp_shell_training=under_red_wings:6']},
    {label:'Sleepy Ruby Warmth',options:['dragonflight.player.ruby_whelp_shell_training=sleepy_ruby_warmth:6']}
  ]}],
  // Crucible of Erratic Energies: the player chooses which energies it releases.
  [264507,{variants:[
    {label:'Violence',options:['midnight.crucible_of_erratic_energies_violence=1']},
    {label:'Sustenance',options:['midnight.crucible_of_erratic_energies_sustenance=1']},
    {label:'Predation',options:['midnight.crucible_of_erratic_energies_predation=1']},
    {label:'All three',options:['midnight.crucible_of_erratic_energies_predation=1','midnight.crucible_of_erratic_energies_sustenance=1','midnight.crucible_of_erratic_energies_violence=1']}
  ]}]
]);

// The variants of one trinket: its bonus IDs with the choice applied, the option lines, and the label. A trinket with
// no override is its own single variant.
export function trinketVariants(itemId,bonuses){
  const override=trinketOverrides.get(itemId);
  if(!override)return [{bonuses,options:[]}];
  // The choice takes the place of the one the item carries; an item carrying none gets it in front.
  const at=bonuses.findIndex(id=>override.bonusIds?.includes(id));
  return override.variants.map(v=>({
    label:v.label,
    bonuses:!v.bonusId?bonuses:at<0?[v.bonusId,...bonuses]:bonuses.map((id,i)=>i===at?v.bonusId:id),
    options:v.options||[]
  }));
}
