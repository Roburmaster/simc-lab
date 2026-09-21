// The SimCLab WoW addon: finding the game's folders, installing the copy shipped with the app, writing Data.lua
// and reading what the addon saved. Files are the only channel between the app and the game.
// Writes go only into Interface\AddOns\SimCLab, never through a link, and always as temp file + rename.
import fs from 'node:fs/promises';
import path from 'node:path';
import {appRoot,home} from './paths.mjs';
import {parseLua} from './lua.mjs';
import {dataFile,addSim,removeSim,limits} from './wowdata.mjs';

export const addonName='SimCLab';
export const shippedDir=path.join(appRoot,'addon',addonName);
const storeFile=path.join(home,'wow','store.json');
const exists=file=>fs.access(file).then(()=>true,()=>false);

export async function readToc(dir){
  try{
    const text=await fs.readFile(path.join(dir,`${addonName}.toc`),'utf8');
    const field=name=>text.match(new RegExp(`^##\\s*${name}:\\s*(.+?)\\s*$`,'mi'))?.[1]||null;
    return {version:field('Version'),interface:field('Interface'),files:text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'))};
  }catch{return null;}
}

export function compareVersions(a,b){
  const pa=String(a||'0').split(/[.-]/).map(n=>Number.parseInt(n,10)||0),pb=String(b||'0').split(/[.-]/).map(n=>Number.parseInt(n,10)||0);
  for(let i=0;i<Math.max(pa.length,pb.length);i++){const d=(pa[i]||0)-(pb[i]||0);if(d)return Math.sign(d);}
  return 0;
}

// SIMC_LAB_WOW_DIR points at a _retail_ folder (tests, unusual installs); otherwise the install folder found
// for the live build is used.
export async function locate(installDir){
  let retail=process.env.SIMC_LAB_WOW_DIR?path.resolve(process.env.SIMC_LAB_WOW_DIR):null;
  if(!retail){const root=await installDir();if(!root)return null;retail=path.join(root,'_retail_');}
  const addons=path.join(retail,'Interface','AddOns');
  if(!await exists(addons))return null;
  return {retail,addons,addon:path.join(addons,addonName),wtf:path.join(retail,'WTF')};
}

// The target folder and every folder below it must be real folders inside AddOns. A junction or symbolic link
// would send writes somewhere else, so it is refused rather than followed.
async function assertInside(where,file){
  const target=path.resolve(file),base=path.resolve(where.addon);
  const rel=path.relative(base,target);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Refusing to write outside the SimCLab addon folder.');
  // Resolve the AddOns parent first: Windows 8.3 aliases (for example RUNNER~1) are not links.
  const realAddons=await fs.realpath(where.addons);
  let current=base;
  for(const part of ['',...path.dirname(rel).split(path.sep).filter(p=>p&&p!=='.')]){
    current=part?path.join(current,part):current;
    const stat=await fs.lstat(current).catch(()=>null);
    if(stat&&(stat.isSymbolicLink()||!stat.isDirectory()))throw new Error(`${current} is a link or not a folder. SimC Lab only writes into a real SimCLab folder.`);
    if(stat){const real=await fs.realpath(current);if(real.toLowerCase()!==path.join(realAddons,path.relative(where.addons,current)).toLowerCase())throw new Error(`${current} is a link to another location. SimC Lab only writes into a real SimCLab folder.`);}
  }
}

async function rename(from,to){
  // Windows refuses a rename while another program briefly holds the file; retry a few times.
  for(let attempt=0;;attempt++){
    try{return await fs.rename(from,to);}
    catch(e){if(attempt>=5||!['EPERM','EBUSY','EACCES'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,100*(attempt+1)));}
  }
}

export async function atomicWrite(file,content){
  const tmp=`${file}.${process.pid}.tmp`;
  try{await fs.writeFile(tmp,content);await rename(tmp,file);}
  catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});throw e;}
}

async function writeAddonFile(where,rel,content){
  const file=path.join(where.addon,rel);
  await assertInside(where,file);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await assertInside(where,file);
  await atomicWrite(file,content);
}

