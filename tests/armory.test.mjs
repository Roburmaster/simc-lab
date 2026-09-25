import test from 'node:test';
import assert from 'node:assert/strict';
import {armoryTarget,profileFromReport,isArmoryProfile,itemLinks} from '../lib/armory.mjs';
import {parseProfile} from '../lib/profile.mjs';
import {buildCrestCandidates} from '../lib/crests.mjs';

// The two parts of a SimC report an Armory import reads: the profile section and the gear's Wowhead links.
const report=`<div class="player-section profile"><h3 class="toggle">Profile</h3><div class="toggle-content hide"><div class="subsection force-wrap">
<p>warrior=&quot;Roburevolved&quot;<br>source=blizzard<br>origin=&quot;https://worldofwarcraft.com/en-gb/character/ravencrest/roburevolved&quot;<br>spec=fury<br>level=90<br>race=human<br>role=attack<br>position=back<br>talents=CgEASWsDSHNy<br><br># Default consumables<br>potion=lights_potential_2<br><br>actions.precombat=snapshot_stats<br>actions+=/rampage<br><br>head=tempered_horns,id=271456,bonus_id=6652/12846/13440,stats=167str_3369sta,enchant=enchant_helm__empowered_rune_of_avoidance_2<br>neck=yoke,id=251173,bonus_id=6652/12699,stats=1895sta_129crit,gems=16mastery_7crit<br>wrists=spellbreakers_bracers,id=237834,bonus_id=8790/8960,stats=103str,crafted_stats=mastery/vers<br>finger1=ring,id=268252,bonus_id=6652/12843,stats=1689sta,gems=32stragiint,enchant=enchant_ring__zuljins_mastery_2<br>finger2=ring,id=268252,bonus_id=6652/12844,stats=1689sta,gems=16haste_7crit,enchant=enchant_ring__zuljins_mastery_2<br><br># gear_ilvl=321.88<br></p></div></div></div>
<a href="https://www.wowhead.com/item=271456?ench=8017&amp;bonus=6652:12846:13440&amp;ilvl=321">x</a>
<a href="https://www.wowhead.com/item=251173?gems=240898&amp;bonus=12699:6652&amp;ilvl=321">x</a>
<a href="https://www.wowhead.com/item=237834?bonus=8960:8790&amp;crafted-stats=49:40&amp;ilvl=331">x</a>
<a href="https://www.wowhead.com/item=268252?ench=7969&amp;gems=240983&amp;bonus=6652:12843&amp;ilvl=311">x</a>
<a href="https://www.wowhead.com/item=268252?ench=7969&amp;gems=240900&amp;bonus=6652:12844&amp;ilvl=315">x</a>`;

test('character links and typed names become region, realm slug and name',()=>{
  const want={region:'eu',realm:'ravencrest',name:'roburevolved'};
  for(const url of ['https://worldofwarcraft.com/en-gb/character/eu/ravencrest/roburevolved','https://worldofwarcraft.com/en-gb/character/ravencrest/Roburevolved','https://raider.io/characters/eu/ravencrest/Roburevolved','https://www.warcraftlogs.com/character/eu/ravencrest/roburevolved'])
    assert.deepEqual(armoryTarget({url}),want);
  assert.deepEqual(armoryTarget({region:'US',realm:"Mal'Ganis",name:'Ålen'}),{region:'us',realm:'malganis',name:'ålen'});
  assert.equal(armoryTarget({region:'eu',realm:'Argent Dawn',name:'x'.repeat(2)}).realm,'argent-dawn');
  for(const bad of [{region:'cn',realm:'x',name:'ab'},{region:'eu',realm:'x,y',name:'ab'},{region:'eu',realm:'ravencrest',name:'a b'},{region:'eu',realm:'ravencrest',name:'html=x'},{url:'https://example.com/'}])assert.throws(()=>armoryTarget(bad));
});

test('the report becomes an addon-shaped profile with gem, enchant and crafted IDs',()=>{
  const text=profileFromReport(report,{region:'eu',realm:'ravencrest',wow:'12.1.0.69933',now:new Date('2026-09-26T10:00:00Z')});
  assert.ok(isArmoryProfile(text));assert.ok(!isArmoryProfile('# Roburevolved - Fury\nwarrior="x"'));
  assert.match(text,/^# Roburevolved - Fury - 2026-09-26 10:00 - EU\/ravencrest$/m);
  assert.doesNotMatch(text,/actions|potion=|source=|origin=|position=|gems=|enchant=|tempered_horns/);
  assert.match(text,/^head=,id=271456,bonus_id=6652\/12846\/13440,stats=167str_3369sta,enchant_id=8017$/m);
  assert.match(text,/^neck=,id=251173,bonus_id=6652\/12699,stats=1895sta_129crit,gem_id=240898$/m);
  assert.match(text,/^wrists=,id=237834,bonus_id=8790\/8960,stats=103str,crafted_stats=49\/40$/m);
  // The same ring twice: each copy keeps its own gem, matched on its bonus IDs.
  assert.match(text,/^finger1=.*bonus_id=6652\/12843.*gem_id=240983$/m);
  assert.match(text,/^finger2=.*bonus_id=6652\/12844.*gem_id=240900$/m);
  const p=parseProfile(text);
  assert.equal(p.info.spec,'fury');assert.equal(p.info.class,'warrior');assert.deepEqual(p.version,{patch:'12.1.0',build:'69933'});
  assert.equal(p.gear.head.enchantId,8017);assert.ok(p.gear.wrist);
  assert.throws(()=>profileFromReport('<html></html>',{region:'eu',realm:'x'}),/no character profile/);
  assert.equal(itemLinks(report).length,5);
});

test('Crest Planner leaves Armory items alone: their stats would not grow with the upgrade',()=>{
  const track={id:1,name:'Hero',levels:[1,2,3].map(l=>({level:l,max:3,bonusId:100+l,itemLevel:300+l,cost:[{currencyId:3,amount:10}]}))};
  const season={tracks:[track],crests:{}};const catalog={items:new Map()};
  const profile={gear:{head:{id:1,value:',id=1,bonus_id=101'},neck:{id:2,value:',id=2,bonus_id=101,stats=100sta'}}};
  const {items}=buildCrestCandidates(profile,'',{affordable:false},season,catalog);
  assert.deepEqual(items.map(i=>i.slot),['head']);
  assert.throws(()=>buildCrestCandidates({gear:{neck:profile.gear.neck}},'',{affordable:false},season,catalog),/needs the \/simc addon export/);
});

test('an addon export without a readable specialization is refused with a way out',()=>{
  assert.throws(()=>parseProfile('warrior="Roburevolved"\nlevel=90\nspec=unknown\nhead=,id=271456\n'),/spec=unknown.*\/reload/);
});
