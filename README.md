# SimC Lab

A SimulationCraft workbench for Windows and Linux: Quick Sim, Enchant Lab, Gear Compare, an Upgrade Finder for every raid, dungeon, vault, delve and crafted source, a Crest Planner that says which equipped item to upgrade first, a Great Vault sim that says which vault choice to take, Weapon Lab and Trinket Lab tier lists for every specialization, Talent Search, and tank simulation that ranks damage and survival. Everything is simulated on your own PC, and the SimCLab addon brings the results into World of Warcraft.

**Download:** [SimC-Lab-Setup.exe](https://github.com/Roburmaster/simc-lab/releases/latest/download/SimC-Lab-Setup.exe) (Windows 10/11, 64-bit) · [SimC-Lab.AppImage](https://github.com/Roburmaster/simc-lab/releases/latest/download/SimC-Lab.AppImage) or [simc-lab_amd64.deb](https://github.com/Roburmaster/simc-lab/releases/latest/download/simc-lab_amd64.deb) (Linux, 64-bit) · [all releases](https://github.com/Roburmaster/simc-lab/releases) · [mythicpersona.com/simc-lab](https://mythicpersona.com/simc-lab)

The installer is not code-signed yet, so Windows SmartScreen may warn on first install: choose More info, then Run anyway. On first start, press Install SimC.

On Linux, make the AppImage executable (`chmod +x SimC-Lab.AppImage`) or install the .deb (`sudo apt install ./simc-lab_amd64.deb`). SimC is built from source there, so install the build tools first: `sudo apt install git cmake build-essential libcurl4-openssl-dev`, and make sure the `en_US.UTF-8` locale exists (`sudo locale-gen en_US.UTF-8`); SimC writes its HTML reports under it. The Armory import needs a Blizzard API client of your own there (`SIMC_LAB_BLIZZARD_API_KEY=clientid:secret` from develop.battle.net), since only the official Windows builds carry SimC's key.

For development, run `npm run install-engine` once and then `npm start` (http://127.0.0.1:8642), or double-click Start-SimC-Lab.cmd.

## Using the app

1. Type /simc in WoW and paste the complete addon export, or open **Import from the Armory** and enter region, realm and name (a worldofwarcraft.com, Raider.IO or Warcraft Logs character link works too).
2. Click Import character.
3. Choose Quick Sim, Enchant Lab, Gear Compare, Upgrade Finder, Crest Planner, Great Vault, or Talent Search.
4. Set fight style, duration, target count, iterations and target error, then run the simulation.

Weapon Lab and Trinket Lab are the exceptions: they rank weapons and trinkets for every specialization on SimulationCraft's own reference characters, so they run without an import.

**Armory imports.** The installed SimC engine downloads the character through its own Blizzard API access in one short run, and the app rewrites the result into the addon export's shape: gems, enchants and crafted stats by ID (read from the report's item links, since SimC's profile writer turns an Armory character's gems into stat strings), and the Armory's item stats kept, as SimC uses them for catalyzed items. The Armory shows the gear from the character's last logout and has no bags, Great Vault or crests, so Crest Planner skips its items. An Armory character is marked as such and is never sent to the WoW addon, by hand or automatically: the game has its own, fresher copy.

All application text is English. Profiles and results remain on your PC.

## Midnight-only choices

Gear, gems, enchants and consumables offered as new choices must be explicitly tagged as Midnight (expansion 11) in the cached public client-data catalog. There is no older-expansion toggle or item-ID cutoff. The backend also validates manual comparison variants.

The catalog currently contains 3,521 current-expansion equippable items supported by the engine, 105 permanent enchants and 75 gems. Data is pinned to WoW 12.1.0.69814 and a content hash. Unknown provenance is rejected. Older items reissued in current-season dungeons are excluded from the item browser and Gear Compare. Upgrade Finder, Weapon Lab and Trinket Lab are the exceptions: they offer them only through the active season's own raid and Mythic+ loot tables (see below).

Your actual imported baseline is preserved, including existing older gear. You can test a Midnight enchant or gem on an existing item without replacing the item's other properties. Existing old gems or enchants may remain unchanged in the baseline; they cannot be selected as new alternatives.

Enchant Lab compares one change at a time or all selected combinations. Gear Compare supports imported bag/vault choices, saved talents, a Midnight item browser, and replacing gems in existing imported sockets. The item browser uses base item data unless you specify item level. For exact upgrades and crafted variants, use complete addon item lines containing the correct bonus IDs. Creating new sockets and automatic gear-set optimization are not included.

## Upgrade Finder

Upgrade Finder searches the active season's loot and simulates what each item would do for your character. Choose any combination of sources, each with its own upgrade track and level:

- Raid: every boss (and trash drops) of the season's raids, selectable per boss, by difficulty (Raid Finder, Normal, Heroic, Mythic map to the last four upgrade tracks). Each boss drops at its own item level: boss sequence n uses level n of the track, trash uses the first level, and the last bosses use the top track's final drop level (item level 344 on Mythic) when the engine data defines one; otherwise level 4. Drops keep their default bonus list, which carries effects such as Venomcursed and jewelry sockets. An optional upgrade raises drops to a chosen level but never lowers them. An all-slot token gives each piece at the level of the boss whose own token drops that slot. Mythic item levels were checked against a Raidbots Droptimizer report; the final-boss level on lower difficulties is not verified.
- Mythic+: every dungeon in the current rotation, selectable per dungeon, including reissued older dungeons.
- Great Vault: raid, dungeon and world rows, each with its own track. Vault rows use all bosses and dungeons, without trash drops.
- Delves: the season's delve loot table.
- Crafted: epic profession gear at a chosen item level. A piece with open secondary stats is tried in every legal pair (or just the one you pick), and the results keep the best pair of each piece; a piece with fixed stats is tried as it is.

The season is read from the pinned client data: its bonus-roll group names the raid encounters and Mythic+ dungeons, and its upgrade tracks (Adventurer to Myth) supply the bonus IDs SimC uses to set item level. No instance, item or bonus ID is hardcoded. Reissued older-expansion items are accepted only when they appear in the active season's raid or Mythic+ loot tables; delve and crafted items must be current expansion.

Candidates are filtered for your class and specialization: allowed classes, loot specialization, armor type, weapon proficiency, shields and primary stat. Each item is placed in every slot it fits. Rings and trinkets are tried in both slots, and a unique-equipped item never goes next to its own copy. Weapons are compared like for like with what you wield: a two-hander replaces a two-hander, and a one-hander replaces a one-hander. Titan's Grip allows both. Your enchant carries over, and existing gems carry over into sockets the new item already has. Vault sockets are not added.

**Embellishments.** Each crafted piece is tried plain and with every embellishment its crafting slots accept (all by default; the list can be narrowed). The reagents, their bonus IDs and their equip limits come from the pinned client data: an embellishment adds its effect and a limit marker, and SimC reads both from the bonus IDs. The limit is counted on everything you wear, including items born embellished such as Loa Worshiper's Band: at most two embellished items, and one of each engineering tinker. A candidate that would break a limit next to the gear that stays is left out, so with two embellishments equipped, only the slots that hold one can take another. Because the limit only binds when two are chosen, a third round simulates the best embellished upgrades from the final round in every pair that can be worn together.

Results can be filtered by slot: pick Neck, Rings or Main hand and every item measured for that slot is listed — the upgrades, the ones that were no better, and the ones screening cut — so "why is this item not here?" has an answer on the page. The unfiltered lists are unchanged.

Each scenario runs in two SimC profileset runs. Screening simulates every candidate with at most 2,000 iterations and a 0.5% target error. Candidates whose screened DPS could beat the current gear within the combined uncertainty then go to a final round with your iteration and target-error settings. The final round takes up to 24, 48 or 96 items, with a quota per slot; every stat pair of a crafted piece that could win goes on with it. A slot where nothing won still lists the best item measured for it, so a slot that was tried and lost does not look like one that was never searched. Results show the best upgrade per boss, dungeon or source, every measured upgrade, and screening results that were not simulated again. Screening-only numbers are labelled. A finished search also has its own **upgrade report** page: the character, the gear you wear slot by slot with the best upgrade for each, the best item per boss and dungeon, every final-round upgrade and the embellishment pairs. Like the weapon tier list it has no script of its own, so it can be opened from the app or downloaded as one HTML file and sent on. A search is limited to 800 candidates. Some crafted pieces require the matching profession to equip, and the data does not say which ones.

## Great Vault

Great Vault answers "which vault choice do I take?", as Raidbots does. The official SimulationCraft addon exports the vault's item choices in a `### Weekly Reward Choices` section, but only while the vault has rewards to claim: after the weekly reset, open the Great Vault in the game, type /simc and import that export. Every choice is simulated in its slot against the equipped gear in one SimC profileset run per scenario at your simulation settings. Rings and trinkets are tried in both slots and weapons in both hands where that is legal, and the better placement is shown. The enchant and the gems of the item a choice replaces carry over into it. A two-hander replaces a main hand and off-hand together; an off-hand that cannot be worn next to the equipped two-hander is listed as not simulated. Optionally, each choice below the top of its upgrade track is also simulated fully upgraded. The vault from an Armory import is never available: the Armory has no vault.

## Crest Planner

Crest Planner answers "which item do I upgrade first?", as Raidbots does with its upgrade-currency option. Every equipped item on one of the season's upgrade tracks (Adventurer to Myth) is simulated at each higher level of its own track — or only fully upgraded, if you choose — in one SimC profileset run per scenario at your simulation settings. Enchants and gems stay as they are; only the track's bonus ID changes. Items outside the season's tracks (crafted gear, older seasons, item level overrides) are listed as not upgradeable.

Costs come from the pinned upgrade data: each level costs its track's crests (Adventurer, Veteran, Champion, Hero and Myth Mistcrest in Midnight Season 2). The official SimulationCraft addon's export carries three comment lines that the app reads:

- `upgrade_currencies`: the crests you have. They fill the "Crests to spend" fields; lower them to keep some back.
- `slot_high_watermarks`: the highest item level each slot has held, for the character and the warband. An upgrade to an item level at or below it costs no crests, as in the game.
- `upgrade_achievements`: the warband crest achievements. The warband's high watermark counts only for a crest whose achievement is done.

Without these lines, costs assume no discount and the crest fields are left for you to fill in.

By default only the upgrades your crests to spend pay for are simulated: an item is taken up level by level until the next level costs more than you have of its crest, and "Highest level only" then means the highest level you can afford. If nothing is affordable, the app says what the cheapest upgrade needs. Untick "Only upgrades these crests pay for" to simulate every level to the top of each track.

The result is a spending order within those crests: it repeatedly takes the upgrade with the most DPS (or tank score) per crest that the remaining crests pay for, and may skip a level when the one after pays better. Changing the crest numbers on the result recomputes the order without simulating again. Gains in different slots are treated as adding up, which is close but not exact for stats with diminishing returns. A table lists every measured upgrade by value per crest, with the crests any slot discount waived.

## WoW addon (SimCLab)

SimC Lab ships a World of Warcraft addon, SimCLab (`addon/SimCLab`), and installs it for you. It shows your sims in the game:

- **Results window** (`/simclab`): the latest sims per character and specialization, with scenario, date, baseline DPS and the top upgrades, talent builds (click to copy the talent string) or Gear Compare variants. A sim is marked **stale** as soon as your equipped gear no longer matches the gear it was simulated with (another item, another upgrade level, enchant or gems); hover the warning to see which slots changed.
- **Gear farm** (`/simclab farm`): the positive results of the latest Upgrade Finder sim, grouped by source (raid boss, dungeon, Great Vault row, delves, crafted) and ranked by gain, with a checklist of what is still missing. Items in your bags or equipped at the simulated item level count as done; tick others by hand. The farm for the instance or boss on display also appears beside the Encounter Journal, and entering a dungeon or raid with something to farm shows a short notice.
- **Item tooltips**: "SimC Lab: +2.31% (Myth 1/6, Heroic Ula'tek)" on every item in your results for the logged-in character and specialization, matched on item ID and the upgrade track and level read from the item's bonus IDs, or its item level. Tanks see the DPS and survival score. A result from another upgrade level is labelled as such.
- **Great Vault and loot rolls**: when the vault or a group loot roll shows items from your results, the best choice gets a green border and every known item its simulated gain. Upgrades in a loot roll are also announced in chat.

Each feature can be switched off with `/simclab tooltip|entrance|journal|vault|loot off`.

**Installing and updating.** Open **WoW addon** in the app. It finds the AddOns folder through the same registry entry that supplies your WoW build (or `SIMC_LAB_WOW_DIR`, pointing at a `_retail_` folder) and shows the installed and shipped addon versions. One button decides whether the addon is installed at all:

- **Install addon** puts the copy that ships inside the app into `InterfaceAddOnsSimCLab` and turns automatic updates on. From then on, whenever SimC Lab updates itself and ships a newer addon, the addon is updated when the app starts. **Reinstall** writes the shipped copy again, and **Update to x.y.z** installs a waiting update without restarting.
- **Remove addon** (two clicks, since it deletes files in the game folder) removes the files SimC Lab wrote, including `Data.lua`, and stops the app installing it again. Files you put in the addon folder yourself are kept, and so is everything the game saved outside AddOns, including the addon's SavedVariables and your sims in the app.

SimC Lab writes only inside `InterfaceAddOnsSimCLab`, never touches other addons, writes every file as a temporary file followed by a rename, and refuses to write if the SimCLab folder is a link to another location.

**The addon updates on its own.** A fix for the game should not need a new app, so the addon has its own release channel. SimC Lab looks for it on GitHub when it starts (and on **Check now** in the panel), and installs it when it is newer than both the installed addon and the copy inside the app. What it downloads is one `addon.json`: the addon's version, the Data.lua schema it understands, and every file with its SHA-256 and its text. Nothing is installed unless the manifest is whole — the right addon, the same data schema this app writes, paths inside the addon folder with known extensions, a TOC version that matches the manifest, and a checksum that matches every file. The switch **Look for addon updates on GitHub** turns the whole thing off; then only the copy that came with the app is used.

**Sending results.** Upgrade Finder, Talent Search and Gear Compare results have a **Send to WoW** button, and the WoW addon panel can send them automatically after every finished job. The app keeps what was sent in `%LOCALAPPDATA%SimC Labwowstore.json` and regenerates `Data.lua` from it: data is keyed by character-realm and specialization, and the last 5 sims per key are kept (1–10, configurable). Then type `/reload` in the game: addons have no network or file access, so `Data.lua` is read only at login or `/reload`.

**Data format.** `Data.lua` assigns one Lua table to the addon's private namespace. It carries `schemaVersion` (currently 1), which the addon checks before using anything; a newer or older schema is refused with a message, and entries of the wrong shape are dropped rather than trusted. The table holds the generation time, the app version, the upgrade tracks by bonus ID, and per character and specialization the sims: mode, date, SimC and WoW versions, settings (iterations, target error, duration, season, tank preset), the baseline gear, and per scenario the baseline DPS and the results with item ID, bonus IDs, slot, item level, gain, score, error, and sources with journal instance and encounter IDs. Every string is escaped for Lua (quotes, backslashes, control characters as three-digit escapes), and names are shown with WoW's markup escaped. The file is capped at 1.5 MB: the oldest sims are dropped first, and each scenario keeps at most 60 item results or 20 builds or variants.

**Characters straight from the game.** The Character panel has a **Characters from WoW** dropdown beside the field you can still paste into. It is always there once World of Warcraft is found, and says what is missing while it is empty. It lists the characters the addon captured, newest first, and loading one imports it. The app reads `WTFAccount<account>SavedVariablesSimCLab.lua` on every start and keeps looking while it is open, so a character appears by itself once the game has written it; on a fresh start with nothing pasted, the newest character is loaded for you.

The addon captures the export shortly after login and again after gear, specialization and talent changes, waiting for combat to end — not only at logout, where half the API is already on its way out. The game itself writes SavedVariables at logout and `/reload`, so that is when a character reaches the app; `/simclab capture` stores it immediately, followed by `/reload`.

The export comes from the official SimulationCraft addon when it is installed and enabled, because that addon is the reference and is updated with every patch. Without it, SimCLab writes the export itself (`addon/SimCLab/Export.lua`): the same format, with gear, enchants, gems, bonus IDs, crafted stats and crafting quality, talents and Omnium talents, saved loadouts, professions and bag items, ending in the same checksum. That format's authors released their addon into the public domain (the Unlicense), and this is SimC Lab's own implementation of it. The dropdown says which of the two wrote each character, and when neither could, the app shows what the game reported instead of leaving the character out. The SavedVariables file is parsed as data only, never executed, and the profile goes through the normal import checks. Turn the capture off with `/simclab capture off`.

**MPCombat.** SimCLab stands alone and has no dependencies. It does not integrate with MPCombat; that could be offered later as an optional extra on MPCombat's side.
## Weapon Lab

Weapon Lab answers which weapon, off-hand, shield or held item a specialization should chase, as one tier list per specialization. It needs no character import: each specialization is carried by SimulationCraft's own reference profile, taken from the newest season folder in the installed engine that has one, with its stored action list dropped so every candidate uses the engine's current default rotation. Healing specializations are the exception, below. Reference profiles may use a few engine options an addon export never has, such as a starting resource or the time of day; those are accepted only from the engine folder, never from a pasted import.

The candidates are the weapons in the active season's loot tables — the same pool as Upgrade Finder, including reissued older dungeon and raid items — filtered for the specialization exactly as Upgrade Finder filters them, and placed like for like with what the reference profile wields: a two-hander replaces a two-hander, a shield replaces a shield, and an off-hand candidate needs an equipped off-hand. Titan's Grip allows both. Categories can be narrowed to main hand, off-hand weapons, shields and held items.

Every candidate is pinned to one upgrade track and level, so the ranking measures the weapon and not where it dropped. The reference profile's weapon enchant carries over, and existing gems carry over into sockets the new item already has. The reference character's own weapon stays as the profileset baseline and is reported with the results.

Crafted weapons and shields carry no secondary stats of their own. Without a chosen pair they lose several percent of their damage — measured at 2.6 to 3.7% on a crafted two-hander — and rank far below what they are worth, so they get one. Before its weapons are simulated, each specialization's stat weights are read — SimC's scale factors for Critical Strike, Haste, Mastery and Versatility on the reference character, in the same fight — and every crafted weapon of that specialization carries the pair, among those you select (all six by default), whose two weights add up highest. All crafted weapons of a specialization therefore wear the same stats and differ only in the weapon itself; letting each item keep whichever pair simulated best gave identical weapons different stats and ranks by chance. If the weights cannot be read, the pair the reference profile's own crafted gear wears is used, and the list says so. Dropped weapons keep the stats they drop with.

Each hand is ranked on its own. What the reference profile happens to wield in the other hand decides how much a swap is worth — a Fury Warrior whose main hand is item level 344 and off hand 331 gains from every off-hand swap and loses from every main-hand one — so a single list across both hands would rank the hands rather than the weapons. Main hand and off hand therefore get a list each, and each hand gets its own share of the final round.

Each specialization runs on its own. A list no longer than the final round size is simulated once with your iteration and target-error settings; a longer one is screened first at up to 2,000 iterations and a 0.5% target error, and the best 12, 24 or 48 go on to the full round. Screening-only numbers are labelled. Tank specializations are ranked on the same weighted DPS and survival score as the rest of the app, with a boss calibrated once for each of them, so shields can be judged on more than damage.

Tiers measure the distance behind the best weapon of the same specialization: S under 0.5, A under 1.5, B under 3, C under 5, then D — in percent of DPS, or in score points for tanks. Weapons within the combined 95% uncertainty of the best one are marked as such. Absolute numbers are comparable within a specialization only; reference profiles are built by different authors and are not a class ranking.

**Item sets.** A weapon can be one piece of an item set whose other piece the reference character already wears. It then brings the set bonus with it, and every other weapon in the same hand loses it. In Midnight Season 2, fourteen reference profiles wear Zul'jin's Guillotine Technique, which with Maze'roa or Aman'muso forms the Bite of Zul'jan 2-set; the bonus alone put Maze'roa 7% ahead of every other Fury Warrior main hand and left the rest in D. Such weapons are found from SimulationCraft's own set data, marked with the set and the piece they pair with, and still ranked where they simulated. Their lead is shown as what it is, and the tiers of the rest of the hand are measured from the best weapon without a set bonus.

**When SimulationCraft has no profile.** Its authors rebuild the season profiles one specialization at a time, and some are left a season behind — in Midnight Season 2 that is Balance Druid, Guardian Druid, Devastation Evoker and Augmentation Evoker, which have no profile at all (Augmentation never had one). Rather than rank this season's weapons on last season's character, SimC Lab carries one of its own for each of them, in `profiles/`. Each is a `.json` naming the guide it was built from, the pages and the date it was read, and a `.simc` generated from it by `node scripts/build-profiles.mjs`.

**Augmentation.** Most of what an Augmentation Evoker does lands in its allies' damage: Ebon Might lends them its primary stat, and Prescience and its other buffs raise what they deal. Its own damage is about a quarter of what it adds, so ranking weapons on it would undervalue everything that feeds the buffs. A lone Augmentation in SimulationCraft gets simplified allies to buff, so Augmentation is ranked on the whole raid's damage instead (`profileset_metric=raid_dps`), with its own damage shown beside it. One more run per scenario has it stand idle, so the allies lose every buff. The raid's drop is what Augmentation adds, about 220,000 DPS on the reference character, of which about 60,000 is its own, and the tiers are percent of that rather than of the raid.

Nothing in that data is taken on its word. The generator looks every item up in the pinned catalog: it must exist, be from the current expansion — or be reissued in the active season's own raid or Mythic+ tables, the same exception Upgrade Finder has — and fit the slot it was listed under. Gems must be current gems. An enchant named by its item is matched back to our own enchant and raised to its highest rank, which is what the season profiles wear. Crafted pieces are written the way SimulationCraft writes them, at the crafting cap rather than on a raid track. An item level that means nothing in the game data, or that sits below the cap of the second-highest track, is treated as a slip in the guide and replaced with what the season data gives — three such slips were caught when these were first built. The talents have to decode and pass the same legality check as an imported build.

These profiles say plainly that they are ours, in the app and on the tier list page, and they stand down on their own: the loader reaches for one only where the engine has no profile for the newest season, so an engine update replaces it without anyone doing anything.

The reference profiles are otherwise SimulationCraft's own, generated from `profiles/generators/` in the engine: a gear set its authors assemble per specialization under stated rules (set pieces, raid, Mythic+, delve, PvP and crafted gear each up to their item level cap, sockets in the usual slots, gem and enchant IDs, no tertiary stats). Every result names the character it was measured on, with the item level its gear actually landed on, read from SimC's own report. A specialization SimulationCraft has not rebuilt for the current season keeps the previous season's character — tens of item levels below the rest — and is marked as such wherever it appears: its own order holds, but its numbers do not belong beside another specialization's.

**Healers.** SimulationCraft cannot simulate healing, and five of the seven healing specializations it cannot run at all, so their weapons are not simulated. SimC reads each weapon's stats instead — one run for every healer weapon, each carried by a Restoration Shaman, which can hold every kind a healer wields — at the level its source gives, with the same sources, stat pairs and equal-footing option as the rest. Intellect is measured as what the carrier gained over an unarmed one, because a main-hand weapon gives more than its item line lists (a 334 staff lists 650 and gives 839). A score then ranks the weapons, with a slider for how much of it is healing (70% by default; the rest is damage):

- **Healing** uses QE Live's published stat weights for the chosen content, Mythic+ or Raid, entered by hand in `profiles/healers/weights.json` with the commit and date they were read. Preservation Evoker has one set per hero tree and is scored on their mean. QE Live's repository carries no licence, so only these numbers are used, never its code.
- **Damage** is our own model: a healer's damage scales with intellect, and with crit, haste and versatility each as a multiplier of its own; mastery adds nothing, since every healing mastery works on healing alone. A rating point is weighed against an intellect point at the stats of SimulationCraft's own Shadow Priest, the season's caster character, with rating conversions read from the carriers.

A score is the share of that whole character the weapon carries, so the tiers read as for damage: percent of throughput behind the best weapon of the same hand. Healers get three lists — two-hand, one-hand and off hand — and a line saying whether the best two-hander or the best one-hand and off-hand pair is ahead. Equip and use effects are in neither score, which is said wherever the lists appear; Wowhead's tooltip shows them.

**The tier list page.** A finished job offers one page holding every class and specialization it covered, each hand separately, with each weapon in its tier, where it drops, the stat pair a crafted item was ranked at, and a link to Wowhead that shows the item's tooltip on hover. Open it in the app or save it and send it on: everything but that tooltip script is in the file, so it reads the same from a folder as it does from the app.

## Trinket Lab

Trinket Lab finds the best two trinkets for each specialization. Players wear two trinkets, so the ranking is of pairs: SimulationCraft's own reference character (SimC Lab's own where SimulationCraft has none), with both of its trinkets taken off, wears two of the season's trinkets at once, each at the item level its own source can give it (Equal item level shows every trinket at every level instead). Pairing every trinket with every other is far too many runs, so the pairs are found in stages. Each trinket is first measured alone, the other slot empty, against the character wearing none: that isolated value is a diagnostic and the pruning pass, and it gives each trinket its item level curve. The best trinkets, everything close behind the cutoff and the best on-use trinkets form the pair pool; every legal pair in it is screened, the best pairs run at full precision, and pairs still statistically tied with the best run once more at high precision. The same trinket is never paired with itself, equip limits count the rest of the gear, two on-use trinkets are tried in both slot orders, and trinkets that roll a stat or have a mode are simulated once per choice. Two other models answer narrower questions: single trinkets with the other slot empty, and single trinkets beside a stat stick (a versatility-only trinket in the second slot, for the baseline too), which measures every trinket with the same stats around it at this app's realistic item levels. Each scenario is ranked on its own: raid single target, movement and cleave, Mythic+ small and large pulls at their own short length, a dungeon route, and Casting Patchwerk. Tanks show damage and survival apart. Every job records the SimC commit, WoW build, profile, talents and the full construction of every trinket, so a result can be reproduced. A debug mode reruns Bloodmallet's own experiment (a versatility stat stick in the second slot, Casting Patchwerk, 60,000 iterations) to explain a difference from Bloodmallet; it is a comparison, not the ranking, and it only claims parity when the SimC commit matches. Healing specializations are left out: SimulationCraft cannot simulate healing, and a trinket is mostly its effect, which no stat score can value.

