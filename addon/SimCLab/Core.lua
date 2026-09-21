-- SimCLab core: validates the data SimC Lab wrote into Data.lua, finds the sims for the logged-in character and
-- specialization, answers "what did SimC Lab say about this item?", and owns the saved settings.
-- The game gives addons no network or file access, so Data.lua (written by the app, read at login or /reload)
-- and SimCLabDB (written by the game at logout or /reload, read by the app) are the only channels.
local addonName, ns = ...

ns.SCHEMA = 1
ns.name = addonName
ns.callbacks = {}

local function wipeTable(t) for k in pairs(t) do t[k] = nil end return t end
ns.wipe = wipeTable

-------------------------------------------------------------------------------
-- Text
-------------------------------------------------------------------------------

-- A pipe starts a WoW markup escape (colours, textures, links). Names come from the app and may hold one.
function ns.Plain(text)
  return (tostring(text or ""):gsub("|", "||"))
end

-- Must match normalizeKey in the app: ASCII letters lowercased, ASCII letters and digits kept, every byte of a
-- multi-byte UTF-8 character kept, everything else dropped.
function ns.NormalizeKey(text)
  text = tostring(text or "")
  local out = {}
  for i = 1, #text do
    local b = text:byte(i)
    if b >= 65 and b <= 90 then
      out[#out + 1] = string.char(b + 32)
    elseif (b >= 97 and b <= 122) or (b >= 48 and b <= 57) or b >= 128 then
      out[#out + 1] = string.char(b)
    end
  end
  return table.concat(out)
end

function ns.CharacterKey(name, realm)
  return ns.NormalizeKey(name) .. "-" .. ns.NormalizeKey(realm)
end

function ns.Thousands(n)
  n = math.floor((tonumber(n) or 0) + 0.5)
  local s = tostring(math.abs(n))
  local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
  if out:sub(1, 1) == "," then out = out:sub(2) end
  return (n < 0 and "-" or "") .. out
end

function ns.Date(unix)
  if type(unix) ~= "number" or unix <= 0 then return "unknown date" end
  return date("%d %b %H:%M", unix)
end

-------------------------------------------------------------------------------
-- Validation. Anything that does not have the expected shape is dropped, never trusted.
-------------------------------------------------------------------------------

local function isNumber(v) return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge end
local function isString(v) return type(v) == "string" end

local function numberList(list)
  if type(list) ~= "table" then return nil end
  local out = {}
  for i = 1, #list do
    if not isNumber(list[i]) then return nil end
    out[i] = list[i]
  end
  return out
end

local function cleanSource(s)
  if type(s) ~= "table" or not isString(s.kind) then return nil end
  return {
    kind = s.kind,
    name = isString(s.name) and s.name or nil,
    label = isString(s.label) and s.label or nil,
    instance = isString(s.instance) and s.instance or nil,
    instanceId = isNumber(s.instanceId) and s.instanceId or nil,
    encounterId = isNumber(s.encounterId) and s.encounterId or nil,
    difficulty = isString(s.difficulty) and s.difficulty or nil,
    row = isString(s.row) and s.row or nil,
  }
end

local function cleanItem(i)
  if type(i) ~= "table" or not isNumber(i.itemId) then return nil end
  return { itemId = i.itemId, slot = isString(i.slot) and i.slot or nil, bonusIds = numberList(i.bonusIds) or {}, itemLevel = isNumber(i.itemLevel) and i.itemLevel or nil }
end

local function cleanResult(r)
  if type(r) ~= "table" or not (isNumber(r.gain) or isNumber(r.score)) then return nil end
  local out = {
    name = isString(r.name) and r.name or nil,
    gain = isNumber(r.gain) and r.gain or nil,
    score = isNumber(r.score) and r.score or nil,
    scoreError = isNumber(r.scoreError) and r.scoreError or nil,
    survival = isNumber(r.survival) and r.survival or nil,
    error = isNumber(r.error) and r.error or nil,
    dps = isNumber(r.dps) and r.dps or nil,
    screening = r.screening == true or nil,
    talents = isString(r.talents) and r.talents or nil,
    slot = isString(r.slot) and r.slot or nil,
    itemLevel = isNumber(r.itemLevel) and r.itemLevel or nil,
    track = isNumber(r.track) and r.track or nil,
    sources = {},
  }
  if r.itemId ~= nil then
    if not isNumber(r.itemId) then return nil end
    out.itemId = r.itemId
    out.bonusIds = numberList(r.bonusIds) or {}
  end
  if type(r.sources) == "table" then
    for _, s in ipairs(r.sources) do out.sources[#out.sources + 1] = cleanSource(s) end
  end
  if type(r.items) == "table" then
    out.items = {}
    for _, i in ipairs(r.items) do out.items[#out.items + 1] = cleanItem(i) end
  end
  return out
end

local function cleanScenario(sc)
  if type(sc) ~= "table" or type(sc.results) ~= "table" then return nil end
  local out = {
    style = isString(sc.style) and sc.style or "Patchwerk",
    targets = isNumber(sc.targets) and sc.targets or 1,
    metric = sc.metric == "score" and "score" or "dps",
    results = {},
  }
  if type(sc.baseline) == "table" and isNumber(sc.baseline.dps) then
    out.baseline = { dps = sc.baseline.dps, error = isNumber(sc.baseline.error) and sc.baseline.error or nil }
  end
  for _, r in ipairs(sc.results) do out.results[#out.results + 1] = cleanResult(r) end
  return out
end

local function cleanSim(sim)
  if type(sim) ~= "table" or not isString(sim.id) or not isString(sim.mode) or type(sim.scenarios) ~= "table" then return nil end
  local out = {
    id = sim.id, mode = sim.mode, title = isString(sim.title) and sim.title or sim.mode,
    created = isNumber(sim.created) and sim.created or 0,
    simc = isString(sim.simc) and sim.simc or nil, wow = isString(sim.wow) and sim.wow or nil,
    settings = type(sim.settings) == "table" and sim.settings or {},
    scenarios = {}, gear = {},
  }
  for _, sc in ipairs(sim.scenarios) do out.scenarios[#out.scenarios + 1] = cleanScenario(sc) end
  if #out.scenarios == 0 then return nil end
  if type(sim.gear) == "table" then
    for slot, item in pairs(sim.gear) do
      if isString(slot) and type(item) == "table" and isNumber(item.itemId) then
        out.gear[slot] = { itemId = item.itemId, bonusIds = numberList(item.bonusIds) or {}, enchant = isNumber(item.enchant) and item.enchant or 0, gems = numberList(item.gems) or {} }
      end
    end
  end
  return out
end

-- Returns clean data, or nil and a message for the player.
function ns.Validate(raw)
  if type(raw) ~= "table" then return nil, "Data.lua holds no data. Send results from SimC Lab, then /reload." end
  local version = raw.schemaVersion
  if not isNumber(version) then return nil, "Data.lua has no schema version. Send results from SimC Lab again." end
  if version > ns.SCHEMA then return nil, "Data.lua comes from a newer SimC Lab. Update the addon from the app (WoW addon, Update)." end
  if version < ns.SCHEMA then return nil, "Data.lua comes from an older SimC Lab. Send your results again." end
  local data = { schemaVersion = version, generated = isNumber(raw.generated) and raw.generated or 0, app = isString(raw.app) and raw.app or "", tracks = {}, characters = {} }
  if type(raw.tracks) == "table" then
    for bonus, t in pairs(raw.tracks) do
      if isNumber(bonus) and type(t) == "table" and isString(t.name) and isNumber(t.itemLevel) then
        data.tracks[bonus] = { name = t.name, level = isNumber(t.level) and t.level or nil, max = isNumber(t.max) and t.max or nil, itemLevel = t.itemLevel, final = t.final == true or nil }
      end
    end
  end
  local count = 0
  if type(raw.characters) == "table" then
    for key, c in pairs(raw.characters) do
      if isString(key) and type(c) == "table" and type(c.specs) == "table" then
        local character = { key = key, name = isString(c.name) and c.name or key, realm = isString(c.realm) and c.realm or "", class = isString(c.class) and c.class or nil, classId = isNumber(c.classId) and c.classId or nil, specs = {} }
        for specId, spec in pairs(c.specs) do
          if isNumber(specId) and type(spec) == "table" and type(spec.sims) == "table" then
            local sims = {}
            for _, sim in ipairs(spec.sims) do sims[#sims + 1] = cleanSim(sim) end
            table.sort(sims, function(a, b) return a.created > b.created end)
            if #sims > 0 then
              character.specs[specId] = { spec = isString(spec.spec) and spec.spec or tostring(specId), sims = sims }
              count = count + #sims
            end
          end
        end
        if next(character.specs) then data.characters[key] = character end
      end
    end
  end
  data.simCount = count
  return data
end

-------------------------------------------------------------------------------
-- The logged-in character and its specialization
-------------------------------------------------------------------------------

local function specInfo()
  local getSpec = (C_SpecializationInfo and C_SpecializationInfo.GetSpecialization) or GetSpecialization
  local getInfo = (C_SpecializationInfo and C_SpecializationInfo.GetSpecializationInfo) or GetSpecializationInfo
  local index = getSpec and getSpec()
  if not index or index == 0 then return nil end
  local id, name = getInfo(index)
  return id, name
end

function ns.PlayerKey()
  return ns.CharacterKey(UnitName("player"), GetRealmName())
end

-- The data entry for the logged-in character. Realms written in another alphabet can differ between the
-- SimulationCraft export and GetRealmName(), so a unique name and class match is accepted as well.
function ns.PlayerCharacter()
  local data = ns.data
  if not data then return nil end
  local key = ns.PlayerKey()
  if data.characters[key] then return data.characters[key] end
  local name = ns.NormalizeKey(UnitName("player"))
  local _, class = UnitClass("player")
  class = class and class:lower() or nil
  local found
  for _, c in pairs(data.characters) do
    if ns.NormalizeKey(c.name) == name and (not class or c.class == class) then
      if found then return nil end
      found = c
    end
  end
  return found
end

function ns.CurrentSpec()
  local character = ns.PlayerCharacter()
  local specId = specInfo()
  if not character or not specId then return nil end
  return character.specs[specId], character, specId
end

-------------------------------------------------------------------------------
-- Results by item, for the tooltip, the vault and loot rolls
-------------------------------------------------------------------------------

function ns.Value(result, scenario)
  if scenario and scenario.metric == "score" and result.score then return result.score end
  return result.gain or result.score or 0
end

function ns.BuildIndex()
  local index = {}
  local spec = ns.CurrentSpec()
  if spec then
    for simIndex, sim in ipairs(spec.sims) do
      for scenarioIndex, scenario in ipairs(sim.scenarios) do
        for _, r in ipairs(scenario.results) do
          if r.itemId then
            local list = index[r.itemId]
            if not list then list = {} index[r.itemId] = list end
            list[#list + 1] = { result = r, sim = sim, scenario = scenario, simIndex = simIndex, scenarioIndex = scenarioIndex }
          end
        end
      end
    end
  end
  ns.index = index
end

-- The best-matching result for an item link: the same bonus IDs first, then the same upgrade track and level
-- or item level, then the nearest item level. Newer sims win ties. Returns the entry and whether it matched.
function ns.Evaluate(link)
  local parsed = ns.ParseLink(link)
  if not parsed or not ns.index then return nil end
  local list = ns.index[parsed.itemId]
  if not list then return nil end
  local track = ns.TrackOf(parsed)
  local level = ns.ItemLevelOf(link)
  local best, bestRank
  for _, entry in ipairs(list) do
    local r = entry.result
    local rank
    if #r.bonusIds > 0 and ns.SameSet(r.bonusIds, parsed.bonusIds) then
      rank = 3
    elseif track and r.track == track then
      rank = 2
    elseif level and r.itemLevel and r.itemLevel == level then
      rank = 2
    elseif level and r.itemLevel then
      rank = 1 - math.min(math.abs(level - r.itemLevel), 500) / 1000
    else
      rank = 0.4
    end
    rank = rank - (entry.simIndex - 1) * 0.01 - (entry.scenarioIndex - 1) * 0.001
    if not bestRank or rank > bestRank then best, bestRank = entry, rank end
  end
  return best, bestRank >= 1.9, parsed
end

-------------------------------------------------------------------------------
-- Labels
-------------------------------------------------------------------------------

function ns.TrackLabel(result)
  local t = result.track and ns.data and ns.data.tracks[result.track]
  if t then
    if t.final then return t.name .. " " .. t.itemLevel end
    if t.level and t.max then return t.name .. " " .. t.level .. "/" .. t.max end
  end
  if result.itemLevel then return "item level " .. result.itemLevel end
  return nil
end

function ns.SourceShort(s)
  if not s then return nil end
  if s.kind == "raid" then return (s.difficulty and (s.difficulty .. " ") or "") .. (s.name or "Raid") end
  if s.kind == "mplus" then return (s.name or "Mythic+") end
  if s.kind == "vault" then return "Vault " .. (s.row or "") .. (s.name and (" (" .. s.name .. ")") or "") end
  if s.kind == "delves" then return "Delves" end
  if s.kind == "crafted" then return "Crafted" .. (s.name and (" (" .. s.name .. ")") or "") end
  return s.name
end

function ns.FormatValue(result, scenario)
  if scenario and scenario.metric == "score" and result.score then
    return string.format("%+.2f score", result.score)
  end
  return string.format("%+.2f%%", result.gain or 0)
end

function ns.Uncertain(result, scenario)
  if scenario and scenario.metric == "score" and result.score and result.scoreError then return math.abs(result.score) <= result.scoreError end
  if result.gain and result.error then return math.abs(result.gain) <= result.error end
  return false
end

function ns.ScenarioLabel(scenario)
  return string.format("%s, %d target%s", scenario.style, scenario.targets, scenario.targets == 1 and "" or "s")
end

-------------------------------------------------------------------------------
-- The gear farm: positive results of an Upgrade Finder sim, grouped by where they drop
-------------------------------------------------------------------------------

function ns.FarmSim(spec, preferred)
  if preferred and preferred.mode == "upgrades" then return preferred end
  if not spec then return nil end
  for _, sim in ipairs(spec.sims) do
    if sim.mode == "upgrades" then return sim end
  end
  return nil
end

function ns.ItemKey(result)
  return result.itemId .. ":" .. (result.track or result.itemLevel or 0)
end

local kindOrder = { raid = 1, mplus = 2, vault = 3, delves = 4, crafted = 5 }

local function groupKey(s)
  return s.kind .. ":" .. (s.instanceId or "") .. ":" .. (s.encounterId or s.name or "")
end

function ns.GroupTitle(s)
  if s.kind == "raid" then return (s.difficulty and (s.difficulty .. " ") or "") .. (s.name or "Raid"), s.instance or "Raid" end
  if s.kind == "mplus" then return s.name or "Mythic+", "Mythic+ dungeon" end
  if s.kind == "vault" then return "Great Vault: " .. (s.row or "any row"), s.name end
  if s.kind == "delves" then return s.name or "Delves", "Delves" end
  if s.kind == "crafted" then return s.name or "Crafted", "Crafted" end
  return s.name or s.kind, nil
end

-- filter(source) limits the farm to one instance or encounter (the Encounter Journal, dungeon entrances).
function ns.Farm(sim, scenarioIndex, characterKey, filter)
  local groups, byKey = {}, {}
  if not sim then return groups end
  local scenario = sim.scenarios[scenarioIndex or 1] or sim.scenarios[1]
  for _, r in ipairs(scenario.results) do
    local value = ns.Value(r, scenario)
    if r.itemId and value > 0 then
      for _, s in ipairs(r.sources) do
        if not filter or filter(s) then
          local key = groupKey(s)
          local g = byKey[key]
          if not g then
            local title, subtitle = ns.GroupTitle(s)
            g = { key = key, source = s, title = title, subtitle = subtitle, items = {}, best = 0, missing = 0, order = kindOrder[s.kind] or 9 }
            byKey[key] = g
            groups[#groups + 1] = g
          end
          local done = ns.IsDone(characterKey, r)
          g.items[#g.items + 1] = { result = r, scenario = scenario, value = value, done = done, owned = ns.Owned(r) }
          if not done then
            g.missing = g.missing + 1
            if value > g.best then g.best = value end
          end
        end
      end
    end
  end
  for _, g in ipairs(groups) do
    table.sort(g.items, function(a, b)
      if a.done ~= b.done then return not a.done end
      return a.value > b.value
    end)
  end
  table.sort(groups, function(a, b)
    if (a.missing > 0) ~= (b.missing > 0) then return a.missing > 0 end
    if a.best ~= b.best then return a.best > b.best end
    return a.order < b.order
  end)
  return groups, scenario
end

function ns.IsDone(characterKey, result)
  if ns.Owned(result) then return true end
  local list = SimCLabDB and SimCLabDB.checklist[characterKey or ""]
  return list and list[ns.ItemKey(result)] == true or false
end

function ns.ToggleDone(characterKey, result)
  local lists = SimCLabDB.checklist
  lists[characterKey] = lists[characterKey] or {}
  local key = ns.ItemKey(result)
  if lists[characterKey][key] then lists[characterKey][key] = nil else lists[characterKey][key] = true end
  ns.Fire("checklist")
end

-------------------------------------------------------------------------------
-- Callbacks
-------------------------------------------------------------------------------

function ns.On(event, fn)
  local list = ns.callbacks[event] or {}
  ns.callbacks[event] = list
  list[#list + 1] = fn
end

function ns.Fire(event, ...)
  for _, fn in ipairs(ns.callbacks[event] or {}) do
    local ok, err = pcall(fn, ...)
    if not ok and ns.debug then ns.Print("error in " .. event .. ": " .. tostring(err)) end
  end
end

function ns.Print(text)
  local line = "|cff4fc3f7SimC Lab|r: " .. text
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage(line) else print(line) end
end

-------------------------------------------------------------------------------
-- Saved state and the SimulationCraft capture
-------------------------------------------------------------------------------

local defaults = { tooltip = true, entrance = true, journal = true, vault = true, loot = true, capture = true, hideDone = false }

local function initDB()
  SimCLabDB = type(SimCLabDB) == "table" and SimCLabDB or {}
  SimCLabDB.version = 1
  SimCLabDB.settings = type(SimCLabDB.settings) == "table" and SimCLabDB.settings or {}
  for k, v in pairs(defaults) do
    if type(SimCLabDB.settings[k]) ~= type(v) then SimCLabDB.settings[k] = v end
  end
  SimCLabDB.checklist = type(SimCLabDB.checklist) == "table" and SimCLabDB.checklist or {}
  SimCLabDB.captures = type(SimCLabDB.captures) == "table" and SimCLabDB.captures or {}
end

-- Stores the official SimulationCraft addon's own /simc export, so SimC Lab can import the character without
-- copy and paste. SimCLab does not build an export itself: parity with that addon is not realistic.
function ns.Capture()
  local api = SimulationcraftAPI
  if type(api) ~= "table" or type(api.GetSimcProfile) ~= "function" then
    return false, "the SimulationCraft addon is not loaded"
  end
  if InCombatLockdown and InCombatLockdown() then return false, "you are in combat" end
  local ok, profile, problem = pcall(api.GetSimcProfile, nil, false, false, false, false)
  if not ok then return false, "SimulationCraft failed: " .. tostring(profile) end
  if problem then return false, tostring(problem) end
  if type(profile) ~= "string" or profile == "" then return false, "SimulationCraft returned no export" end
  -- The export doubles pipes for its edit box; the text SimC reads has single ones.
  profile = profile:gsub("||", "|")
  local _, specName = specInfo()
  local captures = SimCLabDB.captures
  captures[ns.PlayerKey()] = {
    text = profile, time = time(), name = UnitName("player"), realm = GetRealmName(), spec = specName,
    simc = C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata("Simulationcraft", "Version") or nil,
  }
  -- Keep the file small: at most 20 characters, newest first.
  local keys = {}
  for key, c in pairs(captures) do keys[#keys + 1] = { key = key, time = type(c) == "table" and tonumber(c.time) or 0 } end
  table.sort(keys, function(a, b) return a.time > b.time end)
  for i = 21, #keys do captures[keys[i].key] = nil end
  return true
end

-------------------------------------------------------------------------------
-- Loading
-------------------------------------------------------------------------------

function ns.Load()
  local data, problem = ns.Validate(ns.data)
  ns.data = data
  ns.problem = problem
  ns.BuildIndex()
  ns.Fire("data")
end

function ns.WowMismatch(sim)
  if not sim or not sim.wow then return nil end
  local version, build = GetBuildInfo()
  local live = tostring(version) .. "." .. tostring(build)
  if sim.wow ~= live then return live end
  return nil
end

local events = CreateFrame("Frame")
ns.eventFrame = events
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_LOGOUT")
events:RegisterEvent("PLAYER_SPECIALIZATION_CHANGED")
events:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
events:RegisterEvent("BAG_UPDATE_DELAYED")
events:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == addonName then
    initDB()
    ns.Load()
  elseif event == "PLAYER_LOGIN" then
    ns.loggedIn = true
    ns.BuildIndex()
    ns.Fire("player")
    -- Inventory links can still be missing for a moment after login; judge staleness once they are in.
    C_Timer.After(3, function()
      ns.gearReady = true
      ns.InvalidateGear()
      ns.Fire("gear")
    end)
  elseif event == "PLAYER_LOGOUT" then
    if SimCLabDB and SimCLabDB.settings.capture then ns.Capture() end
  elseif event == "PLAYER_SPECIALIZATION_CHANGED" then
    if arg1 == nil or arg1 == "player" then
      ns.BuildIndex()
      ns.Fire("player")
    end
  elseif event == "PLAYER_EQUIPMENT_CHANGED" or event == "BAG_UPDATE_DELAYED" then
    ns.InvalidateGear()
    ns.Fire("gear")
  end
  ns.Fire("event", event, arg1)
end)

-------------------------------------------------------------------------------
-- Slash command
-------------------------------------------------------------------------------

local toggles = { tooltip = "item tooltips", entrance = "the farm at dungeon and raid entrances", journal = "the farm on the Encounter Journal", vault = "Great Vault highlights", loot = "loot roll highlights", capture = "capturing the SimulationCraft export at logout" }

SLASH_SIMCLAB1 = "/simclab"
SlashCmdList.SIMCLAB = function(message)
  local command, value = tostring(message or ""):match("^%s*(%S*)%s*(.-)%s*$")
  command = (command or ""):lower()
  value = (value or ""):lower()
  if command == "" or command == "show" then
    ns.Fire("toggle", "results")
  elseif command == "farm" then
    ns.Fire("toggle", "farm")
  elseif command == "capture" and value == "" then
    local ok, why = ns.Capture()
    if ok then ns.Print("SimulationCraft export stored. Type /reload so the game writes it for SimC Lab.") else ns.Print("could not store the export: " .. why .. ".") end
  elseif toggles[command] then
    local on = value == "on" or (value ~= "off" and not SimCLabDB.settings[command])
    SimCLabDB.settings[command] = on
    ns.Print(toggles[command] .. (on and " on." or " off."))
    ns.Fire("settings", command)
  elseif command == "reset" then
    SimCLabDB.window = nil
    ns.Fire("reset")
    ns.Print("window position reset.")
  else
    ns.Print("/simclab opens the results, /simclab farm the gear farm. /simclab capture stores the SimulationCraft export for SimC Lab. Switch features with /simclab tooltip, entrance, journal, vault, loot or capture, followed by on or off.")
  end
end
