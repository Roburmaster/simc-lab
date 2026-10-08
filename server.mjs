import {slotTypes,fitsSlot,expandWeaponAlternatives} from './lib/equipment.mjs';
import {buffs} from './lib/environment.mjs';
import {loadTalentData,decodeTalents,validateBuild,pointTotals} from './lib/talents.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {parseProfile} from './lib/profile.mjs';
import {loadCatalog} from './lib/catalog.mjs';
import {loadSeason,publicSources,upgradeSteps} from './lib/upgrades.mjs';
import {readUpgradeState} from './lib/crests.mjs';
import {presets as tankPresets,isTank} from './lib/tank.mjs';
import {loadReferenceSpecs,publicSpec,clearReferenceCache,craftedItemLevel,weaponSteps,kinds as weaponKindNames,limits as weaponLimits} from './lib/weapons.mjs';
import {tierListPage} from './lib/tierpage.mjs';
import {trinketListPage} from './lib/trinketpage.mjs';
import {siteReport} from './lib/sitereport.mjs';
import {limits as trinketLimits,trinketSteps,levelSteps,scenarioPresets} from './lib/trinkets.mjs';
import {upgradeReportPage} from './lib/upgradepage.mjs';
import {bisReportPage} from './lib/bispage.mjs';
import {depths as bisDepths,bisSteps} from './lib/bis.mjs';
import {healerWeights,contents as healerContents} from './lib/healers.mjs';
import {root,runsDir,engineStatus,prepare,Jobs,loadEnginePaths,jobFraction} from './lib/engine.mjs';
import * as engine from './lib/engine.mjs';
import {upstreamDir,currentProfileDir} from './lib/paths.mjs';
import {Updater} from './lib/updater.mjs';
import {loadSettings,saveSettings} from './lib/settings.mjs';
import {WowAddon} from './lib/wowaddon.mjs';
import {identity,simEntry,trackTable,sendableModes} from './lib/wowdata.mjs';
import {importArmory,isArmoryProfile} from './lib/armory.mjs';
import {logsDir,listLogs,logPath,scanLog,readPlayer} from './lib/combatlog.mjs';
import {analyserFor,supported as analysedSpecs,simCastsPerMinute,simRotation} from './lib/analysis/index.mjs';
import {fightSetup,align,simCasts,logCasts} from './lib/analysis/compare.mjs';
import {replayHasRoute} from './lib/mplus.mjs';
const port=Number(process.env.PORT || 8642);
const pkg=JSON.parse(await fs.readFile(new URL('./package.json',import.meta.url),'utf8'));
const appInfo={name:'SimC Lab',version:pkg.version,desktop:!!process.env.SIMC_LAB_DESKTOP,platform:process.platform};const token=randomBytes(32).toString('hex');
// Game data is (re)loaded at start and after every engine update. Without an engine the app still starts,
// so a first run can install SimC from the interface.
let catalog=null,talentData=null,season=null,loadError=null;
async function loadData(){
  const {source}=await loadEnginePaths();clearReferenceCache();
  try{const c=await loadCatalog(source);const t=await loadTalentData(upstreamDir,source);const s=await loadSeason(upstreamDir,c,source);catalog=c;talentData=t;season=s;loadError=null;jobs.catalog=c;}
  catch(e){catalog=talentData=season=null;loadError=e.code==='ENOENT'?'SimC is not installed yet.':e.message;}
}
const jobs=new Jobs(null);await jobs.init();await loadData();
const busy=()=>[...jobs.jobs.values()].some(j=>['queued','running'].includes(j.status));
const updater=new Updater({busy,onInstalled:loadData,followSource:async()=>(await loadSettings()).followLatestCommit});
// The WoW addon: installed from the copy inside the app, fed through Data.lua, and kept in step on every start.
const wow=new WowAddon({installDir:engine.wowInstallDir,context:async()=>({tracks:trackTable(season),app:pkg.version})});
async function sendToWow(job,options){
  ready();if(!season)throw new Error('Season data is not loaded.');
  const request=JSON.parse(await fs.readFile(path.join(runsDir,job.id,'request.json'),'utf8'));
  if(isArmoryProfile(request.profile))throw new Error('Characters imported from the Armory are not sent to the WoW addon. Use /simc in game for that.');
  return wow.send(identity(request.profile,talentData),simEntry(job,request,{season,tracks:trackTable(season)}),options);
}
jobs.onFinished=async job=>{
  if(!sendableModes[job.mode]||job.armory||!['complete','partial'].includes(job.status))return;
  const {settings}=await wow.loadStore();if(!settings.autoSend)return;
  try{await sendToWow(job,{auto:true});}catch(e){wow.last={id:job.id,auto:true,time:new Date().toISOString(),error:e.message};}
};
wow.autoUpdate().catch(e=>console.error('SimCLab addon update failed:',e.message));
const ready=()=>{if(!catalog)throw new Error(loadError||'SimC is not installed yet. Use Update SimC.');};
// Combat log scans, kept per file while it is unchanged (name, size and time); a big file takes a while, so a scan
// runs in the background and the page asks how far it has come.
const scans=new Map();
async function startScan(name){
  const dir=await logsDir(await engine.wowInstallDir());const file=logPath(dir,name);const stat=await fs.stat(file);
  const key=`${name}|${stat.size}|${stat.mtimeMs}`;let scan=scans.get(name);
  if(!scan||scan.key!==key){
    scan={key,status:'scanning',progress:0};scans.set(name,scan);
    scanLog(file,p=>{scan.progress=p;}).then(result=>Object.assign(scan,{status:'done',result}),e=>Object.assign(scan,{status:'failed',error:e.message}));
  }
  return {status:scan.status,progress:scan.progress,error:scan.error,...(scan.status==='done'?{scan:scan.result}:{})};
}
// A finished simulation to compare with: its first completed result's report.
async function jobReport(id,stem){
  const job=jobs.jobs.get(String(id));if(!job)throw new Error('Simulation not found.');
  const row=stem?job.results.find(r=>r.stem===stem):job.results.find(r=>r.status==='complete'&&r.baseline)||job.results.find(r=>r.status==='complete');
  if(!row||row.status!=='complete')throw new Error('That simulation has no finished result.');
  const dir=path.join(runsDir,job.id);
  return {job,row,report:JSON.parse(await fs.readFile(path.join(dir,row.stem+'.json'),'utf8')),apl:await fs.readFile(path.join(dir,row.stem+'.apl.simc'),'utf8').catch(()=>'')};
}
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>600000)throw new Error('The request is too large.');}return JSON.parse(text);}
const server=http.createServer(async(req,res)=>{
  try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return json(res,403,{error:'Invalid host.'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);const route=url.pathname;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(!route.startsWith('/reports/'))res.setHeader('Content-Security-Policy',"default-src 'self'; font-src 'self' data:; script-src 'self' https://wow.zamimg.com https://www.wowhead.com https://nether.wowhead.com; style-src 'self' 'unsafe-inline' https://wow.zamimg.com; img-src 'self' data: https://wow.zamimg.com https://*.wowhead.com; frame-ancestors 'none'; connect-src 'self' https://www.wowhead.com https://nether.wowhead.com https://wow.zamimg.com");
    if(req.method==='POST'){
      const received=Buffer.from(req.headers['x-simc-token'] || '');const expected=Buffer.from(token);
      if(received.length!==expected.length || !timingSafeEqual(received,expected))return json(res,403,{error:'Reload the page.'});
      if(req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin))return json(res,403,{error:'Invalid origin.'});
    }
    if(req.method==='GET'&&route==='/api/status')return json(res,200,{engine:await engineStatus(),expansion:catalog?.expansion||null,loadError,token,app:appInfo});
    if(req.method==='GET'&&route==='/api/engine/update')return json(res,200,updater.state);
    if(req.method==='GET'&&route==='/api/settings')return json(res,200,await loadSettings());
    if(req.method==='POST'&&route==='/api/settings')return json(res,200,await saveSettings(await body(req)));
    if(req.method==='POST'&&route==='/api/engine/check')return json(res,200,await updater.check());
    if(req.method==='POST'&&route==='/api/engine/update'){const {mode='auto',sha=null}=await body(req);if(!['auto','nightly','source','rebuild','data'].includes(mode))throw new Error('Unknown update mode.');return json(res,202,updater.start(mode,sha||null));}
    if(req.method==='GET'&&route==='/api/wow')return json(res,200,await wow.status());
    if(req.method==='POST'&&route==='/api/wow/install')return json(res,200,await wow.install());
    if(req.method==='POST'&&route==='/api/wow/uninstall')return json(res,200,await wow.uninstall());
    if(req.method==='POST'&&route==='/api/wow/addon-check'){await wow.checkOnline({force:true});return json(res,200,await wow.status());}
    if(req.method==='POST'&&route==='/api/wow/addon-update'){const online=await wow.checkOnline({force:true});if(!online.manifest)throw new Error(online.error||'No addon release was found.');return json(res,200,await wow.installOnline(online.manifest));}
    if(req.method==='POST'&&route==='/api/wow/settings')return json(res,200,await wow.settings(await body(req)));
    if(req.method==='POST'&&route==='/api/wow/remove'){const {id}=await body(req);return json(res,200,await wow.remove(String(id)));}
    if(req.method==='GET'&&route==='/api/wow/captures')return json(res,200,await wow.captures());
    // Mythic+ routes: the season's dungeons with the MDT routes and Raider.IO runs this PC has for each.
    if(req.method==='GET'&&route==='/api/mplus'){
      const {sources,season}=await engine.routeData();
      return json(res,200,{missing:sources.missing,dungeons:season.map(d=>({name:d.name,index:d.index,total:d.total,bosses:d.bosses.map(b=>b.name),
        routes:d.routes.map(r=>({id:r.id,name:r.name,pulls:r.pulls.length})),
        runs:d.replays.map(r=>({id:r.id,route:replayHasRoute(r,d.total),level:r.level,clearTime:r.clearTime,date:r.date,deaths:r.deaths.length,killed:r.bosses.filter(b=>b.killed).length,bosses:r.bosses.length}))}))});
    }
    if(req.method==='GET'&&route==='/api/logs'){const dir=await logsDir(await engine.wowInstallDir());return json(res,200,{dir,files:await listLogs(dir),specs:analysedSpecs});}
    if(req.method==='POST'&&route==='/api/logs/scan'){const {file}=await body(req);return json(res,200,await startScan(file));}
    // One fight read and analysed, for the simulation and the comparison that follow an analysis.
    const loggedFight=async({file,fight:id,player})=>{
      const state=await startScan(file);if(state.status!=='done')throw new Error('Scan the log first.');
      const fight=state.scan.fights.find(f=>f.id===Number(id));if(!fight)throw new Error('Choose a fight.');
      const data=await readPlayer(logPath(await logsDir(await engine.wowInstallDir()),file),fight,String(player));
      const analyser=analyserFor(data);if(!analyser)throw new Error(`Rotation analysis is not available for this specialization yet. Analysed so far: ${analysedSpecs.join(', ')}.`);
      return {fight,data,analysis:analyser.analyse(data)};
    };
    // Simulate the fight from the Log Analysis tab: the character's addon export, the matching fight, no buffs.
    if(req.method==='POST'&&route==='/api/logs/simulate'){
      ready();if(updater.switching)throw new Error('SimC is switching to the new engine. Try again in a moment.');
      const input=await body(req);const {fight,data,analysis}=await loggedFight(input);
      const capture=(await wow.captures()).characters?.find(c=>c.key===String(input.character));
      if(!capture?.text)throw new Error('This character has no export from the SimCLab addon. Log in with it and type /simc, or use Quick Sim.');
      const {label,...scenario}=fightSetup(fight,data,analysis);
      const request={profile:capture.text,mode:'quick',iterations:Number(input.iterations)||10000,targetError:0.2,duration:scenario.duration,threads:Number(input.threads)||engine.maxThreads,
        environment:{buffs:Object.fromEntries(buffs.map(b=>[b.id,false])),variation:0,bloodlust:{mode:'pull',value:0},consumables:{food:'none',flask:'none',potion:'none',augmentation:'none',main_hand_oil:'none',off_hand_oil:'none'}},scenarios:[scenario]};
      const plan=await prepare(request,catalog,talentData,season);
      return json(res,201,{...jobs.public(await jobs.add(plan,request)),setup:{...scenario,label}});
    }
    // SimC's sample sequence set against the log, cast by cast.
    if(req.method==='POST'&&route==='/api/logs/compare'){
      const input=await body(req);const {analysis}=await loggedFight(input);const {report,row}=await jobReport(input.job);
      const rotation=simRotation(report);
      return json(res,200,{...align(simCasts(rotation.sequence),logCasts(analysis.casts)),simDps:row.dps,logDps:analysis.dps,length:analysis.length});
    }
    if(req.method==='POST'&&route==='/api/logs/analyse'){
      const {file,fight:id,player,job}=await body(req);const state=await startScan(file);if(state.status!=='done')throw new Error('Scan the log first.');
      const fight=state.scan.fights.find(f=>f.id===Number(id));if(!fight)throw new Error('Choose a fight.');
      const data=await readPlayer(logPath(await logsDir(await engine.wowInstallDir()),file),fight,String(player));
      const analyser=analyserFor(data);if(!analyser)throw new Error(`Rotation analysis is not available for this specialization yet. Analysed so far: ${analysedSpecs.join(', ')}.`);
      const compare=job?await jobReport(job):null;
      const potions=[...new Set((catalog?.consumables.potion||[]).map(p=>p.name.replace(/\s*\(.*\)$/,'')))];
      return json(res,200,{...analyser.analyse(data,{sim:compare?simCastsPerMinute(compare.report):null,potions}),fight:{id:fight.id,kind:fight.kind,name:fight.name,length:fight.length},...(compare?{compare:{job:compare.job.id,name:compare.job.name,dps:compare.row.dps,scenario:compare.job.scenarios[compare.row.scenario]}}:{})});
    }
    if(req.method==='POST'&&route==='/api/wow/send'){const {job:id}=await body(req);const job=jobs.jobs.get(String(id));if(!job)return json(res,404,{error:'Job not found.'});return json(res,200,await sendToWow(job,{auto:false}));}
    if(route!=='/api/jobs'&&route.startsWith('/api/')&&!route.startsWith('/api/jobs/')&&route!=='/api/status')ready();
    if(req.method==='GET'&&route==='/api/options')return json(res,200,{buffs,consumables:catalog.consumables,expansion:catalog.expansion,tankPresets});
    if(req.method==='GET'&&route==='/api/upgrade-sources')return json(res,200,publicSources(season));
    if(req.method==='GET'&&route==='/api/bis-sources')return json(res,200,{...publicSources(season),craftedCap:await craftedItemLevel(engine.source),depths:bisDepths});
    if(req.method==='GET'&&route==='/api/weapon-specs'){
      const specs=await loadReferenceSpecs(engine.source,talentData);
      return json(res,200,{specs:specs.map(publicSpec),tracks:season.tracks,difficulties:season.difficulties,kinds:weaponKindNames,craftedStats:season.craftedStats,craftedCap:await craftedItemLevel(engine.source),limits:weaponLimits,season:season.season,healer:{contents:healerContents,source:(await healerWeights()).source}});
    }
    if(req.method==='GET'&&route==='/api/example'){
      const dir=await currentProfileDir(engine.source);const file=(await fs.readdir(dir)).find(f=>/_Mage_Frost\.simc$/.test(f));let text=await fs.readFile(path.join(dir,file),'utf8');
      // Strip generated action lists: use the engine's current default APL, as addon imports do.
      text=text.split('\n').filter(l=>!l.startsWith('actions') && !l.startsWith('#')).join('\n');
      return json(res,200,{text});
    }
    if(req.method==='GET'&&route==='/api/gear'){
      const slot=url.searchParams.get('slot'),info={class:url.searchParams.get('class'),spec:url.searchParams.get('spec'),level:url.searchParams.get('level')??90};if(!slotTypes[slot])return json(res,400,{error:'Select an equipment slot.'});
      const q=(url.searchParams.get('q')||'').toLowerCase();const result=catalog.currentItems.filter(i=>fitsSlot(i,slot,info)&&(i.name.toLowerCase().includes(q)||String(i.id)===q)).slice(0,100).map(i=>({id:i.id,name:i.name,itemLevel:i.itemLevel,expansion:i.expansion}));return json(res,200,result);
    }
    if(req.method==='POST'&&route==='/api/armory'){if(updater.switching)throw new Error('SimC is switching to the new engine. Try again in a moment.');const {region,realm,name,url:link}=await body(req);return json(res,200,await importArmory({region,realm,name,url:link},{executable:engine.executable}));}
    if(req.method==='POST'&&route==='/api/import'){
      const text=(await body(req)).profile;const p=parseProfile(text);p.upgradeState=readUpgradeState(text);
      for(const item of Object.values(p.gear)){item.item=catalog.items.get(item.id)||null;item.enchants=catalog.forItem(item.id,p.info.class);}
      p.expansion=catalog.expansion;p.isTank=isTank(p.info);p.armory=isArmoryProfile(text);
      p.alternatives=p.alternatives.filter(v=>{try{catalog.validateChanges(p,parseProfile(v.text,{override:true}));return true;}catch{return false;}});
      p.alternatives=expandWeaponAlternatives(p,catalog);
      p.gems=catalog.gems;
      try{const tree=talentData.find(p.info);const build=decodeTalents(p.info.talents,tree);p.talents={specId:tree.specId,name:tree.specName,className:tree.className,points:pointTotals(build,tree),errors:validateBuild(build,tree,{budgets:{class:34,spec:34,hero:13},entries:talentData.entries}),nodes:[...tree.classNodes,...tree.specNodes,...tree.heroNodes].filter(n=>build.selected[n.id]).map(n=>({id:n.id,name:n.name,rank:build.selected[n.id].rank,tree:tree.classNodes.includes(n)?'class':tree.specNodes.includes(n)?'spec':'hero'}))};}catch(e){p.talents={errors:[e.message]};}
      return json(res,200,p);
    }
    // Trinket Lab ranks damage and tank specializations; healers are named so the page can say why they are missing.
    if(req.method==='GET'&&route==='/api/trinket-specs'){
      const specs=await loadReferenceSpecs(engine.source,talentData);
      return json(res,200,{specs:specs.filter(s=>!s.healer).map(publicSpec),healers:specs.filter(s=>s.healer).map(s=>s.label),tracks:season.tracks,difficulties:season.difficulties,
        steps:levelSteps(season,season.tracks.map(t=>t.id)),defaultSteps:levelSteps(season).map(s=>s.track),craftedCap:await craftedItemLevel(engine.source),limits:trinketLimits,scenarios:scenarioPresets,engine:await engineStatus().then(e=>({version:e.version,commit:e.commit,maxThreads:e.maxThreads})),tankPresets,season:season.season});
    }
    if(req.method==='POST'&&route==='/api/preview'){
      const plan=await prepare(await body(req),catalog,talentData,season);const upgrade=plan.upgrade&&{candidates:plan.upgrade.candidates.length,slots:new Set(plan.upgrade.candidates.map(c=>c.slot)).size,finalists:plan.upgrade.finalists,embellished:plan.upgrade.candidates.filter(c=>c.embellishment).length,blocked:plan.upgrade.blocked,freed:plan.upgrade.freed,limitsUsed:plan.upgrade.limitsUsed,steps:upgradeSteps(plan.upgrade,plan.scenarios.length)};
      const bis=plan.bis&&{candidates:plan.bis.candidates.length,bags:plan.bis.bags,catalyst:plan.bis.catalyst,slots:new Set(plan.bis.candidates.map(c=>c.slot)).size,rounds:plan.bis.rounds,finalists:plan.bis.finalists,embellished:plan.bis.candidates.filter(c=>c.embellishment).length,steps:bisSteps(plan.bis,plan.scenarios.length)};
      const crests=plan.crests&&{affordable:plan.crests.affordable,candidates:plan.crests.candidates.length,items:plan.crests.items,budget:plan.crests.budget,state:plan.crests.state};
      const vault=plan.vault&&{candidates:plan.vault.candidates.length,items:plan.vault.items,skipped:plan.vault.skipped,upgraded:plan.vault.upgraded};
      const weapons=plan.weapons&&{specs:plan.weapons.specs.length,candidates:plan.weapons.candidates,skipped:plan.weapons.skipped,tanks:plan.weapons.specs.filter(s=>s.tank).length,healers:plan.weapons.specs.filter(s=>s.healer).length,craftedStats:plan.weapons.craftedStats.length,sources:plan.weapons.sources,levels:plan.weapons.levels,steps:weaponSteps(plan.weapons,plan.scenarios.length)};
      const trinkets=plan.trinkets&&{specs:plan.trinkets.specs.length,trinkets:plan.trinkets.trinkets,candidates:plan.trinkets.candidates,skipped:plan.trinkets.skipped,tanks:plan.trinkets.specs.filter(s=>s.tank).length,sources:plan.trinkets.sources,levels:plan.trinkets.levels,steps:trinketSteps(plan.trinkets,plan.scenarios.length),model:plan.trinkets.model,estimate:plan.trinkets.estimate,screened:plan.trinkets.specs.filter(s=>new Set(s.candidates.map(c=>c.itemId)).size>plan.trinkets.finalists).length};
      return json(res,200,{trinkets,variants:plan.variants.map(v=>({name:v.name,baseline:!!v.baseline})),total:trinkets?trinkets.steps:weapons?weapons.steps:crests||vault?plan.scenarios.length:bis?bis.steps:upgrade?upgrade.steps:plan.variants.length*plan.scenarios.length,warnings:plan.profile.warnings,search:plan.search,upgrade,bis,crests,vault,weapons});
    }
    if(req.method==='POST'&&route==='/api/jobs'){ready();if(updater.switching)throw new Error('SimC is switching to the new engine. Try again in a moment.');const request=await body(req);const plan=await prepare(request,catalog,talentData,season);return json(res,201,jobs.public(await jobs.add(plan,request)));}
    if(req.method==='GET'&&route==='/api/jobs/active')return json(res,200,jobs.activeJobs());
    if(req.method==='GET'&&route==='/api/jobs')return json(res,200,[...jobs.jobs.values()].reverse().map(j=>({id:j.id,name:j.name,mode:j.mode,status:j.status,created:j.created,done:j.done,total:j.total,fraction:jobFraction(j)})));
    const rotation=route.match(/^\/api\/jobs\/([\da-f-]{36})\/rotation(?:\/(\d{3}))?$/);
    if(req.method==='GET'&&rotation){const {report,apl,row}=await jobReport(rotation[1],rotation[2]);return json(res,200,{...simRotation(report,apl),stem:row.stem,variant:row.name,dps:row.dps});}
    const jobRoute=route.match(/^\/api\/jobs\/([\da-f-]{36})(\/cancel)?$/);
    if(jobRoute){const job=jobs.jobs.get(jobRoute[1]);if(!job)return json(res,404,{error:'Job not found.'});if(req.method==='POST'&&jobRoute[2])return json(res,200,await jobs.cancel(job.id));if(req.method==='GET'&&!jobRoute[2])return json(res,200,{...jobs.public(job),queue:jobs.queueFor(job),fraction:jobFraction(job)});}
    // The tier list is written here rather than by SimC, and carries no script, so it can be read in place.
    const tierList=route.match(/^\/tier-list\/([\da-f-]{36})\.html$/);
    if(req.method==='GET'&&tierList){
      const job=jobs.jobs.get(tierList[1]);
      if(!job?.weapons)return json(res,404,{error:'No Weapon Lab job with that id.'});
      const html=tierListPage(jobs.public(job));
      const filename=`weapon-tier-list-${new Date(job.finished||job.created).toISOString().slice(0,10)}.html`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="${filename}"`}:{})});
      return res.end(html);
    }
    // The same job in the website's own form, for mythicpersona.com's Trinket Lab section.
    const trinketSite=route.match(/^\/trinket-lab\/([\da-f-]{36})\.json$/);
    if(req.method==='GET'&&trinketSite){
      const job=jobs.jobs.get(trinketSite[1]);
      if(!job?.trinkets)return json(res,404,{error:'No Trinket Lab job with that id.'});
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="trinket-lab-${new Date(job.finished||job.created).toISOString().slice(0,10)}.json"`});
      return res.end(JSON.stringify(siteReport(jobs.public(job)),null,2));
    }
    const trinketList=route.match(/^\/trinket-tier-list\/([\da-f-]{36})\.html$/);
    if(req.method==='GET'&&trinketList){
      const job=jobs.jobs.get(trinketList[1]);
      if(!job?.trinkets)return json(res,404,{error:'No Trinket Lab job with that id.'});
      const html=trinketListPage(jobs.public(job));
      const filename=`trinket-tier-list-${new Date(job.finished||job.created).toISOString().slice(0,10)}.html`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="${filename}"`}:{})});
      return res.end(html);
    }
    // The Upgrade Finder's report page, built like the tier list: from the finished job, with no script of its own.
    const upgradeReport=route.match(/^\/upgrade-report\/([\da-f-]{36})\.html$/);
    if(req.method==='GET'&&upgradeReport){
      const job=jobs.jobs.get(upgradeReport[1]);
      if(!job?.upgrade)return json(res,404,{error:'No Upgrade Finder job with that id.'});
      const request=JSON.parse(await fs.readFile(path.join(runsDir,job.id,'request.json'),'utf8'));
      let info={},equipped={};try{const p=parseProfile(request.profile);info=p.info;for(const [slot,g] of Object.entries(p.gear))if(g.id)equipped[slot]={id:g.id,value:g.value,name:catalog?.items.get(g.id)?.name};}catch{}
      const html=upgradeReportPage(jobs.public(job),{info,equipped,armory:isArmoryProfile(request.profile)});
      const filename=`upgrade-report-${String(info.name||job.name).normalize('NFKD').replace(/[^A-Za-z0-9-]+/g,'_')}-${new Date(job.finished||job.created).toISOString().slice(0,10)}.html`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="${filename}"`}:{})});
      return res.end(html);
    }
    // Best in Slot's report page, built like the upgrade report: from the finished job, with no script of its own.
    const bisReport=route.match(/^\/bis-report\/([\da-f-]{36})\.html$/);
    if(req.method==='GET'&&bisReport){
      const job=jobs.jobs.get(bisReport[1]);
      if(!job?.bis)return json(res,404,{error:'No Best in Slot job with that id.'});
      const request=JSON.parse(await fs.readFile(path.join(runsDir,job.id,'request.json'),'utf8'));
      let info={};try{info=parseProfile(request.profile).info;}catch{}
      const html=bisReportPage(jobs.public(job),{info,armory:isArmoryProfile(request.profile)});
      const filename=`best-in-slot-${String(info.name||job.name).normalize('NFKD').replace(/[^A-Za-z0-9-]+/g,'_')}-${new Date(job.finished||job.created).toISOString().slice(0,10)}.html`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="${filename}"`}:{})});
      return res.end(html);
    }
    const report=route.match(/^\/reports\/([\da-f-]{36})\/(\d{3}\.(?:html|json|simc)|request\.json)$/);
    if(req.method==='GET'&&report){
      const data=await fs.readFile(path.join(runsDir,report[1],report[2]));
      const ext=path.extname(report[2]);
      // Reports are generated by SimC. Serve downloads so their scripts never share this app's origin.
      res.writeHead(200,{'Content-Type':ext==='.json'?'application/json':'application/octet-stream','Content-Disposition':`attachment; filename="${report[2]}"`});return res.end(data);
    }
    const assets={'/':'index.html','/app.js':'app.js','/mplus.js':'mplus.js','/items.js':'items.js','/wowhead.js':'wowhead.js','/features.js':'features.js','/upgrades.js':'upgrades.js','/bis.js':'bis.js','/crests.js':'crests.js','/crestplan.js':'crestplan.js','/vault.js':'vault.js','/weapons.js':'weapons.js','/trinkets.js':'trinkets.js','/tank.js':'tank.js','/engine.js':'engine.js','/activity.js':'activity.js','/environment.js':'environment.js','/wow.js':'wow.js','/logs.js':'logs.js','/armory.js':'armory.js','/style.css':'style.css'};
    if(req.method==='GET'&&assets[route]){const file=assets[route];res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});return res.end(await fs.readFile(path.join(root,'public',file)));}
    json(res,404,{error:'Not found.'});
  }catch(e){json(res,e.code==='ENOENT'?404:400,{error:e.message});}
});
server.listen(port,'127.0.0.1',()=>console.log(`SimC Lab: http://127.0.0.1:${port}`));
// Look for a newer SimC build at start and every few hours. Nothing is installed without the user's click.
updater.watch().catch(e=>console.error('SimC update check failed:',e.message));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{jobs.child?.kill();server.close();process.exit(0);});