The candidates are every trinket in the active season's loot tables — raid, Mythic+ (reissued older dungeon trinkets included, through the season's own tables), delves and crafting — filtered for the specialization as Upgrade Finder filters them. Each is simulated at every chosen item level, the top of an upgrade track (Champion, Hero and Myth by default), below the level its own source can give it, and then at that level: a delve or dungeon trinket stops at the top of the Hero track, a raid trinket reaches the Myth track and a last boss's its own higher drop level, and a crafted trinket its crafting cap. Source limits are set as in Weapon Lab. The Great Vault is on by default: it gives Mythic+ loot on the Myth track, above the dungeon chest's Hero track, so a dungeon trinket runs up to the vault's level (Myth 6/6 unless you choose another) and the chest's level stays one of its steps. Crafted trinkets have no track; their level is chosen from the item levels the season uses, up to the crafting cap SimulationCraft's own profiles craft to. Equal footing shows every trinket at every level instead. The bar for a trinket is what it adds over no trinket, split at each level; its tier is read at its top level, with the same thresholds as Weapon Lab.

A specialization with more trinkets than the final round size (16, 32 or 64; 64 covers every list in Midnight Season 2) is screened first, one run per trinket at its top level, and the best go on to be simulated at every level; the rest keep their screened number and no curve. Tanks are ranked on the weighted DPS and survival score with a calibrated boss each, and Augmentation on the raid's damage against its measured share, as in Weapon Lab. A trinket that completes an item set with the reference gear — Zul'jin's Guillotine Technique beside Maze'roa — is simulated twice and listed twice: with the set's bonus, as that character would wear it, and with the bonus switched off (`set_bonus=bite_of_zuljan_2pc=0`), the trinket alone. The rest are measured from the best trinket without a set bonus. A full season list is about 2,700 trinket and item level runs per scenario, with the vault on.

