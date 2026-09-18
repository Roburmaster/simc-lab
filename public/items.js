export const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const gearGroups=[['Weapons',['main_hand','off_hand']],['Armor',['head','shoulder','chest','wrist','hands','waist','legs','feet']],['Jewelry & cloak',['neck','back','finger1','finger2']],['Trinkets',['trinket1','trinket2']]];
export const slotNames={main_hand:'Main hand',off_hand:'Off hand',head:'Head',shoulder:'Shoulders',chest:'Chest',wrist:'Wrists',hands:'Hands',waist:'Waist',legs:'Legs',feet:'Feet',neck:'Neck',back:'Cloak',finger1:'Ring 1',finger2:'Ring 2',trinket1:'Trinket 1',trinket2:'Trinket 2'};
export function slotOptions(allowed){return gearGroups.map(([name,slots])=>`<optgroup label="${name}">${slots.filter(s=>!allowed||allowed.includes(s)).map(s=>`<option value="${s}">${slotNames[s]}</option>`).join('')}</optgroup>`).join('');}
export function itemLink(id,name,value=''){
  if(!Number.isSafeInteger(Number(id))||Number(id)<=0)return escape(name);
  const params=[`item=${Number(id)}`];
  for(const [key,target,list] of [['bonus_id','bonus',true],['gem_id','gems',true],['enchant_id','ench',false],['ilevel','ilvl',false]]){
    const raw=value.match(new RegExp(`(?:^|,)${key}=([^,\\s]+)`))?.[1];
    if(raw&&new RegExp(list?'^\\d+(?:/\\d+)*$':'^\\d+$').test(raw))params.push(`${target}=${raw.replaceAll('/',':')}`);
  }
  return `<a class="item-link" href="https://www.wowhead.com/item=${Number(id)}" data-wowhead="${escape(params.join('&'))}" target="_blank" rel="noopener noreferrer">${escape(name)}</a>`;
}
export function importedCards(profile){
  const alternatives=profile?.alternatives||[];
  const groups=[...gearGroups,['Saved talent builds',[null]]];
  return `<div class="gear-category-list">${groups.map(([name,slots])=>{
    const count=alternatives.filter(v=>slots.includes(v.slot)).length;
    const equipped=slots.filter(s=>profile?.gear[s]).length;
    if(!count&&!equipped)return '';
    return `<details class="gear-category" open><summary>${name}<span class="pill">${count} alternatives${equipped?` · ${equipped} equipped`:''}</span></summary><div class="gear-slot-grid">${slots.map(slot=>{
      const items=alternatives.map((v,i)=>({...v,index:i})).filter(v=>v.slot===slot);const current=profile?.gear[slot];
      if(!items.length&&!current)return '';
      return `<section class="gear-slot-group"><h3>${slotNames[slot]||'In-game loadouts'}</h3>${current?`<article class="gear-item equipped"><span class="gear-item-state">EQUIPPED · ALWAYS INCLUDED</span><strong>${itemLink(current.id,current.item?.name||`Item ${current.id}`,current.value)}</strong></article>`:''}${items.map(v=>{const id=Number(v.text.match(/(?:^|,)id=(\d+)/)?.[1]);return `<article class="gear-item selectable" data-imported-card="${v.index}" tabindex="0" aria-label="Compare ${escape(v.name)}"><strong>${slot?itemLink(id,v.name,v.text):escape(v.name)}</strong><small>${escape(v.section||'Imported alternative')}</small><button class="text-button" data-add-imported="${v.index}" aria-pressed="false">+ Compare ${slot?'item':'build'}</button></article>`;}).join('')}</section>`;
    }).join('')}</div></details>`;
  }).join('')}</div>`;
}
