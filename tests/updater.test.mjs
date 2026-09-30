import test from 'node:test';
import assert from 'node:assert/strict';
import {plan,parseBuildInfo} from '../lib/updater.mjs';

const build=(wowVersion,version='1210-01')=>({version,wowVersion,hotfix:'2026-09-17/69814'});
const head=(sha,wow)=>({sha,date:'2026-09-18',branch:'midnight',...build(wow)});
const nightly=(sha,wow)=>({sha,date:'2026-09-18',url:'http://x/simc.7z',name:'simc.7z',build:build(wow)});
const live=(wow,hash='h1')=>({wowBuild:wow,contentHash:hash});

test('build_info lines are parsed and non-live builds rejected',()=>{
  assert.deepEqual(parseBuildInfo('Nothing to sim! SimulationCraft 1210-01 for World of Warcraft 12.1.0.69814 Live (hotfix 2026-09-17/69814)'),build('12.1.0.69814'));
  assert.equal(parseBuildInfo('SimulationCraft 1210-01 for World of Warcraft 12.1.5.70000 PTR'),null);
});

test('the nightly build is preferred when it is the newest source and matches WoW',()=>{
  const p=plan({installedWow:'12.1.0.69814',local:{},head:head('aaa','12.1.0.69814'),nightly:nightly('aaa','12.1.0.69814'),live:live('12.1.0.69814')});
  assert.equal(p.action,'nightly');assert.equal(p.engine.url,'http://x/simc.7z');
});

test('source is built when only the newest source matches a new WoW build',()=>{
  const p=plan({installedWow:'12.1.5.70000',local:{},head:head('bbb','12.1.5.70000'),nightly:nightly('aaa','12.1.0.69814'),live:live('12.1.5.70000')});
  assert.equal(p.action,'source');assert.equal(p.engine.sha,'bbb');
});

test('an older nightly still wins when the newest source is for another WoW build',()=>{
  const p=plan({installedWow:'12.1.0.69814',local:{},head:head('ccc','12.1.5.70000'),nightly:nightly('aaa','12.1.0.69814'),live:live('12.1.0.69814')});
  assert.equal(p.action,'nightly');
});

test('nothing is installed when SimC or the game data has not caught up with WoW',()=>{
  assert.equal(plan({installedWow:'12.2.0.1',local:{},head:head('a','12.1.0.69814'),nightly:nightly('a','12.1.0.69814'),live:live('12.2.0.1')}).action,'wait');
  assert.equal(plan({installedWow:'12.1.5.70000',local:{},head:head('b','12.1.5.70000'),nightly:null,live:live('12.1.0.69814')}).action,'wait');
});

test('up to date, data-only and forced source updates',()=>{
  const current={commit:'aaa111',wowVersion:'12.1.0.69814',dataHash:'h1'};
  const args={installedWow:'12.1.0.69814',head:head('aaa111','12.1.0.69814'),nightly:nightly('aaa111','12.1.0.69814')};
  assert.equal(plan({...args,local:current,live:live('12.1.0.69814','h1')}).action,'none');
  const data=plan({...args,local:current,live:live('12.1.0.69814','h2')});assert.equal(data.action,'data');assert.equal(data.engine,null);
  assert.equal(plan({...args,local:current,live:live('12.1.0.69814'),mode:'source'}).engine.kind,'source');
});

test('a newer source commit for the same WoW build never triggers a compile',()=>{
  const p=plan({installedWow:'12.1.0.69875',local:{},head:head('newer','12.1.0.69875'),nightly:nightly('older','12.1.0.69875'),live:live('12.1.0.69875')});
  assert.equal(p.action,'nightly');assert.equal(p.engine.sha,'older');
});

test('a newer nightly for the same WoW build replaces the engine; the same or an older one does not',()=>{
  const local={commit:'old',commitDate:'2026-09-10T00:00:00Z',wowVersion:'12.1.0.69875',dataHash:'h1'};
  const args={installedWow:'12.1.0.69875',head:head('newest','12.1.0.69875'),live:live('12.1.0.69875','h1')};
  const p=plan({...args,local,nightly:nightly('fresh','12.1.0.69875')});
  assert.equal(p.action,'nightly','22 commits behind was kept before: now the nightly is installed');assert.equal(p.engine.sha,'fresh');
  assert.equal(plan({...args,local:{...local,commit:'fresh'},nightly:nightly('fresh','12.1.0.69875')}).action,'none','already on the nightly');
  assert.equal(plan({...args,local:{...local,commit:'mine',commitDate:'2026-09-20T00:00:00Z'},nightly:nightly('older','12.1.0.69875')}).action,'none','a source build newer than the nightly is kept');
  assert.equal(plan({...args,local,nightly:nightly('fresh','12.1.5.70000')}).action,'none','a nightly for another WoW build is not taken');
});

test('an installed engine newer than the nightly is kept for the current WoW build',()=>{
  const local={commit:'mine',commitDate:'2026-09-19T00:00:00Z',wowVersion:'12.1.0.69875',dataHash:'h1'};
  const args={installedWow:'12.1.0.69875',head:head('newer','12.1.0.69875'),nightly:nightly('older','12.1.0.69875')};
  assert.equal(plan({...args,local,live:live('12.1.0.69875','h1')}).action,'none');
  assert.equal(plan({...args,local,live:live('12.1.0.69875','h2')}).action,'data');
  assert.equal(plan({...args,local:{...local,wowVersion:'12.1.0.69814'},live:live('12.1.0.69875')}).action,'nightly','a WoW patch replaces the engine');
});

