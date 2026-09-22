// The SimCLab WoW addon, run in a real Lua VM against tests/addon/wowmock.lua, fed with a Data.lua written by
// the app's own writer. Covers the 5.1 syntax, validation, tooltips, stale marking, the farm, the journal and
// entrance panels, the Great Vault and loot rolls, and the SimulationCraft capture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {checkAddon,checkSource} from './addon/check-lua51.mjs';
import {world,addonDir} from './addon/world.mjs';
import {identity,simEntry,trackTable,addSim,dataFile} from '../lib/wowdata.mjs';
import {checksumOk} from '../lib/wowaddon.mjs';
import {season,profile,talentData,upgradeJob,request} from './addon/fixture.mjs';

const tracks=trackTable(season);
const plain=s=>String(s).replace(/\|c\w{8}|\|r/g,'');
function dataText(mutate){
  const who=identity(profile,talentData);
  if(mutate)mutate(who);
  return dataFile(addSim({},who,simEntry(upgradeJob(),request,{season,tracks})),{tracks,app:'1.1.0',now:new Date('2026-09-19T15:00:00Z')}).text;
}
// The equipped gear from the fixture profile, as item links.
const equip=`
  __mock.inventory[1] = __mock.link(240001, {12831, 6652}, 8016)
  __mock.inventory[2] = __mock.link(240002, {12841}, nil, {240908})
  __mock.inventory[13] = __mock.link(240003, {12835})
  __mock.inventory[16] = __mock.link(240004, {12840, 42}, 7981)`;

async function loaded(options={}){
  const w=await world({data:options.data??dataText()});
  await w.run(equip);
  await w.login(options.saved);
  return w;
}
const tooltip=(w,call)=>w.lines(`__mock.tooltip(${call})`);
// The label of the mark drawn on a frame, or "-" when it has none showing.
const markOn=(w,frame)=>w.get(`(function() for _, f in ipairs(__mock.frames) do if f.__parent == ${frame} and f.label and f:IsShown() then return f.label:GetText() end end return "-" end)()`).then(plain);

