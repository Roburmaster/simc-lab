-- The gear farm where the loot is: beside the Encounter Journal for the instance or boss on display, and as a
-- short notice on entering a dungeon or raid that has something to farm.
local _, ns = ...
local UI = ns.UI

-- Only boss and dungeon loot belongs here; vault, delve and crafted rows have no place in a journal.
local function journalFilter(instanceId, encounterId)
  return function(s)
    if s.kind ~= "raid" and s.kind ~= "mplus" then return false end
    if s.instanceId ~= instanceId then return false end
    -- Mythic+ loot comes from the end chest, so it belongs to every boss of the dungeon.
    if encounterId and s.encounterId and s.encounterId ~= encounterId then return false end
    return true
  end
end

-- Rows for one instance, best first, one row per item even when several bosses drop it.
function ns.InstanceFarm(instanceId, encounterId)
  local spec, character = ns.CurrentSpec()
  local sim = ns.FarmSim(spec)
  if not sim or not instanceId then return {}, nil end
  local groups, scenario = ns.Farm(sim, 1, character.key, journalFilter(instanceId, encounterId))
  local seen, items = {}, {}
  for _, g in ipairs(groups) do
    for _, item in ipairs(g.items) do
      local key = ns.ItemKey(item.result)
      if not seen[key] then
        seen[key] = true
        item.group = g
        items[#items + 1] = item
      end
    end
  end
  table.sort(items, function(a, b)
    if a.done ~= b.done then return not a.done end
    return a.value > b.value
  end)
  return items, scenario, sim
end

local function rowsFor(items, scenario, specId, characterKey)
  local rows = {}
  for _, item in ipairs(items) do
    local r = item.result
    local detail = {}
    if r.slot then detail[#detail + 1] = ns.SLOT_NAMES[r.slot] or r.slot end
    if ns.TrackLabel(r) then detail[#detail + 1] = ns.TrackLabel(r) end
    if item.group and item.group.source.kind == "raid" then detail[#detail + 1] = item.group.title end
    rows[#rows + 1] = UI.ResultRow(r, scenario, specId, {
      checkable = true,
      checked = item.done,
      dim = item.done,
      detail = ns.Plain(table.concat(detail, "  ·  ")),
      valueDetail = item.owned and "owned" or "",
      onCheck = function() ns.ToggleDone(characterKey, r) end,
    })
  end
  return rows
end

local function farmPanel(name, parent, rows)
  local p = UI.Panel(name, parent, 300, 72 + rows * 30)
  p.title = UI.Text(p, "GameFontNormal")
  p.title:SetPoint("TOPLEFT", 10, -10)
  p.title:SetPoint("TOPRIGHT", -28, -10)
  p.subtitle = UI.Text(p, "GameFontDisableSmall")
  p.subtitle:SetPoint("TOPLEFT", 10, -28)
  p.subtitle:SetPoint("TOPRIGHT", -10, -28)
  p.list = UI.List(p, rows)
  p.list:SetPoint("TOPLEFT", 6, -46)
  p.list:SetPoint("TOPRIGHT", -6, -46)
  p.list.position:SetPoint("BOTTOMRIGHT", -10, 8)
  UI.Close(p)
  return p
end

local function fill(panel, items, scenario, sim, heading)
  local _, character, specId = ns.CurrentSpec()
  local missing = 0
  for _, item in ipairs(items) do if not item.done then missing = missing + 1 end end
  panel.title:SetText(UI.Paint("SimC Lab farm: ", UI.colors.accent) .. ns.Plain(heading or ""))
  local stale = ns.IsStale(sim, character)
  panel.subtitle:SetText(UI.Paint(string.format("%d upgrade%s, %d still missing", #items, #items == 1 and "" or "s", missing), UI.colors.muted) .. (stale and UI.Paint("  ·  stale sim", UI.colors.stale) or ""))
  local rows = rowsFor(items, scenario, specId, character.key)
  panel.list:SetItems(rows)
  local shown = math.min(#rows, panel.list.visible)
  panel:SetHeight(58 + math.max(shown, 1) * 30 + (#rows > panel.list.visible and 16 or 0))
end

-------------------------------------------------------------------------------
-- Encounter Journal
-------------------------------------------------------------------------------

local journal, shownInstance, shownEncounter

local function updateJournal()
  if not journal then return end
  if not SimCLabDB.settings.journal or not EncounterJournal or not EncounterJournal:IsShown() or not shownInstance then
    journal:Hide()
    return
  end
  local items, scenario, sim = ns.InstanceFarm(shownInstance, shownEncounter)
  if #items == 0 then journal:Hide() return end
  local heading
  if EJ_GetInstanceInfo then heading = EJ_GetInstanceInfo(shownInstance) end
  if shownEncounter and EJ_GetEncounterInfo then heading = EJ_GetEncounterInfo(shownEncounter) or heading end
  fill(journal, items, scenario, sim, heading)
  journal:Show()
end

local function hookJournal()
  if journal or not EncounterJournal then return end
  journal = farmPanel("SimCLabJournal", EncounterJournal, 10)
  journal:SetPoint("TOPLEFT", EncounterJournal, "TOPRIGHT", 4, 0)
  journal:Hide()
  hooksecurefunc("EncounterJournal_DisplayInstance", function(instanceId)
    shownInstance, shownEncounter = instanceId, nil
    updateJournal()
  end)
  hooksecurefunc("EncounterJournal_DisplayEncounter", function(encounterId)
    shownInstance = EncounterJournal.instanceID or shownInstance
    shownEncounter = encounterId
    updateJournal()
  end)
  EncounterJournal:HookScript("OnShow", updateJournal)
  EncounterJournal:HookScript("OnHide", function() journal:Hide() end)
end

-------------------------------------------------------------------------------
-- Dungeon and raid entrances
-------------------------------------------------------------------------------

local entrance
local announced = {}

local function journalInstanceHere()
  local inInstance, kind = IsInInstance()
  if not inInstance or (kind ~= "party" and kind ~= "raid") then return nil end
  local map = C_Map and C_Map.GetBestMapForUnit and C_Map.GetBestMapForUnit("player")
  if not map or not EJ_GetInstanceForMap then return nil end
  local ok, instanceId = pcall(EJ_GetInstanceForMap, map)
  if ok and type(instanceId) == "number" and instanceId > 0 then return instanceId end
  return nil
end

function ns.CheckEntrance()
  if not SimCLabDB or not SimCLabDB.settings.entrance or not ns.data then return end
  local instanceId = journalInstanceHere()
  if not instanceId or announced[instanceId] then return end
  local items, scenario, sim = ns.InstanceFarm(instanceId)
  local missing = {}
  for _, item in ipairs(items) do if not item.done then missing[#missing + 1] = item end end
  if #missing == 0 then return end
  announced[instanceId] = true
  if not entrance then
    entrance = farmPanel("SimCLabEntrance", UIParent, 6)
    entrance:SetPoint("TOP", UIParent, "TOP", 0, -140)
    entrance:SetFrameStrata("MEDIUM")
    UI.Movable(entrance)
  end
  local name = GetInstanceInfo()
  fill(entrance, missing, scenario, sim, name)
  entrance:Show()
  entrance.expires = GetTime() + 45
  C_Timer.After(45.5, function()
    if entrance and entrance.expires and GetTime() >= entrance.expires then entrance:Hide() end
  end)
end

ns.On("event", function(event, arg1)
  if event == "ADDON_LOADED" and arg1 == "Blizzard_EncounterJournal" then hookJournal() end
  if event == "PLAYER_LOGIN" and EncounterJournal then hookJournal() end
  if event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA" then
    C_Timer.After(2, ns.CheckEntrance)
  end
  if event == "PLAYER_REGEN_DISABLED" and entrance then entrance:Hide() end
end)
ns.eventFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
ns.eventFrame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
ns.eventFrame:RegisterEvent("PLAYER_REGEN_DISABLED")
ns.On("checklist", updateJournal)
ns.On("gear", updateJournal)
ns.On("data", updateJournal)
