import {normalizeEnvironment,environmentLines} from './environment.mjs';
import {prepareTalents} from './optimizer.mjs';
import {buildCandidates,profilesetLines,profilesetResults,screenSettings,selectFinalists} from './upgrades.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {parseProfile,createVariants} from './profile.mjs';
import {normalizeTank,bossLines,survivalLines,actorTank,calibrate,tankComparison,tankMetricList} from './tank.mjs';
import {appRoot,home,runsDir,readEngineMetadata,enginePaths} from './paths.mjs';
export {runsDir};
export const root = appRoot;
// The active engine can change while the server runs (one-click update), so these are live bindings.
export let source, executable;
export async function loadEnginePaths(){({source,executable}=enginePaths(await readEngineMetadata()));return {source,executable};}
await loadEnginePaths();
export const maxThreads = Math.max(1,Math.min(16,os.availableParallelism()-2));
export async function engineStatus() {
  const metadata = await readEngineMetadata();
  const installed = await installedWowVersion();
  const ready=await fs.access(executable).then(()=>true,()=>false);
  return {...metadata,installed,ready:ready && !!metadata.wowVersion,compatible:!!installed && installed===metadata.wowVersion,maxThreads};
}
// WoW's live build, read from .build.info in the install folder. The folder comes from WOW_BUILD_INFO, the default
// location, or the path the Blizzard installer records in the registry.
let wowInfoPath;
async function findWowBuildInfo(){
  const candidates=[process.env.WOW_BUILD_INFO,'C:/Program Files (x86)/World of Warcraft/.build.info','C:/Program Files/World of Warcraft/.build.info'].filter(Boolean);
  for(const key of ['HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft','HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft']){
    try{const {stdout}=await promisify(execFile)('reg',['query',key,'/v','InstallPath'],{windowsHide:true});const dir=stdout.match(/InstallPath\s+REG_SZ\s+(.+)/)?.[1]?.trim();if(dir)candidates.push(path.join(dir,'..','.build.info'),path.join(dir,'.build.info'));}catch{}
  }
  for(const file of candidates)if(await fs.access(file).then(()=>true,()=>false))return file;
  return null;
}
export async function installedWowVersion(){
  wowInfoPath??=await findWowBuildInfo();if(!wowInfoPath)return null;
  try{
    const rows=(await fs.readFile(wowInfoPath,'utf8')).trim().split(/\r?\n/).map(l=>l.split('|'));
    const headers=rows.shift().map(h=>h.split('!')[0]);
    const row=rows.find(r=>r[headers.indexOf('Product')]==='wow'&&r[headers.indexOf('Active')]==='1');
    return row?.[headers.indexOf('Version')]||null;
  }catch{return null;}
}
function integer(value, fallback, min, max, label) {
  const n=Number(value ?? fallback); if(!Number.isInteger(n)||n<min||n>max) throw new Error(`${label} must be ${min}–${max}.`); return n;
}
export async function prepare(request,catalog,talentData,season) {
  const engine=await engineStatus();
  if(!engine.ready) throw new Error('SimC is not installed yet. Use Update SimC to install it.');
  if(!catalog)throw new Error('Game data is not installed yet. Use Update SimC to install it.');
  if(catalog.expansion.wowBuild!==engine.wowVersion)throw new Error('Game data and SimC builds differ. Use Update SimC.');
  if(engine.installed && !engine.compatible) throw new Error(`WoW ${engine.installed} does not match SimC ${engine.wowVersion}. Use Update SimC.`);
  const profile=parseProfile(request.profile);
  if(profile.version && (profile.version.patch!==engine.wowVersion.split('.').slice(0,3).join('.') || (profile.version.build && profile.version.build!==engine.wowVersion.split('.')[3]))) throw new Error('The addon export is from another WoW build. Export again using /simc.');
  const settings={iterations:integer(request.iterations,10000,100,1000000,'Iterations'),duration:integer(request.duration,300,10,1200,'Duration'),threads:integer(request.threads,maxThreads,1,maxThreads,'CPU threads'),targetError:Number(request.targetError ?? 0.1)};
  if(!Number.isFinite(settings.targetError)||settings.targetError<0||settings.targetError>5) throw new Error('Target error must be between 0 and 5%.');
  settings.environment=normalizeEnvironment(request.environment,catalog);
  settings.tank=normalizeTank(request.tank,profile.info);
  const scenarios=request.scenarios || [{style:'Patchwerk',targets:1}];
  if(!Array.isArray(scenarios)||!scenarios.length||scenarios.length>8) throw new Error('Choose 1–8 scenarios.');
  const unique=new Set();
  for(const s of scenarios) {
    if(!['Patchwerk','HecticAddCleave','DungeonSlice','HeavyMovement','LightMovement'].includes(s.style)) throw new Error('Unknown fight style.');
    s.targets=integer(s.targets,1,1,20,'Targets');
    const key=`${s.style}-${s.targets}`; if(unique.has(key)) throw new Error('The same scenario was selected more than once.'); unique.add(key);
  }
  if(request.mode==='upgrades'){
    if(!season)throw new Error('Season loot data is not loaded.');
    const upgrade=buildCandidates(profile,request.upgrades,season,catalog,talentData.find(profile.info).specId);
    upgrade.season=season.season;
    return {engine,profile,settings,scenarios,variants:[{name:'Current gear',text:profile.text,baseline:true}],upgrade};
  }
  const optimization=request.mode==='talents'?await prepareTalents(profile,request,talentData,source):null;
  const variants=optimization?.variants||createVariants(profile,request,catalog);
  if(variants.length*scenarios.length>256) throw new Error('Maximum 256 runs per job.');
  return {engine,profile,settings,scenarios,variants,search:optimization?.search};
}
export function inputFor(variant,settings,scenario,paths) {
  const boss=settings.tank?.boss;
  // fight_style=Patchwerk clears every raid event, including the tank healer; the unset style is the same fight.
  const style=boss&&scenario.style==='Patchwerk'?'':`fight_style=${scenario.style}\n`;
  return `${boss?bossLines(boss).join('\n')+'\n':''}${variant.text}\n\n# Controlled by SimC Lab\nptr=0\nitem_db_source=local\niterations=${settings.iterations}\ntarget_error=${settings.targetError}\nmax_time=${settings.duration}\nvary_combat_length=0.2\nthreads=${settings.threads}\n${style}desired_targets=${scenario.targets}\ncalculate_scale_factors=0\n${environmentLines(settings.environment,variant.text).join('\n')}\n${boss?survivalLines(boss).join('\n')+'\n':''}json2="${paths.json.replaceAll('\\','/')}"\nhtml="${paths.html.replaceAll('\\','/')}"\n`;
}
export function resultFrom(report) {
  const p=report.sim?.players?.[0]; const dps=p?.collected_data?.dps;
  if(!p || !Number.isFinite(dps?.mean)) throw new Error('The SimC report has no DPS result.');
  return {tank:actorTank(report)||undefined,dps:dps.mean,error95: Number.isFinite(dps.mean_std_dev) ? 1.959963984540054*dps.mean_std_dev : null,iterations:report.sim.statistics?.total_iterations ?? report.sim.options?.iterations ?? null,abilities:(p.stats || []).filter(s=>s.compound_amount>0).map(s=>({name:s.name,amount:s.compound_amount})).sort((a,b)=>b.amount-a.amount).slice(0,12)};
}
// SimC redraws a progress line with carriage returns, e.g.
// "Generating Profileset: c057 58/117 [====>....] 1200/2000 287788 (1m 2s)". The last one tells how far the
// current run is: which actor or profileset, and how many of its iterations are done.
const progressLine=/Generating (Baseline|Profileset):?\s*(?:(\S+)\s+)?(\d+)\/(\d+)\s+\[[^\]]*\]\s+(\d+)\/(\d+)/g;
export function parseProgress(text){
  let match,last=null;progressLine.lastIndex=0;
  while((match=progressLine.exec(text)))last=match;
  if(!last)return null;
  const [,phase,name,set,sets,iteration,iterations]=last;
  const within=Math.min(1,Number(iteration)/Math.max(1,Number(iterations)));
  return {phase:phase.toLowerCase(),name:phase==='Profileset'?name:null,set:Number(set),sets:Number(sets),iteration:Number(iteration),iterations:Number(iterations),fraction:Math.min(1,(Number(set)-1+within)/Math.max(1,Number(sets)))};
}
// Overall share of a job that is done: finished steps plus the running step's own progress.
export function jobFraction(job){
  if(job.status==='complete'||job.status==='partial')return 1;
  return Math.min(1,(job.done+(job.status==='running'?job.progress?.fraction||0:0))/Math.max(1,job.total));
}

