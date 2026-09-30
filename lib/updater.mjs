import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {home,upstreamDir,enginesDir,engineFile,dataDir,readEngineMetadata,windows,simcName} from './paths.mjs';

const run=promisify(execFile);
const repo='simulationcraft/simc';
const nightlyIndex='http://downloads.simulationcraft.org/nightly/?C=M;O=D';
const raidbots='https://www.raidbots.com/static/data';
// Game data the app reads, pinned by Raidbots content hash.
export const dataFiles=['talents','equippable-items','enchantments','gems','flasks','potions','foods','temp-enchants','augments','encounter-items','instances','seasons','bonus-upgrade-sets','bonus-crafted-stats','weapon-specs','item-level-bonus-lookup','bonus-sockets','crafting'];
// The part of the SimC source tree the app reads next to the simc executable.
const sourceFiles=['engine/dbc/generated/item_data.inc','engine/dbc/generated/permanent_enchant.inc','engine/dbc/generated/trait_data.inc','engine/dbc/generated/item_bonus.inc','engine/dbc/generated/item_set_bonus.inc','SpellDataDump/build_info.txt'];
const buildPattern=/SimulationCraft ([\d-]+) for World of Warcraft ([\d.]+) Live \(hotfix ([^)]+)\)/;
export function parseBuildInfo(text){const m=String(text).match(buildPattern);return m?{version:m[1],wowVersion:m[2],hotfix:m[3]}:null;}

async function get(url,type='text'){
  const res=await fetch(url,{headers:{'User-Agent':'SimC-Lab'}});
  if(!res.ok)throw new Error(`Download failed: ${url} (${res.status})`);
  return type==='json'?res.json():res.text();
}

// Decides what an update should install. Pure, so it can be tested without the network.
export function plan({installedWow,local,head,nightly,live,mode='auto'}){
  const target=installedWow||live?.wowBuild||head?.wowVersion||nightly?.build?.wowVersion;
  const fits=build=>!!build&&(!target||build.wowVersion===target);
  const fromNightly=()=>({kind:'nightly',...nightly.build,sha:nightly.sha,date:nightly.date,url:nightly.url,name:nightly.name});
  // SimC commits almost daily, and each commit can change class modules, action lists and item effects, so an
  // update installs the newest official nightly whenever it is newer than the engine in use, not only when WoW
  // patches (keeping the engine for a whole WoW build left it dozens of commits behind GitHub). The nightly trails
  // GitHub by hours. Compiling from source (20–40 minutes) is the fallback for a WoW build no nightly covers yet,
  // or a choice (Build from source). An engine newer than the nightly, such as a source build, is kept.
  const newerNightly=!!nightly&&fits(nightly.build)&&nightly.sha!==local?.commit&&!(local?.commitDate&&nightly.date&&Date.parse(local.commitDate)>=Date.parse(nightly.date));
  const keep=mode==='data'||mode==='auto'&&!!local?.commit&&fits(local)&&!newerNightly;
  let engine=null;
  if(mode==='source'){if(!head)throw new Error('Could not reach the SimC source repository.');engine={kind:'source',...head};}
  else if(mode==='nightly'){if(!nightly)throw new Error('Could not reach the SimC nightly builds.');engine=fromNightly();}
  else if(!keep){
    if(nightly&&fits(nightly.build))engine=fromNightly();
    else if(head&&fits(head))engine={kind:'source',...head};
  }
  const engineBuild=engine?.wowVersion||local?.wowVersion;
  const upToDate=keep;
  const dataCurrent=!!live&&live.contentHash===local?.dataHash&&live.wowBuild===engineBuild;
  if(!engine&&!keep)return {action:'wait',engine:null,target,reason:target?`SimC has not been updated for WoW ${target} yet. Try again later.`:'SimC could not be reached.'};
  if(live&&engineBuild&&live.wowBuild!==engineBuild)return {action:'wait',engine,target,reason:`Game data is for WoW ${live.wowBuild}, SimC is for ${engineBuild}. Try again when both are updated.`};
  if(upToDate&&dataCurrent)return {action:'none',engine,target,reason:'SimC is the newest official build and game data is up to date.'};
  return {action:upToDate?'data':engine.kind,engine:upToDate?null:engine,target,reason:upToDate?'New game data is available.':engine.kind==='nightly'?'A newer SimC build is available.':'SimC must be built from source for this WoW build.'};
}

