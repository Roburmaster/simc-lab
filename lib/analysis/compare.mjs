// SimC beside a combat log: the simulation that matches a fight, and the two cast sequences set against each other.
//
// SimC's sequence is one sample iteration, with its own procs, crits and rage, so a single event that differs may be
// chance rather than a mistake. Small shifts in time count as the same cast; only a difference that repeats through
// the fight is marked as large.
import {simKey} from './fury.mjs';

// The simulation that matches a fight: the Silvermoon dummies when they were the targets, otherwise Patchwerk on as
// many targets as were hit; as long as the player attacked, with the bleed tail after it; and no buffs, as on a dummy
// (they can be turned on in Quick Sim).
export function fightSetup(fight,data,analysis){
  const names=[...data.targets.values()].map(t=>t.name);
  const dummies=names.some(n=>/Cleave Training Dummy/i.test(n));
  const busy=[...data.targets.values()].filter(t=>t.hits>=Math.max(5,0.05*Math.max(...[...data.targets.values()].map(x=>x.hits)))).length;
  const attacking=Math.max(20,Math.round(analysis.length-(analysis.tail?.seconds||0)));
  return {
    style:dummies?'SilvermoonDummies':'Patchwerk',targets:dummies?5:Math.max(1,Math.min(20,busy)),duration:attacking,
    ...(analysis.tail?.seconds>=5?{bleedTail:Math.min(60,Math.round(analysis.tail.seconds))}:{}),
    ...(dummies?{dummyHealth:{mode:'held'}}:{}),
    label:dummies?'Silvermoon dummies':`${fight.kind==='encounter'?fight.name:'Patchwerk'} · ${busy} target${busy===1?'':'s'}`
  };
}

// What counts as a cast on each side. SimC's sequence also holds stance toggles and helper actions.
const skip=/^(auto_attack|snapshot_stats|berserker_stance|battle_stance|defensive_stance|variable|call_action_list|run_action_list|use_items|wait|pool_resource)$/;
export const simCasts=sequence=>sequence.filter(e=>!skip.test(e.name)).map(e=>({t:e.t,key:e.name,name:e.spell||e.name,rage:e.rage,buffs:e.buffs||[]}));
// Charge logs two spells for one press; the same name within a moment is one cast.
export const logCasts=casts=>casts.filter(c=>!/^(Battle Shout|Berserker Stance)$/.test(c.name)).filter((c,i,list)=>!(i&&list[i-1].name===c.name&&c.t-list[i-1].t<0.3)).map(c=>({t:c.t,key:simKey(c.name),name:c.name}));

// Sets the two sequences against each other (an alignment: the same ability close in time is a match, everything else
// is a cast only one side made). Both are timed from their own first cast.
export function align(sim,log,{window=6}={}){
  const zero=list=>{const t0=list[0]?.t??0;return list.map(e=>({...e,at:e.t-t0}));};
  const a=zero(sim),b=zero(log),n=a.length,m=b.length,gap=1;
  const cost=(x,y)=>x.key!==y.key?Infinity:Math.min(1.9,Math.abs(x.at-y.at)/window);
  // Classic edit distance with a band in time, so a long fight stays quick.
  const D=Array.from({length:n+1},()=>new Float64Array(m+1).fill(Infinity)),P=Array.from({length:n+1},()=>new Uint8Array(m+1));
  D[0][0]=0;for(let i=1;i<=n;i++){D[i][0]=i*gap;P[i][0]=1;}for(let j=1;j<=m;j++){D[0][j]=j*gap;P[0][j]=2;}
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){
    if(Math.abs(a[i-1].at-b[j-1].at)>30){if(b[j-1].at>a[i-1].at+30)break;}
    let best=D[i-1][j]+gap,step=1;
    if(D[i][j-1]+gap<best){best=D[i][j-1]+gap;step=2;}
    const c=cost(a[i-1],b[j-1]);if(D[i-1][j-1]+c<best){best=D[i-1][j-1]+c;step=3;}
    D[i][j]=best;P[i][j]=step;
  }
  const rows=[];let i=n,j=m;
  while(i>0||j>0){
    const step=i===0?2:j===0?1:P[i][j]||(D[i-1][j]<=D[i][j-1]?1:2);
    if(step===3){rows.push({sim:a[i-1],log:b[j-1]});i--;j--;}else if(step===1){rows.push({sim:a[i-1],log:null});i--;}else{rows.push({sim:null,log:b[j-1]});j--;}
  }
  return classify(rows.reverse());
}

// Colours and words for every row. A cast SimC made that you did not (or the reverse) is large when the same thing
// happens again and again over the fight, small when it is a one-off that may be chance.
export function classify(rows){
  const missed={},extra={};
  for(const r of rows){if(r.sim&&!r.log)missed[r.sim.key]=(missed[r.sim.key]||0)+1;if(r.log&&!r.sim)extra[r.log.key]=(extra[r.log.key]||0)+1;}
  const repeated=(counts,key)=>counts[key]>=3;
  const near=(i,side)=>{for(let k=Math.max(0,i-2);k<=Math.min(rows.length-1,i+2);k++)if(k!==i&&rows[k][side]&&!rows[k][side==='log'?'sim':'log'])return rows[k][side];return null;};
  const out=rows.map((r,i)=>{
    if(r.sim&&r.log){
      const dt=r.log.at-r.sim.at,abs=Math.abs(dt);
      if(abs<1.5)return {...r,kind:'same',size:'none',note:`${r.log.name} as SimC.`};
      return {...r,kind:dt>0?'late':'early',size:abs>=4?'large':'small',note:`${r.log.name} ${abs.toFixed(1)} s ${dt>0?'later':'earlier'} than SimC.${abs>=4&&dt>0?' Something else took its place first.':''}`};
    }
    if(r.sim){
      const instead=near(i,'log');
      return {...r,kind:'missed',size:repeated(missed,r.sim.key)?'large':'small',note:`SimC used ${r.sim.name} here${r.sim.rage!=null?` at ${Math.round(r.sim.rage)} rage`:''}; you did not${instead?`, you used ${instead.name} instead`:''}.${repeated(missed,r.sim.key)?` This happens ${missed[r.sim.key]} times in the fight.`:''}`};
    }
    const instead=near(i,'sim');
    return {...r,kind:'extra',size:repeated(extra,r.log.key)?'large':'small',note:`You used ${r.log.name}; SimC did not${instead?` (it used ${instead.name})`:''}.${repeated(extra,r.log.key)?` You do this ${extra[r.log.key]} times.`:''}`};
  });
  const count=f=>out.filter(f).length;
  return {rows:out,summary:{same:count(r=>r.kind==='same'),small:count(r=>r.size==='small'),large:count(r=>r.size==='large'),
    missed:Object.entries(missed).sort((a,b)=>b[1]-a[1]),extra:Object.entries(extra).sort((a,b)=>b[1]-a[1])}};
}