**Fight style and targets.** Trinket Lab simulates the fight style chosen under the run settings, and **Also compare 3 and 5 targets** runs every specialization at 1, 3 and 5 targets in that style — AoE trinkets move a lot between them.

**The tier list page.** A finished job offers one page in the design of mythicpersona.com's weapon tier list, with its fonts inside the file: every class and specialization, each trinket in its tier with its split bar, source, item level and Wowhead tooltip, and the gain at every level in the row's data so the website can import it. When the job ran 1, 3 and 5 targets, tabs at the top switch between them, with no script. Two trinkets together are not the sum of their bars; the page says so.

## Mythic+ route (experimental, made by AI)

> **Experimental and made by AI.** This fight style was written by an AI assistant (Claude) and has not yet been checked against Mythic+ combat logs. Use it to compare choices on the same route; do not read its DPS or run time as what a real run will give.

The fight style **Mythic+ route** simulates a whole dungeon of the current season, pull by pull, with SimulationCraft's DungeonRoute. Everything it needs is read from addons on your PC at run time; nothing is shipped with the app:

- **Mythic Dungeon Tools**: every enemy's health, enemy forces and bosses, and the routes you have saved. Health at a keystone level uses MDT's own formula (checked against a +14 combat log to within 0.1%).
- **Raider.IO**: the replays of your own recent runs — when every mob died and when every boss was pulled and killed.

