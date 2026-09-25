import test from 'node:test';
import assert from 'node:assert/strict';
import {upgradeReportPage,measured} from '../lib/upgradepage.mjs';

const src=(origin,group,groupName)=>({origin,group,groupName,label:`${groupName} · Hero 6/6`});
const candidate=(key,slot,itemId,name,sources,extra={})=>({key,slot,itemId,name,itemLevel:321,value:`,id=${itemId},bonus_id=6652/13334`,sources,...extra});
const job={
  id:'11111111-2222-3333-4444-555555555555',name:'Roburevolved',mode:'upgrades',status:'complete',
  created:'2026-09-26T10:00:00Z',finished:'2026-09-26T11:00:00Z',
  engine:{version:'1210-01',wowVersion:'12.1.0.69933'},
  settings:{iterations:10000,targetError:0.1,duration:300},
  scenarios:[{style:'Patchwerk',targets:1}],
  upgrade:{season:{name:'Midnight Season 2'},finalists:48,screen:{iterations:2000,targetError:0.5},candidates:[
    candidate('c1','head',1001,'Crown of <b>Kings</b>',[src('raid','raid:1','Boss One')]),
    candidate('c2','finger1',1002,'Ring',[src('mplus','mplus:1','Dungeon A')]),
    candidate('c3','finger2',1002,'Ring',[src('mplus','mplus:1','Dungeon A')]),
    candidate('c4','feet',1003,'Boots',[src('mplus','mplus:2','Dungeon B')]),
    candidate('c5','legs',1004,'Screened legs',[src('raid','raid:1','Boss One')]),
  ]},
  stages:[{scenario:0,stage:1,stem:'000',status:'complete',baseline:{dps:200000,error95:900}},{scenario:0,stage:2,stem:'001',status:'complete',baseline:{dps:200500,error95:200}}],
  results:[
    {scenario:0,stage:1,key:'c1',status:'complete',dps:205000,error95:900},
    {scenario:0,stage:2,key:'c1',status:'complete',dps:206515,error95:200},
    {scenario:0,stage:2,key:'c2',status:'complete',dps:202505,error95:200},
    {scenario:0,stage:2,key:'c3',status:'complete',dps:203507,error95:200},
    {scenario:0,stage:2,key:'c4',status:'complete',dps:200400,error95:200},
    {scenario:0,stage:1,key:'c5',status:'complete',dps:201000,error95:900},
  ]
};

test('the report reads a job the way the results view does',()=>{
  const {upgrades,rows}=measured(job,0);
  // One ring placement, the better one; the boots lost; the screened legs are not an upgrade.
  assert.deepEqual(upgrades.map(r=>r.key),['c1','c3']);
  assert.equal(rows.filter(r=>r.c.itemId===1002).length,1);
  assert.ok(Math.abs(upgrades[0].percent-3)<1e-9);
});

test('upgrade report: character, slots, sources and every upgrade, escaped and script-free',()=>{
  const html=upgradeReportPage(job,{info:{name:'Roburevolved',class:'warrior',spec:'fury'},equipped:{head:{id:9,name:'Old hat',value:',id=9,bonus_id=1'},feet:{id:8,name:'Old boots',value:',id=8'}},armory:true});
  assert.match(html,/<h1>Roburevolved<span>Fury Warrior<i class="tag">Armory import<\/i><\/span><\/h1>/);
  assert.match(html,/\+3\.00 %/);
  assert.match(html,/Crown of &lt;b&gt;Kings&lt;\/b&gt;/);assert.doesNotMatch(html,/<b>Kings/);
  assert.match(html,/Old boots[\s\S]*?Nothing measured beat it\./);
  assert.match(html,/<h4>Raid<\/h4>[\s\S]*Boss One/);assert.match(html,/<h4>Mythic\+<\/h4>[\s\S]*Dungeon A/);
  assert.match(html,/Every measured upgrade <span>2<\/span>/);
  assert.match(html,/data-wowhead="item=1001&amp;bonus=6652:13334"/);
  // Only Wowhead's tooltip script: the page must survive the app's content policy.
  assert.equal((html.match(/<script/g)||[]).length,1);assert.match(html,/<script async src="https:\/\/wow\.zamimg\.com\/js\/tooltips\.js"><\/script>/);
  assert.throws(()=>upgradeReportPage({...job,upgrade:undefined}),/not an Upgrade Finder run/);
});