test('every file in the TOC is Lua 5.1, and the folder holds only what the game loads',async()=>{
  const {files,problems}=await checkAddon(addonDir);
  assert.deepEqual(problems,[]);
  assert.deepEqual(files,['Data.lua','Core.lua','Gear.lua','Export.lua','UI/Widgets.lua','UI/Window.lua','UI/Journal.lua','UI/Tooltip.lua','UI/Loot.lua']);
  const onDisk=(await fs.readdir(addonDir,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>path.relative(addonDir,path.join(e.parentPath??e.path,e.name)).replaceAll('\\','/')).sort();
  assert.deepEqual(onDisk,['SimCLab.toc',...files].sort(),'no harnesses, notes or stray files ship with the addon');
  const toc=await fs.readFile(path.join(addonDir,'SimCLab.toc'),'utf8');
  assert.match(toc,/^## Interface: 1201\d\d\r?$/m);assert.match(toc,/^## Version: \d+\.\d+\.\d+\r?$/m);assert.match(toc,/^## SavedVariables: SimCLabDB\r?$/m);
  assert.deepEqual(checkSource('local s = "\\x41"'),['chunk:1: escape not in Lua 5.1: "\\x41"']);
  assert.equal(checkSource('local s = "\\\\x41"').length,0,'an escaped backslash followed by x is fine');
  assert.equal(checkSource('goto done').length,1);
});

test('the shipped empty Data.lua loads cleanly and the window explains what to do',async()=>{
  const w=await world();
  await w.login();
  assert.equal(await w.get('__ns.data.schemaVersion'),1);
  assert.equal(await w.get('__ns.data.simCount'),0);
  await w.run('SlashCmdList.SIMCLAB("")');
  assert.equal(await w.get('SimCLabFrame:IsShown()'),true);
  assert.match(await w.get('SimCLabFrame.empty:GetText()'),/No sims yet/);
  w.close();
});

test('data from another schema version is refused with a clear message',async()=>{
  for(const [version,message] of [[2,/newer SimC Lab/],[0,/older SimC Lab/]]){
    const w=await world({data:dataText().replace('schemaVersion=1','schemaVersion='+version)});
    await w.login();
    assert.equal(await w.get('__ns.data == nil'),true);
    assert.match(await w.get('__ns.problem'),message);
    await w.run('SlashCmdList.SIMCLAB("")');
    assert.match(await w.get('SimCLabFrame.empty:GetText()'),message);
    assert.deepEqual(await tooltip(w,'__mock.link(250001, {6652, 12830})'),[]);
    w.close();
  }
});

test('broken entries are dropped, not trusted',async()=>{
  const text=dataText().replace('gain=3,','gain="3",').replace('encounterId=2895','encounterId="x"');
  const w=await loaded({data:text});
  assert.equal(await w.get('__ns.data.simCount'),1);
  assert.equal(await w.get('__ns.data.characters["temulan-ravencrest"].specs[250].sims[1].scenarios[1].results[1].itemId'),250001,'the result with a string gain is gone');
  assert.equal(await w.get('__ns.data.characters["temulan-ravencrest"].specs[250].sims[1].scenarios[1].results[1].sources[1].encounterId == nil'),true);
  w.close();
});

test('names with quotes, backslashes, newlines and WoW markup arrive intact and display escaped',async()=>{
  const name='Tem"ulan\\\n|cffff0000|Hitem:1|h';
  const w=await loaded({data:dataText(who=>{who.name=name;})});
  assert.equal(await w.get('__ns.data.characters["temulan-ravencrest"].name'),name);
  assert.equal(await w.get('__ns.Plain("a|b")'),'a||b');
  await w.run('SlashCmdList.SIMCLAB("")');
  assert.equal(await w.get('SimCLabFrame.body.title:GetText():find("||cffff0000||Hitem:1||h", 1, true) ~= nil'),true,'pipes are doubled, so the markup shows as text');
  w.close();
});

test('tooltips show the simulated gain with track and source, matched on bonus IDs or item level',async()=>{
  const w=await loaded();
  assert.deepEqual((await tooltip(w,'__mock.link(250001, {6652, 12830})')).map(plain),["SimC Lab: +2.00% (Hero 1/6, Heroic Ula'tek)",'  Patchwerk, 5 targets: +1.90%']);
  // Same upgrade level, other bonus IDs (a socket): still a match.
  assert.equal(plain((await tooltip(w,'__mock.link(250001, {12830, 4786})'))[0]),"SimC Lab: +2.00% (Hero 1/6, Heroic Ula'tek)");
  // Same item level without a known track bonus.
  await w.run('__mock.itemLevels[__mock.link(250002, {99999})] = 292');
  assert.equal(plain((await tooltip(w,'__mock.link(250002, {99999})'))[0]),'SimC Lab: +3.00% (Myth 2/6, Altar of Fangs)');
  // Another level: the nearest result, labelled as simulated elsewhere.
  assert.equal(plain((await tooltip(w,'__mock.link(250001, {12835})'))[0]),"SimC Lab: +2.00% at Hero 1/6 (Heroic Ula'tek)");
  // A loss, a screening-only gain, and an unknown item.
  assert.match((await tooltip(w,'__mock.link(250003, {12830})'))[0],/\|cfff5756b-0\.50%\|r/);
  assert.match((await tooltip(w,'__mock.link(250005, {12835})')).map(plain).join('\n'),/within the error, screening only|screening only/);
  assert.deepEqual(await tooltip(w,'__mock.link(999999, {12830})'),[]);
  // Bag items come as a GUID, not a hyperlink.
  await w.run('__mock.guids["Item-1"] = __mock.link(250001, {6652, 12830})');
  assert.equal((await tooltip(w,'nil, { guid = "Item-1" }')).length,2);
  // Secret values are skipped, never read.
  await w.run('__mock.secrets["secret-link"] = true');
  assert.deepEqual(await tooltip(w,'nil, { hyperlink = "secret-link" }'),[]);
  await w.run('SlashCmdList.SIMCLAB("tooltip off")');
  assert.deepEqual(await tooltip(w,'__mock.link(250001, {6652, 12830})'),[]);
  w.close();
});

test('tooltips follow the specialization and the character',async()=>{
  const w=await loaded();
  await w.run('__mock.player.specs[2] = {251, "Frost"} __mock.player.specIndex = 2 __mock.event("PLAYER_SPECIALIZATION_CHANGED", "player")');
  assert.deepEqual(await tooltip(w,'__mock.link(250001, {6652, 12830})'),[]);
  w.close();
  const other=await world({data:dataText()});
  await other.run('__mock.player.name = "Someoneelse"');
  await other.login();
  assert.deepEqual(await tooltip(other,'__mock.link(250001, {6652, 12830})'),[]);
  other.close();
  // GetRealmName with spaces and apostrophes still finds the export's tokenized realm.
  const spaced=await world({data:dataText(who=>{who.key='temulan-twilightshammer';who.realm='twilights_hammer';})});
  await spaced.run(`__mock.player.realm = "Twilight's Hammer" ${equip}`);
  await spaced.login();
  assert.equal(plain((await tooltip(spaced,'__mock.link(250001, {6652, 12830})'))[0]),"SimC Lab: +2.00% (Hero 1/6, Heroic Ula'tek)");
  spaced.close();
});

test('a sim is stale once the equipped gear differs from its baseline, and says where',async()=>{
  const w=await loaded();
  await w.run('SlashCmdList.SIMCLAB("")');
  assert.match(await w.get('SimCLabFrame.body.stale:GetText()'),/Up to date/);
  assert.equal(await w.get('select(1, __ns.IsStale(__ns.data.characters["temulan-ravencrest"].specs[250].sims[1]))'),false);
  // Upgrade the head piece, add a second trinket, drop the enchant from the weapon.
  await w.run(`__mock.inventory[1] = __mock.link(240001, {12832, 6652}, 8016)
    __mock.inventory[14] = __mock.link(250002, {12841})
    __mock.inventory[16] = __mock.link(240004, {12840, 42})
    __mock.event("PLAYER_EQUIPMENT_CHANGED", 1)`);
  assert.equal(plain(await w.get('SimCLabFrame.body.stale:GetText()')),'STALE: 3 slots changed (Head, Trinket 2, Main hand). Hover for details.');
  assert.deepEqual(await w.lines('SimCLabFrame.body.staleArea.tooltip'),['Gear changed since this sim','Head: upgraded or changed','Trinket 2: newly equipped','Main hand: different enchant','Simulate again in SimC Lab and send the new result to WoW.']);
  assert.match((await tooltip(w,'__mock.link(250001, {6652, 12830})')).join('\n'),/stale: gear changed since this sim/);
  w.close();
});

test('the results window lists sims, scenarios and the top upgrades',async()=>{
  const w=await loaded();
  await w.run('SlashCmdList.SIMCLAB("")');
  assert.equal(plain(await w.get('SimCLabFrame.body.title:GetText()')),'Temulan  Blood');
  assert.match(plain(await w.get('SimCLabFrame.body.sim:GetText()')),/^Upgrade Finder  \d\d \w{3} \d\d:\d\d$/);
  assert.equal(await w.get('SimCLabFrame.body.scenario:GetText()'),'Scenario 1/2: Patchwerk, 1 target');
  assert.equal(await w.get('SimCLabFrame.body.baseline:GetText()'),'Current gear: 100,000 DPS ± 100');
  assert.equal(await w.get('SimCLabFrame.body.settings:GetText()'),'Midnight Season 2  ·  10,000 iterations  ·  300 s  ·  SimC 1210-01');
  const rows=async()=>(await w.lines('(function() local t = {} for i, r in ipairs(SimCLabFrame.body.list.items) do t[i] = r.title .. " " .. r.value .. " | " .. r.detail end return t end)()')).map(plain);
  assert.deepEqual(await rows(),[
    'Fang of the Altar +3.00% | Trinket 1  ·  Myth 2/6  ·  Altar of Fangs',
    "Ula'tek's Crown +2.00% | Head  ·  Hero 1/6  ·  Heroic Ula'tek +1",
    'Delver Boots +0.80% | Feet  ·  Hero 6/6  ·  Delves',
    'Coil Pendant -0.50% | Neck  ·  Hero 1/6  ·  Heroic Nek\'zali the Soulcoiler',
  ]);
  await w.run('SimCLabFrame.body.nextScenario:GetScript("OnClick")()');
  assert.equal(await w.get('SimCLabFrame.body.scenario:GetText()'),'Scenario 2/2: Patchwerk, 5 targets');
  assert.match(await w.get('SimCLabFrame.body.list.items[1].title'),/Ula'tek's Crown/);
  await w.run('SlashCmdList.SIMCLAB("")');
  assert.equal(await w.get('SimCLabFrame:IsShown()'),false,'the same command closes it again');
  w.close();
});

test('the gear farm groups by source, ranks by gain and keeps a checklist',async()=>{
  const w=await loaded();
  await w.run('SlashCmdList.SIMCLAB("farm")');
  const rows=async()=>(await w.lines('(function() local t = {} for i, r in ipairs(SimCLabFrame.body.list.items) do t[i] = (r.header and "# " or (r.checked and "[x] " or "[ ] ")) .. r.title end return t end)()')).map(plain);
  assert.deepEqual(await rows(),['# Altar of Fangs  Mythic+ dungeon','[ ] Fang of the Altar',"# Heroic Ula'tek  The Venomous Abyss","[ ] Ula'tek's Crown","# Great Vault: Raid  Ula'tek","[ ] Ula'tek's Crown",'# Delves Season 2  Delves','[ ] Delver Boots']);
  assert.equal(plain(await w.get('SimCLabFrame.body.summary:GetText()')),'3 upgrades from 4 sources, 3 still missing');
  // Tick one by hand; the other copy of the same item follows.
  await w.run('SimCLabFrame.body.list.items[4].onCheck(true)');
  assert.deepEqual((await rows()).filter(r=>r.startsWith('[x]')),["[x] Ula'tek's Crown","[x] Ula'tek's Crown"]);
  assert.equal(await w.get('SimCLabDB.checklist["temulan-ravencrest"]["250001:12830"]'),true);
  assert.equal(plain(await w.get('SimCLabFrame.body.summary:GetText()')),'3 upgrades from 4 sources, 2 still missing');
  // An item in the bags at the simulated item level or better counts as owned.
  await w.run('local link = __mock.link(250002, {12842}) __mock.itemLevels[link] = 298 __mock.bags[0] = { link } __mock.event("BAG_UPDATE_DELAYED")');
  assert.equal(plain(await w.get('SimCLabFrame.body.summary:GetText()')),'3 upgrades from 4 sources, 1 still missing');
  await w.run('SimCLabFrame.body.hideDone:SetChecked(true) SimCLabFrame.body.hideDone:GetScript("OnClick")(SimCLabFrame.body.hideDone)');
  assert.deepEqual(await rows(),['# Delves Season 2  Delves','[ ] Delver Boots'],'done items and finished sources are hidden');
  w.close();
});

test('a long item name stays on its own line instead of covering the line below',async()=>{
  const w=await loaded();
  await w.run('SlashCmdList.SIMCLAB("farm")');
  for(const part of ['title','detail','value','valueDetail'])
    assert.equal(await w.get(`SimCLabFrame.body.list.rows[1].${part}.__wrap`),false,`${part} must not wrap inside a fixed row`);
  // The gain column has a width of its own, so a long note is cut there rather than reaching into the name.
  assert.equal(await w.get('SimCLabFrame.body.list.rows[1].value.__width'),84);
  w.close();
});

test('the Encounter Journal shows the farm for the instance and boss on display',async()=>{
  const w=await world({data:dataText()});
  await w.run(`${equip}
    EncounterJournal = __mock.newWidget("Frame", "EncounterJournal")
    function EncounterJournal_DisplayInstance(id) EncounterJournal.instanceID = id end
    function EncounterJournal_DisplayEncounter(id) EncounterJournal.encounterID = id end`);
  await w.login();
  await w.run('__mock.event("ADDON_LOADED", "Blizzard_EncounterJournal") EncounterJournal_DisplayInstance(1320)');
  assert.equal(await w.get('SimCLabJournal:IsShown()'),true);
  assert.equal(plain(await w.get('SimCLabJournal.title:GetText()')),'SimC Lab farm: Instance 1320');
  assert.equal(await w.get('#SimCLabJournal.list.items'),1,'the crown; the pendant is a loss and the vault copy is no journal loot');
  assert.match(await w.get('SimCLabJournal.list.items[1].title'),/Ula'tek's Crown/);
  await w.run('EncounterJournal_DisplayEncounter(2895)');
  assert.equal(plain(await w.get('SimCLabJournal.title:GetText()')),'SimC Lab farm: Encounter 2895');
  await w.run('EncounterJournal_DisplayEncounter(2888)');
  assert.equal(await w.get('SimCLabJournal:IsShown()'),false,"Nek'zali drops nothing worth farming");
  await w.run('EncounterJournal_DisplayInstance(1322)');
  assert.match(await w.get('SimCLabJournal.list.items[1].title'),/Fang of the Altar/);
  await w.run('EncounterJournal:Hide()');
  assert.equal(await w.get('SimCLabJournal:IsShown()'),false);
  w.close();
});

test('entering a dungeon with something to farm shows it once',async()=>{
  const w=await loaded();
  await w.run(`__mock.instance = { inInstance = true, kind = "party", map = 2500, journal = 1322, name = "Altar of Fangs" }
    __mock.event("PLAYER_ENTERING_WORLD") __mock.runTimers()`);
  assert.equal(await w.get('SimCLabEntrance:IsShown()'),true);
  assert.equal(plain(await w.get('SimCLabEntrance.title:GetText()')),'SimC Lab farm: Altar of Fangs');
  assert.equal(plain(await w.get('SimCLabEntrance.subtitle:GetText()')),'1 upgrade, 1 still missing');
  await w.run('__mock.runTimers(60)');
  assert.equal(await w.get('SimCLabEntrance:IsShown()'),false,'it goes away by itself');
  await w.run('__mock.event("ZONE_CHANGED_NEW_AREA") __mock.runTimers()');
  assert.equal(await w.get('SimCLabEntrance:IsShown()'),false,'once per instance and session');
  await w.run('__mock.instance.journal = 1041 __mock.event("PLAYER_ENTERING_WORLD") __mock.runTimers()');
  assert.equal(await w.get('SimCLabEntrance:IsShown()'),false,"nothing to farm in Kings' Rest");
  w.close();
});

test('the Great Vault marks the best choice among items SimC Lab knows',async()=>{
  const w=await loaded();
  await w.run(`
    WeeklyRewardsFrame = __mock.newWidget("Frame", "WeeklyRewardsFrame")
    WeeklyRewardsFrame.Activities = {}
    for i = 1, 3 do
      local a = __mock.newWidget("Frame", "Activity" .. i, WeeklyRewardsFrame)
      a.ItemFrame = __mock.newWidget("Frame", nil, a)
      a.ItemFrame.displayedItemDBID = "db" .. i
      WeeklyRewardsFrame.Activities[i] = a
    end
    function WeeklyRewardsFrame:Refresh() end
    __mock.weekly.db1 = __mock.link(250001, {6652, 12840})
    __mock.weekly.db2 = __mock.link(250002, {12841})
    __mock.weekly.db3 = __mock.link(777777, {12841})
    __mock.event("ADDON_LOADED", "Blizzard_WeeklyRewards")
    WeeklyRewardsFrame:Refresh()
    __mock.runTimers()`);
  assert.deepEqual([await markOn(w,'Activity1'),await markOn(w,'Activity2'),await markOn(w,'Activity3')],['SimC Lab: +2.00% (other level)','SimC Lab best: +3.00%','-']);
  assert.match(await w.get('(function() for _, f in ipairs(__mock.frames) do if f.__parent == WeeklyRewardsFrame and f.__kind == "FontString" then return f:GetText() end end end)()'),/SimC Lab: take .*item:250002.*\+3\.00%/);
  await w.run('SlashCmdList.SIMCLAB("vault off") WeeklyRewardsFrame:Refresh() __mock.runTimers()');
  assert.deepEqual([await markOn(w,'Activity1'),await markOn(w,'Activity2')],['-','-'],'turned off, the marks go');
  w.close();
});

test('loot rolls get the same highlight and a chat line for upgrades',async()=>{
  const w=await loaded();
  await w.run(`
    __mock.rolls[11] = __mock.link(250003, {12830})
    __mock.rolls[12] = __mock.link(250001, {6652, 12830})
    GroupLootFrame1.rollID = 11 GroupLootFrame1:Show()
    GroupLootFrame2.rollID = 12 GroupLootFrame2:Show()
    __mock.event("START_LOOT_ROLL", 11) __mock.event("START_LOOT_ROLL", 12) __mock.event("START_LOOT_ROLL", 12)
    __mock.runTimers()`);
  assert.equal(await markOn(w,'GroupLootFrame1'),'SimC Lab: -0.50%');
  assert.equal(await markOn(w,'GroupLootFrame2'),'SimC Lab best: +2.00%');
  const printed=await w.lines('__mock.printed');
  assert.equal(printed.length,1,'one line per roll, only for upgrades');
  assert.match(printed[0],/item:250001.*\+2\.00%.*Hero 1\/6, Heroic Ula'tek/);
  await w.run('GroupLootFrame2:Hide() __mock.runTimers()');
  assert.equal(await markOn(w,'GroupLootFrame2'),'-');
  w.close();
});

test('/simclab capture stores the official SimulationCraft export with single pipes, and logout refreshes it',async()=>{
  const w=await loaded();
  await w.run('SlashCmdList.SIMCLAB("capture")');
  assert.match((await w.lines('__mock.printed')).at(-1),/export stored/);
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].source'),'SimCLab','without the other addon, ours writes the export');
  await w.run(`SimulationcraftAPI = { GetSimcProfile = function(self, debug, noBags)
      __captureArgs = tostring(self) .. " " .. tostring(debug) .. " " .. tostring(noBags)
      return 'deathknight="Temulan"\\nhead=,id=1 ||cff||r\\n# Checksum: 1', nil
    end }
    SlashCmdList.SIMCLAB("capture")`);
  assert.equal(await w.get('__captureArgs'),'nil false false');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].text'),'deathknight="Temulan"\nhead=,id=1 |cff|r\n# Checksum: 1');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].spec'),'blood',"SimC's own name for the spec, not the client's translated one");
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].simc'),'12.1.0-03');
  await w.run('SimulationcraftAPI.GetSimcProfile = function() return nil, "Error: You need to pick a spec!" end SimCLabDB.captures = {} __mock.event("PLAYER_LOGOUT")');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].source'),'SimCLab','ours steps in when SimulationCraft refuses');
  await w.run('SimulationcraftAPI.GetSimcProfile = function() error("boom") end __mock.player.specIndex = 0 SlashCmdList.SIMCLAB("capture")');
  assert.match((await w.lines('__mock.printed')).at(-1),/boom.*no specialization/,'with neither export available, both reasons are shown');
  await w.run('__mock.player.specIndex = 1');
  await w.run('SimulationcraftAPI.GetSimcProfile = function() return "x", nil end SimCLabDB.captures = {} SlashCmdList.SIMCLAB("capture off") __mock.event("PLAYER_LOGOUT")');
  assert.equal(await w.get('next(SimCLabDB.captures) == nil'),true,'capture off means no capture at logout');
  w.close();
});