Choose a dungeon, a keystone level and a route (one of your runs, or an MDT route), then the group's pace:

- **As fast as one of your runs.** SimC simulates only you, so each mob gets your share of its health. Every boss you killed gets the share that makes it last as long as it did in that run; the trash gets the share that fills the rest of the run's time after walking to every pull. Two short measuring runs come first, the second with Bloodlust where the first placed it.
- **A share of the group's damage** that you set.

Bloodlust goes on the first pull and again on the first pull after it is ready. **Every season dungeon** runs all of them at once, each on your latest run. The result shows the simulated run time beside yours, your share of the group's damage on bosses and on trash, and every pull with its health, length and your DPS. Gear Compare, Enchant Lab, Talent Search and Upgrade Finder all work on a route; each row also shows the run time.

Known limits: boss mechanics, movement, deaths and crowd control are not simulated, so the simulated player is better than a real one and the measured share comes out high. Time saved assumes the whole group speeds up with you, so it overstates what one player's gain is worth. Raider.IO adds up mobs that die together and leaves out mobs worth no forces; some replays keep too few kills to rebuild a route (they still set the pace), and an incomplete replay can pace a route badly. Tank simulation, Weapon Lab and Trinket Lab do not use this fight style.

## Tank simulation

Protection Warrior, Protection Paladin, Blood Death Knight, Guardian Druid, Brewmaster Monk and Vengeance Demon Hunter are detected on import. Every mode (Quick Sim, Enchant Lab, Gear Compare, Upgrade Finder, Crest Planner, Great Vault and Talent Search) then ranks results on DPS and survival.

