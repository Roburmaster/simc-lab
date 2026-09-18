import fs from 'node:fs/promises';
import path from 'node:path';
import {currentProfileDir} from './paths.mjs';
import {decodeTalents,encodeTalents,pointTotals,validateBuild,generateCandidates,nodeMap} from './talents.mjs';
export async function prepareTalents(profile,request,data,source){
  if(Number(profile.info.level)!==90)throw new Error('Automatic talent search currently requires a level 90 character.');
  const tree=data.find(profile.info),build=decodeTalents(profile.info.talents,tree);
  const options=request.talentSearch||{};const limit=Number(options.limit??32),scope=options.scope||'specHero';
  if(!Number.isInteger(limit)||limit<4||limit>128)throw new Error('Choose a talent search budget between 4 and 128 candidates.');
  if(!['spec','specHero','all'].includes(scope))throw new Error('Invalid talent search scope.');
  const budgets={class:34,spec:34,hero:13};
  const errors=validateBuild(build,tree,{budgets,entries:data.entries});if(errors.length)throw new Error('Talent validation failed: '+errors.join(' '));
  const lockIds=options.locks||[];if(!Array.isArray(lockIds)||lockIds.some(id=>!nodeMap(tree).has(Number(id))))throw new Error('Unknown locked talent node.');
  const locks=Object.fromEntries(lockIds.map(id=>[id,true]));
  const allNodes=nodeMap(tree);const seeds=[{name:'Imported build',build}];const skipped=[];
  if(options.includeSeeds!==false){
    const texts=profile.alternatives.filter(v=>!v.slot&&v.text.startsWith('talents=')).map(v=>({name:v.name,talents:v.text.slice(8)}));
    const profileDir=await currentProfileDir(source);for(const file of await fs.readdir(profileDir)){if(!file.endsWith('.simc'))continue;const raw=await fs.readFile(path.join(profileDir,file),'utf8');if(!new RegExp(`^${profile.info.class}=`, 'm').test(raw)||!new RegExp(`^spec=${profile.info.spec}\\s*$`,'m').test(raw))continue;const talents=raw.match(/^talents=(.+)$/m)?.[1]?.trim();if(talents)texts.push({name:file.replace(/^[A-Z]+\d+_|\.simc$/g,'').replaceAll('_',' '),talents});}
    for(const seed of texts)try{
      const incoming=decodeTalents(seed.talents,tree);const merged=structuredClone(build);
      const changed=[...tree.specNodes,...(scope!=='spec'?[...tree.heroNodes,...tree.subTreeNodes]:[]),...(scope==='all'?tree.classNodes:[])];
      for(const node of changed){delete merged.selected[node.id];if(incoming.selected[node.id])merged.selected[node.id]=incoming.selected[node.id];}
      if(validateBuild(merged,tree,{budgets,entries:data.entries,locks,baseline:build}).length){skipped.push(seed.name);continue;}
      if(!seeds.some(s=>encodeTalents(s.build,tree)===encodeTalents(merged,tree)))seeds.push({name:seed.name,build:merged});
    }catch{skipped.push(seed.name);}
  }
  const candidates=[],seen=new Set([encodeTalents(build,tree)]);let checked=0;
  const pools=seeds.map(seed=>{const result=generateCandidates(seed.build,tree,{limit,scope,locks,entries:data.entries});checked+=result.checked;return [{name:seed.name,talents:encodeTalents(seed.build,tree),build:seed.build},...result.candidates];});
  // Round-robin seeds keep a single starting build from consuming the entire search budget.
  for(let i=0;candidates.length<limit&&pools.some(p=>p[i]);i++)for(let j=0;j<pools.length&&candidates.length<limit;j++){
    const candidate=pools[j][i];if(!candidate||seen.has(candidate.talents))continue;
    if(validateBuild(candidate.build,tree,{budgets,entries:data.entries,locks,baseline:build}).length)continue;
    seen.add(candidate.talents);candidates.push({...candidate,name:`Build ${candidates.length+1} · ${candidate.name}`});
  }
  if(!candidates.length)throw new Error('No legal alternatives were found with these locks and search settings.');
  const clean=profile.text.split('\n').filter(l=>!/^actions(?:[.=+])|^(talents|class_talents|spec_talents|hero_talents)=/.test(l)).join('\n');
  const variants=[{name:'Current talents',baseline:true,talents:encodeTalents(build,tree),text:clean+'\ntalents='+encodeTalents(build,tree)},...candidates.map(c=>({name:c.name,talents:c.talents,text:clean+'\ntalents='+c.talents,changes:changesBetween(build,c.build,allNodes)}))];
  return {variants,search:{specId:tree.specId,spec:tree.specName,class:tree.className,budgets,limit,generated:candidates.length,checked,seedCount:seeds.length,skippedSeeds:skipped,scope,locks:lockIds,exhaustive:false,method:'Constrained local search with validated imported, saved and SimC seed builds. Best of the tested candidates; not a global optimum.'}};
}
function changesBetween(original,next,nodes){const changes=[];for(const id of new Set([...Object.keys(original.selected),...Object.keys(next.selected)])){const a=original.selected[id],b=next.selected[id];if(JSON.stringify(a)===JSON.stringify(b))continue;const node=nodes.get(Number(id));if(!node)continue;const label=s=>s?`${node.entries.find(e=>e.id===s.entry)?.name||node.name} (${s.rank})`:'Not selected';changes.push({node:Number(id),from:label(a),to:label(b)});}return changes;}
