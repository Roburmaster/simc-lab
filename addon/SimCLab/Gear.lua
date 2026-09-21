-- Item links, equipped gear and bags: what the character wears now against what a sim was run with, and
-- whether an item from the farm is already owned.
local _, ns = ...

ns.SLOTS = { "head", "neck", "shoulder", "back", "chest", "wrist", "hands", "waist", "legs", "feet", "finger1", "finger2", "trinket1", "trinket2", "main_hand", "off_hand" }
ns.SLOT_IDS = { head = 1, neck = 2, shoulder = 3, back = 15, chest = 5, wrist = 9, hands = 10, waist = 6, legs = 7, feet = 8, finger1 = 11, finger2 = 12, trinket1 = 13, trinket2 = 14, main_hand = 16, off_hand = 17 }
ns.SLOT_NAMES = { head = "Head", neck = "Neck", shoulder = "Shoulders", back = "Back", chest = "Chest", wrist = "Wrists", hands = "Hands", waist = "Waist", legs = "Legs", feet = "Feet", finger1 = "Ring 1", finger2 = "Ring 2", trinket1 = "Trinket 1", trinket2 = "Trinket 2", main_hand = "Main hand", off_hand = "Off hand" }

-- item:ID:enchant:gem1:gem2:gem3:gem4:suffix:unique:linkLevel:spec:modifiersMask:context:numBonus:bonus...
function ns.ParseLink(link)
  if type(link) ~= "string" then return nil end
  local body = link:match("item:([%-%d:]*)")
  if not body then return nil end
  local f = {}
  for v in (body .. ":"):gmatch("([^:]*):") do f[#f + 1] = tonumber(v) or 0 end
  local itemId = f[1]
  if not itemId or itemId <= 0 then return nil end
  local parsed = { itemId = itemId, enchant = f[2] or 0, gems = {}, bonusIds = {} }
  for i = 3, 6 do
    if (f[i] or 0) > 0 then parsed.gems[#parsed.gems + 1] = f[i] end
  end
  local count = f[13] or 0
  for i = 1, count do
    local bonus = f[13 + i]
    if bonus and bonus > 0 then parsed.bonusIds[#parsed.bonusIds + 1] = bonus end
  end
  return parsed
end

function ns.SameSet(a, b)
  if #a ~= #b then return false end
  local seen = {}
  for _, v in ipairs(a) do seen[v] = (seen[v] or 0) + 1 end
  for _, v in ipairs(b) do
    if not seen[v] or seen[v] == 0 then return false end
    seen[v] = seen[v] - 1
  end
  return true
end

function ns.TrackOf(parsed)
  local tracks = ns.data and ns.data.tracks
  if not tracks or not parsed then return nil end
  for _, bonus in ipairs(parsed.bonusIds) do
    if tracks[bonus] then return bonus end
  end
  return nil
end

function ns.ItemLevelOf(link)
  if not (C_Item and C_Item.GetDetailedItemLevelInfo) then return nil end
  local ok, level = pcall(C_Item.GetDetailedItemLevelInfo, link)
  if ok and type(level) == "number" and level > 0 then return level end
  return nil
end

-- An item string the game can show in a tooltip, carrying the simulated bonus IDs.
function ns.ItemString(result, specId)
  local parts = { "item", result.itemId, "", "", "", "", "", "", "", UnitLevel and UnitLevel("player") or "", specId or "", "", "", #(result.bonusIds or {}) }
  for _, bonus in ipairs(result.bonusIds or {}) do parts[#parts + 1] = bonus end
  return table.concat(parts, ":")
end

-------------------------------------------------------------------------------
-- Stale sims: the equipped gear no longer matches the gear the sim started from
-------------------------------------------------------------------------------

local diffCache = setmetatable({}, { __mode = "k" })
local ownedCache = {}

function ns.InvalidateGear()
  ns.wipe(diffCache)
  ns.wipe(ownedCache)
end

local function describe(expected, parsed)
  if not parsed then return "now empty" end
  if not expected then return "newly equipped" end
  if expected.itemId ~= parsed.itemId then return "different item" end
  if not ns.SameSet(expected.bonusIds, parsed.bonusIds) then return "upgraded or changed" end
  if (expected.enchant or 0) ~= (parsed.enchant or 0) then return "different enchant" end
  if not ns.SameSet(expected.gems or {}, parsed.gems) then return "different gems" end
  return nil
end

-- Returns a list of { slot, reason } for the logged-in character, or nil when the sim belongs to someone else
-- or has no gear to compare.
function ns.GearDiff(sim, character)
  if not sim or not next(sim.gear) then return nil end
  if character and character ~= ns.PlayerCharacter() then return nil end
  if diffCache[sim] then return diffCache[sim] end
  local changes = {}
  for _, slot in ipairs(ns.SLOTS) do
    local expected = sim.gear[slot]
    local link = GetInventoryItemLink("player", ns.SLOT_IDS[slot])
    local parsed = link and ns.ParseLink(link)
    if expected or parsed then
      local reason = describe(expected, parsed)
      if reason then changes[#changes + 1] = { slot = slot, reason = reason } end
    end
  end
  if ns.gearReady then diffCache[sim] = changes end
  return changes
end

function ns.IsStale(sim, character)
  local changes = ns.GearDiff(sim, character)
  return changes ~= nil and #changes > 0, changes
end

-------------------------------------------------------------------------------
-- Owned: equipped or in the bags at the simulated item level or higher
-------------------------------------------------------------------------------

local function eachItemLink(fn)
  for _, slot in ipairs(ns.SLOTS) do
    local link = GetInventoryItemLink("player", ns.SLOT_IDS[slot])
    if link then fn(link) end
  end
  if C_Container and C_Container.GetContainerNumSlots then
    for bag = 0, 5 do
      local slots = C_Container.GetContainerNumSlots(bag) or 0
      for i = 1, slots do
        local link = C_Container.GetContainerItemLink(bag, i)
        if link then fn(link) end
      end
    end
  end
end

function ns.Owned(result)
  if not result.itemId then return false end
  local key = ns.ItemKey(result)
  if ownedCache[key] ~= nil then return ownedCache[key] end
  local owned = false
  eachItemLink(function(link)
    if owned then return end
    local parsed = ns.ParseLink(link)
    if parsed and parsed.itemId == result.itemId then
      local level = ns.ItemLevelOf(link)
      if not result.itemLevel or (level and level >= result.itemLevel) then owned = true end
    end
  end)
  ownedCache[key] = owned
  return owned
end