**Tank Sim** has its own place in the menu: the imported tank against a boss and its adds, one simulation per fight you tick (the boss alone, the boss with 2 adds, the boss with 4 adds), with the numbers a tank cares about: damage taken per second and as a share of your health, healing and absorbs, how much of the fight you survive, how often you die, and your DPS. It needs a tank specialization. Tank Sim is a page of its own and is kept apart from the other simulations: its fights, fight style, duration, iterations, target error, CPU threads, raid buffs and consumables, boss and gear sources are all on the page, and the settings column the other modes share is not used. It can also **find gear** from three sources you switch on or off: the gear from your bags (read from the addon export, with the equipped gear always the baseline), upgrades with crests (each equipped item at every higher level of its track, within the crests you have), and loot from instances (Upgrade Finder's raid, Mythic+, Great Vault, delve and crafted sources, kept as a separate copy of its settings). Every candidate from all three is simulated in its slot in each fight you ticked and the best ones again at full precision, ranked on the survival and damage score. Each fight in the result shows what your current gear takes per second, how much of the fight it survives and how often it dies, then the gear that does better for that fight. With all three off it runs the fights alone.

SimC's built-in tank dummy uses level-70 damage values and never threatens a Midnight tank, and SimC gives players infinite health by default. SimC Lab replaces it with a calibrated boss, tuned once per job against the imported gear and then shared by every variant and scenario:

- Sustained damage: melee swings plus a magic damage-over-time effect, scaled until the imported gear takes the chosen share of its maximum health per second after its own mitigation.
- Tank-busters: a heavy melee hit every 30 seconds. SimC does not time defensive cooldowns to incoming busters, so a fixed buster size either kills a spec every time or never. The buster is therefore resized until the imported gear dies in the chosen share of fights (25% by default). Better gear can then survive more often, worse gear less often.
- Healing: healers top the tank up to full health on a fixed rhythm (every 5 seconds by default). Tanks can die (`infinite_health=0`).

- Adds: every target beyond the first is a mob that attacks the tank (Targets 3 or 5, or the "compare 3 and 5 targets" box), each with an auto attack of 40% of the boss's swing (adjustable under Boss details, "Each add hits for"). The boss is still calibrated alone, so calibration is the same for one target and for five, and the adds then add their damage on top: more targets means more damage taken and a higher chance to die, and armor, avoidance and self-healing are worth what they are against a pack, not against one hit. The adds stand and swing for the whole fight, and the tank's own damage cleaves them. SimC's own adds (Hectic Add Cleave, Dungeon Slice) are pets that never attack, and Dungeon Slice, Mythic+ route and the Silvermoon dummies have no incoming damage at all, so those fight styles are off for a tank; use Patchwerk, Casting Patchwerk or the movement styles with more targets. Weapon Lab and Trinket Lab keep the single-boss fight they always had.

Presets are Mythic+ dungeon (3% health per second, 45% starting buster), Heroic raid (4%, 50%) and Mythic raid (5%, 55%), all adjustable under Boss details. The job result states the calibrated boss and how often the current gear died during calibration.

Survival is the sum of two percentages: the reduction in net damage taken (damage taken minus the tank's own healing, relative to the boss's sustained damage), and the change in the share of the fight survived. Absorbs are already removed from damage taken. Score = weight × survival + (1 − weight) × DPS change, with the weight set by a slider (50% by default). Upgrade Finder screens and selects finalists by score.

Limits: this is a model, not a recorded boss. Stamina matters through death risk, which changes sharply once a buster can exceed a smaller health pool, so large survival swings are expected when health drops. Survived time is noisy; use at least 10,000 iterations before acting on small differences. Fight styles other than Patchwerk keep their own raid events and adds. Patchwerk is written without `fight_style=` in tank mode because that style clears raid events, including the healer.

## Automatic Talent Search

Import a level 90 character, choose Talent Search, and set a budget of 16, 32, 64 or 128 candidates. Search the spec tree, spec and hero trees, or all three trees. Lock selected talent nodes to preserve their current rank and choice.

The system starts from the imported build and, optionally, legal saved builds and current SimC reference builds. It generates choice-node switches and rank reallocations, checks legality, simulates the candidates, and ranks them for each selected combat scenario. Imported gear and Omnium talents are held constant. All candidates, including the baseline, use SimC's default rotation so a fixed imported action list does not bias the comparison.

Validation covers specialization, prerequisites, point gates, rank limits, level requirements, choice nodes, hero-tree selection, source-data availability and level 90 point budgets (34 class, 34 spec, 13 purchased hero points plus granted talents). Invalid or inconsistent source builds are rejected. Some SimC reference profiles intentionally omit utility points or use overrides; these are not accepted as legal seeds. If an imported build cannot be validated against the current tree data, the app explains the problem instead of simulating invented talent combinations.

The search is bounded and deterministic. It is not exhaustive, adaptive across simulation rounds, or a guarantee of the global optimum. Results expose the best measured build per scenario, its changes, and a copyable in-game talent export. Increase precision before acting on small differences. Short test runs are not gearing recommendations.

## Results and local operation

Results include DPS, differences from baseline, approximate 95% confidence intervals, actual SimC input and downloadable HTML/JSON reports. The History tab persists completed jobs across server restarts. Unfinished jobs are marked interrupted after a restart.

Jobs run sequentially with configurable CPU threads. There is no cap on how much a job may simulate — enchant combinations, alternatives, Upgrade Finder candidates, Crest Planner upgrades, and Weapon Lab and Trinket Lab lists all run in full, however long that takes on your PC; the count before you start says how many runs it will be. Up to 5 jobs can be queued or running at once. Active and queued jobs can be cancelled. Files are stored in runs/; the import field is also remembered in browser localStorage.

The server listens only on 127.0.0.1, verifies Host and POST tokens, rejects file/network/output directives in profile imports, and launches SimC without a shell. The compiled engine has networking disabled.

## Desktop app and updates

SimC Lab installs as a normal Windows program (desktop/). The installer adds Start menu and desktop shortcuts, needs no administrator rights and opens the app in its own window. The engine, game data, runs and logs live in %LOCALAPPDATA%\SimC Lab, so updating or uninstalling the app keeps them.

On Linux the same app ships as an AppImage and a .deb. Its data lives in `~/.local/share/simc-lab` (`$XDG_DATA_HOME/simc-lab`). SimC has no official Linux builds, so Update SimC always builds from source with the system's Git, CMake, C++ compiler and libcurl (with networking, for the Armory import); a missing tool is named with the apt command rather than installed. WoW is found in the usual Wine prefixes (Lutris' ~/Games/battlenet, ~/.wine, Steam/Proton and Bottles); set WOW_BUILD_INFO when it is elsewhere. The AppImage updates itself like the Windows app; the .deb is updated by installing the next one.

