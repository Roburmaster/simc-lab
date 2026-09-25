-- A small World of Warcraft API mock for the SimCLab addon tests. It models what the addon calls and lets a test
-- drive the game: events, timers, the inventory, bags, item levels, loot rolls, the Great Vault and tooltips.
-- Unmodelled widget methods (PascalCase) are no-ops; unset lowercase fields are nil, as on real frames.
__mock = {
  now = 1758300000,
  frames = {},
  timers = {},
  printed = {},
  inventory = {},
  bags = {},
  itemLevels = {},
  guids = {},
  rolls = {},
  weekly = {},
  secrets = {},
  tooltipCalls = {},
  player = { name = "Temulan", realm = "Ravencrest", class = "DEATHKNIGHT", classLocal = "Death Knight", specIndex = 1, specs = { [1] = { 250, "Blood" } } },
  instance = { inInstance = false, kind = "none", map = nil, journal = nil, name = "" },
}

local Widget = {}
local Meta = {}
Meta.__index = function(t, k)
  local m = Widget[k]
  if m then return m end
  if type(k) == "string" and k:match("^%u") then return function() end end
  return nil
end

local function newWidget(kind, name, parent)
  local w = setmetatable({ __kind = kind, __name = name, __parent = parent, __shown = true, __scripts = {}, __events = {}, __points = {}, __lines = {} }, Meta)
  __mock.frames[#__mock.frames + 1] = w
  if name then _G[name] = w end
  return w
end
__mock.newWidget = newWidget

function Widget:GetName() return self.__name end
function Widget:GetParent() return self.__parent end
function Widget:GetObjectType() return self.__kind end
function Widget:IsShown() return self.__shown end
function Widget:IsVisible()
  if not self.__shown then return false end
  if self.__parent and self.__parent.IsVisible then return self.__parent:IsVisible() end
  return true
end
function Widget:Show()
  local was = self.__shown
  self.__shown = true
  if not was then __mock.script(self, "OnShow") end
end
function Widget:Hide()
  local was = self.__shown
  self.__shown = false
  if was then __mock.script(self, "OnHide") end
end
function Widget:SetShown(shown) if shown then self:Show() else self:Hide() end end
function Widget:SetScript(name, fn) self.__scripts[name] = fn end
function Widget:GetScript(name) return self.__scripts[name] end
function Widget:HookScript(name, fn)
  local old = self.__scripts[name]
  self.__scripts[name] = function(...)
    if old then old(...) end
    fn(...)
  end
end
function Widget:RegisterEvent(event) self.__events[event] = true end
function Widget:UnregisterEvent(event) self.__events[event] = nil end
function Widget:SetText(text) self.__text = text end
function Widget:GetText() return self.__text end
function Widget:SetFormattedText(fmt, ...) self.__text = string.format(fmt, ...) end
-- Recorded rather than ignored: a row that lets its text wrap draws the second line over the row below.
function Widget:SetWordWrap(on) self.__wrap = on and true or false end
function Widget:SetMaxLines(n) self.__maxLines = n end
function Widget:SetWidth(width) self.__width = width end
function Widget:SetChecked(v) self.__checked = v and true or false end
function Widget:GetChecked() return self.__checked or false end
function Widget:SetEnabled(v) self.__enabled = v and true or false end
function Widget:IsEnabled() return self.__enabled ~= false end
function Widget:SetPoint(...) self.__points[#self.__points + 1] = { ... } end
function Widget:ClearAllPoints() self.__points = {} end
function Widget:GetPoint() local p = self.__points[1] if p then return p[1], p[2], p[3], p[4], p[5] end return "CENTER", nil, "CENTER", 0, 0 end
function Widget:GetFrameLevel() return self.__level or 1 end
function Widget:SetFrameLevel(level) self.__level = level end
function Widget:SetBackdropBorderColor(r, g, b, a) self.__border = { r, g, b, a } end
function Widget:CreateTexture(name) return newWidget("Texture", name, self) end
function Widget:CreateFontString(name) return newWidget("FontString", name, self) end
function Widget:SetTexture(texture) self.__texture = texture end
-- Tooltip lines
function Widget:AddLine(text) self.__lines[#self.__lines + 1] = text end
function Widget:ClearLines() self.__lines = {} end
function Widget:NumLines() return #self.__lines end

function __mock.script(widget, name, ...)
  local fn = widget.__scripts[name]
  if fn then fn(widget, ...) end
end

function __mock.event(event, ...)
  for _, f in ipairs(__mock.frames) do
    if f.__events[event] then __mock.script(f, "OnEvent", event, ...) end
  end
end

-- Timers run when the test says so, never inside the call that armed them: every timer due within the next
-- `seconds` (default 5), in order, with the clock moved along.
function __mock.runTimers(seconds)
  local horizon = __mock.now + (seconds or 5)
  local guard = 0
  while true do
    guard = guard + 1
    if guard > 1000 then error("timers keep arming timers") end
    local nextIndex
    for i, t in ipairs(__mock.timers) do
      if t.at <= horizon and (not nextIndex or t.at < __mock.timers[nextIndex].at) then nextIndex = i end
    end
    if not nextIndex then break end
    local t = table.remove(__mock.timers, nextIndex)
    if __mock.now < t.at then __mock.now = t.at end
    t.fn()
  end
  __mock.now = horizon
end

function __mock.tooltip(link, data)
  GameTooltip:ClearLines()
  for _, fn in ipairs(__mock.tooltipCalls[Enum.TooltipDataType.Item] or {}) do fn(GameTooltip, data or { hyperlink = link }) end
  return GameTooltip.__lines
end

-- Item links as the game writes them: item:ID:enchant:gem1..4:suffix:unique:level:spec:mask:context:n:bonus...
function __mock.link(itemId, bonusIds, enchant, gems)
  gems = gems or {}
  local parts = { itemId, enchant or "", gems[1] or "", gems[2] or "", gems[3] or "", gems[4] or "", "", "", 90, 250, "", "", #bonusIds }
  for _, b in ipairs(bonusIds) do parts[#parts + 1] = b end
  return "|cffa335ee|Hitem:" .. table.concat(parts, ":") .. "|h[Item " .. itemId .. "]|h|r"
end

-- Globals
UIParent = newWidget("Frame", "UIParent")
GameTooltip = newWidget("GameTooltip", "GameTooltip")
DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) __mock.printed[#__mock.printed + 1] = text end }
ChatFontNormal = {}
UISpecialFrames = {}
SlashCmdList = {}
ITEM_QUALITY_COLORS = { [4] = { hex = "|cffa335ee" } }
Enum = { TooltipDataType = { Item = 0 } }

function CreateFrame(kind, name, parent) return newWidget(kind, name, parent) end
function hooksecurefunc(a, b, c)
  local target, key, fn = _G, a, b
  if type(a) == "table" then target, key, fn = a, b, c end
  local old = target[key]
  target[key] = function(...)
    local r = { old(...) }
    fn(...)
    return (table.unpack or unpack)(r)
  end
end
function GetTime() return __mock.now end
function time() return __mock.now end
date = os.date
function print(...) __mock.printed[#__mock.printed + 1] = table.concat({ ... }, " ") end

C_Timer = { After = function(seconds, fn) __mock.timers[#__mock.timers + 1] = { at = __mock.now + seconds, fn = fn } end }
function UnitName() return __mock.player.name end
function GetRealmName() return __mock.player.realm end
function UnitClass() return __mock.player.classLocal, __mock.player.class, 6 end
function UnitLevel() return 90 end
C_SpecializationInfo = {
  GetSpecialization = function() return __mock.player.specIndex end,
  GetSpecializationInfo = function(i) local s = __mock.player.specs[i] if s then return s[1], s[2] end end,
}
function GetInventoryItemLink(_, slot) return __mock.inventory[slot] end
C_Container = {
  GetContainerNumSlots = function(bag) return #(__mock.bags[bag] or {}) end,
  GetContainerItemLink = function(bag, i) return (__mock.bags[bag] or {})[i] end,
}
C_Item = {
  GetDetailedItemLevelInfo = function(link) return __mock.itemLevels[link] end,
  GetItemIconByID = function() return 134400 end,
  GetItemQualityByID = function() return 4 end,
  GetItemLinkByGUID = function(guid) return __mock.guids[guid] end,
}
TooltipDataProcessor = {
  AddTooltipPostCall = function(kind, fn)
    local list = __mock.tooltipCalls[kind] or {}
    __mock.tooltipCalls[kind] = list
    list[#list + 1] = fn
  end,
}
function issecretvalue(v) return __mock.secrets[v] == true end
C_WeeklyRewards = { GetItemHyperlink = function(dbid) return __mock.weekly[dbid] end }
function GetLootRollItemLink(id) return __mock.rolls[id] end
function IsInInstance() return __mock.instance.inInstance, __mock.instance.kind end
C_Map = { GetBestMapForUnit = function() return __mock.instance.map end }
function EJ_GetInstanceForMap() return __mock.instance.journal end
function EJ_GetInstanceInfo(id) return "Instance " .. tostring(id) end
function EJ_GetEncounterInfo(id) return "Encounter " .. tostring(id) end
-- Journal loot by instance: { [instanceId] = { { itemID = …, encounterID = … } } }.
__mock.ejLoot = {}
__mock.ej = { instance = nil, encounter = nil, classId = 0, specId = 0, scans = 0 }
function EJ_SelectInstance(id) __mock.ej.instance, __mock.ej.encounter = id, nil __mock.ej.scans = __mock.ej.scans + 1 end
function EJ_SelectEncounter(id) __mock.ej.encounter = id end
function EJ_GetLootFilter() return __mock.ej.classId, __mock.ej.specId end
function EJ_SetLootFilter(classId, specId) __mock.ej.classId, __mock.ej.specId = classId, specId end
function EJ_GetNumLoot() return #(__mock.ejLoot[__mock.ej.instance] or {}) end
C_EncounterJournal = { GetLootInfoByIndex = function(i) return (__mock.ejLoot[__mock.ej.instance] or {})[i] end }
function GetInstanceInfo() return __mock.instance.name, __mock.instance.kind end
function InCombatLockdown() return false end
function GetBuildInfo() return "12.1.0", "69875", "Sep 18 2026", 120100 end
C_AddOns = { GetAddOnMetadata = function(name, field)
  if field ~= "Version" then return nil end
  if name == "Simulationcraft" then return "12.1.0-03" end
  if name == "SimCLab" then return __mock.addonVersion or "1.2.3" end
end }
function IsModifiedClick() return false end
function HandleModifiedItemClick() end

-- Blizzard creates the four group loot frames at startup, hidden.
for i = 1, 4 do
  local f = newWidget("Frame", "GroupLootFrame" .. i)
  f.__shown = false
end

-- Extra APIs the addon's own /simc export reads.
__mock.player.race = "Draenei"
__mock.player.role = "TANK"
__mock.professions = { [1] = { "Herbalism", 9 }, [2] = { "Enchanting", 64 } }
__mock.traits = {
  activeConfig = 1,
  strings = { [1] = "CoPAkXBWactive", [7] = "CoPAkXBWsaved" },
  configs = { [1] = { name = "Main", treeIDs = { 1 } }, [7] = { name = "M+ build", treeIDs = { 1 } }, [48] = { name = "Omnium", treeIDs = { 9 } } },
  nodes = { [9] = { { entryID = 1234, rank = 2 }, { entryID = 1235, rank = 1 } } },
  specConfigs = { 1, 7 },
}
function UnitRace() return __mock.player.race, __mock.player.race end
function GetCurrentRegionName() return "EU" end
function GetCurrentRegion() return 3 end
function GetSpecializationRole() return __mock.player.role end
function GetProfessions() return 1, 2 end
function GetProfessionInfo(id)
  local p = __mock.professions[id]
  if p then return p[1], nil, p[2] end
end
C_ClassTalents = {
  GetActiveConfigID = function() return __mock.traits.activeConfig end,
  GetConfigIDsBySpecID = function() return __mock.traits.specConfigs end,
}
C_Traits = {
  GenerateImportString = function(id) return __mock.traits.strings[id] end,
  GetConfigIDBySystemID = function(system) return system == 48 and 48 or nil end,
  GetConfigInfo = function(id) return __mock.traits.configs[id] end,
  GetTreeNodes = function(tree) return __mock.traits.nodes[tree] and { 1, 2 } or {} end,
  GetNodeInfo = function(config, node)
    local list = __mock.traits.nodes[9]
    local entry = list and list[node]
    if entry then return { ranksPurchased = entry.rank, activeEntry = entry } end
    return {}
  end,
}
C_TradeSkillUI = { GetItemCraftedQualityByItemInfo = function(link) return __mock.craftedQuality and __mock.craftedQuality[link] end }
C_Item.GetItemInfoInstant = function(link)
  local id = tonumber(tostring(link):match("item:(%d+)"))
  return id, nil, nil, __mock.equipLoc and __mock.equipLoc[id] or "INVTYPE_FINGER"
end
