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
