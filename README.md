# SimC Lab

A SimulationCraft workbench for Windows: Quick Sim, Enchant Lab, Gear Compare, an Upgrade Finder for every raid, dungeon, vault, delve and crafted source, Talent Search, and tank simulation that ranks damage and survival. Everything is simulated on your own PC, and the SimCLab addon brings the results into World of Warcraft.

**Download:** [SimC-Lab-Setup.exe](https://github.com/Roburmaster/simc-lab/releases/latest/download/SimC-Lab-Setup.exe) (Windows 10/11, 64-bit) · [all releases](https://github.com/Roburmaster/simc-lab/releases) · [mythicpersona.com/simc-lab](https://mythicpersona.com/simc-lab)

The installer is not code-signed yet, so Windows SmartScreen may warn on first install: choose More info, then Run anyway. On first start, press Install SimC.

For development, run `npm run install-engine` once and then `npm start` (http://127.0.0.1:8642), or double-click Start-SimC-Lab.cmd.

## Using the app

1. Type /simc in WoW and paste the complete addon export.
2. Click Import character.
3. Choose Quick Sim, Enchant Lab, Gear Compare, Upgrade Finder, or Talent Search.
4. Set fight style, duration, target count, iterations and target error, then run the simulation.

All application text is English. Profiles and results remain on your PC.

## Midnight-only choices

Gear, gems, enchants and consumables offered as new choices must be explicitly tagged as Midnight (expansion 11) in the cached public client-data catalog. There is no older-expansion toggle or item-ID cutoff. The backend also validates manual comparison variants.

The catalog currently contains 3,521 current-expansion equippable items supported by the engine, 105 permanent enchants and 75 gems. Data is pinned to WoW 12.1.0.69814 and a content hash. Unknown provenance is rejected. Older items reissued in current-season dungeons are excluded from the item browser and Gear Compare. Upgrade Finder is the one exception: it offers them only through the active season's own raid and Mythic+ loot tables (see below).

Your actual imported baseline is preserved, including existing older gear. You can test a Midnight enchant or gem on an existing item without replacing the item's other properties. Existing old gems or enchants may remain unchanged in the baseline; they cannot be selected as new alternatives.

Enchant Lab compares one change at a time or all selected combinations. Gear Compare supports imported bag/vault choices, saved talents, a Midnight item browser, and replacing gems in existing imported sockets. The item browser uses base item data unless you specify item level. For exact upgrades and crafted variants, use complete addon item lines containing the correct bonus IDs. Creating new sockets and automatic gear-set optimization are not included.

## Upgrade Finder

Upgrade Finder searches the active season's loot and simulates what each item would do for your character. Choose any combination of sources, each with its own upgrade track and level:

- Raid: every boss (and trash drops) of the season's raids, selectable per boss, by difficulty (Raid Finder, Normal, Heroic, Mythic map to the last four upgrade tracks). Each boss drops at its own item level: boss sequence n uses level n of the track, trash uses the first level, and the last bosses use the top track's final drop level (item level 344 on Mythic) when the engine data defines one; otherwise level 4. Drops keep their default bonus list, which carries effects such as Venomcursed and jewelry sockets. An optional upgrade raises drops to a chosen level but never lowers them. An all-slot token gives each piece at the level of the boss whose own token drops that slot. Mythic item levels were checked against a Raidbots Droptimizer report; the final-boss level on lower difficulties is not verified.
- Mythic+: every dungeon in the current rotation, selectable per dungeon, including reissued older dungeons.
- Great Vault: raid, dungeon and world rows, each with its own track. Vault rows use all bosses and dungeons, without trash drops.
- Delves: the season's delve loot table.
- Crafted: epic profession gear at a chosen item level with a chosen pair of secondary stats.

The season is read from the pinned client data: its bonus-roll group names the raid encounters and Mythic+ dungeons, and its upgrade tracks (Adventurer to Myth) supply the bonus IDs SimC uses to set item level. No instance, item or bonus ID is hardcoded. Reissued older-expansion items are accepted only when they appear in the active season's raid or Mythic+ loot tables; delve and crafted items must be current expansion.

Candidates are filtered for your class and specialization: allowed classes, loot specialization, armor type, weapon proficiency, shields and primary stat. Each item is placed in every slot it fits. Rings and trinkets are tried in both slots, and a unique-equipped item never goes next to its own copy. Weapons are compared like for like with what you wield: a two-hander replaces a two-hander, and a one-hander replaces a one-hander. Titan's Grip allows both. Your enchant carries over, and existing gems carry over into sockets the new item already has. Vault sockets and embellishments are not added.

Each scenario runs in two SimC profileset runs. Screening simulates every candidate with at most 2,000 iterations and a 0.5% target error. Candidates whose screened DPS could beat the current gear within the combined uncertainty then go to a final round with your iteration and target-error settings. The final round takes up to 24, 48 or 96 candidates, with a quota per slot. Results show the best upgrade per boss, dungeon or source, every measured upgrade, and screening results that were not simulated again. Screening-only numbers are labelled. A search is limited to 800 candidates. Some crafted pieces require the matching profession to equip, and the data does not say which ones.

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

**Sending results.** Upgrade Finder, Talent Search and Gear Compare results have a **Send to WoW** button, and the WoW addon panel can send them automatically after every finished job. The app keeps what was sent in `%LOCALAPPDATA%SimC Labwowstore.json` and regenerates `Data.lua` from it: data is keyed by character-realm and specialization, and the last 5 sims per key are kept (1–10, configurable). Then type `/reload` in the game: addons have no network or file access, so `Data.lua` is read only at login or `/reload`.

**Data format.** `Data.lua` assigns one Lua table to the addon's private namespace. It carries `schemaVersion` (currently 1), which the addon checks before using anything; a newer or older schema is refused with a message, and entries of the wrong shape are dropped rather than trusted. The table holds the generation time, the app version, the upgrade tracks by bonus ID, and per character and specialization the sims: mode, date, SimC and WoW versions, settings (iterations, target error, duration, season, tank preset), the baseline gear, and per scenario the baseline DPS and the results with item ID, bonus IDs, slot, item level, gain, score, error, and sources with journal instance and encounter IDs. Every string is escaped for Lua (quotes, backslashes, control characters as three-digit escapes), and names are shown with WoW's markup escaped. The file is capped at 1.5 MB: the oldest sims are dropped first, and each scenario keeps at most 60 item results or 20 builds or variants.

**Import without copy-paste.** With the official SimulationCraft addon installed, SimCLab stores that addon's own `/simc` export in its SavedVariables at every logout and `/reload` (or right away with `/simclab capture`, followed by `/reload`). **Import from WoW** in the Character panel reads it from `WTFAccount<account>SavedVariablesSimCLab.lua` and verifies the export's checksum. SimCLab deliberately does not build its own export: the SimulationCraft addon is updated with every patch for new gear, talent, upgrade and crafting systems, and a second exporter would drift from it. The SavedVariables file is parsed as data only, never executed, and the profile goes through the normal import checks. Turn the capture off with `/simclab capture off`.

**MPCombat.** SimCLab stands alone and has no dependencies. It does not integrate with MPCombat; that could be offered later as an optional extra on MPCombat's side.

## Tank simulation

Protection Warrior, Protection Paladin, Blood Death Knight, Guardian Druid, Brewmaster Monk and Vengeance Demon Hunter are detected on import. Every mode (Quick Sim, Enchant Lab, Gear Compare, Upgrade Finder and Talent Search) then ranks results on DPS and survival.

SimC's built-in tank dummy uses level-70 damage values and never threatens a Midnight tank, and SimC gives players infinite health by default. SimC Lab replaces it with a calibrated boss, tuned once per job against the imported gear and then shared by every variant and scenario:

- Sustained damage: melee swings plus a magic damage-over-time effect, scaled until the imported gear takes the chosen share of its maximum health per second after its own mitigation.
- Tank-busters: a heavy melee hit every 30 seconds. SimC does not time defensive cooldowns to incoming busters, so a fixed buster size either kills a spec every time or never. The buster is therefore resized until the imported gear dies in the chosen share of fights (25% by default). Better gear can then survive more often, worse gear less often.
- Healing: healers top the tank up to full health on a fixed rhythm (every 5 seconds by default). Tanks can die (`infinite_health=0`).

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

Jobs run sequentially with configurable CPU threads. Limits are 128 alternative builds, 256 runs per job (Upgrade Finder: 800 candidates, two profileset runs per scenario) and 5 queued/running jobs. Active and queued jobs can be cancelled. Files are stored in runs/; the import field is also remembered in browser localStorage.

The server listens only on 127.0.0.1, verifies Host and POST tokens, rejects file/network/output directives in profile imports, and launches SimC without a shell. The compiled engine has networking disabled.

## Desktop app and updates

SimC Lab installs as a normal Windows program (desktop/). The installer adds Start menu and desktop shortcuts, needs no administrator rights and opens the app in its own window. The engine, game data, runs and logs live in %LOCALAPPDATA%\SimC Lab, so updating or uninstalling the app keeps them.

**Update SimC** (sidebar, engine panel, or the install screen on first start) does everything in one step:

1. It reads the installed WoW build, the newest SimC source commit, the newest official nightly Windows build and the live Raidbots game data.
2. When the nightly build matches your WoW build, it is downloaded (about 120 MB) and unpacked with Windows' own tar. The few source files the app reads (item, bonus, enchant and talent data and build_info.txt) are downloaded for the same commit.
3. When only the newest source matches, SimC is built from source instead. Missing Git, CMake or Visual Studio C++ Build Tools are installed with winget (Windows asks for permission), and the first build takes 20–40 minutes. Advanced › Build from source forces this path.
4. The new engine must report the expected version before it is used. Game data for the same WoW build is then downloaded, and engine and data switch together. Nothing changes when SimC or the game data has not caught up with WoW yet.

The app itself updates through electron-updater: it checks at start and every six hours, downloads a new version in the background and offers Restart and update in the engine panel.

### Releasing

GitHub CI and releases never install or compile SimC. The app installs it locally on the user's PC.

1. Raise `version` in package.json and merge that change to main.
2. Create the matching tag: `git tag v1.2.3 && git push origin v1.2.3`.
3. The Release workflow checks that the tag matches package.json, runs the standalone app and addon tests with `npm run test:ci`, builds the installer and, after the owner approves the release environment, publishes SimC-Lab-Setup.exe, its blockmap and latest.yml to GitHub Releases.

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
    node tests/tank-integration.mjs
    node tests/english-browser.cjs

Integration and browser tests require the running server and built engine. Browser tests use Microsoft Edge and Playwright from the local Codex runtime; adjust the import path on another machine. Tests create example jobs in History. They cover profile parsing, expansion rejection, legal talent generation, point budgets, locks, exports, actual simulations, cancellation, reports and responsive English UI.

The WoW addon has its own tests in `npm test`: the Data.lua writer (escaping, a round trip through a Lua 5.1 parser and a real Lua VM, size limits), installation into a temporary AddOns folder (other addons untouched, links refused), the SavedVariables reader, and the addon itself. `tests/addon/check-lua51.mjs` parses every file in the addon's TOC as Lua 5.1, and `tests/addon/world.mjs` loads the addon into a Lua VM (wasmoon) on top of a WoW API mock (`tests/addon/wowmock.lua`) to drive tooltips, stale marking, the farm, the Encounter Journal and entrance panels, the Great Vault, loot rolls and the SimulationCraft capture.

## Sources

SimulationCraft source and licenses: https://github.com/simulationcraft/simc (local license files: vendor/simc/).
Public client-data metadata and talent connections: https://www.raidbots.com/developers . The exact cached build, generation date, content hash and file checksums are in data/upstream/metadata.json.

This is an independent local app, not an official Raidbots or Blizzard product. It does not include Armory imports, cloud workers, a full gear-set optimizer that combines several new items at once, or a guarantee that every new game effect is modeled perfectly by SimC.

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
