import {slotTypes,fitsSlot,expandWeaponAlternatives} from './lib/equipment.mjs';
import {buffs} from './lib/environment.mjs';
import {loadTalentData,decodeTalents,validateBuild,pointTotals} from './lib/talents.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {parseProfile} from './lib/profile.mjs';
import {loadCatalog} from './lib/catalog.mjs';
import {loadSeason,publicSources} from './lib/upgrades.mjs';
import {presets as tankPresets,isTank} from './lib/tank.mjs';
import {root,runsDir,engineStatus,prepare,Jobs,loadEnginePaths,jobFraction} from './lib/engine.mjs';
import * as engine from './lib/engine.mjs';
import {upstreamDir,currentProfileDir} from './lib/paths.mjs';
import {Updater} from './lib/updater.mjs';
import {WowAddon} from './lib/wowaddon.mjs';
import {identity,simEntry,trackTable,sendableModes} from './lib/wowdata.mjs';
const port=Number(process.env.PORT || 8642);
const pkg=JSON.parse(await fs.readFile(new URL('./package.json',import.meta.url),'utf8'));
const appInfo={name:'SimC Lab',version:pkg.version,desktop:!!process.env.SIMC_LAB_DESKTOP};const token=randomBytes(32).toString('hex');
// Game data is (re)loaded at start and after every engine update. Without an engine the app still starts,
// so a first run can install SimC from the interface.
let catalog=null,talentData=null,season=null,loadError=null;
async function loadData(){
  const {source}=await loadEnginePaths();
  try{const c=await loadCatalog(source);const t=await loadTalentData(upstreamDir,source);const s=await loadSeason(upstreamDir,c,source);catalog=c;talentData=t;season=s;loadError=null;jobs.catalog=c;}
  catch(e){catalog=talentData=season=null;loadError=e.code==='ENOENT'?'SimC is not installed yet.':e.message;}
}
const jobs=new Jobs(null);await jobs.init();await loadData();
const busy=()=>[...jobs.jobs.values()].some(j=>['queued','running'].includes(j.status));
const updater=new Updater({busy,onInstalled:loadData});
// The WoW addon: installed from the copy inside the app, fed through Data.lua, and kept in step on every start.
const wow=new WowAddon({installDir:engine.wowInstallDir,context:async()=>({tracks:trackTable(season),app:pkg.version})});
async function sendToWow(job,options){
  ready();if(!season)throw new Error('Season data is not loaded.');
  const request=JSON.parse(await fs.readFile(path.join(runsDir,job.id,'request.json'),'utf8'));
  return wow.send(identity(request.profile,talentData),simEntry(job,request,{season,tracks:trackTable(season)}),options);
}
jobs.onFinished=async job=>{
  if(!sendableModes[job.mode]||!['complete','partial'].includes(job.status))return;
  const {settings}=await wow.loadStore();if(!settings.autoSend)return;
  try{await sendToWow(job,{auto:true});}catch(e){wow.last={id:job.id,auto:true,time:new Date().toISOString(),error:e.message};}
};
wow.autoUpdate().catch(e=>console.error('SimCLab addon update failed:',e.message));
const ready=()=>{if(!catalog)throw new Error(loadError||'SimC is not installed yet. Use Update SimC.');};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>600000)throw new Error('The request is too large.');}return JSON.parse(text);}
const server=http.createServer(async(req,res)=>{
  try{
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host))return json(res,403,{error:'Invalid host.'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);const route=url.pathname;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(!route.startsWith('/reports/'))res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://wow.zamimg.com https://www.wowhead.com https://nether.wowhead.com; style-src 'self' 'unsafe-inline' https://wow.zamimg.com; img-src 'self' data: https://wow.zamimg.com https://*.wowhead.com; frame-ancestors 'none'; connect-src 'self' https://www.wowhead.com https://nether.wowhead.com https://wow.zamimg.com");
    if(req.method==='POST'){
      const received=Buffer.from(req.headers['x-simc-token'] || '');const expected=Buffer.from(token);
      if(received.length!==expected.length || !timingSafeEqual(received,expected))return json(res,403,{error:'Reload the page.'});
      if(req.headers.origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin))return json(res,403,{error:'Invalid origin.'});
    }
    if(req.method==='GET'&&route==='/api/status')return json(res,200,{engine:await engineStatus(),expansion:catalog?.expansion||null,loadError,token,app:appInfo});
    if(req.method==='GET'&&route==='/api/engine/update')return json(res,200,updater.state);
    if(req.method==='POST'&&route==='/api/engine/check')return json(res,200,await updater.check());
    if(req.method==='POST'&&route==='/api/engine/update'){const {mode='auto'}=await body(req);if(!['auto','nightly','source','data'].includes(mode))throw new Error('Unknown update mode.');return json(res,202,updater.start(mode));}
    if(req.method==='GET'&&route==='/api/wow')return json(res,200,await wow.status());
    if(req.method==='POST'&&route==='/api/wow/install')return json(res,200,await wow.install());
    if(req.method==='POST'&&route==='/api/wow/settings')return json(res,200,await wow.settings(await body(req)));
    if(req.method==='POST'&&route==='/api/wow/remove'){const {id}=await body(req);return json(res,200,await wow.remove(String(id)));}
    if(req.method==='GET'&&route==='/api/wow/captures')return json(res,200,await wow.captures());
    if(req.method==='POST'&&route==='/api/wow/send'){const {job:id}=await body(req);const job=jobs.jobs.get(String(id));if(!job)return json(res,404,{error:'Job not found.'});return json(res,200,await sendToWow(job,{auto:false}));}
    if(route!=='/api/jobs'&&route.startsWith('/api/')&&!route.startsWith('/api/jobs/')&&route!=='/api/status')ready();
    if(req.method==='GET'&&route==='/api/options')return json(res,200,{buffs,consumables:catalog.consumables,expansion:catalog.expansion,tankPresets});
    if(req.method==='GET'&&route==='/api/upgrade-sources')return json(res,200,publicSources(season));
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
    if(req.method==='POST'&&route==='/api/import'){
      const p=parseProfile((await body(req)).profile);
      for(const item of Object.values(p.gear)){item.item=catalog.items.get(item.id)||null;item.enchants=catalog.forItem(item.id,p.info.class);}
      p.expansion=catalog.expansion;p.isTank=isTank(p.info);
      p.alternatives=p.alternatives.filter(v=>{try{catalog.validateChanges(p,parseProfile(v.text,{override:true}));return true;}catch{return false;}});
      p.alternatives=expandWeaponAlternatives(p,catalog);
      p.gems=catalog.gems;
      try{const tree=talentData.find(p.info);const build=decodeTalents(p.info.talents,tree);p.talents={specId:tree.specId,name:tree.specName,className:tree.className,points:pointTotals(build,tree),errors:validateBuild(build,tree,{budgets:{class:34,spec:34,hero:13},entries:talentData.entries}),nodes:[...tree.classNodes,...tree.specNodes,...tree.heroNodes].filter(n=>build.selected[n.id]).map(n=>({id:n.id,name:n.name,rank:build.selected[n.id].rank,tree:tree.classNodes.includes(n)?'class':tree.specNodes.includes(n)?'spec':'hero'}))};}catch(e){p.talents={errors:[e.message]};}
      return json(res,200,p);
    }
    if(req.method==='POST'&&route==='/api/preview'){
      const plan=await prepare(await body(req),catalog,talentData,season);const upgrade=plan.upgrade&&{candidates:plan.upgrade.candidates.length,slots:new Set(plan.upgrade.candidates.map(c=>c.slot)).size,finalists:plan.upgrade.finalists};return json(res,200,{variants:plan.variants.map(v=>({name:v.name,baseline:!!v.baseline})),total:upgrade?2*plan.scenarios.length:plan.variants.length*plan.scenarios.length,warnings:plan.profile.warnings,search:plan.search,upgrade});
    }
    if(req.method==='POST'&&route==='/api/jobs'){ready();if(updater.state.status==='running')throw new Error('Wait for the SimC update to finish.');const request=await body(req);const plan=await prepare(request,catalog,talentData,season);return json(res,201,jobs.public(await jobs.add(plan,request)));}
    if(req.method==='GET'&&route==='/api/jobs/active')return json(res,200,jobs.activeJobs());
    if(req.method==='GET'&&route==='/api/jobs')return json(res,200,[...jobs.jobs.values()].reverse().map(j=>({id:j.id,name:j.name,mode:j.mode,status:j.status,created:j.created,done:j.done,total:j.total,fraction:jobFraction(j)})));
    const jobRoute=route.match(/^\/api\/jobs\/([\da-f-]{36})(\/cancel)?$/);
    if(jobRoute){const job=jobs.jobs.get(jobRoute[1]);if(!job)return json(res,404,{error:'Job not found.'});if(req.method==='POST'&&jobRoute[2])return json(res,200,await jobs.cancel(job.id));if(req.method==='GET'&&!jobRoute[2])return json(res,200,{...jobs.public(job),queue:jobs.queueFor(job),fraction:jobFraction(job)});}
    const report=route.match(/^\/reports\/([\da-f-]{36})\/(\d{3}\.(?:html|json|simc)|request\.json)$/);
    if(req.method==='GET'&&report){
      const data=await fs.readFile(path.join(runsDir,report[1],report[2]));
      const ext=path.extname(report[2]);
      // Reports are generated by SimC. Serve downloads so their scripts never share this app's origin.
      res.writeHead(200,{'Content-Type':ext==='.json'?'application/json':'application/octet-stream','Content-Disposition':`attachment; filename="${report[2]}"`});return res.end(data);
    }
    const assets={'/':'index.html','/app.js':'app.js','/items.js':'items.js','/wowhead.js':'wowhead.js','/features.js':'features.js','/upgrades.js':'upgrades.js','/tank.js':'tank.js','/engine.js':'engine.js','/activity.js':'activity.js','/environment.js':'environment.js','/wow.js':'wow.js','/style.css':'style.css'};
    if(req.method==='GET'&&assets[route]){const file=assets[route];res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});return res.end(await fs.readFile(path.join(root,'public',file)));}
    json(res,404,{error:'Not found.'});
  }catch(e){json(res,e.code==='ENOENT'?404:400,{error:e.message});}
});
server.listen(port,'127.0.0.1',()=>console.log(`SimC Lab: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{jobs.child?.kill();server.close();process.exit(0);});