export class Updater{
  constructor({busy,onInstalled}){this.busy=busy;this.onInstalled=onInstalled;this.state={status:'idle',log:[]};}
  log(line){this.state.log.push(`${new Date().toLocaleTimeString('en-GB')} ${line}`);this.state.log=this.state.log.slice(-200);this.state.step=line;}

  async check(){
    const [local,installedWow]=await Promise.all([readEngineMetadata(),import('./engine.mjs').then(m=>m.installedWowVersion())]);
    const localData=await fs.readFile(path.join(upstreamDir,'metadata.json'),'utf8').then(JSON.parse,()=>null);
    const errors=[];
    const safe=async(label,fn)=>{try{return await fn();}catch(e){errors.push(`${label}: ${e.message}`);return null;}};
    const branch=local.branch||'midnight';
    const head=await safe('SimC source',async()=>{
      const commit=await get(`https://api.github.com/repos/${repo}/commits/${branch}`,'json');
      return {sha:commit.sha,date:commit.commit.committer.date,branch,...parseBuildInfo(await get(`https://raw.githubusercontent.com/${repo}/${commit.sha}/SpellDataDump/build_info.txt`))};
    });
    // Official nightly builds exist only for Windows; Linux always builds from source.
    const nightly=!windows?null:await safe('SimC nightly',async()=>{
      const name=(await get(nightlyIndex)).match(/href="(simc-[\d.]+\.([0-9a-f]{7,})-win64\.7z)"/);if(!name)throw new Error('No Windows build listed.');
      const commit=await get(`https://api.github.com/repos/${repo}/commits/${name[2]}`,'json');
      return {name:name[1],url:new URL(name[1],nightlyIndex).href,sha:commit.sha,date:commit.commit.committer.date,build:parseBuildInfo(await get(`https://raw.githubusercontent.com/${repo}/${commit.sha}/SpellDataDump/build_info.txt`))};
    });
    // How far the installed engine trails GitHub, so a stale engine is visible rather than silent.
    const behind=local.commit&&head?.sha&&local.commit!==head.sha?await safe('SimC history',async()=>(await get(`https://api.github.com/repos/${repo}/compare/${local.commit}...${head.sha}`,'json')).ahead_by):local.commit&&head?.sha?0:null;
    const live=await safe('Game data',()=>get(`${raidbots}/live/metadata.json`,'json'));
    // Data from before a file joined the list is refreshed even when Raidbots has not published anything new.
    const complete=dataFiles.every(name=>localData?.hashes?.[name]);
    const decision=plan({installedWow,local:{...local,dataHash:complete?localData?.contentHash:null},head,nightly,live});
    return this.state.check={checkedAt:new Date().toISOString(),installedWow,local:{version:local.version,wowVersion:local.wowVersion,commit:local.commit,behind,source:['nightly','source'].includes(local.source)?local.source:'source',dataBuild:localData?.wowBuild},head,nightly:nightly&&{name:nightly.name,url:nightly.url,sha:nightly.sha,date:nightly.date,...nightly.build},live:live&&{wowBuild:live.wowBuild,contentHash:live.contentHash},decision,errors};
  }

  // `sha` pins one SimC commit: the official build of that commit when there is one, else that commit built from
  // source. For comparing with a result made on a known commit (Bloodmallet parity); an ordinary update never pins.
  // At start, when the user has it on: install a newer official build or new game data by itself. A build from
  // source (20–40 minutes, and possibly a Windows prompt for build tools) is never started unasked; the check's
  // reason is kept so the engine panel can say what is waiting.
  async startup(){
    if(this.state.status==='running'||this.busy())return null;
    const check=await this.check();
    const action=check.decision.action;
    this.state.startup={checkedAt:check.checkedAt,action,reason:check.decision.reason,behind:check.local.behind??null};
    if(!['nightly','data'].includes(action))return null;
    this.log('Automatic update at start …');
    return this.start('auto');
  }