**Update SimC** (sidebar, engine panel, or the install screen on first start) does everything in one step:

1. It reads the installed WoW build, the newest SimC source commit, the newest official nightly Windows build and the live Raidbots game data.
2. When the nightly build matches your WoW build, it is downloaded (about 120 MB) and unpacked with Windows' own tar. The few source files the app reads (item, bonus, enchant and talent data and build_info.txt) are downloaded for the same commit.
3. When only the newest source matches, SimC is built from source instead. Missing Git, CMake or Visual Studio C++ Build Tools are installed with winget (Windows asks for permission), and the first build takes 20–40 minutes. Advanced › Build from source forces this path.
4. The new engine must report the expected version before it is used. Game data for the same WoW build is then downloaded, and engine and data switch together. Nothing changes when SimC or the game data has not caught up with WoW yet.

The app itself updates through electron-updater: it checks at start and every six hours, downloads a new version in the background and offers Restart and update in the engine panel.

### Releasing

GitHub CI and releases never install or compile SimC. The app installs it locally on the user's PC.

1. Raise the version in package.json, desktop/package.json, package-lock.json (`npm install --package-lock-only`) and the addon's `## Version` in addon/SimCLab/SimCLab.toc, and merge that change to main. The app, the desktop shell and the addon carry the same version, so an installed addon is updated whenever the app is; a test fails if one of them drifts.
2. Create the matching tag: `git tag v1.2.3 && git push origin v1.2.3`.
3. The Release workflow checks that the tag matches package.json, runs the standalone app and addon tests with `npm run test:ci`, builds the installer and, after the owner approves the release environment, publishes SimC-Lab-Setup.exe, its blockmap and latest.yml to GitHub Releases. A Linux job builds SimC-Lab.AppImage, simc-lab_amd64.deb and latest-linux.yml first, and the approved job publishes them in the same release.