test('saved settings survive, and unknown saved values fall back to defaults',async()=>{
  const w=await loaded({saved:'SimCLabDB = { settings = { tooltip = false, entrance = "yes" }, checklist = { ["temulan-ravencrest"] = { ["250001:12830"] = true } }, captures = 5 }'});
  assert.equal(await w.get('SimCLabDB.settings.tooltip'),false);
  assert.equal(await w.get('SimCLabDB.settings.entrance'),true);
  assert.equal(await w.get('type(SimCLabDB.captures)'),'table');
  assert.equal(await w.get('__ns.IsDone("temulan-ravencrest", { itemId = 250001, track = 12830 })'),true);
  w.close();
});

// ---------------------------------------------------------------------------
// The addon's own /simc export, and how the character reaches the app
// ---------------------------------------------------------------------------

// A link with the type/value pairs and gem bonus IDs the game writes after the bonus list.
const craftedLink=(id,bonuses,pairs,gemBonuses)=>`|cffa335ee|Hitem:${[id,'','','','','','','',90,250,'','',bonuses.length,...bonuses,pairs.length/2,...pairs,0,gemBonuses.length,...gemBonuses].join(':')}|h[Crafted ${id}]|h|r`;

test("the addon writes its own /simc export that the app can import",async()=>{
  const w=await loaded();
  await w.run(`__mock.inventory[11] = "${craftedLink(250009,[6652,12841],[9,80,29,40,30,36],[7777])}"
    __mock.itemLevels[__mock.inventory[1]] = 295
    __mock.bags[0] = { __mock.link(250002, {12841}) }
    __mock.craftedQuality = { ["${craftedLink(250009,[6652,12841],[9,80,29,40,30,36],[7777])}"] = 5 }`);
  const text=await w.get('__ns.BuildProfile()');
  // The header the app reads the game build from, and the identity lines.
  assert.match(text,/^# Temulan - Blood - \d{4}-\d{2}-\d{2} \d{2}:\d{2} - EU\/Ravencrest\n/);
  assert.match(text,/^# WoW 12\.1\.0\.69875, TOC 120100$/m);
  assert.match(text,/^deathknight="Temulan"$/m);
  assert.match(text,/^level=90$/m);assert.match(text,/^race=draenei$/m);assert.match(text,/^region=eu$/m);
  assert.match(text,/^server=ravencrest$/m);assert.match(text,/^spec=blood$/m);assert.match(text,/^role=tank$/m);
  assert.match(text,/^professions=herbalism=9\/enchanting=64$/m);
  assert.match(text,/^talents=CoPAkXBWactive$/m);
  assert.match(text,/^omnium_talents=1234:2\/1235:1$/m);
  assert.match(text,/^# Saved Loadout: M\+ build\n# talents=CoPAkXBWsaved$/m);
  // Equipped gear, with everything the item link carries.
  assert.match(text,/^head=,id=240001,enchant_id=8016,bonus_id=12831\/6652$/m);
  assert.match(text,/^neck=,id=240002,gem_id=240908,bonus_id=12841$/m);
  assert.match(text,/^finger1=,id=250009,bonus_id=6652\/12841,drop_level=80,crafted_stats=40\/36,gem_bonus_id=7777,crafting_quality=5$/m);
  assert.match(text,/^# Item 240001 \(295\)$/m,'the item level goes in the comment above the line');
  // Bag items travel as comments; SimC Lab offers them as Gear Compare alternatives.
  assert.match(text,/^### Gear from Bags$/m);
  assert.match(text,/^# finger1=,id=250002,bonus_id=12841$/m);
  // The app accepts it as a profile, keys it and reads its gear.
  const who=identity(text,talentData);
  assert.equal(who.key,'temulan-ravencrest');assert.equal(who.specId,250);assert.equal(who.region,'eu');
  assert.deepEqual(who.gear.head,{itemId:240001,bonusIds:[12831,6652],enchant:8016});
  assert.equal(checksumOk(text),true,'it carries the same checksum the SimulationCraft addon uses');
  assert.equal(checksumOk(text.replace('level=90','level=80')),false);
  w.close();
});

test('the export falls back to ours only when SimulationCraft cannot deliver',async()=>{
  const w=await loaded();
  await w.run('SlashCmdList.SIMCLAB("capture")');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].source'),'SimCLab');
  assert.equal(await w.get('SimCLabDB.captureStatus.ok'),true);
  assert.match(await w.get('SimCLabDB.captures["temulan-ravencrest"].text'),/deathknight="Temulan"/);
  // With the official addon present, its export wins.
  await w.run(`SimulationcraftAPI = { GetSimcProfile = function() return 'deathknight="Temulan"\\nfrom ||the|| addon', nil end }
    SlashCmdList.SIMCLAB("capture")`);
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].source'),'SimulationCraft addon');
  assert.match(await w.get('SimCLabDB.captures["temulan-ravencrest"].text'),/from \|the\| addon/);
  // When it errors, ours steps in rather than nothing being captured.
  await w.run('SimulationcraftAPI.GetSimcProfile = function() error("boom") end SlashCmdList.SIMCLAB("capture")');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].source'),'SimCLab');
  w.close();
});

test('a character that cannot be exported says why, instead of going missing',async()=>{
  const w=await loaded();
  await w.run('__mock.player.specIndex = 0 __mock.player.specs = {} SlashCmdList.SIMCLAB("capture")');
  assert.equal(await w.get('SimCLabDB.captureStatus.ok'),false);
  assert.match(await w.get('SimCLabDB.captureStatus.reason'),/no specialization/);
  assert.equal(await w.get('next(SimCLabDB.captures) == nil'),true);
  assert.match((await w.lines('__mock.printed')).at(-1),/no specialization/);
  w.close();
});

test('the character is captured shortly after login and after gear and talent changes',async()=>{
  const w=await loaded();
  assert.equal(await w.get('next(SimCLabDB.captures) == nil'),true,'nothing yet right after login');
  await w.run('__mock.runTimers(15)');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"] ~= nil'),true,'captured without logging out');
  const first=await w.get('SimCLabDB.captures["temulan-ravencrest"].time');
  // Several events in a row share one capture, and it waits until combat is over.
  await w.run(`__mock.inventory[1] = __mock.link(240001, {12832, 6652}, 8016)
    __mock.event("PLAYER_EQUIPMENT_CHANGED", 1) __mock.event("PLAYER_EQUIPMENT_CHANGED", 2) __mock.event("TRAIT_CONFIG_UPDATED")
    __mock.combat = true
    InCombatLockdown = function() return __mock.combat end
    __mock.runTimers(30)`);
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].time'),first,'in combat it waits');
  assert.equal(await w.get('__ns.captureAfterCombat'),true);
  await w.run('__mock.combat = false __mock.event("PLAYER_REGEN_ENABLED") __mock.runTimers(10)');
  assert.ok(await w.get('SimCLabDB.captures["temulan-ravencrest"].time')>first,'and catches up once combat ends');
  assert.match(await w.get('SimCLabDB.captures["temulan-ravencrest"].text'),/^head=,id=240001,enchant_id=8016,bonus_id=12832\/6652$/m);
  w.close();
});

test('the export names the specialization even when the client only gives its ID',async()=>{
  const w=await loaded();
  // What the live 12.1.0 client does: the namespaced call answers with the ID and no name.
  await w.run(`C_SpecializationInfo.GetSpecializationInfo = function(index) local s = __mock.player.specs[index] if s then return s[1] end end
    GetSpecializationInfo = nil
    GetSpecializationRole = nil`);
  const text=await w.get('__ns.BuildProfile()');
  assert.match(text,/^spec=blood$/m);
  assert.match(text,/^# Temulan - blood - /m);
  assert.match(text,/^role=tank$/m,'the tank specs are known by ID too');
  assert.match(text,/^# Temulan - blood - /m);
  assert.equal(identity(text,talentData).specId,250);
  // The capture says which spec it is, so the app can label it.
  await w.run('SlashCmdList.SIMCLAB("capture")');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].spec'),'blood');
  // A client in another language hands out a translated name; the ID table keeps spec= English.
  await w.run('__mock.player.specs[1] = {250, "Blod"} C_SpecializationInfo.GetSpecializationInfo = function(i) local s = __mock.player.specs[i] if s then return s[1], s[2] end end');
  assert.match(await w.get('__ns.BuildProfile()'),/^spec=blood$/m);
  await w.run('SlashCmdList.SIMCLAB("capture")');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].spec'),'blood');
  assert.equal(await w.get('SimCLabDB.captures["temulan-ravencrest"].addon'),'1.2.3','the capture says which addon wrote it');
  // A specialization nobody knows is refused, rather than written without a spec line.
  await w.run('__mock.player.specs[1] = {999999, nil} __ns.wipe(SimCLabDB.captures) SlashCmdList.SIMCLAB("capture")');
  assert.match((await w.lines('__mock.printed')).at(-1),/did not say which specialization/);
  assert.equal(await w.get('next(SimCLabDB.captures) == nil'),true);
  w.close();
});

test('every specialization in the game data has a SimC name in the addon',async()=>{
  const w=await world();
  await w.login();
  const specs=JSON.parse(await w.get(`(function()
    local out = {}
    for id, token in pairs(__ns.SPECS) do out[#out + 1] = '"' .. id .. '":"' .. token .. '"' end
    table.sort(out)
    return "{" .. table.concat(out, ",") .. "}"
  end)()`));
  assert.equal(Object.keys(specs).length,40,'thirteen classes, Demon Hunter now with three');
  for(const [id,token] of [[250,'blood'],[72,'fury'],[253,'beast_mastery'],[1480,'devourer'],[1473,'augmentation']])assert.equal(specs[id],token);
  w.close();
});