test('at start, only an official build or new game data is installed by itself',async()=>{
  const {Updater}=await import('../lib/updater.mjs');
  for(const [action,started] of [['nightly',true],['data',true],['source',false],['none',false],['wait',false]]){
    const u=new Updater({busy:()=>false,onInstalled:async()=>{}});
    let mode=null;
    u.check=async()=>({checkedAt:'t',local:{behind:3},decision:{action,reason:`r-${action}`}});
    u.start=m=>{mode=m;return {status:'running'};};
    await u.startup();
    assert.equal(mode!==null,started,action);
    assert.equal(u.state.startup.reason,`r-${action}`);
  }
  const busy=new Updater({busy:()=>true,onInstalled:async()=>{}});
  busy.check=async()=>{throw new Error('must not check while simulations run');};
  assert.equal(await busy.startup(),null);
});

test('where there are no official builds (Linux), a newer commit on GitHub is built from source',()=>{
  const local={commit:'old',commitDate:'2026-09-27T15:27:00Z',wowVersion:'12.1.0.69933',dataHash:'h1'};
  const args={installedWow:null,live:live('12.1.0.69933','h1'),nightly:null,sourceOnly:true};
  const p=plan({...args,local,head:{...head('fa7a6dc','12.1.0.69933'),date:'2026-09-30T12:15:00Z'}});
  assert.equal(p.action,'source','16 commits behind was kept before');assert.equal(p.engine.sha,'fa7a6dc');
  assert.match(p.reason,/newer SimC commits/);
  const same=plan({...args,local:{...local,commit:'fa7a6dc'},head:{...head('fa7a6dc','12.1.0.69933'),date:'2026-09-30T12:15:00Z'}});
  assert.equal(same.action,'none');assert.match(same.reason,/newest commit on GitHub/);
  assert.equal(plan({...args,local,head:{...head('fa7a6dc','12.1.0.69933'),date:'2026-09-30T12:15:00Z'},sourceOnly:false}).action,'none','with nightlies (Windows) a source commit alone never compiles');
});

test('update modes: latest commit skips what is installed, a clean build does not, unknown modes are refused',async()=>{
  const {Updater}=await import('../lib/updater.mjs');
  const u=new Updater({busy:()=>false,onInstalled:async()=>{}});
  assert.throws(()=>u.start('everything'),/Unknown update mode/);
  // Following the latest commit: a Windows install that chose it, or Linux always.
  assert.equal(await new Updater({busy:()=>false,onInstalled:async()=>{},followSource:async()=>true}).sourceOnly(),true);
  const plain=await new Updater({busy:()=>false,onInstalled:async()=>{}}).sourceOnly();
  assert.equal(plain,process.platform!=='win32');
  // At start, following installs compile a newer commit; others never do.
  for(const [sourceOnly,started] of [[true,true],[false,false]]){
    const s=new Updater({busy:()=>false,onInstalled:async()=>{}});let mode=null;
    s.check=async()=>({checkedAt:'t',sourceOnly,local:{behind:3},decision:{action:'source',reason:'r'}});s.start=m=>{mode=m;return {};};
    await s.startup();assert.equal(mode!==null,started);
  }
});

test('following the latest commit on Windows builds GitHub head even when a newer nightly exists',()=>{
  const local={commit:'613b5fb',commitDate:'2026-09-29T22:26:00Z',wowVersion:'12.1.0.69933',dataHash:'h1'};
  const args={installedWow:'12.1.0.69933',live:live('12.1.0.69933','h1'),local,head:{...head('fa7a6dc','12.1.0.69933'),date:'2026-09-30T12:15:00Z'},nightly:{...nightly('b00b1e5','12.1.0.69933'),date:'2026-09-30T08:00:00Z'}};
  const p=plan({...args,sourceOnly:true});
  assert.equal(p.action,'source');assert.equal(p.engine.sha,'fa7a6dc');
  assert.equal(plan({...args,sourceOnly:false}).action,'nightly','without the choice the nightly is taken');
  assert.equal(plan({...args,sourceOnly:true,local:{...local,commit:'fa7a6dc',commitDate:'2026-09-30T12:15:00Z'}}).action,'none','already on head: a newer-looking nightly is not taken');
});

test('a GitHub token is found for API calls, and a failed check does not claim SimC is current',async()=>{
  const {githubToken}=await import('../lib/updater.mjs');
  assert.equal(await githubToken({}),null);
  assert.equal(await githubToken({SIMC_LAB_PUBLISH_TOKEN:' pub '}),'pub','the publish token on a server');
  assert.equal(await githubToken({SIMC_LAB_GITHUB_TOKEN:'gh',SIMC_LAB_PUBLISH_TOKEN:'pub'}),'gh','a token of its own first');
  const local={commit:'fa7a6dc',wowVersion:'12.1.0.69933',dataHash:'h1'};
  const r=plan({installedWow:null,local,head:null,nightly:null,live:live('12.1.0.69933','h1'),sourceOnly:true});
  assert.equal(r.action,'none');assert.match(r.reason,/could not be reached/);assert.doesNotMatch(r.reason,/newest commit/);
});