export class Jobs {
  constructor(catalog){this.catalog=catalog;this.jobs=new Map();this.running=false;this.child=null;}
  async init(){await fs.mkdir(runsDir,{recursive:true}); for(const id of await fs.readdir(runsDir)){if(!/^[\da-f-]{36}$/.test(id))continue;try{const j=JSON.parse(await fs.readFile(path.join(runsDir,id,'job.json'),'utf8'));if(['queued','running'].includes(j.status)){j.status='interrupted';j.error='The server stopped during the run.';}this.jobs.set(id,j);}catch{}}}
  async save(j){const p=path.join(runsDir,j.id,'job.json');const data=JSON.stringify(j,null,2);this.saves=(this.saves||Promise.resolve()).catch(()=>{}).then(async()=>{await fs.writeFile(p+'.tmp',data);await fs.rename(p+'.tmp',p);});return this.saves;}
  async add(plan,request){
    if([...this.jobs.values()].filter(j=>['queued','running'].includes(j.status)).length>=5)throw new Error('The queue is full (maximum 5 jobs).');
    const job={id:randomUUID(),name:plan.profile.info.name,mode:request.mode || 'quick',created:new Date().toISOString(),status:'queued',done:0,total:(plan.upgrade?2*plan.scenarios.length:plan.variants.length*plan.scenarios.length)+(plan.settings.tank?1:0),engine:plan.engine,settings:plan.settings,scenarios:plan.scenarios,search:plan.search,results:[],log:'',warnings:plan.profile.warnings};
    if(plan.upgrade)Object.assign(job,{upgrade:{season:plan.upgrade.season,finalists:plan.upgrade.finalists,candidates:plan.upgrade.candidates.map(({line,...c})=>c),screen:screenSettings(plan.settings)},stages:[]});
    await fs.mkdir(path.join(runsDir,job.id));
    await fs.writeFile(path.join(runsDir,job.id,'request.json'),JSON.stringify(request,null,2));
    this.jobs.set(job.id,job);job._plan=plan;await this.save({...job,_plan:undefined});void this.pump();return job;
  }
  public(j){const {_plan,...rest}=j;return rest;}
  // Jobs run one at a time in creation order; a queued job shows what it is waiting behind.
  // A compact view of every waiting or running job, for the activity bar and the job list.
  activeJobs(){
    return [...this.jobs.values()].filter(j=>['queued','running'].includes(j.status)).map((j,i)=>({id:j.id,name:j.name,mode:j.mode,status:j.status,position:i+1,done:j.done,total:j.total,started:j.started||null,current:j.current?.name||null,progress:j.progress||null,fraction:jobFraction(j)}));
  }
  queueFor(job){
    if(job.status!=='queued')return null;
    const waiting=[...this.jobs.values()].filter(j=>['queued','running'].includes(j.status));
    const ahead=waiting.slice(0,waiting.indexOf(job)).map(j=>({id:j.id,name:j.name,mode:j.mode,status:j.status,done:j.done,total:j.total,current:j.current?.name||null}));
    return {position:ahead.length+1,ahead};
  }
  async cancel(id){const j=this.jobs.get(id);if(!j)throw new Error('Job not found.');if(['queued','running'].includes(j.status)){j.status='cancelled';if(this.active===id)this.child?.kill();await this.save(this.public(j));}return this.public(j);}
  async pump(){
    if(this.running)return;const job=[...this.jobs.values()].find(j=>j.status==='queued');if(!job)return;
    this.running=true;this.active=job.id;job.status='running';job.started=new Date().toISOString();
    try{
      const plan=job._plan;const current=await engineStatus();
      if(!current.ready || (current.installed && !current.compatible) || current.commit!==plan.engine.commit)throw new Error('SimC or WoW changed while the job was queued. Submit a new job.');
      if(plan.settings.tank)await this.calibrateTank(job,plan);
      if(plan.upgrade)await this.runUpgrades(job,plan);
      else for(let s=0;s<plan.scenarios.length;s++)for(let v=0;v<plan.variants.length;v++){
        if(job.status==='cancelled')break;
        const index=job.results.length;const stem=String(index).padStart(3,'0');const dir=path.join(runsDir,job.id);const paths={json:path.join(dir,`${stem}.json`),html:path.join(dir,`${stem}.html`)};
        const input=path.join(dir,`${stem}.simc`);const variant=plan.variants[v];
        job.current={name:variant.name,scenario:plan.scenarios[s],index};
        await fs.writeFile(input,inputFor(variant,plan.settings,plan.scenarios[s],paths));
        await this.save(this.public(job));
        const row={name:variant.name,baseline:!!variant.baseline,scenario:s,stem,talents:variant.talents,changes:variant.changes};
        try{
          await this.execute(input,dir,job);
          if(job.status==='cancelled')break;
          Object.assign(row,resultFrom(JSON.parse(await fs.readFile(paths.json,'utf8'))),{status:'complete'});
        }catch(e){if(job.status==='cancelled')break;Object.assign(row,{status:'failed',error:e.message});}
        const base=job.results.find(r=>r.baseline&&r.scenario===s&&r.status==='complete');
        if(plan.settings.tank&&row.status==='complete'&&base&&!row.baseline&&row.tank&&base.tank)Object.assign(row,tankComparison(row,base,plan.settings.tank.boss,plan.settings.tank.weight));
        job.results.push(row);job.done++;await this.save(this.public(job));
      }
      if(job.status!=='cancelled')job.status=job.results.some(r=>r.status==='failed')||job.stages?.some(r=>r.status==='failed')?'partial':'complete';
    }catch(e){job.error=e.message;job.status='failed';}
    finally{job.finished=new Date().toISOString();delete job._plan;delete job.current;delete job.progress;this.child=null;this.running=false;this.active=null;await this.save(job);void this.pump();}
  }
  // Upgrade Finder: one profileset run screens every candidate, a second run re-simulates the finalists at full precision.
  async runUpgrades(job,plan){
    const all=plan.upgrade.candidates;
    for(let s=0;s<plan.scenarios.length&&job.status!=='cancelled';s++){
      const screen=await this.stage(job,plan,s,1,all,screenSettings(plan.settings));
      if(job.status==='cancelled')return;
      const finalists=screen?selectFinalists(all,screen,plan.upgrade.finalists,plan.settings.tank):[];
      if(!finalists.length){job.stages.push({scenario:s,stage:2,status:'skipped',count:0,reason:screen?'No candidate could beat the current gear within screening uncertainty.':'Screening failed, so there was no final round.'});job.done++;await this.save(this.public(job));continue;}
      await this.stage(job,plan,s,2,finalists,plan.settings);
    }
  }
  async stage(job,plan,s,stage,list,settings){
    const stem=String(job.stages.filter(r=>r.stem).length).padStart(3,'0');const dir=path.join(runsDir,job.id);const paths={json:path.join(dir,`${stem}.json`),html:path.join(dir,`${stem}.html`)};const input=path.join(dir,`${stem}.simc`);
    const scenario=plan.scenarios[s];const record={scenario:s,stage,stem,count:list.length,iterations:settings.iterations,targetError:settings.targetError};
    job.current={name:`${stage===1?'Screening':'Final round'} · ${list.length} candidates`,scenario,index:job.stages.length};
    // Profilesets go last so each one inherits every option of the base profile and environment.
    await fs.writeFile(input,inputFor({text:plan.profile.text},settings,scenario,paths)+(settings.tank?`profileset_metric=${tankMetricList}\nprofileset_main_actor_index=1\n`:'')+profilesetLines(list,plan.profile,this.catalog).join('\n')+'\n');
    await this.save(this.public(job));
    try{
      await this.execute(input,dir,job,6*3600000);
      if(job.status==='cancelled')return null;
      const result=profilesetResults(JSON.parse(await fs.readFile(paths.json,'utf8')),settings.tank);
      Object.assign(record,{status:'complete',baseline:result.baseline});
      for(const row of result.rows)job.results.push({scenario:s,stage,...row,status:'complete'});
      job.stages.push(record);job.done++;await this.save(this.public(job));
      return result;
    }catch(e){
      if(job.status==='cancelled')return null;
      Object.assign(record,{status:'failed',error:e.message});job.stages.push(record);job.done++;await this.save(this.public(job));return null;
    }
  }
  // The tank boss is calibrated once against the imported gear and then shared by every variant and scenario.
  async calibrateTank(job,plan){
    const dir=path.join(runsDir,job.id);let n=0;
    job.current={name:'Calibrating the tank boss',scenario:{style:'Patchwerk',targets:1},index:0};await this.save(this.public(job));
    const simulate=async(boss,{iterations})=>{
      const stem=`tank-${n++}`;const paths={json:path.join(dir,stem+'.json'),html:path.join(dir,stem+'.html')};const input=path.join(dir,stem+'.simc');
      const settings={...plan.settings,iterations,targetError:0,tank:{...plan.settings.tank,boss}};
      await fs.writeFile(input,inputFor({text:plan.profile.text},settings,{style:'Patchwerk',targets:1},paths).replace(/^html=.*\n/m,''));
      await this.execute(input,dir,job);if(job.status==='cancelled')throw new Error('Cancelled.');
      return JSON.parse(await fs.readFile(paths.json,'utf8'));
    };
    plan.settings.tank.boss=await calibrate(plan.settings.tank,simulate);
    job.done++;await this.save(this.public(job));
  }
  execute(input,dir,job,timeout=3600000){return new Promise((resolve,reject)=>{
    const child=spawn(executable,[input],{cwd:dir,windowsHide:true,shell:false});this.child=child;let tail='';job.progress=null;
    const capture=data=>{tail=(tail+data.toString()).slice(-12000);job.log=tail;const progress=parseProgress(tail.slice(-2000));if(progress)job.progress=progress;};child.stdout.on('data',capture);child.stderr.on('data',capture);
    const timer=setTimeout(()=>{child.kill();reject(new Error(`The run exceeded ${timeout/60000} minutes.`));},timeout);
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(tail.slice(-3000)||`SimC exited with code ${code}.`));});
  });}
}