async function shippedFiles(dir=shippedDir,prefix=''){
  const out=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true})){
    const rel=path.join(prefix,e.name);
    if(e.isDirectory())out.push(...await shippedFiles(path.join(dir,e.name),rel));
    else if(e.isFile())out.push(rel);
  }
  return out;
}

export class WowAddon{
  constructor({installDir,appVersion,context}){this.installDir=installDir;this.appVersion=appVersion;this.context=context;this.last=null;}
  where(){return locate(this.installDir);}
  async loadStore(){
    try{const s=JSON.parse(await fs.readFile(storeFile,'utf8'));s.characters||={};s.settings={...defaults(),...s.settings};return s;}
    catch{return {characters:{},settings:defaults()};}
  }
  async saveStore(store){await fs.mkdir(path.dirname(storeFile),{recursive:true});await atomicWrite(storeFile,JSON.stringify(store));}

  async status(){
    const where=await this.where();const shipped=await readToc(shippedDir);
    const installed=where?await readToc(where.addon):null;const store=await this.loadStore();
    const sent=[];
    for(const [key,c] of Object.entries(store.characters))for(const [specId,spec] of Object.entries(c.specs))for(const sim of spec.sims)
      sent.push({key,name:c.name,realm:c.realm,spec:spec.spec,specId:Number(specId),id:sim.id,mode:sim.mode,title:sim.title,created:sim.created,scenarios:sim.scenarios.length,results:sim.scenarios.reduce((n,s)=>n+s.results.length,0)});
    let linked=false;if(where&&installed)try{await assertInside(where,path.join(where.addon,`${addonName}.toc`));}catch{linked=true;}
    // `manage` is the button: null until the user has chosen, and then true (keep it installed and updated)
    // or false (leave the game alone).
    const manage=store.settings.manage;
    return {found:!!where,addons:where?.addons||null,shipped:shipped?.version||null,installed:installed?.version||null,
      updateAvailable:!!(installed&&shipped&&compareVersions(shipped.version,installed.version)>0),linked,settings:store.settings,limits:{keep:limits.keep},
      manage:manage===null?!!installed:manage,
      sent:sent.sort((a,b)=>(b.created||0)-(a.created||0)),last:this.last};
  }

  // Installs or updates from the copy shipped with the app, then writes Data.lua from the store. The TOC goes
  // last, so an interrupted install never looks complete to the game. Installing turns the addon on: from then
  // on the app keeps it in step with every app update.
  async install({manage=true}={}){
    const where=await this.where();
    if(!where)throw new Error('The World of Warcraft AddOns folder was not found.');
    if(!await exists(shippedDir))throw new Error('This SimC Lab build does not include the addon.');
    const files=(await shippedFiles()).filter(f=>f!=='Data.lua').sort((a,b)=>Number(a.endsWith('.toc'))-Number(b.endsWith('.toc')));
    await fs.mkdir(where.addon,{recursive:true});
    for(const rel of files)await writeAddonFile(where,rel,await fs.readFile(path.join(shippedDir,rel)));
    await this.writeData(where);
    if(manage)await this.setManage(true);
    return this.status();
  }

  // The other half of the button: the files this app wrote are removed, and the app stops installing the addon.
  // Files SimC Lab did not write stay, and so does everything the game saved outside AddOns.
  async uninstall(){
    const where=await this.where();
    if(!where)throw new Error('The World of Warcraft AddOns folder was not found.');
    await this.setManage(false);
    if(!await exists(where.addon))return this.status();
    const files=[...await shippedFiles(),'Data.lua'];
    for(const rel of new Set(files)){
      const file=path.join(where.addon,rel);
      await assertInside(where,file);
      await fs.rm(file,{force:true});
    }
    // Only empty folders go: anything the player put in the addon folder keeps it alive.
    const folders=[...new Set(files.map(f=>path.dirname(f)).filter(d=>d!=='.'))].sort((a,b)=>b.length-a.length);
    for(const folder of [...folders,'.'])await fs.rmdir(path.join(where.addon,folder)).catch(()=>{});
    return this.status();
  }

