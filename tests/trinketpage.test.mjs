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

// The same job with three target counts, and the set trinket shown with and without its bonus.
const multi=structuredClone(job);
multi.scenarios=[{style:'Patchwerk',targets:1},{style:'Patchwerk',targets:3},{style:'Patchwerk',targets:5}];
const spec=multi.trinkets.specs[0];
spec.candidates.push(candidate('t0007',54,'Technique',334,true,{group:'54',set:{name:"Bite of Zul'jan",pieces:2,with:["Maze'roa"]}}),candidate('t0008',54,'Technique',334,true,{group:'54|noset',setOff:{name:"Bite of Zul'jan",pieces:2}}));
multi.results.push({spec:'warrior-arms',scenario:0,stage:2,key:'t0007',status:'complete',dps:216000,gain:16000,percent:8,rank:4,behind:-2.86,tier:'S',tied:false},
  {spec:'warrior-arms',scenario:0,stage:2,key:'t0008',status:'complete',dps:204000,gain:4000,percent:2,rank:5,behind:2.86,tier:'B',tied:false});
for(const s of [1,2]){
  multi.stages.push({spec:'warrior-arms',scenario:s,stage:2,stem:'00'+s,status:'complete',baseline:{dps:200000*(s+1)}});
  multi.results.push({spec:'warrior-arms',scenario:s,stage:2,key:'t0003',status:'complete',dps:210000*(s+1),gain:10000*(s+1),percent:5,rank:1,behind:0,tier:'S',tied:false});
}

test('1, 3 and 5 targets sit side by side and are switched without a script',()=>{
  const html=trinketListPage(multi);
  assert.deepEqual(html.match(/<script[^>]*>/gi),['<script async src="https://wow.zamimg.com/js/tooltips.js">']);
  assert.equal((html.match(/<input class="scn" type="radio" name="scenario"/g)||[]).length,3);
  assert.match(html,/id="scn-0" checked/,'the first scenario is shown first');
  assert.match(html,/<nav class="targets" aria-label="Targets"><span>Patchwerk<\/span><label for="scn-0">1 target<\/label><label for="scn-1">3 targets<\/label><label for="scn-2">5 targets<\/label><\/nav>/);
  assert.match(html,/#scn-2:checked~\.scenarios>\.scenario\[data-scenario="2"\]\{display:block\}/);
  assert.equal((html.match(/<div class="scenario" data-scenario="\d"/g)||[]).length,3);
  assert.equal((html.match(/<p class="title">/g)||[]).length,3,'each scenario names its own fight');
  assert.match(html,/400,000 DPS with no trinket/,'each scenario has its own baseline');
});

test('a set trinket is listed with and without its set bonus',()=>{
  const html=trinketListPage(multi);
  assert.match(html,/data-variant="set"/);assert.match(html,/data-variant="noset"/);
  assert.match(html,/With the Bite of Zul&#39;jan 2-set bonus, beside Maze&#39;roa/);
  assert.match(html,/Without the Bite of Zul&#39;jan set bonus: the trinket alone/);
  assert.match(html,/\+2\.86 % with the set/);
});

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
  assert.match(html,/<h1><span>Trinket<\/span><span class="accent">tier list\.<\/span><\/h1>/,'the website\'s heading');
  assert.match(html,/@font-face\{font-family:"Oswald";src:url\(data:font\/ttf;base64,/,'the site\'s fonts travel inside the file');
  assert.match(html,/Always sim your own character\./);
  assert.equal(html.includes('class="targets"'),false,'one scenario needs no switch');
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