**Releasing the addon alone.** Raise `## Version` in `addon/SimCLab/SimCLab.toc`, merge, then tag `addon-v1.2.3`. The Addon release workflow checks the tag against the TOC, runs the tests, packs the addon (`node scripts/pack-addon.mjs`) and, after the same approval, publishes `addon.json` and `SimCLab-addon.zip`. No installer is built, and installed apps pick the addon up on their next start. The addon's version is its own; the app, the desktop shell and the lockfile share theirs.

Installed apps read latest.yml from the newest GitHub release. The installer keeps the fixed name SimC-Lab-Setup.exe, so /releases/latest/download/SimC-Lab-Setup.exe always serves the newest version. `cd desktop && node build.mjs` builds locally without publishing; with SIMC_LAB_UPDATE_URL and SIMC_LAB_DIST set, it makes a test build that updates from a folder served by serve-release.mjs.

For development, `npm start` still runs the server from the project folder with the original source checkout and CMake build, and `cd desktop && npm start` opens the same code in the desktop window.

## Engine and data updates

The installed engine was built from simulationcraft/simc midnight commit 1e832c0849acc32d2218d2a260f02dc768770b0a: SimulationCraft 1210-01, WoW Live 12.1.0.69814, hotfix 2026-09-16/69814.

Stop the server before updating. From this directory:

    powershell -ExecutionPolicy Bypass -File scripts/build-engine.ps1 -Update
    node scripts/refresh-data.mjs
    npm start

