import test from 'node:test';
import assert from 'node:assert/strict';
import {tierListPage} from '../lib/tierpage.mjs';

const candidate=(key,itemId,name,extra={})=>({key,itemId,name,slot:'main_hand',kind:'main',itemLevel:334,value:`,id=${itemId},bonus_id=12854/13335`,sources:['Raid · Boss'],...extra});
const job={
  id:'11111111-2222-3333-4444-555555555555',
  created:'2026-09-22T10:00:00Z',finished:'2026-09-22T12:00:00Z',
  engine:{version:'1210-01',wowVersion:'12.1.0.69875'},
  settings:{iterations:10000,targetError:0.1,duration:300},
  scenarios:[{style:'Patchwerk',targets:1}],
  weapons:{
    season:{id:2,name:'Midnight Season 2'},level:{track:618,level:6,itemLevel:334,label:'Myth 6/6'},
    screen:{iterations:2000,targetError:0.5},kinds:['main'],
    specs:[
      {key:'warrior-arms',label:'Arms Warrior',className:'Warrior',specName:'Arms',file:'MID2_Warrior_Arms.simc',tank:false,
       candidates:[candidate('w001',30,'Great axe'),candidate('w002',31,'Forged axe',{craftedStat:'Critical Strike / Haste',sources:['Crafted · Blacksmithing']}),candidate('w003',32,'<script>alert(1)</script>')]},
      {key:'warrior-protection',label:'Protection Warrior',className:'Warrior',specName:'Protection',file:'MID2_Warrior_Protection.simc',tank:true,
       candidates:[candidate('w001',40,'Bulwark',{kind:'shield',slot:'off_hand'})]}
    ]
  },
  stages:[{spec:'warrior-arms',scenario:0,stage:2,stem:'000',baseline:{dps:250000}},{spec:'warrior-protection',scenario:0,stage:2,stem:'001',baseline:{dps:180000}}],
  results:[
    {spec:'warrior-arms',scenario:0,stage:2,key:'w001',status:'complete',dps:300000,error95:500,rank:1,behind:0,tier:'S',tied:false},
    {spec:'warrior-arms',scenario:0,stage:2,key:'w002',status:'complete',dps:297000,error95:500,rank:2,behind:1,tier:'A',tied:true},
    {spec:'warrior-arms',scenario:0,stage:1,key:'w003',status:'complete',dps:280000,error95:2000,rank:3,behind:6.67,tier:'D',tied:false,screened:true},
    // A screening row the final round replaced, and a stat pair that lost to its twin: neither belongs on the page.
    {spec:'warrior-arms',scenario:0,stage:1,key:'w001',status:'complete',dps:299000,superseded:true},
    {spec:'warrior-arms',scenario:0,stage:2,key:'w004',status:'complete',dps:290000,variant:true},
    {spec:'warrior-protection',scenario:0,stage:2,key:'w001',status:'complete',dps:180500,score:1.25,scoreError:0.2,rank:1,behind:0,tier:'S',tied:false}
  ]
};

test('the page carries every class, spec and tier, and no script but Wowhead’s',()=>{
  const html=tierListPage(job);
  assert.match(html,/<h1>Weapon tier list/);
  assert.match(html,/Midnight Season 2/);
  assert.match(html,/item level 334/);
  assert.match(html,/>Warrior</,'the class heading');
  assert.match(html,/>Arms<|Arms<\/h3>|>Arms/,'the specialization heading');
  assert.match(html,/Protection/);
  // Wowhead's tooltip script is the only one, and nothing in the data can add another.
  assert.deepEqual(html.match(/<script[^>]*>/gi),['<script async src="https://wow.zamimg.com/js/tooltips.js">']);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/,'an item name is escaped, not executed');
  assert.match(html,/data-wowhead="item=30&amp;bonus=12854:13335"/,'links carry the simulated item for the tooltip');
  for(const tier of ['tier-S','tier-A','tier-D'])assert.ok(html.includes(tier),tier);
  assert.match(html,/wowhead\.com\/item=30\?bonus=12854:13335/,'items link to Wowhead with the simulated bonus IDs');
  assert.match(html,/Critical Strike \/ Haste/,'a crafted weapon shows the pair it was ranked at');
  assert.match(html,/screened only/);
  assert.match(html,/\+1\.25 score/,'a tank is ranked on the weighted score');
  assert.match(html,/reference 250,000 DPS/);
});

test('rows that were replaced or lost to a better stat pair stay off the page',()=>{
  const html=tierListPage(job);
  assert.equal((html.match(/Great axe/g)||[]).length,1,'the screening row of the same weapon is not listed again');
  assert.equal(html.includes('w004'),false);
});

test('each hand gets its own list, so a main hand is never ranked against an off hand',()=>{
  const dual={...job,weapons:{...job.weapons,specs:[{...job.weapons.specs[0],
    candidates:[
      {key:'m1',itemId:30,name:'Main axe',slot:'main_hand',kind:'main',itemLevel:334,value:',id=30',sources:['Raid · Boss']},
      {key:'o1',itemId:31,name:'Off axe',slot:'off_hand',kind:'offhand',itemLevel:334,value:',id=31',sources:['Raid · Boss']}
    ]}]},
    results:[
      {spec:'warrior-arms',scenario:0,stage:2,key:'m1',status:'complete',dps:300000,error95:500,rank:1,behind:0,tier:'S',tied:false},
      {spec:'warrior-arms',scenario:0,stage:2,key:'o1',status:'complete',dps:290000,error95:500,rank:1,behind:0,tier:'S',tied:false}
    ]};
  const html=tierListPage(dual);
  assert.match(html,/Main hand <span>1 weapons/);
  assert.match(html,/Off hand <span>1 weapons/);
  // Both are first in their own hand, so both say "best" rather than one of them trailing the other.
  assert.equal((html.match(/>best</g)||[]).length,2);
});

test('a job without a Weapon Lab plan is refused',()=>{
  assert.throws(()=>tierListPage({...job,weapons:undefined}),/not a Weapon Lab run/);
});
