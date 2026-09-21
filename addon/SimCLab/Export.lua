-- SimCLab's own /simc export, so a character can be simulated without the official SimulationCraft addon.
-- When that addon is installed SimCLab uses its export instead: it is the reference, and it is updated with
-- every patch. This one follows the same output format, which its authors released into the public domain
-- (the Unlicense); the text below is SimCLab's own implementation of it.
local _, ns = ...

-- Slots in the order SimC writes them, with the inventory slot each one reads.
local SLOTS = {
  { "head", 1 }, { "neck", 2 }, { "shoulder", 3 }, { "back", 15 }, { "chest", 5 },
  { "wrist", 9 }, { "hands", 10 }, { "waist", 6 }, { "legs", 7 }, { "feet", 8 },
  { "finger1", 11 }, { "finger2", 12 }, { "trinket1", 13 }, { "trinket2", 14 },
  { "main_hand", 16 }, { "off_hand", 17 },
}

-- Type/value pairs that follow the bonus IDs in an item link.
local MOD_DROP_LEVEL, MOD_CONTENT_TUNING, MOD_CRAFT_STATS_1, MOD_CRAFT_STATS_2, MOD_REDIRECTED_BASE_STATS = 9, 28, 29, 30, 64
local REGIONS = { "us", "kr", "eu", "tw", "cn" }

-- Every specialization's SimC name, by specialization ID. The client does not always hand out the name --
-- C_SpecializationInfo.GetSpecializationInfo answers with the ID alone on this build -- and a profile without
-- spec= cannot be simulated, so the names live here as well.
ns.SPECS = {
  [62]="arcane", [63]="fire", [64]="frost", [65]="holy", [66]="protection", [70]="retribution",
  [71]="arms", [72]="fury", [73]="protection", [102]="balance", [103]="feral", [104]="guardian",
  [105]="restoration", [250]="blood", [251]="frost", [252]="unholy", [253]="beast_mastery", [254]="marksmanship",
  [255]="survival", [256]="discipline", [257]="holy", [258]="shadow", [259]="assassination", [260]="outlaw",
  [261]="subtlety", [262]="elemental", [263]="enhancement", [264]="restoration", [265]="affliction", [266]="demonology",
  [267]="destruction", [268]="brewmaster", [269]="windwalker", [270]="mistweaver", [577]="havoc", [581]="vengeance",
  [1467]="devastation", [1468]="preservation", [1473]="augmentation", [1480]="devourer",
}
-- The specs SimC Lab simulates as tanks, for role=tank when the client does not say.
ns.TANK_SPECS = { [250]=true, [66]=true, [73]=true, [104]=true, [268]=true, [581]=true }
local EQUIP_SLOTS = {
  INVTYPE_HEAD = "head", INVTYPE_NECK = "neck", INVTYPE_SHOULDER = "shoulder", INVTYPE_CLOAK = "back",
  INVTYPE_CHEST = "chest", INVTYPE_ROBE = "chest", INVTYPE_WRIST = "wrist", INVTYPE_HAND = "hands",
  INVTYPE_WAIST = "waist", INVTYPE_LEGS = "legs", INVTYPE_FEET = "feet", INVTYPE_FINGER = "finger1",
  INVTYPE_TRINKET = "trinket1", INVTYPE_WEAPON = "main_hand", INVTYPE_2HWEAPON = "main_hand",
  INVTYPE_WEAPONMAINHAND = "main_hand", INVTYPE_WEAPONOFFHAND = "off_hand", INVTYPE_HOLDABLE = "off_hand",
  INVTYPE_SHIELD = "off_hand", INVTYPE_RANGED = "main_hand", INVTYPE_RANGEDRIGHT = "main_hand",
}