  start(mode='auto',sha=null){
    if(sha!==null&&!/^[0-9a-f]{7,40}$/i.test(String(sha)))throw new Error('A SimC commit is 7 to 40 hexadecimal characters.');
    if(this.state.status==='running')throw new Error('An update is already running.');
    if(this.busy())throw new Error('Wait for running simulations to finish before updating SimC.');
    if(mode==='nightly'&&!windows)throw new Error('Official SimC builds are Windows only. Use Build from source.');
    this.state={status:'running',mode,...(this.state.startup?{startup:this.state.startup}:{}),...(sha?{sha}:{}),log:[],started:new Date().toISOString()};
    this.run(mode,sha?.toLowerCase()||null).then(result=>Object.assign(this.state,{status:'complete',result,finished:new Date().toISOString()}),e=>{this.log(`Failed: ${e.message}`);Object.assign(this.state,{status:'failed',error:e.message,finished:new Date().toISOString()});});
    return this.state;
  }

  async run(mode,sha=null){
    this.log('Checking SimC, WoW and game data versions …');
    const check=await this.check();
    const local=await readEngineMetadata();
    const decision=sha?await this.pinned(sha,check,local):mode==='auto'?check.decision:plan({installedWow:check.installedWow,local:{...local,dataHash:null},head:check.head,nightly:check.nightly&&{...check.nightly,build:check.nightly},live:check.live,mode});
    this.log(decision.reason);
    if(decision.action==='wait')throw new Error(decision.reason);
    if(decision.action==='none')return {changed:false,reason:decision.reason};
    const live=check.live;if(!live)throw new Error('Game data could not be reached.');
    let installed=null;
    if(decision.engine){
      installed=decision.engine.kind==='nightly'?await this.installNightly(decision.engine):await this.buildFromSource(decision.engine);
      await this.verify(installed);
    }
    const staged=await this.downloadData(live,installed?.meta.wowVersion||local.wowVersion);
    // Engine and data switch together, so the app never pairs a new engine with old data.
    await swap(staged,upstreamDir);
    if(installed){await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(engineFile,JSON.stringify(installed.meta,null,2));await this.cleanup(installed.dir);}
    this.log('Loading the new engine and data …');
    await this.onInstalled();
    this.log(installed?`Installed SimulationCraft ${installed.meta.version} for WoW ${installed.meta.wowVersion} (${installed.meta.source}).`:`Installed game data for WoW ${live.wowBuild}.`);
    return {changed:true,engine:installed?.meta||null,data:live.contentHash};
  }

  // The engine for one pinned commit. The same commit is kept; the official nightly is used when it is that commit;
  // otherwise it is built from source. A commit for another WoW build than the one installed is refused.
  async pinned(sha,check,local){
    if(local.commit?.startsWith(sha))return {action:'none',engine:null,reason:`SimC ${local.commit.slice(0,10)} is already installed.`};
    const commit=await get(`https://api.github.com/repos/${repo}/commits/${sha}`,'json');
    const build=parseBuildInfo(await get(`https://raw.githubusercontent.com/${repo}/${commit.sha}/SpellDataDump/build_info.txt`));
    if(!build)throw new Error(`SimC commit ${sha} is not a live build.`);
    const target=check.installedWow||check.live?.wowBuild;
    if(target&&build.wowVersion!==target)throw new Error(`SimC commit ${commit.sha.slice(0,10)} is for WoW ${build.wowVersion}, not the installed ${target}.`);
    const engine=check.nightly?.sha===commit.sha?{kind:'nightly',...check.nightly,build:undefined}:{kind:'source',sha:commit.sha,date:commit.commit.committer.date,branch:local.branch||'midnight',pin:commit.sha,...build};
    return {action:engine.kind,engine,reason:`Installing SimC commit ${commit.sha.slice(0,10)} (${engine.kind==='nightly'?'official build':'built from source'}).`};
  }

