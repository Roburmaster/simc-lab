import test from 'node:test';
import assert from 'node:assert/strict';
import {trinketListPage,trinketSeries,jobLevels} from '../lib/trinketpage.mjs';

const candidate=(key,itemId,name,itemLevel,top,extra={})=>({key,itemId,name,slot:'trinket1',itemLevel,levelLabel:`level ${itemLevel}`,top,value:`,id=${itemId},bonus_id=${12000+itemLevel}`,sources:['Raid · Boss'],...extra});
const job={
  id:'11111111-2222-3333-4444-555555555555',
  created:'2026-09-28T10:00:00Z',finished:'2026-09-28T12:00:00Z',
  engine:{version:'1210-01',wowVersion:'12.1.0.69933'},
  settings:{iterations:10000,targetError:0.1,duration:300},
  scenarios:[{style:'Patchwerk',targets:1}],
  trinkets:{
    season:{id:2,name:'Midnight Season 2'},levels:{min:308,max:334},
    sources:{equal:false,raid:{label:'Mythic · up to Myth 6/6',itemLevel:344},mplus:{label:'Hero 6/6',itemLevel:321}},
    screen:{iterations:2000,targetError:0.5},
    specs:[{key:'warrior-arms',label:'Arms Warrior',class:'warrior',className:'Warrior',specName:'Arms',file:'MID2_Warrior_Arms.simc',gear:{itemLevel:338.6},
      candidates:[candidate('t0001',50,'Idol',308,false),candidate('t0002',50,'Idol',321,false),candidate('t0003',50,'Idol',334,true),
        candidate('t0004',51,'Flask',308,false,{sources:['Mythic+ · Murder Row']}),candidate('t0005',51,'Flask',321,true,{sources:['Mythic+ · Murder Row'],onUse:true}),
        candidate('t0006',52,'<script>x</script>',334,true)]}]
  },
  stages:[{spec:'warrior-arms',scenario:0,stage:2,stem:'000',status:'complete',baseline:{dps:200000}}],
  results:[
    {spec:'warrior-arms',scenario:0,stage:2,key:'t0001',status:'complete',dps:206000,gain:6000,percent:3},
    {spec:'warrior-arms',scenario:0,stage:2,key:'t0002',status:'complete',dps:208000,gain:8000,percent:4},
    {spec:'warrior-arms',scenario:0,stage:2,key:'t0003',status:'complete',dps:210000,gain:10000,percent:5,rank:1,behind:0,tier:'S',tied:false},
    {spec:'warrior-arms',scenario:0,stage:2,key:'t0004',status:'complete',dps:205000,gain:5000,percent:2.5},
    {spec:'warrior-arms',scenario:0,stage:2,key:'t0005',status:'complete',dps:207000,gain:7000,percent:3.5,rank:2,behind:1.43,tier:'A',tied:false},
    {spec:'warrior-arms',scenario:0,stage:1,key:'t0006',status:'complete',dps:201000,gain:1000,percent:0.5,rank:3,behind:4.29,tier:'C',tied:false,screened:true}
  ]
};

test('each ranked trinket carries its gain at every simulated level, lowest first',()=>{
  const series=trinketSeries(job,job.trinkets.specs[0],0);
  assert.deepEqual(series.map(s=>s.candidate.name),['Idol','Flask','<script>x</script>']);
  assert.deepEqual(series[0].levels.map(l=>l.itemLevel),[308,321,334]);
  assert.deepEqual(series[1].levels.map(l=>l.gain),[5000,7000]);
  assert.equal(series[2].levels.length,1,'a screened trinket has its top level only');
  assert.deepEqual(jobLevels(job),[308,321,334]);
});

test('the page is a tier list with a split bar per trinket and no script but Wowhead’s',()=>{
  const html=trinketListPage(job);
  assert.match(html,/<h1>Trinket <em>tier list<\/em><\/h1>/);
  assert.deepEqual(html.match(/<script[^>]*>/gi),['<script async src="https://wow.zamimg.com/js/tooltips.js">']);
  assert.match(html,/&lt;script&gt;x&lt;\/script&gt;/);
  for(const tier of ['tier-S','tier-A','tier-C'])assert.ok(html.includes(`class="tier-row ${tier}"`),tier);
  assert.match(html,/data-levels="308:6000\.0:3\.000\|321:8000\.0:4\.000\|334:10000\.0:5\.000"/,'the importer reads the curve from the row');
  assert.match(html,/\+5\.00 % · \+10,000 DPS/);
  assert.match(html,/−1\.43 %/);
  assert.match(html,/on use/);
  assert.match(html,/screened only/);
  assert.match(html,/200,000 DPS with no trinket/);
  assert.equal((html.match(/<li class="trinket/g)||[]).length,3,'one row per trinket, not per level');
  // Three segments for the Idol: 0–60 %, 60–80 %, 80–100 % of the spec's largest gain.
  assert.match(html,/left:0\.00%;width:60\.00%/);assert.match(html,/left:80\.00%;width:20\.00%/);
});
