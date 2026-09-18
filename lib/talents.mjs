import fs from 'node:fs/promises';
import path from 'node:path';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const token=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
export async function loadTalentData(directory,source){
  const trees=JSON.parse(await fs.readFile(path.join(directory,'talents.json'),'utf8'));
  const dbc=await fs.readFile(path.join(source,'engine/dbc/generated/trait_data.inc'),'utf8');
  const entries=new Map([...dbc.matchAll(/\{\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),/g)].map(m=>[+m[3],{tree:+m[1],classId:+m[2],node:+m[4],ranks:+m[5],gate:+m[6]}]));
  return {trees,entries,find(info){const tree=trees.find(t=>token(t.className)===token(info.class)&&token(t.specName)===token(info.spec));if(!tree)throw new Error('No live talent tree is available for this specialization.');return tree;}};
}
export function nodeMap(tree){return new Map([...tree.classNodes,...tree.specNodes,...tree.heroNodes,...tree.subTreeNodes].map(n=>[n.id,n]));}
export function decodeTalents(text,tree){
  if(typeof text!=='string'||!/^[A-Za-z0-9+/]+$/.test(text))throw new Error('Import a current in-game talent export string.');
  let offset=0;const read=count=>{let n=0;for(let i=0;i<count;i++){if(offset>=text.length*6)throw new Error('The talent export is truncated.');n+=(alphabet.indexOf(text[Math.floor(offset/6)])>>(offset%6)&1)*2**i;offset++;}return n;};
  const version=read(8),spec=read(16),hash=Array.from({length:16},()=>read(8));
  if(version!==2||spec!==tree.specId)throw new Error('The talent export version or specialization does not match the character.');
  const nodes=nodeMap(tree),selected={};
  for(const id of tree.fullNodeOrder){
    if(!read(1))continue;
    const node=nodes.get(id);if(!node)throw new Error(`Selected talent node ${id} is not available to this specialization.`);
    const purchased=!!read(1);let rank=node.maxRanks||1,choice=0;
    if(purchased){if(read(1))rank=read(6);if(read(1))choice=read(2);}else rank=1;
    if(!node.entries[choice])throw new Error(`Invalid choice at talent node ${id}.`);
    selected[id]={rank,entry:node.entries[choice].id,purchased};
  }
  return {version,spec,hash,selected};
}
export function encodeTalents(build,tree){
  const bits=[];const write=(n,count)=>{for(let i=0;i<count;i++)bits.push((n>>i)&1);};
  write(2,8);write(tree.specId,16);for(const b of build.hash)write(b,8);
  const nodes=nodeMap(tree);
  for(const id of tree.fullNodeOrder){const s=build.selected[id];write(s?1:0,1);if(!s)continue;const n=nodes.get(id);write(s.purchased?1:0,1);if(!s.purchased)continue;
    const partial=s.rank<(n.maxRanks||1);write(partial?1:0,1);if(partial)write(s.rank,6);
    const choice=n.type==='choice'||n.type==='subtree';write(choice?1:0,1);if(choice)write(n.entries.findIndex(e=>e.id===s.entry),2);
  }
  let result='';for(let i=0;i<bits.length;i+=6){let n=0;for(let j=0;j<6;j++)n|=(bits[i+j]||0)<<j;result+=alphabet[n];}return result;
}
export function pointTotals(build,tree){
  const totals={class:0,spec:0,hero:0};
  for(const [key,nodes] of [['class',tree.classNodes],['spec',tree.specNodes],['hero',tree.heroNodes]])for(const n of nodes){const s=build.selected[n.id];if(s?.purchased)totals[key]+=s.rank;}
  return totals;
}
export function selectedHero(build,tree){const n=tree.subTreeNodes.find(n=>build.selected[n.id]);return n?.entries.find(e=>e.id===build.selected[n.id].entry)?.traitSubTreeId;}
export function validateBuild(build,tree,{budgets,level=90,entries,locks={},baseline}={}){
  const nodes=nodeMap(tree),selected=build.selected,errors=[];const hero=selectedHero(build,tree);
  if(tree.subTreeNodes.filter(n=>selected[n.id]).length!==1)errors.push('Select exactly one hero tree.');
  for(const [id,s] of Object.entries(selected)){
    const n=nodes.get(+id);if(!n){errors.push(`Unknown node ${id}.`);continue;}
    if(!Number.isInteger(s.rank)||s.rank<1||s.rank>(n.maxRanks||1))errors.push(`Invalid rank for ${n.name}.`);
    if(!n.entries.some(e=>e.id===s.entry))errors.push(`Invalid choice for ${n.name}.`);
    if(n.subTreeId&&n.subTreeId!==hero&&s.purchased)errors.push(`Mixed hero trees: ${n.name}.`);
    if(n.rankLevels){const max=Math.max(0,...n.rankLevels.filter(r=>r.level<=level).map(r=>r.maxRanks));if(s.rank>max)errors.push(`${n.name} requires a higher level.`);}
    if(n.freeNode&&(!n.freeLevel||level>=n.freeLevel)){if(s.purchased||s.rank!==1)errors.push(`${n.name} must be granted.`);}else if(!s.purchased)errors.push(`${n.name} cannot be granted for free.`);
    if(n.requiresNode&&nodes.has(n.requiresNode)&&!selected[n.requiresNode])errors.push(`${n.name} requires another talent.`);
    if(entries&&n.type!=='subtree'&&!n.entries.every(e=>entries.has(e.id)))errors.push(`SimC data does not contain ${n.name}.`);
  }
  // Reconstruct a valid purchase sequence. Gates count only points already spent,
  // so talents beyond a gate can never unlock themselves or one another.
  for(const [key,group] of [['class',tree.classNodes],['spec',tree.specNodes],['hero',tree.heroNodes.filter(n=>n.subTreeId===hero)]]){
    for(const n of group)if(n.freeNode&&(!n.freeLevel||level>=n.freeLevel)&&!selected[n.id])errors.push(`Missing granted talent ${n.name}.`);
    const bought=new Set(group.filter(n=>selected[n.id]&&!selected[n.id].purchased).map(n=>n.id));
    const pending=group.filter(n=>selected[n.id]?.purchased);let spent=0,progress=true;
    while(pending.length&&progress){progress=false;for(let i=pending.length-1;i>=0;i--){const n=pending[i];const parents=n.prev||[];if((n.reqPoints||0)>spent)continue;if(parents.length&&!parents.some(id=>bought.has(id)&&selected[id]?.rank===(nodes.get(id)?.maxRanks||1)))continue;bought.add(n.id);spent+=selected[n.id].rank;pending.splice(i,1);progress=true;}}
    if(pending.length)errors.push(`Disconnected or point-gated ${key} talents: ${pending.map(n=>n.name).join(', ')}.`);
    if(budgets&&spent!==budgets[key])errors.push(`${key} tree uses ${spent} points; expected ${budgets[key]}.`);
  }
  if(baseline)for(const id of Object.keys(locks))if(JSON.stringify(selected[id]||null)!==JSON.stringify(baseline.selected[id]||null))errors.push(`Locked talent ${id} was changed.`);
  return errors;
}
function clone(build){return {...build,selected:structuredClone(build.selected)};}
export function generateCandidates(build,tree,options={}){
  const {limit=32,scope='specHero',locks={},entries}=options;
  const budgets=pointTotals(build,tree);const baseErrors=validateBuild(build,tree,{budgets,entries});
  if(baseErrors.length)throw new Error('The imported talent build cannot be used for optimization: '+baseErrors.join(' '));
  const groups=[tree.specNodes,...(scope==='all'?[tree.classNodes]:[]),...(scope!=='spec'?[tree.heroNodes]:[])];
  const editable=groups.flat().filter(n=>n.type!=='subtree'&&!n.freeNode&&!locks[n.id]);
  const original=encodeTalents(build,tree),seen=new Set([original]),candidates=[],queue=[build];
  let checked=0;
  function consider(candidate,description){
    checked++;if(validateBuild(candidate,tree,{budgets,entries,locks,baseline:build}).length)return;
    const talents=encodeTalents(candidate,tree);if(seen.has(talents))return;seen.add(talents);queue.push(candidate);candidates.push({name:description,talents,build:candidate});
  }
  for(let q=0;q<queue.length&&candidates.length<limit&&checked<50000;q++){
    const current=queue[q];
    for(const n of editable){const s=current.selected[n.id];if(!s)continue;
      if(n.type==='choice')for(const e of n.entries){if(e.id===s.entry)continue;const c=clone(current);c.selected[n.id].entry=e.id;consider(c,`${e.name}${q?' · combined':''}`);if(candidates.length>=limit)break;}
      if(candidates.length>=limit)break;
    }
    if(candidates.length>=limit)break;
    for(const group of groups){
      const eligible=group.filter(n=>editable.includes(n)&&(!n.subTreeId||n.subTreeId===selectedHero(current,tree)));
      for(const remove of eligible){const from=current.selected[remove.id];if(!from?.purchased)continue;
        for(const add of eligible){if(remove.id===add.id)continue;const to=current.selected[add.id];if(to?.rank>=add.maxRanks)continue;
          for(const entry of to?[add.entries.find(e=>e.id===to.entry)]:[add.entries[0]]){const c=clone(current);if(from.rank===1)delete c.selected[remove.id];else c.selected[remove.id].rank--;c.selected[add.id]={rank:(to?.rank||0)+1,entry:entry.id,purchased:true};consider(c,`${remove.name} → ${add.name}${q?' · combined':''}`);}
          if(candidates.length>=limit||checked>=50000)break;
        }if(candidates.length>=limit||checked>=50000)break;
      }if(candidates.length>=limit||checked>=50000)break;
    }
  }
  return {candidates,checked,budgets,scope,exhaustive:false};
}