  async download(url,file,label){
    const res=await fetch(url,{headers:{'User-Agent':'SimC-Lab'}});if(!res.ok)throw new Error(`${label} download failed (${res.status}).`);
    // Compressed responses report the compressed length, so progress is shown only for large uncompressed files.
    const total=res.headers.get('content-encoding')?0:Number(res.headers.get('content-length'))||0;let done=0,last=0;
    if(total<20*1048576)this.log(`Downloading ${label} …`);
    const counter=new Transform({transform:(chunk,_,cb)=>{done+=chunk.length;if(total>=20*1048576&&done-last>total/10){last=done;this.log(`${label}: ${Math.min(100,Math.round(100*done/total))}% of ${(total/1048576).toFixed(0)} MB`);}cb(null,chunk);}});
    await pipeline(Readable.fromWeb(res.body),counter,createWriteStream(file));
  }

  async installNightly(engine){
    const work=await fs.mkdtemp(path.join(os.tmpdir(),'simc-lab-'));
    try{
      const archive=path.join(work,engine.name);
      this.log(`Downloading ${engine.name} …`);await this.download(engine.url,archive,'SimC');
      this.log('Unpacking …');
      // Windows ships bsdtar, which reads 7z archives.
      await run(path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe'),['-xf',archive,'-C',work],{windowsHide:true,maxBuffer:1e8});
      const folder=(await fs.readdir(work,{withFileTypes:true})).find(e=>e.isDirectory());if(!folder)throw new Error('The SimC archive was empty.');
      const from=path.join(work,folder.name);
      const dir=path.join(enginesDir,`${engine.version}-${engine.sha.slice(0,7)}`);
      await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});
      await fs.copyFile(path.join(from,'simc.exe'),path.join(dir,'simc.exe'));
      await fs.cp(path.join(from,'profiles'),path.join(dir,'profiles'),{recursive:true});
      await this.fetchSource(engine.sha,dir);
      return {dir,meta:{...metaFor(engine,dir),source:'nightly',networking:true}};
    }finally{await fs.rm(work,{recursive:true,force:true}).catch(()=>{});}
  }

  async fetchSource(sha,dir){
    this.log('Downloading matching SimC game data from source …');
    for(const file of sourceFiles){
      const target=path.join(dir,file);await fs.mkdir(path.dirname(target),{recursive:true});
      await this.download(`https://raw.githubusercontent.com/${repo}/${sha}/${file}`,target,path.basename(file));
    }
  }

  async buildFromSource(engine){
    const tools=windows?await this.toolchain():await this.linuxToolchain();
    const src=path.join(home,'source','simc'),build=path.join(home,'source','build');
    if(await exists(path.join(src,'.git'))){
      this.log('Updating the SimC source …');
      await this.exec(tools.git,['-C',src,'fetch','--depth','1','origin',engine.pin||engine.branch]);
      await this.exec(tools.git,['-C',src,'checkout','--force','FETCH_HEAD']);
    }else if(engine.pin){
      // A pinned commit is fetched by its hash, which GitHub serves without cloning the branch.
      this.log(`Downloading SimC commit ${engine.pin.slice(0,10)} …`);await fs.mkdir(src,{recursive:true});
      await this.exec(tools.git,['-C',src,'init']);
      await this.exec(tools.git,['-C',src,'remote','add','origin',`https://github.com/${repo}.git`]);
      await this.exec(tools.git,['-C',src,'fetch','--depth','1','origin',engine.pin]);
      await this.exec(tools.git,['-C',src,'checkout','--force','FETCH_HEAD']);
    }else{
      this.log('Downloading the SimC source …');await fs.mkdir(path.dirname(src),{recursive:true});
      await this.exec(tools.git,['clone','--depth','1','--branch',engine.branch,`https://github.com/${repo}.git`,src]);
    }
    const sha=(await run(tools.git,['-C',src,'rev-parse','HEAD'],{windowsHide:true})).stdout.trim();
    const info=parseBuildInfo(await fs.readFile(path.join(src,'SpellDataDump/build_info.txt'),'utf8'));
    if(!info)throw new Error('The SimC source is not a live build.');
    this.log('Configuring the build …');
    // On Linux SimC is built with networking (libcurl), so the Armory import works as it does with a nightly.
    const networking=!windows&&tools.curl;
    await this.exec(tools.cmake,['-S',src,'-B',build,...(windows?['-A','x64']:['-DCMAKE_BUILD_TYPE=Release']),'-DBUILD_GUI=OFF','-DBUILD_TESTING=OFF',`-DSC_NO_NETWORKING=${networking?'OFF':'ON'}`]);
    this.log('Compiling SimC. The first build takes 20–40 minutes …');
    await this.exec(tools.cmake,['--build',build,'--config','Release','--parallel',String(buildJobs())]);
    const dir=path.join(enginesDir,`${info.version}-${sha.slice(0,7)}-source`);
    await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});
    await fs.copyFile(windows?path.join(build,'Release','simc.exe'):path.join(build,'simc'),path.join(dir,simcName));
    await fs.cp(path.join(src,'profiles'),path.join(dir,'profiles'),{recursive:true});
    for(const file of sourceFiles){await fs.mkdir(path.dirname(path.join(dir,file)),{recursive:true});await fs.copyFile(path.join(src,file),path.join(dir,file));}
    const date=(await run(tools.git,['-C',src,'show','-s','--format=%cI','HEAD'],{windowsHide:true})).stdout.trim();
    return {dir,meta:{...metaFor({...info,sha,date,branch:engine.branch},dir),source:'source',networking:!!networking}};
  }

  // Git, CMake and the Visual Studio C++ tools; missing ones are installed with winget (Windows asks for permission).
  async toolchain(){
    const find=async(name,paths)=>{for(const p of paths)if(await exists(p))return p;try{return (await run('where',[name],{windowsHide:true})).stdout.split(/\r?\n/)[0].trim()||null;}catch{return null;}};
    const pf=process.env.ProgramFiles||'C:\\Program Files',pf86=process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)';
    const vc=async()=>{try{return (await run(path.join(pf86,'Microsoft Visual Studio','Installer','vswhere.exe'),['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{windowsHide:true})).stdout.trim()||null;}catch{return null;}};
    const install=async(id,extra=[])=>{this.log(`Installing ${id} with winget. Approve the Windows prompt if one appears …`);await this.exec('winget',['install','--id',id,'-e','--silent','--accept-source-agreements','--accept-package-agreements',...extra]);};
    let git=await find('git',[path.join(pf,'Git','cmd','git.exe')]);if(!git){await install('Git.Git');git=await find('git',[path.join(pf,'Git','cmd','git.exe')]);}
    let cmake=await find('cmake',[path.join(pf,'CMake','bin','cmake.exe')]);if(!cmake){await install('Kitware.CMake');cmake=await find('cmake',[path.join(pf,'CMake','bin','cmake.exe')]);}
    if(!await vc())await install('Microsoft.VisualStudio.2022.BuildTools',['--override','--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended']);
    if(!git||!cmake||!await vc())throw new Error('The build tools could not be installed. Install Git, CMake and Visual Studio Build Tools (C++), then try again.');
    return {git,cmake};
  }

  // Linux: the tools come from the system's package manager, which needs root, so a missing one is named
  // rather than installed.
  async linuxToolchain(){
    const find=async name=>{try{return (await run('sh',['-c',`command -v ${name}`])).stdout.trim()||null;}catch{return null;}};
    const git=await find('git'),cmake=await find('cmake'),cxx=await find('c++')||await find('g++')||await find('clang++');
    const curl=(await Promise.all(['/usr/include/curl/curl.h','/usr/include/x86_64-linux-gnu/curl/curl.h','/usr/include/aarch64-linux-gnu/curl/curl.h'].map(exists))).some(Boolean);
    const missing=[!git&&'git',!cmake&&'cmake',!cxx&&'build-essential'].filter(Boolean);
    if(missing.length)throw new Error(`Building SimC needs ${missing.join(', ')}. On Ubuntu or Debian: sudo apt install git cmake build-essential libcurl4-openssl-dev`);
    if(!curl)this.log('libcurl4-openssl-dev is not installed, so SimC is built without networking and the Armory import will not work.');
    // SimC switches to en_US.UTF-8 for its HTML reports, which the Armory import reads too.
    const locales=await run('locale',['-a']).then(r=>r.stdout,()=>'');
    if(!/^en_US\.utf-?8$/im.test(locales))this.log('The en_US.UTF-8 locale is missing, so SimC cannot write HTML reports and the Armory import will fail. Fix: sudo locale-gen en_US.UTF-8');
    return {git,cmake,curl};
  }

  exec(command,args){return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,shell:false});let tail='';
    const capture=data=>{tail=(tail+data.toString()).slice(-6000);const line=data.toString().trim().split(/\r?\n/).pop();if(line)this.state.detail=line.slice(0,300);};
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`${path.basename(command)} failed (${code}). ${tail.slice(-1200)}`)));
  });}

  async verify(installed){
    this.log('Checking the new engine …');
    let output='';try{output=(await run(path.join(installed.dir,simcName),[],{windowsHide:true,timeout:120000,maxBuffer:1e7})).stdout;}catch(e){output=`${e.stdout||''}${e.stderr||''}`;}
    const info=parseBuildInfo(output);
    if(!info||info.version!==installed.meta.version||info.wowVersion!==installed.meta.wowVersion)throw new Error('The new SimC engine did not report the expected version.');
  }

  async downloadData(live,wowVersion){
    if(live.wowBuild!==wowVersion)throw new Error(`Game data is for WoW ${live.wowBuild}, SimC is for ${wowVersion}.`);
    this.log(`Downloading game data for WoW ${live.wowBuild} …`);
    const staged=upstreamDir+'.new';await fs.rm(staged,{recursive:true,force:true});await fs.mkdir(staged,{recursive:true});
    const hashes={};
    for(const name of dataFiles){
      const text=await get(`${raidbots}/${live.contentHash}/${name}.json`);JSON.parse(text);
      hashes[name]=createHash('sha256').update(text).digest('hex');await fs.writeFile(path.join(staged,name+'.json'),text);
    }
    await fs.writeFile(path.join(staged,'metadata.json'),JSON.stringify({...live,downloadedAt:new Date().toISOString(),hashes},null,2));
    return staged;
  }

  // Keep the new engine and the original source checkout; older downloaded engines are removed.
  async cleanup(keep){
    for(const entry of await fs.readdir(enginesDir,{withFileTypes:true}).catch(()=>[]))
      if(entry.isDirectory()&&path.join(enginesDir,entry.name)!==keep)await fs.rm(path.join(enginesDir,entry.name),{recursive:true,force:true}).catch(()=>{});
  }
}

function metaFor(engine,dir){
  return {version:engine.version,wowVersion:engine.wowVersion,hotfix:engine.hotfix,commit:engine.sha,commitDate:engine.date,branch:engine.branch||'midnight',builtAt:new Date().toISOString(),dir:path.relative(home,dir),repository:`https://github.com/${repo}`};
}
const exists=p=>fs.access(p).then(()=>true,()=>false);
// SimC's compiler jobs take about 1.5 GB each, so a small machine is kept from running out of memory.
function buildJobs(){
  const set=Number(process.env.SIMC_LAB_BUILD_JOBS);if(Number.isInteger(set)&&set>0)return set;
  return Math.max(1,Math.min(os.availableParallelism()-(windows?2:0),Math.floor(os.totalmem()/(1.5*1024**3))));
}
async function swap(staged,target){
  const old=target+'.old';await fs.rm(old,{recursive:true,force:true});
  if(await exists(target))await fs.rename(target,old);
  await fs.rename(staged,target);await fs.rm(old,{recursive:true,force:true});
}
