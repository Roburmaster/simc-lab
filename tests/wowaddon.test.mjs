import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {season,profile,talentData,upgradeJob,request} from './addon/fixture.mjs';

// paths.mjs reads SIMC_LAB_HOME when it is first imported, so the environment is set before the import.
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-addon-'));
const retail=path.join(temp,'World of Warcraft','_retail_');
const addons=path.join(retail,'Interface','AddOns');
process.env.SIMC_LAB_HOME=path.join(temp,'home');
process.env.SIMC_LAB_WOW_DIR=retail;
const {WowAddon,readToc,compareVersions,checksumOk,shippedDir,locate,validateManifest,releasesUrl}=await import('../lib/wowaddon.mjs');
const {identity,simEntry,trackTable}=await import('../lib/wowdata.mjs');
test.after(()=>fs.rm(temp,{recursive:true,force:true}));

const tracks=trackTable(season);
const addon=()=>new WowAddon({installDir:async()=>null,context:async()=>({tracks,app:'9.9.9'})});
const exists=f=>fs.access(f).then(()=>true,()=>false);
// A Lua string as WoW writes one into SavedVariables.
const luaQuote=s=>'"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n')+'"';
async function tree(dir){
  const out=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true,recursive:true}))if(e.isFile())out.push(path.relative(dir,path.join(e.parentPath??e.path,e.name)).replaceAll('\\','/'));
  return out.sort();
}

test('no AddOns folder, no install',async()=>{
  assert.equal(await locate(async()=>null),null);
  const s=await addon().status();
  assert.equal(s.found,false);assert.equal(s.installed,null);
  await assert.rejects(addon().install(),/AddOns folder was not found/);
});

test('versions compare numerically',()=>{
  assert.equal(compareVersions('1.10.0','1.9.9'),1);
  assert.equal(compareVersions('1.0','1.0.0'),0);
  assert.equal(compareVersions('0.9.1','1.0.0'),-1);
});

