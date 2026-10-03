import test from 'node:test';
import assert from 'node:assert/strict';
import {healthAt,readMdtDungeon,readMdtRoutes,readReplays,attachBosses,routeFromReplay,routeFromMdt,routeLines,pullLengths,lustPlan,trialRoute,finishRoute,routeResult,replayHasRoute} from '../lib/mplus.mjs';

const dungeonText=`local _, MDT = ...
local dungeonIndex = 900
MDT.mapInfo[dungeonIndex] = { englishName = "Test Hold", mapID = 1 };
MDT.dungeonTotalCount[dungeonIndex] = { normal = 100 }
MDT.dungeonEnemies[dungeonIndex] = {
  [1] = { ["name"] = "Grunt", ["id"] = 1, ["count"] = 5, ["health"] = 1000, ["clones"] = { [1] = { ["x"] = 10, ["y"] = -10, ["g"] = 1 }, [2] = { ["x"] = 12, ["y"] = -10, ["g"] = 1 } } },
  [2] = { ["name"] = "Brute", ["id"] = 2, ["count"] = 7, ["health"] = 2000, ["clones"] = { [1] = { ["x"] = 100, ["y"] = -50 } } },
  [3] = { ["name"] = "King Gorr", ["id"] = 3, ["count"] = 0, ["health"] = 10000, ["isBoss"] = true, ["encounterID"] = 77, ["clones"] = { [1] = { ["x"] = 200, ["y"] = -50 } } },
  [4] = { ["name"] = "Gorr's Pet", ["id"] = 4, ["count"] = 0, ["health"] = 3000, ["isBoss"] = true, ["encounterID"] = 77, ["clones"] = { [1] = { ["x"] = 210, ["y"] = -55 } } },
  [5] = { ["name"] = "Rare Thing", ["id"] = 5, ["count"] = 0, ["health"] = 500, ["isBoss"] = true, ["clones"] = { [1] = { ["x"] = 50, ["y"] = -50 } } },
}
`;
const dungeon=()=>{const d=readMdtDungeon(dungeonText);attachBosses(d,[{id:77,name:'Gorr, The Old King'}]);return d;};

test('health follows MDT’s keystone scaling',()=>{
  assert.equal(healthAt(1000,2,false),1070);
  // +14: Fortified 1.2 × 1.07^9 × 1.1^4, rounded to 3.23 as MDT does
  assert.equal(healthAt(3645228,14,false),Math.round(3.23*3645228));
  assert.equal(healthAt(1000,10,true),Math.round(Math.round(1.25*1.07**9*100)/100*1000));
});

test('an MDT dungeon file and its bosses are read',()=>{
  const d=dungeon();
  assert.equal(d.index,900);assert.equal(d.name,'Test Hold');assert.equal(d.total,100);
  assert.equal(d.enemies.length,5);
  // Matched by a shared name word; the pet stands beside the boss and joins it; the rare has no encounter.
  assert.deepEqual(d.bosses,[{journal:77,name:'Gorr, The Old King',enemies:[3,4]}]);
  assert.equal(d.enemies[4].journal,null);
});

test('routes come from MDT saved variables, and missing bosses are placed by position',()=>{
  const routes=readMdtRoutes(`MythicDungeonToolsDB = { ["global"] = { ["presets"] = { [900] = { { ["text"] = "Empty", ["value"] = { ["pulls"] = { { ["color"] = "fff" } } } }, { ["text"] = "Mine", ["value"] = { ["pulls"] = { { [1] = { 1, 2 }, ["color"] = "fff" }, { [2] = { 1 } } } } } } } } }`);
  assert.deepEqual([...routes.keys()],[900]);
  const [r]=routes.get(900);assert.equal(r.name,'Mine');
  const route=routeFromMdt(dungeon(),r);
  assert.deepEqual(route.pulls.map(p=>p.boss??p.mobs.length),[2,1,77]);
  assert.equal(route.pulls[2].mobs.length,2);
});

