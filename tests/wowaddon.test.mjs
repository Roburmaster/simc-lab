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
const {WowAddon,readToc,compareVersions,checksumOk,shippedDir,locate}=await import('../lib/wowaddon.mjs');
const {identity,simEntry,trackTable}=await import('../lib/wowdata.mjs');
test.after(()=>fs.rm(temp,{recursive:true,force:true}));

const tracks=trackTable(season);
const addon=()=>new WowAddon({installDir:async()=>null,context:async()=>({tracks,app:'9.9.9'})});
const exists=f=>fs.access(f).then(()=>true,()=>false);
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

test('an old install is updated automatically, a missing one is not installed',async()=>{
  const toc=path.join(addons,'SimCLab','SimCLab.toc');
  await fs.writeFile(toc,(await fs.readFile(toc,'utf8')).replace(/## Version: .*/,'## Version: 0.0.1'));
  assert.equal((await addon().status()).updateAvailable,true);
  assert.equal(await addon().autoUpdate(),true);
  assert.equal((await addon().status()).updateAvailable,false);
  assert.equal(await addon().autoUpdate(),false);
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
  assert.deepEqual((await a.status()).settings,{autoSend:true,keep:2});
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
  const body='# SimC Addon 12.1.0-03\ndeathknight="Temulan"\nserver=ravencrest\nspec=blood\n\n';
  let s1=1,s2=0;for(const b of Buffer.from(body,'utf8')){s1+=b;s2+=s1;}
  const text=`${body}# Checksum: ${((s2%65521)*65536+(s1%65521)>>>0).toString(16)}`;
  assert.equal(checksumOk(text),true);
  assert.equal(checksumOk(text.replace('blood','frost')),false);
  assert.equal(checksumOk('no checksum'),null);
  const quote=s=>'"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n')+'"';
  for(const [account,time] of [['ACCOUNT1',100],['ACCOUNT2',200]]){
    const dir=path.join(retail,'WTF','Account',account,'SavedVariables');
    await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'SimCLab.lua'),`\nSimCLabDB = {\n["captures"] = {\n["temulan-ravencrest"] = {\n["text"] = ${quote(text)},\n["time"] = ${time},\n["name"] = "Temulan",\n["realm"] = "Ravencrest",\n["spec"] = "Blood",\n},\n},\n["version"] = 1,\n}\n`);
  }
  await fs.mkdir(path.join(retail,'WTF','Account','BROKEN','SavedVariables'),{recursive:true});
  await fs.writeFile(path.join(retail,'WTF','Account','BROKEN','SavedVariables','SimCLab.lua'),'SimCLabDB = { os.exit() }');
  const list=await addon().captures();
  assert.deepEqual(list.map(c=>[c.account,c.name,c.time,c.checksum]),[['ACCOUNT2','Temulan',200,true],['ACCOUNT1','Temulan',100,true]],'newest first; the broken file is skipped');
  assert.equal(list[0].text,text);
});
