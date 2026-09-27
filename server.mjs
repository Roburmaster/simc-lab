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
import {upgradeReportPage} from './lib/upgradepage.mjs';
import {healerWeights,contents as healerContents} from './lib/healers.mjs';
import {root,runsDir,engineStatus,prepare,Jobs,loadEnginePaths,jobFraction} from './lib/engine.mjs';
import * as engine from './lib/engine.mjs';
import {upstreamDir,currentProfileDir} from './lib/paths.mjs';
import {Updater} from './lib/updater.mjs';
import {WowAddon} from './lib/wowaddon.mjs';
import {identity,simEntry,trackTable,sendableModes} from './lib/wowdata.mjs';
import {importArmory,isArmoryProfile} from './lib/armory.mjs';
import {Accounts,cookie,discordSettings} from './lib/accounts.mjs';
const port=Number(process.env.PORT || 8642);
const pkg=JSON.parse(await fs.readFile(new URL('./package.json',import.meta.url),'utf8'));
// Server mode (SIMC_LAB_SERVER=1) shares one SimC Lab between the members of a Discord server, who sign in with
// Discord. It usually sits behind a reverse proxy that adds HTTPS. SIMC_LAB_PUBLIC_URL is the address people open; HOST is the interface to listen on.
const serverMode=!!process.env.SIMC_LAB_SERVER;
const publicUrl=process.env.SIMC_LAB_PUBLIC_URL?new URL(process.env.SIMC_LAB_PUBLIC_URL):null;
const listenHost=process.env.HOST||'127.0.0.1';
const hosts=[`127.0.0.1:${port}`,`localhost:${port}`,...(publicUrl?[publicUrl.host]:[])];
const origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`,...(publicUrl?[publicUrl.origin]:[])];
const sessionCookie='simclab_session',stateCookie='simclab_discord',pendingCookie='simclab_signup';
const trustProxy=!!process.env.SIMC_LAB_TRUST_PROXY;
const address=req=>trustProxy&&req.headers['x-forwarded-for']?String(req.headers['x-forwarded-for']).split(',').pop().trim():req.socket.remoteAddress||'';
const secureCookie=publicUrl?.protocol==='https:';
const appInfo={name:'SimC Lab',version:pkg.version,desktop:!!process.env.SIMC_LAB_DESKTOP,server:serverMode,platform:process.platform};const token=randomBytes(32).toString('hex');
const accounts=serverMode?await new Accounts(discordSettings(process.env,publicUrl)).init():null;
const limit=(name,fallback)=>{const n=Number(process.env[name]);return Number.isInteger(n)&&n>0?n:fallback;};
const queueLimits={total:limit('SIMC_LAB_QUEUE',20),perUser:limit('SIMC_LAB_QUEUE_PER_USER',2)};
if(serverMode)appInfo.queue=queueLimits;
// Game data is (re)loaded at start and after every engine update. Without an engine the app still starts,
// so a first run can install SimC from the interface.
let catalog=null,talentData=null,season=null,loadError=null;
async function loadData(){
  const {source}=await loadEnginePaths();clearReferenceCache();
  try{const c=await loadCatalog(source);const t=await loadTalentData(upstreamDir,source);const s=await loadSeason(upstreamDir,c,source);catalog=c;talentData=t;season=s;loadError=null;jobs.catalog=c;}
  catch(e){catalog=talentData=season=null;loadError=e.code==='ENOENT'?'SimC is not installed yet.':e.message;}
}
const jobs=serverMode?new Jobs(null,{limit:queueLimits.total,perOwner:queueLimits.perUser}):new Jobs(null);await jobs.init();await loadData();
const busy=()=>[...jobs.jobs.values()].some(j=>['queued','running'].includes(j.status));
const updater=new Updater({busy,onInstalled:loadData});
// The WoW addon: installed from the copy inside the app, fed through Data.lua, and kept in step on every start.
const wow=new WowAddon({installDir:engine.wowInstallDir,context:async()=>({tracks:trackTable(season),app:pkg.version})});
async function sendToWow(job,options){
  ready();if(!season)throw new Error('Season data is not loaded.');
  const request=JSON.parse(await fs.readFile(path.join(runsDir,job.id,'request.json'),'utf8'));
  if(isArmoryProfile(request.profile))throw new Error('Characters imported from the Armory are not sent to the WoW addon. Use /simc in game for that.');
  return wow.send(identity(request.profile,talentData),simEntry(job,request,{season,tracks:trackTable(season)}),options);
}
jobs.onFinished=async job=>{
  if(serverMode)return;
  if(!sendableModes[job.mode]||job.armory||!['complete','partial'].includes(job.status))return;
  const {settings}=await wow.loadStore();if(!settings.autoSend)return;
  try{await sendToWow(job,{auto:true});}catch(e){wow.last={id:job.id,auto:true,time:new Date().toISOString(),error:e.message};}
};
if(!serverMode)wow.autoUpdate().catch(e=>console.error('SimCLab addon update failed:',e.message));
const ready=()=>{if(!catalog)throw new Error(loadError||'SimC is not installed yet. Use Update SimC.');};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const armoryBusy=new Set();
// Lax, not Strict: the browser arrives from discord.com, and a Strict cookie would be missing on that first page.
// POSTs still need the per-session token and a matching Origin.
const setCookie=(name,value,maxAge)=>`${name}=${value?encodeURIComponent(value):''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value?maxAge:0}${secureCookie?'; Secure':''}`;
function setSession(res,key){res.setHeader('Set-Cookie',[setCookie(sessionCookie,key,7*86400),setCookie(stateCookie,null),setCookie(pendingCookie,null)]);}
const toLogin=(res,error)=>{res.writeHead(302,{Location:error?`/login?error=${encodeURIComponent(error)}`:'/'});res.end();};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>600000)throw new Error('The request is too large.');}return JSON.parse(text);}
const server=http.createServer(async(req,res)=>{
  try{
    if(!hosts.includes(req.headers.host))return json(res,403,{error:'Invalid host.'});
    const url=new URL(req.url,`http://127.0.0.1:${port}`);const route=url.pathname;
    let viewer=null,csrf=token;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(!route.startsWith('/reports/'))res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' https://wow.zamimg.com https://www.wowhead.com https://nether.wowhead.com; style-src 'self' 'unsafe-inline' https://wow.zamimg.com; img-src 'self' data: https://wow.zamimg.com https://*.wowhead.com${serverMode?' https://cdn.discordapp.com':''}; frame-ancestors 'none'; connect-src 'self' https://www.wowhead.com https://nether.wowhead.com https://wow.zamimg.com`);
    if(req.method==='POST'&&req.headers.origin&&!origins.includes(req.headers.origin))return json(res,403,{error:'Invalid origin.'});
    if(serverMode){
      // Signing in with Discord comes before a session exists; everything else under /api needs one.
      if(req.method==='GET'&&route==='/auth/discord'){const {state,url:to}=accounts.begin();res.writeHead(302,{Location:to,'Set-Cookie':setCookie(stateCookie,state,600)});return res.end();}
      if(req.method==='GET'&&route==='/auth/discord/callback'){
        if(url.searchParams.get('error'))return toLogin(res,url.searchParams.get('error')==='access_denied'?'Sign-in was cancelled on Discord.':'Discord could not sign you in. Try again.');
        try{
          const result=await accounts.finish({code:url.searchParams.get('code'),state:url.searchParams.get('state'),cookieState:cookie(req,stateCookie)});
          // Someone new: the invite key comes next, on the sign-in page.
          if(result.pending){res.writeHead(302,{Location:'/login?invite=1','Set-Cookie':[setCookie(stateCookie,null),setCookie(pendingCookie,result.pending,900)]});return res.end();}
          setSession(res,result.key);return toLogin(res,null);
        }
        catch(e){res.setHeader('Set-Cookie',setCookie(stateCookie,null));return toLogin(res,e.message);}
      }
      if(req.method==='GET'&&route==='/api/auth/pending')return json(res,200,{name:accounts.pendingName(cookie(req,pendingCookie))});
      if(req.method==='POST'&&route==='/api/auth/invite'){
        if(!req.headers.origin)return json(res,403,{error:'Invalid origin.'});
        const {key:inviteKey}=await body(req);const {key}=await accounts.redeem({pending:cookie(req,pendingCookie),key:inviteKey},address(req));
        setSession(res,key);return json(res,200,{});
      }
      const session=accounts.session(cookie(req,sessionCookie));
      if(session){viewer=session.user;csrf=session.csrf;}
      else if(route==='/'){res.writeHead(302,{Location:'/login'});return res.end();}
      else if(route.startsWith('/api/')||/^\/(reports|tier-list|upgrade-report)\//.test(route))return json(res,401,{error:'Sign in to continue.',login:true});
    }
    if(req.method==='POST'){
      const received=Buffer.from(req.headers['x-simc-token'] || '');const expected=Buffer.from(csrf);
      if(received.length!==expected.length || !timingSafeEqual(received,expected))return json(res,403,{error:'Reload the page.'});
    }
    const me=viewer&&accounts.publicUser(viewer);
    const admin=()=>{if(serverMode&&!viewer?.admin)throw Object.assign(new Error('Only an admin can do that.'),{status:403});};
    if(serverMode){
      if(req.method==='POST'&&route==='/api/auth/logout'){await accounts.logout(cookie(req,sessionCookie));setSession(res,null);return json(res,200,{});}
      if(req.method==='GET'&&route==='/api/admin/users'){admin();return json(res,200,{users:accounts.list(),blocked:accounts.blockedCount()});}
      if(req.method==='GET'&&route==='/api/admin/keys'){admin();return json(res,200,{keys:accounts.keys()});}
      if(req.method==='POST'&&route==='/api/admin/keys'){admin();const {key,label}=await body(req);return json(res,200,{keys:await accounts.addKey(key,label)});}
      if(req.method==='POST'&&route==='/api/admin/keys/remove'){admin();const {id}=await body(req);return json(res,200,{keys:await accounts.removeKey(String(id))});}
      if(req.method==='POST'&&route==='/api/admin/unblock'){admin();await accounts.unblockAll();return json(res,200,{users:accounts.list(),blocked:0});}
      if(req.method==='POST'&&route==='/api/admin/remove'){admin();const {id}=await body(req);return json(res,200,{users:await accounts.remove(String(id),viewer)});}
      if(req.method==='POST'&&route==='/api/admin/role'){admin();const {id,admin:asAdmin}=await body(req);return json(res,200,{users:await accounts.setAdmin(String(id),!!asAdmin,viewer)});}
      // The game is on each player's own PC, so the WoW addon bridge does not exist on a server.
      if(route.startsWith('/api/wow'))return json(res,404,{error:'The WoW addon works with the desktop app only.'});
      if(route.startsWith('/api/engine/')&&req.method==='POST')admin();
    }
    if(req.method==='GET'&&route==='/api/status')return json(res,200,{engine:await engineStatus(),expansion:catalog?.expansion||null,loadError,token:csrf,app:appInfo,user:me});
    if(req.method==='GET'&&route==='/api/engine/update')return json(res,200,updater.state);
    if(req.method==='POST'&&route==='/api/engine/check')return json(res,200,await updater.check());
    if(req.method==='POST'&&route==='/api/engine/update'){const {mode='auto'}=await body(req);if(!['auto','nightly','source','data'].includes(mode))throw new Error('Unknown update mode.');return json(res,202,updater.start(mode));}
    if(req.method==='GET'&&route==='/api/wow')return json(res,200,await wow.status());
    if(req.method==='POST'&&route==='/api/wow/install')return json(res,200,await wow.install());
    if(req.method==='POST'&&route==='/api/wow/uninstall')return json(res,200,await wow.uninstall());
    if(req.method==='POST'&&route==='/api/wow/addon-check'){await wow.checkOnline({force:true});return json(res,200,await wow.status());}
    if(req.method==='POST'&&route==='/api/wow/addon-update'){const online=await wow.checkOnline({force:true});if(!online.manifest)throw new Error(online.error||'No addon release was found.');return json(res,200,await wow.installOnline(online.manifest));}
    if(req.method==='POST'&&route==='/api/wow/settings')return json(res,200,await wow.settings(await body(req)));
    if(req.method==='POST'&&route==='/api/wow/remove'){const {id}=await body(req);return json(res,200,await wow.remove(String(id)));}
    if(req.method==='GET'&&route==='/api/wow/captures')return json(res,200,await wow.captures());
    if(req.method==='POST'&&route==='/api/wow/send'){const {job:id}=await body(req);const job=jobs.jobs.get(String(id));if(!job)return json(res,404,{error:'Job not found.'});return json(res,200,await sendToWow(job,{auto:false}));}
    if(route!=='/api/jobs'&&route.startsWith('/api/')&&!route.startsWith('/api/jobs/')&&route!=='/api/status')ready();
    if(req.method==='GET'&&route==='/api/options')return json(res,200,{buffs,consumables:catalog.consumables,expansion:catalog.expansion,tankPresets});
    if(req.method==='GET'&&route==='/api/upgrade-sources')return json(res,200,publicSources(season));
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
    if(req.method==='POST'&&route==='/api/armory'){if(updater.state.status==='running')throw new Error('Wait for the SimC update to finish.');const {region,realm,name,url:link}=await body(req);
      // One Armory lookup per account at a time: each one starts SimC.
      const who=viewer?.id||'';if(armoryBusy.has(who))throw new Error('An Armory import is already running.');armoryBusy.add(who);
      try{return json(res,200,await importArmory({region,realm,name,url:link},{executable:engine.executable}));}finally{armoryBusy.delete(who);}}
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
    if(req.method==='POST'&&route==='/api/preview'){
      const plan=await prepare(await body(req),catalog,talentData,season);const upgrade=plan.upgrade&&{candidates:plan.upgrade.candidates.length,slots:new Set(plan.upgrade.candidates.map(c=>c.slot)).size,finalists:plan.upgrade.finalists,embellished:plan.upgrade.candidates.filter(c=>c.embellishment).length,blocked:plan.upgrade.blocked,limitsUsed:plan.upgrade.limitsUsed,steps:upgradeSteps(plan.upgrade,plan.scenarios.length)};
      const crests=plan.crests&&{affordable:plan.crests.affordable,candidates:plan.crests.candidates.length,items:plan.crests.items,budget:plan.crests.budget,state:plan.crests.state};
      const weapons=plan.weapons&&{specs:plan.weapons.specs.length,candidates:plan.weapons.candidates,skipped:plan.weapons.skipped,tanks:plan.weapons.specs.filter(s=>s.tank).length,healers:plan.weapons.specs.filter(s=>s.healer).length,craftedStats:plan.weapons.craftedStats.length,sources:plan.weapons.sources,levels:plan.weapons.levels,steps:weaponSteps(plan.weapons,plan.scenarios.length)};
      return json(res,200,{variants:plan.variants.map(v=>({name:v.name,baseline:!!v.baseline})),total:weapons?weapons.steps:crests?plan.scenarios.length:upgrade?upgrade.steps:plan.variants.length*plan.scenarios.length,warnings:plan.profile.warnings,search:plan.search,upgrade,crests,weapons});
    }
    if(req.method==='POST'&&route==='/api/jobs'){ready();if(updater.state.status==='running')throw new Error('Wait for the SimC update to finish.');const request=await body(req);const plan=await prepare(request,catalog,talentData,season);return json(res,201,jobs.public(await jobs.add(plan,request,viewer?.id||null)));}
    // Who is waiting is shown by display name, so members can see whose turn it is; their characters stay private.
    if(req.method==='GET'&&route==='/api/jobs/active')return json(res,200,jobs.activeJobs(me).map(({owner,...j})=>({...j,by:serverMode?(accounts.user(owner)?.name||'Removed member'):null})));
    if(req.method==='GET'&&route==='/api/jobs')return json(res,200,[...jobs.jobs.values()].reverse().filter(j=>jobs.visible(j,me)).map(j=>({id:j.id,name:j.name,mode:j.mode,status:j.status,created:j.created,done:j.done,total:j.total,fraction:jobFraction(j)})));
    const jobRoute=route.match(/^\/api\/jobs\/([\da-f-]{36})(\/cancel)?$/);
    if(jobRoute){const job=jobs.jobs.get(jobRoute[1]);if(!job||!jobs.visible(job,me))return json(res,404,{error:'Job not found.'});if(req.method==='POST'&&jobRoute[2])return json(res,200,await jobs.cancel(job.id));if(req.method==='GET'&&!jobRoute[2])return json(res,200,{...jobs.public(job),queue:jobs.queueFor(job,me),fraction:jobFraction(job)});}
    // The tier list is written here rather than by SimC, and carries no script, so it can be read in place.
    const tierList=route.match(/^\/tier-list\/([\da-f-]{36})\.html$/);
    if(req.method==='GET'&&tierList){
      const job=jobs.jobs.get(tierList[1]);
      if(!job?.weapons||!jobs.visible(job,me))return json(res,404,{error:'No Weapon Lab job with that id.'});
      const html=tierListPage(jobs.public(job));
      const filename=`weapon-tier-list-${new Date(job.finished||job.created).toISOString().slice(0,10)}.html`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="${filename}"`}:{})});
      return res.end(html);
    }
    // The Upgrade Finder's report page, built like the tier list: from the finished job, with no script of its own.
    const upgradeReport=route.match(/^\/upgrade-report\/([\da-f-]{36})\.html$/);
    if(req.method==='GET'&&upgradeReport){
      const job=jobs.jobs.get(upgradeReport[1]);
      if(!job?.upgrade||!jobs.visible(job,me))return json(res,404,{error:'No Upgrade Finder job with that id.'});
      const request=JSON.parse(await fs.readFile(path.join(runsDir,job.id,'request.json'),'utf8'));
      let info={},equipped={};try{const p=parseProfile(request.profile);info=p.info;for(const [slot,g] of Object.entries(p.gear))if(g.id)equipped[slot]={id:g.id,value:g.value,name:catalog?.items.get(g.id)?.name};}catch{}
      const html=upgradeReportPage(jobs.public(job),{info,equipped,armory:isArmoryProfile(request.profile)});
      const filename=`upgrade-report-${String(info.name||job.name).normalize('NFKD').replace(/[^A-Za-z0-9-]+/g,'_')}-${new Date(job.finished||job.created).toISOString().slice(0,10)}.html`;
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8',...(url.searchParams.has('download')?{'Content-Disposition':`attachment; filename="${filename}"`}:{})});
      return res.end(html);
    }
    const report=route.match(/^\/reports\/([\da-f-]{36})\/(\d{3}\.(?:html|json|simc)|request\.json)$/);
    if(req.method==='GET'&&report){
      const owner=jobs.jobs.get(report[1]);if(!owner||!jobs.visible(owner,me))return json(res,404,{error:'Not found.'});
      const data=await fs.readFile(path.join(runsDir,report[1],report[2]));
      const ext=path.extname(report[2]);
      // Reports are generated by SimC. Serve downloads so their scripts never share this app's origin.
      res.writeHead(200,{'Content-Type':ext==='.json'?'application/json':'application/octet-stream','Content-Disposition':`attachment; filename="${report[2]}"`});return res.end(data);
    }
    const assets={'/':'index.html','/app.js':'app.js','/items.js':'items.js','/wowhead.js':'wowhead.js','/features.js':'features.js','/upgrades.js':'upgrades.js','/crests.js':'crests.js','/crestplan.js':'crestplan.js','/weapons.js':'weapons.js','/tank.js':'tank.js','/engine.js':'engine.js','/activity.js':'activity.js','/environment.js':'environment.js','/wow.js':'wow.js','/armory.js':'armory.js','/style.css':'style.css','/account.js':'account.js','/queue.js':'queue.js',...(serverMode?{'/login':'login.html','/login.js':'login.js'}:{})};
    if(req.method==='GET'&&assets[route]){const file=assets[route];res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});return res.end(await fs.readFile(path.join(root,'public',file)));}
    json(res,404,{error:'Not found.'});
  }catch(e){json(res,e.status||(e.code==='ENOENT'?404:400),{error:e.message});}
});
server.listen(port,listenHost,async()=>{
  console.log(`SimC Lab${serverMode?' server':''}: http://${listenHost}:${port}${publicUrl?` (public address ${publicUrl.origin})`:''}`);
  if(serverMode)console.log(`Sign in with Discord at ${publicUrl.origin}/login`);
});
// SIMC_LAB_AUTO_UPDATE keeps an unattended server on the live WoW build: a minute after start and then every six
// hours, SimC and game data are updated when something new is out and no simulation is waiting.
if(process.env.SIMC_LAB_AUTO_UPDATE){
  const tick=async()=>{
    if(busy()||updater.state.status==='running')return;
    try{const {decision}=await updater.check();if(['nightly','source','data'].includes(decision.action)){console.log(`Automatic SimC update: ${decision.reason}`);updater.start('auto');}}
    catch(e){console.error('Automatic SimC update check failed:',e.message);}
  };
  setTimeout(tick,60000).unref();setInterval(tick,6*3600000).unref();
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{jobs.child?.kill();server.close();process.exit(0);});
