export const slotTypes={head:[1],neck:[2],shoulder:[3],back:[16],chest:[5,20],wrist:[9],hands:[10],waist:[6],legs:[7],feet:[8],finger1:[11],finger2:[11],trinket1:[12],trinket2:[12],main_hand:[13,17,21,15,26],off_hand:[13,14,22,23]};
export const hasTitansGrip=info=>info?.class==='warrior'&&info?.spec==='fury'&&Number(info.level??90)>=11;
export function fitsSlot(item,slot,info){
  if(!item)return false;
  if(slot==='off_hand'&&item.inventoryType===17)return hasTitansGrip(info)&&item.itemClass===2;
  return !!slotTypes[slot]?.includes(item.inventoryType);
}
export function expandWeaponAlternatives(profile,catalog){
  if(!hasTitansGrip(profile.info))return profile.alternatives;
  const result=[...profile.alternatives],seen=new Set(result.map(v=>v.text));
  for(const v of profile.alternatives){
    if(!['main_hand','off_hand'].includes(v.slot))continue;
    const id=Number(v.text.match(/(?:^|,)id=(\d+)/)?.[1]),item=catalog.items.get(id);
    if(item?.inventoryType!==17||item.itemClass!==2)continue;
    const slot=v.slot==='main_hand'?'off_hand':'main_hand';
    const text=v.text.replace(new RegExp(`^${v.slot}=`),slot+'=');
    if(!seen.has(text)){result.push({...v,slot,text});seen.add(text);}
  }
  return result;
}