-- SimC's own tokenizer: lowercase, spaces to underscores, drop punctuation, keep multi-byte characters.
function ns.Tokenize(text)
  text = tostring(text or "")
  local out = {}
  for i = 1, #text do
    local b = text:byte(i)
    if b == 32 then
      out[#out + 1] = "_"
    elseif b >= 65 and b <= 90 then
      out[#out + 1] = string.char(b + 32)
    elseif (b >= 97 and b <= 122) or (b >= 48 and b <= 57) or b == 37 or b == 43 or b == 46 or b == 95 or b >= 128 then
      out[#out + 1] = string.char(b)
    end
  end
  return (table.concat(out):gsub("_+$", ""))
end

-- Race tokens come as one word: BloodElf becomes blood_elf.
local function raceToken(race)
  local words = {}
  for word in tostring(race or ""):gmatch("%u%l*") do words[#words + 1] = word end
  return ns.Tokenize(#words > 0 and table.concat(words, " ") or race)
end

-- The checksum the SimulationCraft addon appends: adler32 over everything before the line, no bit library.
function ns.Adler32(text)
  local s1, s2 = 1, 0
  for i = 1, #text do
    s1 = s1 + text:byte(i)
    s2 = s2 + s1
    if s1 > 1e14 then s1 = s1 % 65521 s2 = s2 % 65521 end
  end
  s1, s2 = s1 % 65521, s2 % 65521
  local value, digits, hex = s2 * 65536 + s1, {}, "0123456789abcdef"
  repeat
    local rest = value % 16
    table.insert(digits, 1, hex:sub(rest + 1, rest + 1))
    value = math.floor(value / 16)
  until value == 0
  return table.concat(digits)
end

-- Every field of an item link, including the type/value pairs and gem bonus IDs after the bonus list.
local function itemOptions(link)
  local body = link and link:match("item:([%-%d:]*)")
  if not body then return nil end
  local f = {}
  for v in (body .. ":"):gmatch("([^:]*):") do f[#f + 1] = tonumber(v) or 0 end
  local itemId = f[1]
  if not itemId or itemId <= 0 then return nil end
  local options = { ",id=" .. itemId }
  if (f[2] or 0) > 0 then options[#options + 1] = "enchant_id=" .. f[2] end
  local gems = {}
  for i = 3, 6 do gems[#gems + 1] = f[i] or 0 end
  while #gems > 0 and gems[#gems] == 0 do table.remove(gems) end
  if #gems > 0 then options[#options + 1] = "gem_id=" .. table.concat(gems, "/") end
  local count = f[13] or 0
  local bonuses = {}
  for i = 1, count do bonuses[#bonuses + 1] = f[13 + i] end
  if #bonuses > 0 then options[#options + 1] = "bonus_id=" .. table.concat(bonuses, "/") end
  -- After the bonus IDs comes a count of type/value pairs, then the gem bonus IDs.
  local pairOffset = 13 + count + 1
  local pairs_ = f[pairOffset] or 0
  local crafted = {}
  for i = 1, pairs_ do
    local kind, value = f[pairOffset + 2 * i - 1], f[pairOffset + 2 * i]
    if kind == MOD_DROP_LEVEL then options[#options + 1] = "drop_level=" .. value
    elseif kind == MOD_CONTENT_TUNING then options[#options + 1] = "content_tuning=" .. value
    elseif kind == MOD_CRAFT_STATS_1 or kind == MOD_CRAFT_STATS_2 then crafted[#crafted + 1] = value
    elseif kind == MOD_REDIRECTED_BASE_STATS then options[#options + 1] = "redirected_base_stats=" .. value end
  end
  if #crafted > 0 then options[#options + 1] = "crafted_stats=" .. table.concat(crafted, "/") end
  local gemOffset = pairOffset + 2 * pairs_ + 2
  local gemBonuses = {}
  for i = 1, (f[gemOffset] or 0) do gemBonuses[#gemBonuses + 1] = f[gemOffset + i] end
  if #gemBonuses > 0 then options[#options + 1] = "gem_bonus_id=" .. table.concat(gemBonuses, "/") end
  local quality = C_TradeSkillUI and C_TradeSkillUI.GetItemCraftedQualityByItemInfo and C_TradeSkillUI.GetItemCraftedQualityByItemInfo(link)
  if quality then options[#options + 1] = "crafting_quality=" .. quality end
  return table.concat(options, ",")
end
ns.ItemOptions = itemOptions

local function talentLines(lines)
  local traits, classTalents = C_Traits, C_ClassTalents
  if not (traits and classTalents and classTalents.GetActiveConfigID) then return end
  local active = classTalents.GetActiveConfigID()
  if active and traits.GenerateImportString then
    local export = traits.GenerateImportString(active)
    if export and export ~= "" then lines[#lines + 1] = "talents=" .. export end
  end
  -- Omnium talents are a second trait system, written as entry:rank pairs.
  if traits.GetConfigIDBySystemID and traits.GetConfigInfo and traits.GetTreeNodes and traits.GetNodeInfo then
    local configId = traits.GetConfigIDBySystemID(48)
    local info = configId and traits.GetConfigInfo(configId)
    local entries = {}
    for _, treeId in ipairs(info and info.treeIDs or {}) do
      for _, nodeId in ipairs(traits.GetTreeNodes(treeId) or {}) do
        local node = traits.GetNodeInfo(configId, nodeId)
        if node and (node.ranksPurchased or 0) > 0 and node.activeEntry then
          entries[#entries + 1] = node.activeEntry.entryID .. ":" .. node.activeEntry.rank
        end
      end
    end
    if #entries > 0 then lines[#lines + 1] = "omnium_talents=" .. table.concat(entries, "/") end
  end
  -- Saved loadouts travel as comments; SimC Lab offers them as talent alternatives.
  if classTalents.GetConfigIDsBySpecID and traits.GetConfigInfo and traits.GenerateImportString then
    local specId = ns.SpecId()
    for _, configId in ipairs(specId and classTalents.GetConfigIDsBySpecID(specId) or {}) do
      if configId ~= active then
        local info = traits.GetConfigInfo(configId)
        local export = traits.GenerateImportString(configId)
        if info and export and export ~= "" then
          lines[#lines + 1] = "# Saved Loadout: " .. tostring(info.name):gsub("||", "|")
          lines[#lines + 1] = "# talents=" .. export
        end
      end
    end
  end
end

-- Equippable items in the bags, as comments. SimC Lab reads them as Gear Compare alternatives.
local function bagLines(lines)
  if not (C_Container and C_Container.GetContainerNumSlots and C_Item and C_Item.GetItemInfoInstant) then return end
  local written = 0
  for bag = 0, 5 do
    for slot = 1, C_Container.GetContainerNumSlots(bag) or 0 do
      if written >= 60 then return end
      local link = C_Container.GetContainerItemLink(bag, slot)
      -- `link and C_Item.GetItemInfoInstant(link)` would keep only the first return value.
      local equipLoc
      if link then local _, _, _, loc = C_Item.GetItemInfoInstant(link) equipLoc = loc end
      local simcSlot = equipLoc and EQUIP_SLOTS[equipLoc]
      local options = simcSlot and itemOptions(link)
      if options then
        if written == 0 then
          lines[#lines + 1] = ""
          lines[#lines + 1] = "### Gear from Bags"
          lines[#lines + 1] = "#"
        end
        local name = link:match("%[(.-)%]") or ("Item " .. tostring(options:match("id=(%d+)")))
        local level = ns.ItemLevelOf(link)
        lines[#lines + 1] = "# " .. name .. (level and (" (" .. level .. ")") or "")
        lines[#lines + 1] = "# " .. simcSlot .. "=" .. options
        written = written + 1
      end
    end
  end
end

function ns.SpecId()
  return (ns.SpecInfo())
end

-- Builds the profile. Returns the text, or nil and why it could not be built.
function ns.BuildProfile()
  local specId, specName, index = ns.SpecInfo()
  if not specId then return nil, "this character has no specialization yet" end
  -- SimC needs the specialization by name; the table stands in when the client answers with the ID alone.
  local specToken = specName and ns.Tokenize(specName) or nil
  if not specToken or specToken == "" then specToken = ns.SPECS[specId] end
  if not specToken then return nil, "the game did not say which specialization this is (" .. tostring(specId) .. ")" end
  local name = UnitName("player")
  local _, classToken = UnitClass("player")
  local _, raceToken_ = UnitRace("player")
  if not name or not classToken then return nil, "the game has not loaded this character yet" end
  local realm = GetRealmName()
  local region = (GetCurrentRegionName and GetCurrentRegionName()) or REGIONS[GetCurrentRegion and GetCurrentRegion() or 0] or ""
  local version, build, _, toc = GetBuildInfo()

  local lines = {
    "# " .. name .. " - " .. (specName or specToken) .. " - " .. date("%Y-%m-%d %H:%M") .. " - " .. tostring(region):upper() .. "/" .. tostring(realm),
    "# SimCLab " .. (C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata(ns.name, "Version") or ""),
    "# WoW " .. tostring(version) .. "." .. tostring(build) .. ", TOC " .. tostring(toc),
    "# Written by SimC Lab's own addon, in the format of the SimulationCraft addon.",
    ns.Tokenize(classToken) .. '="' .. name .. '"',
    "level=" .. (UnitLevel("player") or 0),
    "race=" .. raceToken(raceToken_ == "Scourge" and "Undead" or raceToken_),
    "region=" .. ns.Tokenize(region),
    "server=" .. ns.Tokenize(realm),
    "spec=" .. specToken,
  }
  local role = index and GetSpecializationRole and GetSpecializationRole(index)
  if role == "TANK" or (not role and ns.TANK_SPECS[specId]) then lines[#lines + 1] = "role=tank" end
  local professions = {}
  if GetProfessions then
    local first, second = GetProfessions()
    for _, id in ipairs({ first, second }) do
      local profName, _, rank = GetProfessionInfo(id)
      if profName then professions[#professions + 1] = ns.Tokenize(profName) .. "=" .. tostring(rank or 0) end
    end
  end
  if #professions > 0 then lines[#lines + 1] = "professions=" .. table.concat(professions, "/") end
  talentLines(lines)

  local worn = 0
  lines[#lines + 1] = ""
  for _, slot in ipairs(SLOTS) do
    local link = GetInventoryItemLink("player", slot[2])
    local options = link and itemOptions(link)
    if options then
      local level = ns.ItemLevelOf(link)
      lines[#lines + 1] = "# " .. (link:match("%[(.-)%]") or slot[1]) .. (level and (" (" .. level .. ")") or "")
      lines[#lines + 1] = slot[1] .. "=" .. options
      worn = worn + 1
    end
  end
  if worn == 0 then return nil, "no equipped gear could be read" end
  bagLines(lines)

  local text = table.concat(lines, "\n") .. "\n\n"
  return text .. "# Checksum: " .. ns.Adler32(text)
end