  // Keeps the addon in step with the app: with the button on, a missing addon is installed and an older one
  // updated on every start. With it off, or when the folder is a link elsewhere, nothing is touched.
  async autoUpdate(){
    const s=await this.status();
    if(!s.found||s.linked||!s.manage)return false;
    if(!s.installed||s.updateAvailable){await this.install({manage:false});return true;}
    return false;
  }

  async setManage(on){
    const store=await this.loadStore();
    store.settings.manage=!!on;
    await this.saveStore(store);
  }

  async writeData(where){
    where??=await this.where();
    const store=await this.loadStore();const {tracks,app}=await this.context();
    const file=dataFile(store,{tracks,app,keep:store.settings.keep});
    if(!where||!await readToc(where.addon))return {written:false,bytes:file.bytes,dropped:file.dropped};
    await writeAddonFile(where,'Data.lua',file.text);
    return {written:true,bytes:file.bytes,dropped:file.dropped};
  }

  async send(who,entry,{auto=false}={}){
    const store=await this.loadStore();
    addSim(store,who,entry,store.settings.keep);await this.saveStore(store);
    const result=await this.writeData();
    this.last={id:entry.id,auto,time:new Date().toISOString(),written:result.written,name:who.name,spec:who.spec};
    return {...result,key:who.key,specId:who.specId,installed:result.written};
  }

  async remove(id){const store=await this.loadStore();removeSim(store,id);await this.saveStore(store);await this.writeData();return this.status();}

  async settings(input){
    const store=await this.loadStore();const next={...store.settings};
    if(input.autoSend!==undefined)next.autoSend=!!input.autoSend;
    if(input.keep!==undefined){const k=Number(input.keep);if(!Number.isInteger(k)||k<limits.keep[0]||k>limits.keep[1])throw new Error(`Keep ${limits.keep[0]}–${limits.keep[1]} sims per character and specialization.`);next.keep=k;}
    store.settings=next;await this.saveStore(store);await this.writeData();return this.status();
  }

  // Characters the addon captured through the official SimulationCraft addon, from every account's
  // SavedVariables. The file is written by the game, but any addon can change the table before it is saved,
  // so it is parsed as data only and the profile still goes through the normal import checks.
  async captures(){
    const where=await this.where();if(!where)return [];
    const out=[];
    const accounts=await fs.readdir(path.join(where.wtf,'Account'),{withFileTypes:true}).catch(()=>[]);
    for(const account of accounts){
      if(!account.isDirectory()||account.name==='SavedVariables')continue;
      const file=path.join(where.wtf,'Account',account.name,'SavedVariables',`${addonName}.lua`);
      let text;try{const stat=await fs.stat(file);if(stat.size>16*1024*1024)continue;text=await fs.readFile(file,'utf8');}catch{continue;}
      let db;try{db=parseLua(text).SimCLabDB;}catch{continue;}
      for(const [key,c] of Object.entries(db?.captures||{})){
        if(!c||typeof c.text!=='string'||c.text.length>250000)continue;
        out.push({account:account.name,key,name:String(c.name||''),realm:String(c.realm||''),spec:String(c.spec||''),time:Number(c.time)||0,simc:String(c.simc||''),text:c.text,checksum:checksumOk(c.text)});
      }
    }
    return out.sort((a,b)=>b.time-a.time);
  }
}

// manage: null until the Install or Remove button has been pressed, so an addon installed by an earlier
// version keeps being updated while nothing is installed behind the user's back.
const defaults=()=>({autoSend:false,keep:limits.defaultKeep,manage:null});

// The SimulationCraft addon ends its export with an adler32 of everything before that line.
export function checksumOk(text){
  const m=String(text).match(/\n# Checksum: ([0-9a-f]+)\s*$/);if(!m)return null;
  let s1=1,s2=0;for(const b of Buffer.from(text.slice(0,m.index+1),'utf8')){s1+=b;s2+=s1;}
  s1%=65521;s2%=65521;
  const value=(s2*65536+s1)>>>0;
  return m[1].slice(-8).padStart(8,'0')===value.toString(16).padStart(8,'0');
}
