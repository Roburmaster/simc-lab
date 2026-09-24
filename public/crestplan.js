// Spending order for crests, shared by the page and the tests. Each option is one measured upgrade of an equipped
// item: {id (the item in its slot), to (target level), gain, crests (from the equipped level), currencyId}.
// The plan repeatedly takes the step with the most gain per crest that the remaining crests pay for. A step may
// skip levels when a later level pays better than the next one. Gains of different slots are treated as additive.
export function spendingPlan(options,budget){
  const left=budget?{...budget}:null;const byItem=new Map();
  for(const o of options){if(!Number.isFinite(o.gain))continue;if(!byItem.has(o.id))byItem.set(o.id,[]);byItem.get(o.id).push(o);}
  const at=new Map([...byItem.keys()].map(id=>[id,{to:0,gain:0,crests:0}]));const steps=[];
  for(;;){
    let best=null;
    for(const [id,list] of byItem){
      const cur=at.get(id);
      for(const o of list){
        if(o.to<=cur.to)continue;
        const gain=o.gain-cur.gain,crests=o.crests-cur.crests;
        if(gain<=0||crests<0)continue;
        if(left&&crests>0&&(left[o.currencyId]??0)<crests)continue;
        const value=crests===0?Infinity:gain/crests;
        // On equal value the smaller step wins, so the order stays level by level.
        if(!best||value>best.value||value===best.value&&(crests<best.crests||crests===best.crests&&gain>best.gain))best={o,from:cur,gain,crests,value};
      }
    }
    if(!best)break;
    const {o}=best;
    if(left&&best.crests)left[o.currencyId]-=best.crests;
    steps.push({option:o,from:best.from.to,to:o.to,gain:best.gain,crests:best.crests,currencyId:o.currencyId,perCrest:best.value});
    at.set(o.id,{to:o.to,gain:o.gain,crests:o.crests});
  }
  const spent={};for(const s of steps)if(s.crests)spent[s.currencyId]=(spent[s.currencyId]||0)+s.crests;
  return {steps,spent,left,gain:steps.reduce((n,s)=>n+s.gain,0)};
}