test('a Raider.IO replay becomes pulls; merged kills are split into whole mobs',()=>{
  const text=`local _, ns = ...
ns.REPLAYS = { { ["dungeon"] = { ["name"] = "Test Hold", ["short_name"] = "TH" }, ["keystone_run_id"] = 5, ["mythic_level"] = 12, ["clear_time_ms"] = 300000, ["date"] = "2026-09-21T17:07:18Z",
  ["encounters"] = { { ["journal_encounter_id"] = 77, ["ordinal"] = 0 } },
  ["events"] = { { 10000, 1, 1 }, { 30000, 2, 5 }, { 35000, 2, 10 }, { 80000, 2, 7 }, { 100000, 3, 0, 1, true, false }, { 200000, 4, 0, 1, false, true } } } }`;
  const [replay]=readReplays(text);
  assert.equal(replay.id,'rio-5');assert.equal(replay.deaths.length,1);
  assert.deepEqual(replay.bosses[0],{journal:77,ordinal:0,start:100,end:200,killed:true});
  assert.ok(replayHasRoute(replay,40));assert.ok(!replayHasRoute(replay,100));
  const route=routeFromReplay(dungeon(),replay);
  assert.deepEqual(route.pulls.map(p=>[p.mobs.map(m=>m.name).join('+'),p.end]),[['Grunt+Grunt+Grunt',35],['Brute',80],['King Gorr+Gorr\'s Pet',200]]);
  assert.equal(route.pulls[2].start,100);
});

test('pull lines, lengths and Bloodlust',()=>{
  const route={pulls:[{mobs:[{name:"Gorr's Pet",health:1000,boss:true,journal:77}],boss:77},{mobs:[{name:'Grunt',health:1000,boss:false}]}],level:2,share:0.5,shares:[0.5,0.25],delays:[0,12.34],lust:[true,false]};
  assert.deepEqual(routeLines(route),['raid_events+=/pull,pull=01,bloodlust=1,delay=0,enemies=BOSS_Gorr_s_Pet:535','raid_events+=/pull,pull=02,bloodlust=0,delay=12.3,enemies=Grunt:268']);
  assert.deepEqual(pullLengths('<td>Pull 2 (35.8): Grunt</td> Pull 1 (12.5): x Pull 2 (35.8)'),[12.5,35.8]);
  assert.deepEqual(lustPlan([0,300,620,900,1300]),[true,false,true,false,true]);
});

test('a run paces the route: each boss at its own length, trash in the time left',()=>{
  const d=dungeon();
  const route={pulls:[{mobs:[{name:'Grunt',health:1000,boss:false}],end:60},{boss:77,mobs:[{name:'King Gorr',health:10000,boss:true,journal:77}],start:100,end:200}],
    level:12,source:'replay',routeId:'rio-5',gap:10,lust:true,shareSet:0.25,pace:{mode:'replay',run:'rio-5',level:12,clearTime:300,bosses:[{journal:77,length:100,killed:true}]}};
  const trial=trialRoute(route);
  assert.equal(trial.share,0.25);assert.deepEqual(trial.lust,[true,false]);
  // At the trial share the boss took 50 s and the trash 40 s; the run took 100 s on the boss and had
  // 300 - 100 - 2×10 = 180 s for trash.
  const done=finishRoute(route,trial,[40,50]);
  assert.equal(done.shares[1],0.5);assert.equal(done.shares[0],Math.min(1,0.25*180/40));
  // The boss starts where it was pulled in the run.
  const trashEnd=done.delays[0]+done.expected.lengths[0];
  assert.equal(done.delays[1],Math.max(0,100-trashEnd));
  const result=routeResult(done,[60,100],320);
  assert.equal(result.pulls.length,2);assert.equal(result.combat,160);
  assert.ok(result.pulls[1].boss&&result.pulls[1].share===0.5);
  assert.ok(d);
});
