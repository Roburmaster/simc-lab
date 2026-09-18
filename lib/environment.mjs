export const buffs = [
  ['arcane_intellect','Arcane Intellect','Raid buffs'],['battle_shout','Battle Shout','Raid buffs'],
  ['power_word_fortitude','Power Word: Fortitude','Raid buffs'],['mark_of_the_wild','Mark of the Wild','Raid buffs'],
  ['skyfury','Skyfury','Raid buffs'],['blessing_of_the_bronze','Blessing of the Bronze','Raid buffs'],
  ['chaos_brand','Chaos Brand','Target debuffs'],['mystic_touch','Mystic Touch','Target debuffs'],
  ['hunters_mark',"Hunter’s Mark",'Target debuffs'],['bleeding','Bleeding','Target debuffs'],['mortal_wounds','Mortal Wounds','Target debuffs'],
  ['bloodlust','Bloodlust / Heroism','Raid buffs']
].map(([id,name,group])=>({id,name,group}));
export function normalizeEnvironment(input={},catalog){
  if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Invalid simulation environment.');
  const selected={};
  for(const b of buffs){const value=input.buffs?.[b.id]??true;if(typeof value!=='boolean')throw new Error(`Invalid ${b.name} setting.`);selected[b.id]=value;}
  for(const key of Object.keys(input.buffs||{}))if(!buffs.some(b=>b.id===key))throw new Error('Unknown raid buff.');
  const variation=Number(input.variation??20);
  if(!Number.isFinite(variation)||variation<0||variation>50)throw new Error('Fight length variation must be 0–50%.');
  const lust={mode:input.bloodlust?.mode??'pull',value:Number(input.bloodlust?.value??0)};
  if(!['pull','time','remaining','health'].includes(lust.mode)||!Number.isFinite(lust.value)||lust.value<0||lust.value>1200||(lust.mode==='health'&&(lust.value<1||lust.value>99))||(lust.mode==='remaining'&&lust.value<1))throw new Error('Invalid Bloodlust timing.');
  const consumables={};
  for(const key of Object.keys(input.consumables||{})){
    if(!['food','flask','potion','augmentation','main_hand_oil','off_hand_oil'].includes(key))throw new Error('Unknown consumable setting.');
    const value=input.consumables[key];const kind=key.endsWith('_oil')?'temporary_enchant':key;
    if(!['profile','none'].includes(value)&&!catalog.consumables[kind].some(c=>c.value===value))throw new Error(`${kind}: choose a verified Midnight consumable.`);
    consumables[key]=value;
  }
  return {buffs:selected,variation,bloodlust:lust,consumables};
}
export function environmentLines(env,profileText=''){
  if(!env)return [];
  const lines=['optimal_raid=0',...buffs.map(b=>`override.${b.id}=${Number(env.buffs[b.id])}`),`vary_combat_length=${env.variation/100}`];
  const lust=env.bloodlust;
  lines.push(`bloodlust_percent=${lust.mode==='health'?lust.value:0}`,`bloodlust_time=${lust.mode==='health'?99999:lust.mode==='remaining'?-lust.value:lust.mode==='time'?lust.value:0}`);
  for(const key of ['food','flask','potion','augmentation']){
    const value=env.consumables[key];if(!value||value==='profile')continue;
    lines.push(`${key}=${value==='none'?'disabled':value}`);
    const allow={food:'food',flask:'flasks',potion:'potions',augmentation:'augmentations'}[key];
    lines.push(`override.allow_${allow}=${value==='none'?0:1}`);
  }
  const oils=['main_hand','off_hand'];
  if(oils.some(slot=>env.consumables[slot+'_oil']&&env.consumables[slot+'_oil']!=='profile')){
    const original=profileText.match(/^temporary_enchant=(.+)$/m)?.[1]||'';
    const entries=Object.fromEntries(original.split('/').filter(v=>v.includes(':')).map(v=>v.split(':')));
    for(const slot of oils){const value=env.consumables[slot+'_oil'];if(value&&value!=='profile')entries[slot]=value==='none'?'disabled':value;}
    lines.push(`temporary_enchant=${Object.entries(entries).map(([slot,value])=>`${slot}:${value}`).join('/')}`);
  }
  return lines;
}