Requirements: Node.js 22+, Git, CMake, Visual Studio 2026 C++ tools and Windows SDK. No npm package installation is required for the app; the tests need `npm ci` once for the Lua parser and Lua VM. The build and data refresh both reject mismatching live builds. Restart after updating. Data refresh caches immutable content-hash URLs from Raidbots; profiles are never sent to that service.

The default WoW build file is C:\Program Files (x86)\World of Warcraft\.build.info. Set WOW_BUILD_INFO for a different location. If the local installation cannot be read, the interface reports the version as unknown; a readable addon version is still checked.

## Tests

    npm ci
    npm test
    node tests/integration.mjs
    node tests/upgrade-integration.mjs
    node scripts/build-profiles.mjs
    node tests/weapon-integration.mjs
    node tests/tank-integration.mjs
    node tests/english-browser.cjs

Integration and browser tests require the running server and built engine. Browser tests use Microsoft Edge and Playwright from the local Codex runtime; adjust the import path on another machine. Tests create example jobs in History. They cover profile parsing, expansion rejection, legal talent generation, point budgets, locks, exports, actual simulations, cancellation, reports and responsive English UI.

The WoW addon has its own tests in `npm test`: the Data.lua writer (escaping, a round trip through a Lua 5.1 parser and a real Lua VM, size limits), installation into a temporary AddOns folder (other addons untouched, links refused), the SavedVariables reader, and the addon itself. `tests/addon/check-lua51.mjs` parses every file in the addon's TOC as Lua 5.1, and `tests/addon/world.mjs` loads the addon into a Lua VM (wasmoon) on top of a WoW API mock (`tests/addon/wowmock.lua`) to drive tooltips, stale marking, the farm, the Encounter Journal and entrance panels, the Great Vault, loot rolls and the SimulationCraft capture.

## Sources

SimulationCraft source and licenses: https://github.com/simulationcraft/simc (local license files: vendor/simc/).
Healer stat weights: QE Live, https://questionablyepic.com/live ( https://github.com/Voulk/QuestionablyEpic ); the numbers only, entered by hand, see profiles/healers/weights.json.
Public client-data metadata and talent connections: https://www.raidbots.com/developers . The exact cached build, generation date, content hash and file checksums are in data/upstream/metadata.json.

This is an independent local app, not an official Raidbots or Blizzard product. It does not include cloud workers, a full gear-set optimizer that combines several new items at once, or a guarantee that every new game effect is modeled perfectly by SimC.

## Raid buffs and consumables

All simulation modes share an environment panel. Optimal raid buffs and No external buffs set all supported raid overrides; individual buffs and target debuffs can then be customized. A character can still cast its own buffs when an external override is disabled. Bloodlust can trigger on pull, after a delay, near the end, or below a target health percentage. Fight length variation is configurable from 0–50%.

Food, flasks, potions, augment runes and weapon treatments use the pinned Midnight catalog. From profile / SimC preserves each variant’s configuration; None disables a category; a specific selection overrides every variant. Add as Gear Compare variant resets that global selection to From profile / SimC, allowing a meaningful comparison. Result details and downloaded inputs retain the environment used.

This is not full Raidbots feature parity: crest and catalyst budgeting, combined multi-item gear sets, graphical talent tree editing and external Power Infusion scheduling are not implemented.

## Item tooltips and gear categories

Gear Compare groups equipment into Weapons, Armor, Jewelry & cloak, and Trinkets, with a separate Saved talent builds section. Equipped items remain visible beside imported alternatives. Search results are selectable item cards; equipment dropdowns use matching category headings. Gear, gems, enchant items and consumable cards link to Wowhead with hover tooltips. Imported bonus IDs, gems, enchant IDs and explicit item levels are forwarded as documented tooltip parameters. Tooltips require an internet connection and use the official Wowhead script (https://www.wowhead.com/tooltips); simulation execution remains local.

## License

SimC Lab is free software under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE). Copyright © Roburmaster.

SimulationCraft is a separate program, GPL-3.0, by its own authors (https://github.com/simulationcraft/simc). SimC Lab does not include it: the app downloads the official build or builds it from source on your PC and runs it as a separate process. Game data is public client data from Raidbots (https://www.raidbots.com/developers). Item tooltips use Wowhead. World of Warcraft is a trademark of Blizzard Entertainment; this project is not affiliated with Blizzard, SimulationCraft, Raidbots or Wowhead.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security problems privately as described in [SECURITY.md](SECURITY.md).
