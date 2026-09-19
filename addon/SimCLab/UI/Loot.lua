-- The Great Vault and group loot rolls: when they show items SimC Lab simulated, the best choice gets a green
-- border and every known item its simulated gain.
local _, ns = ...
local UI = ns.UI

local GOLD = { 0.95, 0.72, 0.33 }

-- Picks the best of a list of { frame, link } by simulated value. Returns the evaluated list and the winner.
function ns.RankLinks(candidates)
  local best
  for _, c in ipairs(candidates) do
    local entry, exact = ns.Evaluate(c.link)
    if entry then
      c.entry, c.exact = entry, exact
      c.value = ns.Value(entry.result, entry.scenario)
      if c.value > 0 and (not best or c.value > best.value) then best = c end
    end
  end
  return candidates, best
end

local function mark(candidates, best, bestText)
  for _, c in ipairs(candidates) do
    if c.entry then
      local m = UI.Mark(c.frame)
      local text = ns.FormatValue(c.entry.result, c.entry.scenario) .. (c.exact and "" or " (other level)")
      if c == best then
        m:SetBackdropBorderColor(UI.colors.gain[1], UI.colors.gain[2], UI.colors.gain[3], 1)
        m.label:SetText(UI.Paint(bestText .. text, UI.colors.gain))
      else
        m:SetBackdropBorderColor(0, 0, 0, 0)
        m.label:SetText(UI.Paint("SimC Lab: " .. text, UI.ValueColor(c.value)))
      end
      m:Show()
    else
      UI.Unmark(c.frame)
    end
  end
end

-------------------------------------------------------------------------------
-- Great Vault
-------------------------------------------------------------------------------

local vaultSummary

function ns.UpdateVault()
  local frame = WeeklyRewardsFrame
  if not frame or not frame.Activities then return end
  local candidates = {}
  for _, activity in ipairs(frame.Activities) do
    local dbid = activity.ItemFrame and activity.ItemFrame.displayedItemDBID
    local link = dbid and C_WeeklyRewards.GetItemHyperlink(dbid)
    if link and SimCLabDB.settings.vault then
      candidates[#candidates + 1] = { frame = activity, link = link }
    else
      UI.Unmark(activity)
    end
  end
  local _, best = ns.RankLinks(candidates)
  mark(candidates, best, "SimC Lab best: ")
  if not vaultSummary then
    vaultSummary = UI.Text(frame, "GameFontNormal", "CENTER")
    vaultSummary:SetPoint("BOTTOM", frame, "BOTTOM", 0, 12)
  end
  if best then
    vaultSummary:SetText(UI.Paint("SimC Lab: take ", GOLD) .. best.link .. UI.Paint(" (" .. ns.FormatValue(best.entry.result, best.entry.scenario) .. ")", UI.colors.gain) .. (ns.IsStale(best.entry.sim) and UI.Paint("  stale sim", UI.colors.stale) or ""))
  elseif #candidates > 0 then
    local known = 0
    for _, c in ipairs(candidates) do if c.entry then known = known + 1 end end
    vaultSummary:SetText(known > 0 and UI.Paint("SimC Lab: none of these beat your current gear.", UI.colors.muted) or "")
  else
    vaultSummary:SetText("")
  end
end

local function hookVault()
  if ns.vaultHooked or not WeeklyRewardsFrame then return end
  ns.vaultHooked = true
  hooksecurefunc(WeeklyRewardsFrame, "Refresh", function() C_Timer.After(0, ns.UpdateVault) end)
  WeeklyRewardsFrame:HookScript("OnShow", function() C_Timer.After(0, ns.UpdateVault) end)
end

-------------------------------------------------------------------------------
-- Group loot rolls
-------------------------------------------------------------------------------

local announcedRolls = {}

function ns.UpdateRolls()
  local candidates = {}
  for i = 1, 4 do
    local frame = _G["GroupLootFrame" .. i]
    if frame then
      local link = frame:IsShown() and frame.rollID and GetLootRollItemLink(frame.rollID)
      if link and SimCLabDB.settings.loot then
        candidates[#candidates + 1] = { frame = frame, link = link }
      else
        UI.Unmark(frame)
      end
    end
  end
  local _, best = ns.RankLinks(candidates)
  mark(candidates, best, "SimC Lab best: ")
end

local function announceRoll(rollID)
  if not SimCLabDB.settings.loot or announcedRolls[rollID] then return end
  local link = GetLootRollItemLink(rollID)
  local lines = link and ns.TooltipLines(link)
  if not lines then return end
  announcedRolls[rollID] = true
  local entry = ns.Evaluate(link)
  if entry and ns.Value(entry.result, entry.scenario) > 0 then
    ns.Print(link .. " " .. lines[1]:gsub("^.-SimC Lab:|r ", ""))
  end
end

local function hookRolls()
  if ns.rollsHooked then return end
  ns.rollsHooked = true
  for i = 1, 4 do
    local frame = _G["GroupLootFrame" .. i]
    if frame then
      frame:HookScript("OnShow", function() C_Timer.After(0, ns.UpdateRolls) end)
      frame:HookScript("OnHide", function() UI.Unmark(frame) C_Timer.After(0, ns.UpdateRolls) end)
    end
  end
end

ns.On("event", function(event, arg1)
  if event == "ADDON_LOADED" and arg1 == "Blizzard_WeeklyRewards" then hookVault() end
  if event == "PLAYER_LOGIN" then
    hookRolls()
    hookVault()
  end
  if event == "START_LOOT_ROLL" then
    announceRoll(arg1)
    C_Timer.After(0, ns.UpdateRolls)
  end
  if event == "WEEKLY_REWARDS_UPDATE" and WeeklyRewardsFrame and WeeklyRewardsFrame:IsShown() then ns.UpdateVault() end
end)
ns.eventFrame:RegisterEvent("START_LOOT_ROLL")
ns.eventFrame:RegisterEvent("WEEKLY_REWARDS_UPDATE")