test('install copies the shipped addon, writes Data.lua and touches nothing else',async()=>{
  await fs.mkdir(path.join(addons,'Other'),{recursive:true});
  await fs.writeFile(path.join(addons,'Other','Other.toc'),'## Interface: 120100\n');
  await fs.writeFile(path.join(addons,'loose.txt'),'keep me');
  const before=await tree(addons);
  const status=await addon().install();
  const shipped=await readToc(shippedDir);
  assert.equal(status.installed,shipped.version);assert.equal(status.updateAvailable,false);
  const after=await tree(addons);
  assert.deepEqual(after.filter(f=>!f.startsWith('SimCLab/')),before,'other addons and loose files are untouched');
  assert.deepEqual(after.filter(f=>f.startsWith('SimCLab/')).map(f=>f.slice(8)),(await tree(shippedDir)),'exactly the shipped files, Data.lua included');
  assert.ok(!after.some(f=>f.endsWith('.tmp')),'no temp files left behind');
  for(const f of shipped.files)assert.ok(await exists(path.join(addons,'SimCLab',f)),`${f} from the TOC is installed`);
  assert.match(await fs.readFile(path.join(addons,'SimCLab','Data.lua'),'utf8'),/generated [^\n]*\n--[^\n]*\nlocal _, ns = \.\.\.\nns\.data = \{\n  schemaVersion=1,/);
});

test('installing turns the addon on, and an old install is then updated automatically',async()=>{
  assert.equal((await addon().status()).manage,true,'the Install button turned it on');
  const toc=path.join(addons,'SimCLab','SimCLab.toc');
  await fs.writeFile(toc,(await fs.readFile(toc,'utf8')).replace(/## Version: .*/,'## Version: 0.0.1'));
  assert.equal((await addon().status()).updateAvailable,true);
  assert.equal(await addon().autoUpdate(),true);
  assert.equal((await addon().status()).updateAvailable,false);
  assert.equal(await addon().autoUpdate(),false,'nothing to do when it is up to date');
});

test('the Remove button deletes what the app wrote, and stops it coming back',async()=>{
  const a=addon();
  const mine=path.join(addons,'SimCLab','Notes.txt');
  await fs.writeFile(mine,'kept');
  const status=await a.uninstall();
  assert.equal(status.installed,null);
  assert.equal(status.manage,false);
  assert.deepEqual(await fs.readdir(path.join(addons,'SimCLab')),['Notes.txt'],'only files SimC Lab wrote are removed');
  assert.equal(await a.autoUpdate(),false,'removed means removed: no reinstall on the next start');
  await fs.rm(mine);
  await a.uninstall();
  assert.equal(await exists(path.join(addons,'SimCLab')),false,'an empty folder goes too');
  assert.equal((await a.uninstall()).installed,null,'removing twice is not an error');
  // Turned on again, a missing addon is installed on the next start.
  await a.setManage(true);
  assert.equal(await a.autoUpdate(),true);
  assert.equal((await a.status()).installed,(await readToc(shippedDir)).version);
});

test('an addon installed before this setting existed keeps being updated',async()=>{
  const a=addon();
  const store=await a.loadStore();store.settings.manage=null;await a.saveStore(store);
  assert.equal((await a.status()).manage,true,'installed, so it is managed until the user says otherwise');
  const toc=path.join(addons,'SimCLab','SimCLab.toc');
  await fs.writeFile(toc,(await fs.readFile(toc,'utf8')).replace(/## Version: .*/,'## Version: 0.0.1'));
  assert.equal(await a.autoUpdate(),true);
  const empty=addon();
  const fresh=await empty.loadStore();fresh.settings.manage=null;await empty.saveStore(fresh);
  await empty.uninstall();
  const afterRemoval=await empty.loadStore();afterRemoval.settings.manage=null;await empty.saveStore(afterRemoval);
  assert.equal((await empty.status()).manage,false,'nothing installed, so nothing is installed unasked');
  assert.equal(await empty.autoUpdate(),false);
  await empty.install();
});

test('Send to WoW keeps the store and regenerates Data.lua',async()=>{
  const a=addon();
  const who=identity(profile,talentData);
  const r=await a.send(who,simEntry(upgradeJob(),request,{season,tracks}));
  assert.equal(r.written,true);assert.equal(r.key,'temulan-ravencrest');
  const data=await fs.readFile(path.join(addons,'SimCLab','Data.lua'),'utf8');
  assert.match(data,/\["temulan-ravencrest"\]=\{/);assert.match(data,/app="9\.9\.9"/);
  const s=await a.status();
  assert.equal(s.sent.length,1);assert.equal(s.sent[0].results,6);assert.equal(s.last.written,true);
  await a.settings({autoSend:true,keep:2});
  const settings=(await a.status()).settings;
  assert.equal(settings.autoSend,true);assert.equal(settings.keep,2);
  await assert.rejects(a.settings({keep:0}),/Keep 1–10/);
  await a.remove(s.sent[0].id);
  assert.equal((await a.status()).sent.length,0);
  assert.doesNotMatch(await fs.readFile(path.join(addons,'SimCLab','Data.lua'),'utf8'),/temulan/);
});

test('a SimCLab folder that is a link elsewhere is never written through',{skip:process.platform!=='win32'&&'junctions are a Windows feature'},async()=>{
  const outside=path.join(temp,'outside');
  await fs.mkdir(outside,{recursive:true});
  await fs.writeFile(path.join(outside,'SimCLab.toc'),'## Version: 0.0.1\n');
  await fs.rm(path.join(addons,'SimCLab'),{recursive:true,force:true});
  await fs.symlink(outside,path.join(addons,'SimCLab'),'junction');
  try{
    const s=await addon().status();
    assert.equal(s.linked,true);
    await assert.rejects(addon().install(),/link/);
    assert.equal(await addon().autoUpdate(),false);
    assert.deepEqual(await fs.readdir(outside),['SimCLab.toc'],'nothing written into the link target');
  }finally{await fs.rm(path.join(addons,'SimCLab'),{recursive:true,force:true});}
});

test('captured exports are read from every account and checked against their checksum',async()=>{
  await addon().install(); // the link test above left the folder removed
  const body='# SimC Addon 12.1.0-03\ndeathknight="Temulan"\nlevel=90\nserver=ravencrest\nspec=blood\nhead=,id=240001\n\n';
  let s1=1,s2=0;for(const b of Buffer.from(body,'utf8')){s1+=b;s2+=s1;}
  const text=`${body}# Checksum: ${((s2%65521)*65536+(s1%65521)>>>0).toString(16)}`;
  assert.equal(checksumOk(text),true);
  assert.equal(checksumOk(text.replace('blood','frost')),false);
  assert.equal(checksumOk('no checksum'),null);
  for(const [account,time] of [['ACCOUNT1',100],['ACCOUNT2',200]]){
    const dir=path.join(retail,'WTF','Account',account,'SavedVariables');
    await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'SimCLab.lua'),`\nSimCLabDB = {\n["captures"] = {\n["temulan-ravencrest"] = {\n["text"] = ${luaQuote(text)},\n["time"] = ${time},\n["name"] = "Temulan",\n["realm"] = "Ravencrest",\n["spec"] = "Blood",\n},\n},\n["version"] = 1,\n}\n`);
  }
  await fs.mkdir(path.join(retail,'WTF','Account','BROKEN','SavedVariables'),{recursive:true});
  await fs.writeFile(path.join(retail,'WTF','Account','BROKEN','SavedVariables','SimCLab.lua'),'SimCLabDB = { os.exit() }');
  const {characters,problems,found,installed}=await addon().captures();
  assert.equal(found,true);
  assert.equal(installed,(await readToc(shippedDir)).version,'the panel can say whether the addon is there yet');
  assert.deepEqual(characters.map(c=>[c.account,c.name,c.time,c.checksum,c.source]),[['ACCOUNT2','Temulan',200,true,'SimulationCraft addon']],
    'one row per character: the newest capture wins, and the file that is not data is skipped');
  assert.equal(characters[0].text,text);
  assert.equal(characters[0].usable,true);
  assert.deepEqual(problems,[]);
});

test('a character the game could not export says why it is missing',async()=>{
  const dir=path.join(retail,'WTF','Account','ACCOUNT3','SavedVariables');
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'SimCLab.lua'),'\nSimCLabDB = {\n["captures"] = {\n},\n["captureStatus"] = {\n["ok"] = false,\n["reason"] = "the SimulationCraft addon is not installed or not enabled",\n["time"] = 300,\n["name"] = "Temulan",\n},\n}\n');
  try{
    const {problems}=await addon().captures();
    assert.deepEqual(problems.map(p=>[p.account,p.name,p.reason]),[['ACCOUNT3','Temulan','the SimulationCraft addon is not installed or not enabled']]);
  }finally{await fs.rm(path.join(retail,'WTF','Account','ACCOUNT3'),{recursive:true,force:true});}
});

// ---------------------------------------------------------------------------
// The addon's own release channel: a fix for the game without a new app
// ---------------------------------------------------------------------------

const {buildManifest,sha256}=await import('../scripts/pack-addon.mjs');

// The shipped addon, published as its own release with a higher version.
async function publish(version,change=m=>m){
  const manifest=await buildManifest();
  manifest.version=version;
  for(const file of manifest.files){
    if(file.path===`SimCLab.toc`){
      file.text=file.text.replace(/^## Version: .*$/m,`## Version: ${version}`);
      file.bytes=Buffer.byteLength(file.text,'utf8');
      file.sha256=sha256(file.text);
    }
  }
  return change(manifest);
}
// A GitHub that answers with the releases and manifest a test hands it.
function githubServing(manifest,{releases,manifestStatus=200}={}){
  const calls=[];
  const body=JSON.stringify(manifest);
  const list=releases||[
    {tag_name:'v9.9.9',draft:false,assets:[{name:'addon.json',size:10,browser_download_url:'https://example.invalid/app.json'}]},
    {tag_name:'addon-v'+manifest.version,draft:false,published_at:'2026-09-21T10:00:00Z',assets:[{name:'SimCLab-addon.zip',size:1,browser_download_url:'https://example.invalid/zip'},{name:'addon.json',size:body.length,browser_download_url:'https://example.invalid/addon.json'}]},
  ];
  const fetchImpl=async url=>{
    calls.push(String(url));
    if(String(url).startsWith(releasesUrl))return {ok:true,status:200,json:async()=>list};
    if(String(url)==='https://example.invalid/addon.json')return {ok:manifestStatus===200,status:manifestStatus,text:async()=>body};
    return {ok:false,status:404,text:async()=>''};
  };
  return {fetchImpl,calls};
}
const onlineAddon=fetchImpl=>new WowAddon({installDir:async()=>null,context:async()=>({tracks,app:'9.9.9'}),fetchImpl});

test('a manifest is refused unless it is whole and built for this app',async()=>{
  const good=await publish('9.0.0');
  assert.equal(validateManifest(good).version,'9.0.0');
  const broken=[
    [m=>({...m,addon:'Something'}),/another addon/],
    [m=>({...m,schemaVersion:99}),/data schema 99/],
    [m=>({...m,version:'nine'}),/no version/],
    [m=>({...m,files:m.files.map(f=>f.path==='Core.lua'?{...f,text:f.text+'\n-- sneaky'}:f)}),/does not match its checksum/],
    [m=>({...m,files:[...m.files,{path:'../../evil.lua',text:'x',sha256:sha256('x'),bytes:1}]}),/unusable path/],
    [m=>({...m,files:[...m.files,{path:'C:/evil.lua',text:'x',sha256:sha256('x'),bytes:1}]}),/unusable path|unexpected file/],
    [m=>({...m,files:[...m.files,{path:'evil.exe',text:'x',sha256:sha256('x'),bytes:1}]}),/unexpected file/],
    [m=>({...m,files:m.files.filter(f=>f.path!=='SimCLab.toc')}),/no TOC/],
    [m=>({...m,version:'9.0.1'}),/TOC version and the manifest version differ/],
  ];
  for(const [change,message] of broken)assert.throws(()=>validateManifest(change(structuredClone(good))),message,String(message));
});

test('the newest addon release is found on GitHub and installed on its own',async()=>{
  await addon().install();
  const manifest=await publish('9.0.0');
  const {fetchImpl,calls}=githubServing(manifest);
  const a=onlineAddon(fetchImpl);
  const online=await a.checkOnline({force:true});
  assert.equal(online.manifest.version,'9.0.0');
  assert.equal(online.tag,'addon-v9.0.0','app releases are skipped');
  const before=await a.status();
  assert.equal(before.newest,'9.0.0');assert.equal(before.fromGitHub,true);assert.equal(before.updateAvailable,true);
  const after=await a.installOnline(online.manifest);
  assert.equal(after.installed,'9.0.0');
  assert.equal(after.updateAvailable,false);
  assert.match(await fs.readFile(path.join(addons,'SimCLab','UI','Window.lua'),'utf8'),/SimC Lab/);
  assert.ok(await exists(path.join(addons,'SimCLab','Data.lua')),'the data file is written again afterwards');
  assert.equal(calls.filter(u=>u.startsWith(releasesUrl)).length,1);
  // Back to the shipped copy for the tests that follow.
  await addon().install();
});

test('a checked check is remembered, and problems are reported rather than thrown',async()=>{
  const a=onlineAddon(async()=>{throw new Error('offline');});
  const online=await a.checkOnline({force:true});
  assert.match(online.error,/offline/);
  assert.equal((await a.status()).online.error,online.error);
  assert.equal((await a.status()).updateAvailable,false,'a failed check never claims an update');
  const empty=onlineAddon(async()=>({ok:true,status:200,json:async()=>[{tag_name:'v1.0.0',draft:false,assets:[]}]}));
  assert.match((await empty.checkOnline({force:true})).error,/No addon release/);
  const noAsset=onlineAddon(async()=>({ok:true,status:200,json:async()=>[{tag_name:'addon-v9.0.0',draft:false,assets:[]}]}));
  assert.match((await noAsset.checkOnline({force:true})).error,/no addon.json/);
});

test('automatic updates take the newer of the shipped copy and the addon release, and can be turned off',async()=>{
  const shipped=(await readToc(shippedDir)).version;
  const manifest=await publish('9.1.0');
  const {fetchImpl,calls}=githubServing(manifest);
  const a=onlineAddon(fetchImpl);
  await a.install();
  assert.equal((await a.status()).installed,shipped);
  assert.equal(await a.autoUpdate(),true,'the published addon is newer');
  assert.equal((await a.status()).installed,'9.1.0');
  assert.equal(await a.autoUpdate(),false,'nothing left to do');
  // Turned off, GitHub is never asked.
  await a.settings({online:false});
  const quiet=onlineAddon(async()=>{throw new Error('should not be called');});
  await quiet.uninstall();
  await quiet.setManage(true);
  assert.equal(await quiet.autoUpdate(),true,'the shipped copy still installs');
  assert.equal((await quiet.status()).installed,shipped);
  assert.equal((await quiet.checkOnline({force:true})).disabled,true);
  await a.settings({online:true});
  assert.ok(calls.length>0);
});

test('an addon built for another data schema is never installed',async()=>{
  const manifest=await publish('9.2.0',m=>({...m,schemaVersion:2}));
  const {fetchImpl}=githubServing(manifest);
  const a=onlineAddon(fetchImpl);
  const online=await a.checkOnline({force:true});
  assert.match(online.error,/data schema 2/);
  assert.equal((await a.status()).newest,(await readToc(shippedDir)).version,'the app keeps its own copy');
  await assert.rejects(a.installOnline(manifest),/data schema 2/);
});

test('an export the app cannot read is listed with the reason, not hidden',async()=>{
  const dir=path.join(retail,'WTF','Account','ACCOUNT4','SavedVariables');
  await fs.mkdir(dir,{recursive:true});
  // What the addon wrote before it knew the specialization by ID: everything but spec=.
  const broken=luaQuote('warrior="Roburevolved"\nlevel=90\nspec=\nhead=,id=271456\n');
  await fs.writeFile(path.join(dir,'SimCLab.lua'),`\nSimCLabDB = {\n["captures"] = {\n["roburevolved-ravencrest"] = {\n["text"] = ${broken},\n["time"] = 500,\n["name"] = "Roburevolved",\n["realm"] = "Ravencrest",\n["source"] = "SimCLab",\n},\n},\n}\n`);
  try{
    const {characters}=await addon().captures();
    const broken_=characters.find(c=>c.key==='roburevolved-ravencrest');
    assert.equal(broken_.usable,false);
    assert.match(broken_.problem,/missing spec=/);
  }finally{await fs.rm(path.join(retail,'WTF','Account','ACCOUNT4'),{recursive:true,force:true});}
});
