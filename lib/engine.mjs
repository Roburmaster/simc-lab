import {normalizeEnvironment,environmentLines} from './environment.mjs';
import {prepareTalents} from './optimizer.mjs';
import {buildCandidates,profilesetLines,profilesetResults,screenSettings,selectFinalists,embellishmentPairs,upgradeSteps} from './upgrades.mjs';
import {buildBis,bisSteps,searchBis} from './bis.mjs';
import {buildCrestCandidates} from './crests.mjs';
import {buildVaultCandidates} from './vault.mjs';
import {prepareWeapons,publicSpec,weaponSteps,specSteps,selectTop,rankWeaponRows,actorGear,pairCount,withPair,bestPair,profilePair,scaleStats,scaleOnly} from './weapons.mjs';
import {prepareTrinkets,trinketSteps,specSteps as trinketSpecSteps,topRows,selectTopTrinkets,trinketCount,gainOf,pairPool,trinketPairs,selectPairs,tiedPairs,bestPartners,pairScreenSettings,resolveSettings,pairStages,isPairStage,presetScenarios,groupOf,parity as parityRun} from './trinkets.mjs';
import {readoutInput,readoutStats,healerRows,rankHealerRows,damageWeights} from './healers.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {parseProfile,createVariants} from './profile.mjs';
import {isArmoryProfile} from './armory.mjs';
import {isDummyStyle,dummyLines,dummyCount,dummyScenario,normalizeDummyHealth,needsCalibration,bands as dummyBands,calibrate as calibrateDummies} from './dummies.mjs';
import {isRouteStyle,loadRoutes,resolveRoute,routeLines,trialRoute,finishRoute,pullLengths,routeResult} from './mplus.mjs';
import {locate} from './wowaddon.mjs';
import {normalizeTank,bossLines,survivalLines,actorTank,calibrate,tankComparison,tankMetricList} from './tank.mjs';
import {appRoot,home,runsDir,upstreamDir,readEngineMetadata,enginePaths} from './paths.mjs';
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
// location, the path the Blizzard installer records in the registry, or on Linux the usual Wine prefixes.
let wowInfoPath;
export async function linuxWowFolders(user=os.homedir()){
  const wow=prefix=>['Program Files (x86)','Program Files'].map(pf=>path.join(prefix,'drive_c',pf,'World of Warcraft'));
  const prefixes=[path.join(user,'Games','battlenet'),path.join(user,'Games','world-of-warcraft'),path.join(user,'.wine')];
  // Steam (Proton), Bottles and Lutris keep one prefix per game or bottle.
  for(const parent of [path.join(user,'.steam','steam','steamapps','compatdata'),path.join(user,'.local','share','Steam','steamapps','compatdata')])
    for(const id of await fs.readdir(parent).catch(()=>[]))prefixes.push(path.join(parent,id,'pfx'));
  for(const parent of [path.join(user,'.local','share','bottles','bottles'),path.join(user,'.var','app','com.usebottles.bottles','data','bottles','bottles'),path.join(user,'Games')])
    for(const id of await fs.readdir(parent).catch(()=>[]))prefixes.push(path.join(parent,id));
  return [...new Set(prefixes)].flatMap(wow);
}
async function findWowBuildInfo(){
  const candidates=[process.env.WOW_BUILD_INFO,'C:/Program Files (x86)/World of Warcraft/.build.info','C:/Program Files/World of Warcraft/.build.info'].filter(Boolean);
  if(process.platform!=='win32'){for(const dir of await linuxWowFolders())candidates.push(path.join(dir,'.build.info'));}
  else for(const key of ['HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft','HKLM\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft']){
    try{const {stdout}=await promisify(execFile)('reg',['query',key,'/v','InstallPath'],{windowsHide:true});const dir=stdout.match(/InstallPath\s+REG_SZ\s+(.+)/)?.[1]?.trim();if(dir)candidates.push(path.join(dir,'..','.build.info'),path.join(dir,'.build.info'));}catch{}
  }
  for(const file of candidates)if(await fs.access(file).then(()=>true,()=>false))return file;
  return null;
}
// The WoW install folder (the one holding _retail_), found the same way as the live build.
export async function wowInstallDir(){
  wowInfoPath??=await findWowBuildInfo();
  return wowInfoPath?path.dirname(wowInfoPath):null;
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
// CastingPatchwerk is Patchwerk with a boss that casts, for effects that react to enemy casts. The Silvermoon styles
// are the city's five training dummies, measured from a combat log (see dummies.mjs). A Mythic+ route is a whole
// dungeon, pull by pull, from Mythic Dungeon Tools and Raider.IO (see mplus.mjs).
export const fightStyles=['Patchwerk','CastingPatchwerk','HecticAddCleave','DungeonSlice','HeavyMovement','LightMovement','SilvermoonDummies','MythicPlusRoute'];
// The Mythic+ data on this PC: MDT's dungeons and routes and Raider.IO's runs, below WoW's _retail_ folder.
export async function routeData(){
  const where=await locate(wowInstallDir);
  if(!where)throw new Error('The WoW folder was not found, so Mythic Dungeon Tools and Raider.IO cannot be read.');
  return loadRoutes(where.retail,upstreamDir);
}
// A scenario that needs a measuring run before the real ones: falling dummies, and every Mythic+ route.
export const calibrates=s=>needsCalibration(s)||isRouteStyle(s?.style)&&!s.route?.expected;
function integer(value, fallback, min, max, label) {
  const n=Number(value ?? fallback); if(!Number.isInteger(n)||n<min||n>max) throw new Error(`${label} must be ${min}–${max}.`); return n;
}
export async function prepare(request,catalog,talentData,season) {
  const engine=await engineStatus();
  if(!engine.ready) throw new Error('SimC is not installed yet. Use Update SimC to install it.');
  if(!catalog)throw new Error('Game data is not installed yet. Use Update SimC to install it.');
  if(catalog.expansion.wowBuild!==engine.wowVersion)throw new Error('Game data and SimC builds differ. Use Update SimC.');
  if(engine.installed && !engine.compatible) throw new Error(`WoW ${engine.installed} does not match SimC ${engine.wowVersion}. Use Update SimC.`);
  // Weapon Lab simulates SimC's own reference profiles, one per specialization, so it needs no character import.
  // Trinket Lab works the same way.
  const weapons=['weapons','trinkets'].includes(request.mode);
  const profile=weapons?null:parseProfile(request.profile);
  if(profile?.version && (profile.version.patch!==engine.wowVersion.split('.').slice(0,3).join('.') || (profile.version.build && profile.version.build!==engine.wowVersion.split('.')[3]))) throw new Error('The addon export is from another WoW build. Export again using /simc.');
  const settings={iterations:integer(request.iterations,10000,100,1000000,'Iterations'),duration:integer(request.duration,300,10,1200,'Duration'),threads:integer(request.threads,maxThreads,1,maxThreads,'CPU threads'),targetError:Number(request.targetError ?? 0.1)};
  if(!Number.isFinite(settings.targetError)||settings.targetError<0||settings.targetError>5) throw new Error('Target error must be between 0 and 5%.');
  settings.environment=normalizeEnvironment(request.environment,catalog);
  settings.tank=weapons?null:normalizeTank(request.tank,profile.info);
  // Trinket Lab can name its scenarios instead: raid and Mythic+ fights of their own length (see scenarioPresets).
  const presets=request.mode==='trinkets'&&request.trinkets?.scenarioSet?.length;
  // Bloodmallet parity fixes the fight and the precision to Bloodmallet's own (see parity in trinkets.mjs).
  const parity=request.mode==='trinkets'&&!!request.trinkets?.parity;
  let scenarios=parity?[{style:parityRun.fightStyle,targets:parityRun.targets,duration:parityRun.duration}]:presets?presetScenarios(request.trinkets.scenarioSet):request.scenarios || [{style:'Patchwerk',targets:1}];
  if(!Array.isArray(scenarios)||!scenarios.length||scenarios.length>8) throw new Error('Choose 1–8 scenarios.');
  // The Silvermoon dummies are always five, so a target matrix collapses to one fight there.
  // Dungeon Slice is always one boss for six minutes, so it collapses the same way.
  scenarios=scenarios.filter((s,i)=>!(isDummyStyle(s?.style)||s?.style==='DungeonSlice')||scenarios.findIndex(o=>o?.style===s.style&&(o.duration??null)===(s.duration??null)&&(o.dummyHealth?.mode??'held')===(s.dummyHealth?.mode??'held'))===i);
  const unique=new Set();let routes=null;
  for(const s of scenarios) {
    if(!fightStyles.includes(s.style)) throw new Error('Unknown fight style.');
    if(isRouteStyle(s.style)){
      if(settings.tank)throw new Error('Tank simulation is not available on a Mythic+ route. Turn it off for this fight style.');
      if(weapons)throw new Error('Weapon Lab and Trinket Lab simulate fixed fights. Choose another fight style for them.');
      routes??=await routeData();
      s.route=resolveRoute(s.route,routes.sources);
      Object.assign(s,{targets:1});delete s.bleedTail;delete s.duration;delete s.dummyHealth;
    }
    if(isDummyStyle(s.style)){
      if(settings.tank)throw new Error('The Silvermoon dummies never attack, so there is nothing to tank. Turn tank simulation off for this fight style.');
      Object.assign(s,dummyScenario,{dummyHealth:normalizeDummyHealth(s.dummyHealth)});
      // Falling health is measured on the imported character; the labs simulate SimC's reference profiles instead.
      if(s.dummyHealth.mode==='falling'&&weapons)throw new Error('Falling dummy health is measured on your own character. Use held health in Weapon Lab and Trinket Lab.');
    }
    // Dungeon Slice builds its own fight and nothing in it attacks the tank boss's target: every tank metric comes back
    // zero (no damage taken, no deaths, no healing), so the survival half of the score would be noise. Raidbots says the same.
    if(s.style==='DungeonSlice'&&settings.tank)throw new Error('Dungeon Slice does not work for tank specializations: nothing in that fight attacks the tank, so there is no survival to measure. Choose another fight style, such as Patchwerk or Hectic Add Cleave.');
    // SimC's Dungeon Slice sets its own 6 minutes and one boss, whatever max_time and desired_targets say, so say so here too.
    if(s.style==='DungeonSlice')Object.assign(s,{targets:1,duration:360}),delete s.bleedTail;
    s.targets=integer(s.targets,1,1,20,'Targets');
    // Stop attacking at the end and let damage over time run out, as a meter on a dummy counts it.
    if(s.bleedTail===undefined||s.bleedTail===null||s.bleedTail===false)delete s.bleedTail;else s.bleedTail=integer(s.bleedTail,15,3,60,'Seconds for bleeds to run out');
    if(s.duration!==undefined)s.duration=integer(s.duration,300,10,1200,'Scenario duration');
    const key=`${s.style}-${s.targets}-${s.duration||''}-${s.dummyHealth?.mode||''}-${s.route?[s.route.dungeon,s.route.routeId,s.route.level,s.route.pace.mode,s.route.pace.run||s.route.shareSet,s.route.gap,s.route.lust].join(':'):''}`; if(unique.has(key)) throw new Error('The same scenario was selected more than once.'); unique.add(key);
  }
  if(request.mode==='trinkets'){
    if(!season)throw new Error('Season loot data is not loaded.');
    const warnings=[];
    if(parity){
      // SimC's own defaults (the optimal raid) rather than this app's environment, as Bloodmallet runs it.
      Object.assign(settings,{iterations:parityRun.iterations,targetError:parityRun.targetError,duration:parityRun.duration,environment:null});
      const compare=String(request.trinkets.compareSha||'').trim().toLowerCase();
      if(!compare)warnings.push('Bloodmallet parity: no SimC commit given to compare with, so this run cannot claim parity. Enter the commit Bloodmallet used.');
      else if(!engine.commit?.startsWith(compare)&&!compare.startsWith(engine.commit||'-'))warnings.push(`Bloodmallet parity: this engine is SimC ${engine.commit?.slice(0,10)}, not ${compare.slice(0,10)}. Differences may come from the SimC commit, not from Trinket Lab.`);
    }
    const plan=await prepareTrinkets(request,catalog,season,talentData,source,scenarios.length);
    if(parity)plan.compareSha=String(request.trinkets.compareSha||'').trim().toLowerCase()||null;
    const name=`${parity?'Bloodmallet parity':'Trinket tier list'} · ${plan.specs.length} spec${plan.specs.length===1?'':'s'}`;
    return {engine,profile:{text:'',info:{name},warnings},settings,scenarios,variants:[],trinkets:plan};
  }
  if(weapons){
    if(!season)throw new Error('Season loot data is not loaded.');
    const plan=await prepareWeapons(request,catalog,season,talentData,source,scenarios.length);
    const name=`Weapon tier list · ${plan.specs.length} spec${plan.specs.length===1?'':'s'}`;
    return {engine,profile:{text:'',info:{name},warnings:[]},settings,scenarios,variants:[],weapons:plan};
  }
  if(request.mode==='upgrades'){
    if(!season)throw new Error('Season loot data is not loaded.');
    const upgrade=buildCandidates(profile,request.upgrades,season,catalog,talentData.find(profile.info).specId);
    upgrade.season=season.season;upgrade.itemLimits=season.itemLimits;
    return {engine,profile,settings,scenarios,variants:[{name:'Current gear',text:profile.text,baseline:true}],upgrade};
  }
  if(request.mode==='bis'){
    if(!season)throw new Error('Season loot data is not loaded.');
    const bis=buildBis(profile,request.bis,season,catalog,talentData.find(profile.info).specId);
    bis.season=season.season;bis.itemLimits=season.itemLimits;
    return {engine,profile,settings,scenarios,variants:[{name:'Current gear',text:profile.text,baseline:true}],bis};
  }
  if(request.mode==='crests'){
    if(!season)throw new Error('Season loot data is not loaded.');
    const crests=buildCrestCandidates(profile,request.profile,request.crests,season,catalog);
    crests.season=season.season;
    return {engine,profile,settings,scenarios,variants:[{name:'Current gear',text:profile.text,baseline:true}],crests};
  }
  if(request.mode==='vault'){
    const vault=buildVaultCandidates(profile,request.profile,request.vault,season,catalog);
    return {engine,profile,settings,scenarios,variants:[{name:'Current gear',text:profile.text,baseline:true}],vault};
  }
  const optimization=request.mode==='talents'?await prepareTalents(profile,request,talentData,source):null;
  const variants=optimization?.variants||createVariants(profile,request,catalog);
  return {engine,profile,settings,scenarios,variants,search:optimization?.search};
}
// What a Trinket Lab job needs to be run again: the exact SimC commit and WoW build, and the fight and precision of
// every round. Stages add their own scenario; specs add their profile (see referenceMeta in trinkets.mjs).
export function reproduction(plan){
  const {settings,engine}=plan;
  return {simcSha:engine.commit||null,simcBranch:engine.branch||null,simcVersion:engine.version||null,wowBuild:engine.wowVersion||null,hotfix:engine.hotfix||null,ptr:0,
    scenarios:plan.scenarios.map(s=>({...(s.preset?{preset:s.preset,label:s.label}:{}),fightStyle:s.style,targets:s.targets,duration:s.duration||settings.duration,...(s.bloodlust===false?{bloodlust:false}:{}),...(s.potion===false?{potion:false}:{})})),duration:settings.duration,variation:(settings.environment?.variation??20)/100,
    iterations:settings.iterations,targetError:settings.targetError,model:plan.trinkets.model,pool:plan.trinkets.pool,pairFinalists:plan.trinkets.pairFinalists,
    ...(plan.trinkets.parity?{parity:{compareSha:plan.trinkets.compareSha||null,shaMatches:!!plan.trinkets.compareSha&&!!engine.commit&&(engine.commit.startsWith(plan.trinkets.compareSha)||plan.trinkets.compareSha.startsWith(engine.commit)),optimalRaid:true}}:{})};
}
// What a scenario turns off after the environment: a Mythic+ pull that gets no Bloodlust or no potion.
export const scenarioLines=scenario=>[...(scenario.bloodlust===false?['override.bloodlust=0']:[]),...(scenario.potion===false?['potion=disabled','override.allow_potions=0']:[])].map(l=>l+'\n').join('');
// The end of a fight where the player stops and their damage over time keeps ticking: a stun from the set duration on
// (players only, so nothing is cast and no auto attack swings), the fight longer by the tail, and no length variation
// so the stop lands where it is set. DPS is then counted over the whole time, as a meter does.
export const bleedTailLines=(scenario,duration)=>scenario.bleedTail?`vary_combat_length=0\nraid_events+=/stun,first=${duration},duration=${scenario.bleedTail+30},cooldown=9999,players_only=1\n`:'';
// Enemies declared before the player make it a later actor, which profilesets must be told.
export const playerActorIndex=(settings,scenario)=>settings.tank?.boss?1:dummyCount(scenario.style);
export function inputFor(variant,settings,scenario,paths) {
  const boss=settings.tank?.boss,dummies=isDummyStyle(scenario.style),route=isRouteStyle(scenario.style)?scenario.route:null;
  // fight_style=Patchwerk clears every raid event, including the tank healer; the unset style is the same fight.
  // The dummies are their own enemies in that unset (Patchwerk) fight.
  // A bleed tail is a raid event, which fight_style=Patchwerk would clear too.
  // A Mythic+ route is SimC's DungeonRoute: the pulls are its raid events, it ends when the last pull dies, and
  // Bloodlust comes from the pulls. Warriors would switch fixed_time back on and end the run on a timer instead.
  const style=route?'fight_style=DungeonRoute\n':dummies||(boss||scenario.bleedTail)&&scenario.style==='Patchwerk'?'':`fight_style=${scenario.style}\n`;
  const pulls=route?`${/^warrior=/m.test(variant.text)?'warrior_fixed_time=0\n':''}${routeLines(route).join('\n')}\n`:'';
  const duration=scenario.duration||settings.duration;
  return `${boss?bossLines(boss).join('\n')+'\n':''}${dummies?dummyLines(scenario.style,scenario.dummyHealth).join('\n')+'\n':''}${variant.text}\n\n# Controlled by SimC Lab\nptr=0\nitem_db_source=local\niterations=${settings.iterations}\ntarget_error=${settings.targetError}\nmax_time=${duration+(scenario.bleedTail||0)}\nvary_combat_length=0.2\nthreads=${settings.threads}\n${style}desired_targets=${scenario.targets}\ncalculate_scale_factors=0\n${environmentLines(settings.environment,variant.text).join('\n')}\n${scenarioLines(scenario)}${bleedTailLines(scenario,duration)}${pulls}${boss?survivalLines(boss).join('\n')+'\n':''}${paths.apl?`save_actions="${paths.apl.replaceAll('\\','/')}"\n`:''}json2="${paths.json.replaceAll('\\','/')}"\nhtml="${paths.html.replaceAll('\\','/')}"\n`;
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
    const steps=plan.trinkets?trinketSteps(plan.trinkets,plan.scenarios.length):plan.weapons?weaponSteps(plan.weapons,plan.scenarios.length):plan.crests||plan.vault?plan.scenarios.length:plan.bis?bisSteps(plan.bis,plan.scenarios.length):(plan.upgrade?upgradeSteps(plan.upgrade,plan.scenarios.length):plan.variants.length*plan.scenarios.length);
    const job={id:randomUUID(),name:plan.profile.info.name,mode:request.mode || 'quick',created:new Date().toISOString(),status:'queued',done:0,total:steps+(plan.settings.tank?1:0)+plan.scenarios.filter(calibrates).length,engine:plan.engine,settings:plan.settings,scenarios:plan.scenarios,search:plan.search,results:[],log:'',warnings:plan.profile.warnings,armory:isArmoryProfile(request.profile)};
    if(plan.upgrade)Object.assign(job,{upgrade:{season:plan.upgrade.season,finalists:plan.upgrade.finalists,embellished:plan.upgrade.embellished,limitsUsed:plan.upgrade.limitsUsed,blocked:plan.upgrade.blocked,candidates:plan.upgrade.candidates.map(({line,...c})=>c),screen:screenSettings(plan.settings)},stages:[]});
    if(plan.bis){const {candidates,itemLimits,...rest}=plan.bis;Object.assign(job,{bis:{...rest,candidates:candidates.map(({line,...c})=>c),screen:screenSettings(plan.settings),worn:Object.entries(plan.profile.gear).filter(([,g])=>g.id).map(([slot,g])=>({slot,itemId:g.id,name:this.catalog.items.get(g.id)?.name||`Item ${g.id}`,value:g.value})),runs:[]},stages:[]});}
    if(plan.crests){const {candidates,...rest}=plan.crests;Object.assign(job,{crests:{...rest,candidates:candidates.map(({line,...c})=>c)},stages:[]});}
    if(plan.vault){const {candidates,...rest}=plan.vault;Object.assign(job,{vault:{...rest,candidates:candidates.map(({line,...c})=>c)},stages:[]});}
    if(plan.trinkets)Object.assign(job,{trinkets:{...plan.trinkets,screen:screenSettings(plan.settings),pairScreen:pairScreenSettings(plan.settings),resolve:resolveSettings(plan.settings),repro:reproduction(plan),
      specs:plan.trinkets.specs.map(s=>({...publicSpec(s),tank:!!s.tank,worn:s.worn,profile:s.profile,...(s.parity?{parity:s.parity}:{}),...(s.statStick?{statStick:s.statStick}:{}),candidates:s.candidates.map(({line,...c})=>c),pairs:[]}))},stages:[]});
    if(plan.weapons)Object.assign(job,{weapons:{...plan.weapons,referenceText:undefined,screen:screenSettings(plan.settings),specs:plan.weapons.specs.map(s=>({...publicSpec(s),tank:!!s.tank,candidates:s.candidates.map(({line,...c})=>c)}))},stages:[]});
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
      if(plan.settings.tank)plan.settings.tank.boss=await this.calibrateTank(job,plan.profile.text,plan.settings,'Calibrating the tank boss','tank');
      for(const [s,scenario] of plan.scenarios.entries()){
        if(needsCalibration(scenario))scenario.dummyHealth=await this.calibrateDummyHealth(job,plan,s);
        else if(calibrates(scenario))scenario.route=await this.calibrateRoute(job,plan,s);
      }
      if(plan.trinkets)await this.runTrinkets(job,plan);
      else if(plan.weapons)await this.runWeapons(job,plan);
      else if(plan.bis)await this.runBis(job,plan);
      else if(plan.upgrade)await this.runUpgrades(job,plan);
      else if(plan.crests)await this.runCrests(job,plan);
      else if(plan.vault)await this.runVault(job,plan);
      else for(let s=0;s<plan.scenarios.length;s++)for(let v=0;v<plan.variants.length;v++){
        if(job.status==='cancelled')break;
        const index=job.results.length;const stem=String(index).padStart(3,'0');const dir=path.join(runsDir,job.id);const paths={json:path.join(dir,`${stem}.json`),html:path.join(dir,`${stem}.html`),apl:path.join(dir,`${stem}.apl.simc`)};
        const input=path.join(dir,`${stem}.simc`);const variant=plan.variants[v];
        job.current={name:variant.name,scenario:plan.scenarios[s],index};
        await fs.writeFile(input,inputFor(variant,plan.settings,plan.scenarios[s],paths));
        await this.save(this.public(job));
        const row={name:variant.name,baseline:!!variant.baseline,scenario:s,stem,talents:variant.talents,changes:variant.changes};
        try{
          await this.execute(input,dir,job);
          if(job.status==='cancelled')break;
          const report=JSON.parse(await fs.readFile(paths.json,'utf8'));
          Object.assign(row,resultFrom(report),{status:'complete'});
          if(isRouteStyle(plan.scenarios[s].style))row.route=routeResult(plan.scenarios[s].route,pullLengths(await fs.readFile(paths.html,'utf8')),report.sim.players[0].collected_data.fight_length?.mean);
        }catch(e){if(job.status==='cancelled')break;Object.assign(row,{status:'failed',error:e.message});}
        const base=job.results.find(r=>r.baseline&&r.scenario===s&&r.status==='complete');
        if(plan.settings.tank&&row.status==='complete'&&base&&!row.baseline&&row.tank&&base.tank)Object.assign(row,tankComparison(row,base,plan.settings.tank.boss,plan.settings.tank.weight));
        job.results.push(row);job.done++;await this.save(this.public(job));
      }
      if(job.status!=='cancelled')job.status=job.results.some(r=>r.status==='failed')||job.stages?.some(r=>r.status==='failed')?'partial':'complete';
    }catch(e){job.error=e.message;job.status='failed';}
    finally{job.finished=new Date().toISOString();delete job._plan;delete job.current;delete job.progress;this.child=null;this.running=false;this.active=null;await this.save(job);void this.pump();if(this.onFinished)Promise.resolve().then(()=>this.onFinished(job)).catch(()=>{});}
  }
  // Upgrade Finder: one profileset run screens every candidate, a second run re-simulates the finalists at full precision.
  async runUpgrades(job,plan){
    const all=plan.upgrade.candidates;
    for(let s=0;s<plan.scenarios.length&&job.status!=='cancelled';s++){
      const screen=await this.stage(job,plan,s,1,all,screenSettings(plan.settings));
      if(job.status==='cancelled')return;
      const finalists=screen?selectFinalists(all,screen,plan.upgrade.finalists,plan.settings.tank):[];
      const skip=async(stage,reason)=>{job.stages.push({scenario:s,stage,status:'skipped',count:0,reason});job.done++;await this.save(this.public(job));};
      if(!finalists.length){await skip(2,screen?'No candidate could beat the current gear within screening uncertainty.':'Screening failed, so there was no final round.');if(plan.upgrade.embellished)await skip(3,'There was no final round to pair embellishments from.');continue;}
      const final=await this.stage(job,plan,s,2,finalists,plan.settings);
      if(!plan.upgrade.embellished||job.status==='cancelled')continue;
      // Third round: the best embellished upgrades worn two at a time, within the equip limit.
      const pairs=final?embellishmentPairs(finalists,final.rows,final.baseline,plan.profile,{itemLimits:plan.upgrade.itemLimits},this.catalog,{tank:plan.settings.tank}):[];
      if(!pairs.length){const worn=(plan.upgrade.limitsUsed||[]).map(h=>h.name).join(', ');await skip(3,!final?'The final round failed, so there were no embellishments to pair.':worn?`No two of the best embellished upgrades can be worn together next to ${worn}, so the best single one is the answer.`:'Fewer than two embellished upgrades beat your gear, so there was nothing to pair.');continue;}
      job.upgrade.pairs=[...(job.upgrade.pairs||[]),...pairs.map(p=>({scenario:s,key:p.key,parts:p.parts.map(c=>({key:c.key,slot:c.slot}))}))];
      await this.stage(job,plan,s,3,pairs,plan.settings);
    }
  }
  // Best in Slot: per scenario, Upgrade Finder's screening and final round, then the best full set built and refined
  // from them (see searchBis in bis.mjs). Every run after the first has its own base actor: the set found so far.
  async runBis(job,plan){
    for(let s=0;s<plan.scenarios.length&&job.status!=='cancelled';s++){
      const run={scenario:s,variants:[],rounds:[],notes:[],set:null,final:null,start:null,bySource:null};
      job.bis.runs.push(run);
      await searchBis({plan,catalog:this.catalog,run,settings:plan.settings,tank:plan.settings.tank,
        sim:(stage,list,settings,extra)=>this.stage(job,plan,s,stage,list,settings,undefined,extra),
        step:n=>{job.done+=n;},cancelled:()=>job.status==='cancelled',save:()=>this.save(this.public(job))});
    }
  }
  // Crest Planner: every upgrade is one profileset of a single run per scenario, at the chosen precision, because the
  // spending order compares small differences between neighbouring levels.
  async runCrests(job,plan){
    for(let s=0;s<plan.scenarios.length&&job.status!=='cancelled';s++)await this.stage(job,plan,s,2,plan.crests.candidates,plan.settings);
  }
  // Great Vault: a handful of choices, so each scenario is one profileset run at the chosen precision, no screening.
  async runVault(job,plan){
    for(let s=0;s<plan.scenarios.length&&job.status!=='cancelled';s++)await this.stage(job,plan,s,2,plan.vault.candidates,plan.settings);
  }
  // Trinket Lab: each specialization on its reference profile without trinkets. A list longer than the final round
  // is screened first with one row per trinket, at its top level; the final round runs the best at every level.
  async runTrinkets(job,plan){
    const lab=plan.trinkets;
    for(const spec of lab.specs){
      if(job.status==='cancelled')return;
      if(spec.tank){
        try{
          // The boss is tuned to the character without trinkets, the one the pairs are measured against; the tier
          // list's stat stick character then fights the same boss.
          spec.tank.boss=await this.calibrateTank(job,spec.bareText??spec.text,{...plan.settings,tank:spec.tank},`${spec.label} · calibrating the tank boss`,`tank-${spec.key}`);
          const stored=job.trinkets.specs.find(s=>s.key===spec.key);if(stored)stored.boss=spec.tank.boss;
        }catch(e){
          if(job.status==='cancelled')return;
          job.stages.push({spec:spec.key,stage:0,status:'failed',count:0,error:e.message});
          job.done+=trinketSpecSteps(spec,lab.finalists,plan.scenarios.length,lab.model);
          await this.save(this.public(job));continue;
        }
      }
      for(let s=0;s<plan.scenarios.length&&job.status!=='cancelled';s++){
        const settings={...plan.settings,tank:spec.tank||null};
        let finalists=spec.candidates;
        if(trinketCount(spec)>lab.finalists){
          const screen=await this.stage(job,plan,s,1,topRows(spec),screenSettings(settings),spec);
          if(job.status==='cancelled')return;
          finalists=screen?selectTopTrinkets(spec.candidates,screen,lab.finalists,settings.tank):[];
          if(!finalists.length){job.stages.push({spec:spec.key,scenario:s,stage:2,status:'skipped',count:0,reason:'Screening failed, so there was no final round.'});job.done+=1+(lab.model==='pairs'?3:0)+(spec.support?1:0);await this.save(this.public(job));continue;}
        }
        await this.stage(job,plan,s,2,finalists,settings,spec);
        if(job.status==='cancelled')return;
        const scale=spec.support?await this.supportShare(job,plan,s,settings,spec):null;
        if(job.status==='cancelled')return;
        this.rankTrinkets(job,spec,s,settings.tank,scale);
        await this.save(this.public(job));
        if(lab.model==='pairs')await this.runPairs(job,plan,s,settings,spec,scale);
      }
    }
  }
  // Trinket pairs of one spec and scenario, after its isolated round has been ranked: the pool, every legal pair in
  // it at screening precision, the best at full precision, and the pairs still tied with the best at high precision.
  // Each round is one step whether it runs or not, so the job's step count holds.
  async runPairs(job,plan,s,settings,spec,share){
    const lab=plan.trinkets,stored=job.trinkets.specs.find(x=>x.key===spec.key);
    // Pairs replace both slots, so they run on the character without the stat stick the tier list is measured beside.
    const pairSpec=spec.bareText?{...spec,text:spec.bareText}:spec;
    const skip=async(stage,reason)=>{job.stages.push({spec:spec.key,scenario:s,stage,status:'skipped',count:0,reason});job.done++;await this.save(this.public(job));};
    const ranked=job.results.filter(r=>r.spec===spec.key&&r.scenario===s&&!r.pair&&Number.isFinite(r.rank));
    const pool=pairPool(spec.candidates,ranked,{size:lab.pool});
    const pairs=trinketPairs(pool,{legal:{equipped:spec.equipped,itemLimits:spec.itemLimits},prefix:`p${s}-`});
    const entry={scenario:s,pool:pool.map(c=>c.key),pairs:pairs.map(({parts,...p})=>p),partners:[]};
    if(stored)stored.pairs[s]=entry;
    if(!pairs.length){for(const stage of Object.values(pairStages))await skip(stage,pool.length<2?'Fewer than two trinkets reached the pair pool.':'No two trinkets in the pool can be worn together.');return;}
    let finals=pairs;
    if(lab.pairFinalists&&new Set(pairs.map(p=>p.pairKey)).size>lab.pairFinalists){
      const screen=await this.stage(job,plan,s,pairStages.screen,pairs,pairScreenSettings(settings),pairSpec);
      if(job.status==='cancelled')return;
      finals=screen?selectPairs(pairs,screen,lab.pairFinalists,settings.tank):[];
    }else await skip(pairStages.screen,'Every pair fits the final round, so it was not screened.');
    if(!finals.length){await skip(pairStages.final,'Pair screening failed, so there was no final round.');await skip(pairStages.resolve,'There was no final round.');this.rankPairs(job,spec,s,settings.tank,share);return;}
    const final=await this.stage(job,plan,s,pairStages.final,finals,settings,pairSpec);
    if(job.status==='cancelled')return;
    const tied=final?tiedPairs(finals,final.rows,settings.tank):[];
    const precise=resolveSettings(settings);
    if(tied.length&&(precise.targetError<settings.targetError||!settings.targetError&&precise.iterations>settings.iterations)){
      await this.stage(job,plan,s,pairStages.resolve,tied,precise,pairSpec);
      if(job.status==='cancelled')return;
    }else await skip(pairStages.resolve,!final?'The final round failed.':tied.length?'The final round was already at least as precise as a resolution run.':'No pair was statistically tied with the best.');
    this.rankPairs(job,spec,s,settings.tank,share);
    await this.save(this.public(job));
  }
  // Ranks the pairs of one spec and scenario. A pair's number comes from its most precise round; the rows it
  // replaces are marked superseded. Both slot orders of an on-use pair share a pair key; only the better is ranked.
  // Gains are over the character with no trinket, from the baseline of the pair's own run. Tanks keep their damage
  // and survival numbers apart on every row (dpsGain, survival) beside the combined score they are ranked on.
  rankPairs(job,spec,s,tank,share=null){
    const stored=job.trinkets.specs.find(x=>x.key===spec.key),entry=stored?.pairs?.[s];
    if(!entry)return;
    const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===s&&r.pair);
    const byKey=new Map(entry.pairs.map(p=>[p.key,p]));
    const baseline=stage=>job.stages.find(st=>st.spec===spec.key&&st.scenario===s&&st.stage===stage&&st.status==='complete')?.baseline;
    const best=new Map();
    for(const row of rows){
      for(const k of ['rank','tier','behind','tied','variant','behindFirst','set','gain','percent','superseded','screened'])delete row[k];
      const g=gainOf(row,baseline(row.stage),{tank,share});if(g)Object.assign(row,g);
      if(!best.has(row.key)||row.stage>best.get(row.key).stage)best.set(row.key,row);
    }
    for(const row of rows)row.superseded=best.get(row.key)!==row;
    const live=rows.filter(r=>!r.superseded);
    for(const row of live)row.screened=row.stage===pairStages.screen;
    const ranked=rankWeaponRows(live,tank,row=>byKey.get(row.key)?.pairKey||row.key,()=>false,share);
    entry.partners=bestPartners(ranked,entry.pairs);
  }
  // Every row gets its gain over the character with no trinket, from the baseline of its own run. The tier list
  // ranks one row per trinket, the one at its top level: the final round's where it has one, else the screened.
  rankTrinkets(job,spec,s,tank,share=null){
    const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===s&&!r.pair);
    const finals=new Set(rows.filter(r=>r.stage===2).map(r=>r.key));
    const baseline=stage=>job.stages.find(st=>st.spec===spec.key&&st.scenario===s&&st.stage===stage&&st.status==='complete')?.baseline;
    for(const row of rows){
      row.superseded=row.stage===1&&finals.has(row.key);row.screened=row.stage===1;
      for(const k of ['rank','tier','behind','tied','variant','behindFirst','set','gain','percent','alternative'])delete row[k];
      const g=gainOf(row,baseline(row.stage),{tank,share});
      if(g)Object.assign(row,g);
    }
    const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
    // A trinket worn in place of one of the gear's embellishments is simulated once per embellishment it could
    // replace; at each item level only the swap that costs least stands, the others are kept as alternatives.
    const value=r=>tank?.boss?(Number.isFinite(r.score)?r.score:-Infinity):(Number.isFinite(r.dps)?r.dps:-Infinity);
    const swaps=new Map();
    for(const row of rows.filter(r=>!r.superseded&&byKey.get(r.key)?.freed)){
      const c=byKey.get(row.key),id=`${groupOf(c)}|${c.itemLevel}|${row.stage}`;
      if(!swaps.has(id))swaps.set(id,[]);swaps.get(id).push(row);
    }
    for(const list of swaps.values()){
      list.sort((a,b)=>value(b)-value(a));
      for(const row of list.slice(1)){row.superseded=true;row.alternative=true;}
    }
    const top=rows.filter(r=>!r.superseded&&byKey.get(r.key)?.top);
    // Tiers are measured from the best trinket the character can wear as it is: a set bonus leads on its own, and a
    // trinket over an equip limit beside the reference gear is listed, marked, but never the yardstick.
    rankWeaponRows(top,tank,null,row=>!!byKey.get(row.key)?.set||!!byKey.get(row.key)?.overLimit,share);
  }
  // Weapon Lab: each specialization is its own profileset run on its reference profile. Lists that already fit
  // the final round are simulated once at full precision; longer ones are screened first, as Upgrade Finder does.
  async runWeapons(job,plan){
    if(plan.weapons.specs.some(s=>s.healer))await this.readHealers(job,plan);
    for(const spec of plan.weapons.specs){
      if(job.status==='cancelled')return;
      if(spec.healer)continue;
      if(spec.tank){
        try{
          spec.tank.boss=await this.calibrateTank(job,spec.text,{...plan.settings,tank:spec.tank},`${spec.label} · calibrating the tank boss`,`tank-${spec.key}`);
          const stored=job.weapons.specs.find(s=>s.key===spec.key);if(stored)stored.boss=spec.tank.boss;
        }
        catch(e){
          if(job.status==='cancelled')return;
          // A tank spec whose boss cannot be calibrated is reported and skipped; the rest of the list still runs.
          // Its profileset runs are counted as done as well, so the job's own step count stays honest.
          job.stages.push({spec:spec.key,stage:0,status:'failed',count:0,error:e.message});
          job.done+=specSteps(spec,plan.weapons.finalists,plan.scenarios.length);
          await this.save(this.public(job));continue;
        }
      }
      for(let s=0;s<plan.scenarios.length&&job.status!=='cancelled';s++){
        const settings={...plan.settings,tank:spec.tank||null};
        let list=spec.candidates;
        if(pairCount(spec)>1){
          list=withPair(spec,await this.craftedPair(job,plan,s,spec));
          if(job.status==='cancelled')return;
        }
        let finalists=list;
        if(list.length>plan.weapons.finalists){
          const screen=await this.stage(job,plan,s,1,list,screenSettings(settings),spec);
          if(job.status==='cancelled')return;
          finalists=screen?selectTop(list,screen,plan.weapons.finalists,settings.tank):[];
          if(!finalists.length){job.stages.push({spec:spec.key,scenario:s,stage:2,status:'skipped',count:0,reason:'Screening failed, so there was no final round.'});job.done++;await this.save(this.public(job));continue;}
        }
        await this.stage(job,plan,s,2,finalists,settings,spec);
        if(job.status==='cancelled')return;
        const scale=spec.support?await this.supportShare(job,plan,s,settings,spec):null;
        if(job.status==='cancelled')return;
        this.rankWeapons(job,spec,s,settings.tank,scale);
        await this.save(this.public(job));
      }
    }
  }
  // The crafted pair of one spec and scenario: SimC's scale factors for the four secondary stats on the reference
  // profile, in the same fight, and the selected pair they add up highest. A tank's weights are read on damage, with
  // no boss, as its crafted pair is chosen for damage like the rest. If the run fails, the pair the profile's own
  // crafted gear wears stands in, and the stage says so.
  async craftedPair(job,plan,s,spec){
    const pairs=plan.weapons.craftedStats.filter(p=>spec.candidates.some(c=>c.craftedBonus===p.bonusId));
    const stem=String(job.stages.filter(r=>r.stem).length).padStart(3,'0'),dir=path.join(runsDir,job.id);
    const paths={json:path.join(dir,`${stem}.json`),html:path.join(dir,`${stem}.html`)},input=path.join(dir,`${stem}.simc`);
    const record={spec:spec.key,scenario:s,stage:5,stem,count:0,iterations:plan.settings.iterations,targetError:plan.settings.targetError,weights:null};
    job.current={name:`${spec.label} · stat weights for crafted weapons`,scenario:plan.scenarios[s],index:job.stages.length};
    await fs.writeFile(input,inputFor({text:spec.text},{...plan.settings,tank:null},plan.scenarios[s],paths).replace('calculate_scale_factors=0',`calculate_scale_factors=1\n${scaleOnly}`));
    await this.save(this.public(job));
    let pair=null;
    try{
      await this.execute(input,dir,job);
      if(job.status==='cancelled')return null;
      const weights=JSON.parse(await fs.readFile(paths.json,'utf8')).sim?.players?.[0]?.scale_factors;
      pair=bestPair(weights,pairs);
      if(!pair)throw new Error('SimC reported no stat weights for the secondary stats.');
      record.weights=Object.fromEntries(Object.values(scaleStats).map(k=>[k,weights[k]]));
      Object.assign(record,{status:'complete',pair:pair.name});
    }catch(e){
      if(job.status==='cancelled')return null;
      pair=profilePair(spec.text,pairs);
      Object.assign(record,{status:'failed',error:e.message,pair:pair?.name||null,fallback:true});
    }
    const stored=job.weapons.specs.find(x=>x.key===spec.key);
    if(stored){stored.crafted=stored.crafted||[];stored.crafted[s]={pair:record.pair,weights:record.weights,fallback:!!record.fallback};}
    job.stages.push(record);job.done++;await this.save(this.public(job));
    return pair;
  }
  // Healers: one run reads every healer weapon's stats (each distinct item once), then each specialization is
  // scored and ranked on them. Their rows sit under the first scenario; a fight style does not change a stat score.
  async readHealers(job,plan){
    const healers=plan.weapons.specs.filter(s=>s.healer),dir=path.join(runsDir,job.id);
    const actors=new Map();
    for(const spec of healers)for(const c of spec.candidates)if(!actors.has(c.line))actors.set(c.line,'x'+String(actors.size+1).padStart(4,'0'));
    const stem=String(job.stages.filter(r=>r.stem).length).padStart(3,'0'),json=path.join(dir,`${stem}.json`),input=path.join(dir,`${stem}.simc`);
    const record={stage:3,stem,count:actors.size,healer:true};
    job.current={name:`Healers · reading ${actors.size} weapons`,scenario:plan.scenarios[0],index:job.stages.length};
    await fs.writeFile(input,readoutInput([...actors].map(([line,key])=>({key,line})),plan.weapons.referenceText,json));
    await this.save(this.public(job));
    try{
      await this.execute(input,dir,job);
      if(job.status==='cancelled')return;
      const readout=readoutStats(JSON.parse(await fs.readFile(json,'utf8')));
      if(!readout.reference)throw new Error('The weapon readout has no reference character.');
      const {weight,content}=plan.weapons.healer;
      job.weapons.healer={...job.weapons.healer,damageWeights:damageWeights(readout.reference,readout.conversion),reference:{...job.weapons.healer.reference,intellect:readout.reference.intellect,ratings:readout.reference.ratings}};
      for(const spec of healers){
        const items=new Map(spec.candidates.map(c=>[c.key,readout.items.get(actors.get(c.line))]));
        const rows=healerRows(spec,{...readout,items},{content,weight});
        const ranked=rankHealerRows(rows,spec.candidates);
        const stored=job.weapons.specs.find(s=>s.key===spec.key);if(stored)Object.assign(stored,{compare:ranked.compare,weights:spec.weights[content]});
        job.results.push(...rows);
      }
      Object.assign(record,{status:'complete'});
    }catch(e){
      if(job.status==='cancelled')return;
      Object.assign(record,{status:'failed',error:e.message});
    }
    job.stages.push(record);job.done++;await this.save(this.public(job));
  }
  // Merged view of one spec and scenario: the final round replaces its own screening rows, the rest keep the
  // screened numbers, and every surviving row gets its rank and tier.
  // A support specialization's share of the raid: the same fight once more with it standing idle, so its allies
  // lose every buff. What the raid drops by is what the specialization adds, and gaps are read against that.
  async supportShare(job,plan,s,settings,spec){
    const stem=String(job.stages.filter(r=>r.stem).length).padStart(3,'0'),dir=path.join(runsDir,job.id);
    const paths={json:path.join(dir,`${stem}.json`),html:path.join(dir,`${stem}.html`)},input=path.join(dir,`${stem}.simc`);
    const record={spec:spec.key,scenario:s,stage:4,stem,count:0,iterations:settings.iterations,targetError:settings.targetError,idle:true};
    job.current={name:`${spec.label} · allies without its buffs`,scenario:plan.scenarios[s],index:job.stages.length};
    await fs.writeFile(input,inputFor({text:`${spec.text}\nactions.precombat=snapshot_stats\nactions=wait,sec=5`},settings,plan.scenarios[s],paths));
    await this.save(this.public(job));
    try{
      await this.execute(input,dir,job);
      if(job.status==='cancelled')return null;
      const idle=JSON.parse(await fs.readFile(paths.json,'utf8')).sim?.statistics?.raid_dps?.mean;
      const final=job.stages.find(st=>st.spec===spec.key&&st.scenario===s&&st.stage===2&&st.status==='complete')?.baseline;
      if(!Number.isFinite(idle)||!final)throw new Error('The idle run or the final round has no raid damage to compare.');
      const share=final.dps-idle;
      if(!(share>0))throw new Error('The raid did no less damage without this specialization.');
      Object.assign(record,{status:'complete',idle,share,own:final.own??null});
      job.stages.push(record);job.done++;await this.save(this.public(job));
      return share;
    }catch(e){
      if(job.status==='cancelled')return null;
      Object.assign(record,{status:'failed',error:e.message});job.stages.push(record);job.done++;await this.save(this.public(job));
      return null;
    }
  }
  rankWeapons(job,spec,s,tank,scale=null){
    const rows=job.results.filter(r=>r.spec===spec.key&&r.scenario===s);
    const finals=new Set(rows.filter(r=>r.stage===2).map(r=>r.key));
    for(const row of rows){row.superseded=row.stage===1&&finals.has(row.key);row.screened=row.stage===1;delete row.rank;delete row.tier;delete row.behind;delete row.tied;delete row.variant;delete row.behindFirst;delete row.set;}
    // A crafted weapon is one item in several stat pairs: they share a group, and only its best pair is ranked.
    const byKey=new Map(spec.candidates.map(c=>[c.key,c]));
    const group=row=>{const c=byKey.get(row.key);return c?`${c.slot}|${c.itemId}`:row.key;};
    // Each hand is ranked on its own. What the reference profile happens to wield in the other hand decides how
    // much a swap is worth, so one list across both hands would rank the hands, not the weapons.
    const live=rows.filter(r=>!r.superseded);
    for(const slot of new Set(spec.candidates.map(c=>c.slot)))rankWeaponRows(live.filter(r=>byKey.get(r.key)?.slot===slot),tank,group,row=>!!byKey.get(row.key)?.set,scale);
  }
  // `extra` is for Best in Slot: a base actor other than the imported character (the set found so far) and its own title.
  async stage(job,plan,s,stage,list,settings,spec,extra={}){
    const profile=extra.base||spec||plan.profile;
    const stem=String(job.stages.filter(r=>r.stem).length).padStart(3,'0');const dir=path.join(runsDir,job.id);const paths={json:path.join(dir,`${stem}.json`),html:path.join(dir,`${stem}.html`)};const input=path.join(dir,`${stem}.simc`);
    const scenario=plan.scenarios[s];
    // Enough to run the same stage again: the fight, its length and variation, and the precision it asked for.
    const record={...(spec?{spec:spec.key}:{}),scenario:s,stage,stem,count:list.length,iterations:settings.iterations,targetError:settings.targetError,fightStyle:scenario.style,targets:scenario.targets,duration:scenario.duration||settings.duration,variation:settings.environment?.variation??20};
    const title=job.crests?'Upgrades':job.vault?'Great Vault choices':{1:'Screening',3:'Embellishment pairs',[pairStages.screen]:'Pair screening',[pairStages.final]:'Pair final',[pairStages.resolve]:'Resolving tied pairs'}[stage]||'Final round';
    job.current={name:`${spec?spec.label+' · ':''}${extra.title||title} · ${list.length} ${extra.base||stage===3&&job.bis?'sets':isPairStage(stage)?'pairs':'candidates'}`,scenario,index:job.stages.length};
    // Profilesets go last so each one inherits every option of the base profile and environment.
    const actor=playerActorIndex(settings,scenario);
    await fs.writeFile(input,inputFor({text:profile.text},settings,scenario,paths)+(settings.tank?`profileset_metric=${tankMetricList}\n`:'')+(actor?`profileset_main_actor_index=${actor}\n`:'')+(spec?.support?'profileset_metric=raid_dps,dps\n':'')+profilesetLines(list,profile,this.catalog).join('\n')+'\n');
    await this.save(this.public(job));
    try{
      await this.execute(input,dir,job);
      if(job.status==='cancelled')return null;
      const report=JSON.parse(await fs.readFile(paths.json,'utf8'));
      const result=profilesetResults(report,settings.tank,{raid:!!spec?.support});
      Object.assign(record,{status:'complete',baseline:result.baseline});
      // The gear the reference character wears is worth stating: it decides the stat weights the weapons are judged under.
      if(spec){const gear=actorGear(report);if(gear){record.gear=gear;const stored=(job.weapons||job.trinkets).specs.find(s=>s.key===spec.key);if(stored)stored.gear=gear;}}
      for(const row of result.rows)job.results.push({...(spec?{spec:spec.key}:{}),scenario:s,stage,...(isPairStage(stage)?{pair:true}:{}),...row,status:'complete'});
      job.stages.push(record);job.done++;await this.save(this.public(job));
      return result;
    }catch(e){
      if(job.status==='cancelled')return null;
      Object.assign(record,{status:'failed',error:e.message});job.stages.push(record);job.done++;await this.save(this.public(job));return null;
    }
  }
  // The tank boss is calibrated once against the gear it will judge and then shared by every variant and scenario.
  // Weapon Lab calibrates one boss per tank specialization, because each reference profile has its own health pool.
  // A Mythic+ route: one shorter run at a trial share measures every pull's length; the share, the time between
  // pulls and the Bloodlust pulls come from it (see finishRoute in mplus.mjs).
  // Bloodlust shortens the pull it lands on, so a second measuring run has it where the first one placed it.
  async calibrateRoute(job,plan,s){
    const dir=path.join(runsDir,job.id),scenario=plan.scenarios[s];
    const settings={...plan.settings,iterations:Math.min(plan.settings.iterations,1000),targetError:Math.max(plan.settings.targetError,0.5)};
    let route=null;
    for(const pass of [1,2]){
      const trial={...trialRoute(scenario.route),...(route?{lust:route.lust}:{})};
      job.current={name:`Measuring the pace of ${scenario.route.dungeonName} · ${pass} of 2`,scenario,index:job.results.length};await this.save(this.public(job));
      const stem=`route-${s}-${pass}`;const paths={json:path.join(dir,stem+'.json'),html:path.join(dir,stem+'.html')};const input=path.join(dir,stem+'.simc');
      await fs.writeFile(input,inputFor({text:plan.profile.text},settings,{...scenario,route:trial},paths));
      await this.execute(input,dir,job);if(job.status==='cancelled')throw new Error('Cancelled.');
      route=finishRoute(scenario.route,trial,pullLengths(await fs.readFile(paths.html,'utf8')));
      if(pass===2)route.lust=trial.lust;
    }
    job.done++;await this.save(this.public(job));
    return route;
  }
  // Falling dummy health: one short run per health band with the dummies held there, measuring how much damage each
  // dummy takes per second; every dummy then gets its own timeline from 100% to 1% (see dummies.mjs).
  async calibrateDummyHealth(job,plan,s){
    const dir=path.join(runsDir,job.id),{bleedTail,...scenario}=plan.scenarios[s],duration=(scenario.duration||plan.settings.duration)+(bleedTail||0);
    const settings={...plan.settings,iterations:Math.min(plan.settings.iterations,1000),targetError:Math.max(plan.settings.targetError,0.5)};
    const reports=[];
    for(const band of dummyBands){
      if(job.status==='cancelled')throw new Error('Cancelled.');
      job.current={name:`Measuring how fast the dummies fall · ${band.from}–${band.to}%`,scenario,index:job.results.length};await this.save(this.public(job));
      const stem=`dummies-${s}-${band.at}`;const paths={json:path.join(dir,stem+'.json'),html:path.join(dir,stem+'.html')};const input=path.join(dir,stem+'.simc');
      await fs.writeFile(input,inputFor({text:plan.profile.text},settings,{...scenario,dummyHealth:{calibrate:band.at}},paths).replace(/^html=.*\n/m,''));
      await this.execute(input,dir,job);if(job.status==='cancelled')throw new Error('Cancelled.');
      reports.push(JSON.parse(await fs.readFile(paths.json,'utf8')));
    }
    job.done++;await this.save(this.public(job));
    return calibrateDummies(reports,duration);
  }
  async calibrateTank(job,text,base,label,prefix){
    const dir=path.join(runsDir,job.id);let n=0;
    job.current={name:label,scenario:{style:'Patchwerk',targets:1},index:job.stages?.length||0};await this.save(this.public(job));
    const simulate=async(boss,{iterations})=>{
      const stem=`${prefix}-${n++}`;const paths={json:path.join(dir,stem+'.json'),html:path.join(dir,stem+'.html')};const input=path.join(dir,stem+'.simc');
      const settings={...base,iterations,targetError:0,tank:{...base.tank,boss}};
      await fs.writeFile(input,inputFor({text},settings,{style:'Patchwerk',targets:1},paths).replace(/^html=.*\n/m,''));
      await this.execute(input,dir,job);if(job.status==='cancelled')throw new Error('Cancelled.');
      return JSON.parse(await fs.readFile(paths.json,'utf8'));
    };
    const boss=await calibrate(base.tank,simulate);
    job.done++;await this.save(this.public(job));
    return boss;
  }
  // A run takes as long as it takes: no time limit, since a job is cancelled from the app when it should stop.
  // A timeout is only set where a caller asks for one.
  execute(input,dir,job,timeout=null){return new Promise((resolve,reject)=>{
    const child=spawn(executable,[input],{cwd:dir,windowsHide:true,shell:false});this.child=child;let tail='';job.progress=null;
    let localeMissing=false;const capture=data=>{tail=(tail+data.toString()).slice(-12000);if(tail.includes('_S_create_c_locale'))localeMissing=true;job.log=tail;const progress=parseProgress(tail.slice(-2000));if(progress)job.progress=progress;};child.stdout.on('data',capture);child.stderr.on('data',capture);
    const timer=Number.isFinite(timeout)?setTimeout(()=>{child.kill();reject(new Error(`The run exceeded ${timeout/60000} minutes.`));},timeout):null;
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code===0)resolve();
      // On Linux SimC writes its HTML report under the en_US.UTF-8 locale and fails when the system lacks it.
      // The JSON result is complete by then, so the run counts; only the HTML download is missing.
      else if(localeMissing&&code!==null){const note='SimC could not write HTML reports because the en_US.UTF-8 locale is missing (Ubuntu: sudo locale-gen en_US.UTF-8). Results are complete.';job.warnings=[...new Set([...(job.warnings||[]),note])];resolve();}else reject(new Error(tail.slice(-3000)||`SimC exited with code ${code}.`));});
  });}
}
