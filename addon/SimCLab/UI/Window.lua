-- The /simclab window: characters and specializations on the left; on the right the selected sim with its
-- scenario, date and baseline, a stale warning when the equipped gear no longer matches, and two tabs:
-- the top results, and the gear farm with its checklist.
local _, ns = ...
local UI = ns.UI

local W, H = 720, 500
local frame
local state = { key = nil, specId = nil, sim = 1, scenario = 1, tab = "results" }

local function entries()
  local list = {}
  local data = ns.data
  if not data then return list end
  local player = ns.PlayerCharacter()
  for key, c in pairs(data.characters) do
    for specId, spec in pairs(c.specs) do
      list[#list + 1] = { key = key, character = c, specId = specId, spec = spec, mine = c == player, newest = spec.sims[1].created }
    end
  end
  table.sort(list, function(a, b)
    if a.mine ~= b.mine then return a.mine end
    return a.newest > b.newest
  end)
  return list
end

local function selected()
  local data = ns.data
  local c = data and state.key and data.characters[state.key]
  local spec = c and c.specs[state.specId]
  if not spec then return nil end
  local sim = spec.sims[state.sim] or spec.sims[1]
  return c, spec, sim
end

local function selectDefault()
  local list = entries()
  local _, current, specId = ns.CurrentSpec()
  if current and specId and current.specs[specId] then
    state.key, state.specId = current.key, specId
  elseif list[1] then
    state.key, state.specId = list[1].key, list[1].specId
  else
    state.key, state.specId = nil, nil
  end
  state.sim, state.scenario = 1, 1
end

local function specLabel(spec)
  local s = spec.spec or ""
  return s:sub(1, 1):upper() .. s:sub(2)
end

-------------------------------------------------------------------------------
-- Rendering
-------------------------------------------------------------------------------

local function renderCharacters()
  local items = {}
  for _, e in ipairs(entries()) do
    local active = e.key == state.key and e.specId == state.specId
    items[#items + 1] = {
      title = (active and UI.Paint(ns.Plain(e.character.name), UI.colors.accent) or ns.Plain(e.character.name)),
      detail = ns.Plain(specLabel(e.spec) .. "  ·  " .. #e.spec.sims .. " sim" .. (#e.spec.sims == 1 and "" or "s")),
      onClick = function()
        state.key, state.specId, state.sim, state.scenario = e.key, e.specId, 1, 1
        ns.RefreshWindow()
      end,
    }
  end
  frame.characters:SetItems(items, true)
end

local function staleText(c, sim)
  local stale, changes = ns.IsStale(sim, c)
  if changes == nil then
    if c ~= ns.PlayerCharacter() then return UI.Paint("Log in on this character to check its gear against this sim.", UI.colors.muted), nil end
    return UI.Paint("This sim has no gear to compare.", UI.colors.muted), nil
  end
  if not stale then return UI.Paint("Up to date: your equipped gear matches this sim.", UI.colors.ok), nil end
  local names = {}
  for i, change in ipairs(changes) do
    if i <= 4 then names[#names + 1] = ns.SLOT_NAMES[change.slot] or change.slot end
  end
  local more = #changes > 4 and (" and " .. (#changes - 4) .. " more") or ""
  local lines = { "Gear changed since this sim" }
  for _, change in ipairs(changes) do lines[#lines + 1] = (ns.SLOT_NAMES[change.slot] or change.slot) .. ": " .. change.reason end
  lines[#lines + 1] = "Simulate again in SimC Lab and send the new result to WoW."
  return UI.Paint("STALE: " .. #changes .. " slot" .. (#changes == 1 and "" or "s") .. " changed (" .. table.concat(names, ", ") .. more .. "). Hover for details.", UI.colors.stale), lines
end

local function resultRows(c, spec, sim, scenario)
  local rows = {}
  for _, r in ipairs(scenario.results) do
    if sim.mode == "talents" then
      rows[#rows + 1] = UI.ResultRow(r, scenario, state.specId, {
        detail = r.talents and "Click to copy the talent string" or "",
        onClick = r.talents and function() UI.Copy(r.name or "Talent build", r.talents) end or nil,
      })
    elseif sim.mode == "compare" and not r.itemId and r.items and r.items[1] then
      local first = r.items[1]
      rows[#rows + 1] = UI.ResultRow(r, scenario, state.specId, {
        icon = C_Item and C_Item.GetItemIconByID and C_Item.GetItemIconByID(first.itemId) or nil,
        detail = #r.items .. " item" .. (#r.items == 1 and "" or "s") .. " changed",
      })
    else
      rows[#rows + 1] = UI.ResultRow(r, scenario, state.specId)
    end
  end
  if #rows == 0 then rows[1] = { title = UI.Paint("No result beat the current gear in this scenario.", UI.colors.muted) } end
  return rows
end

local function farmRows(c, spec, sim)
  local farmSim = ns.FarmSim(spec, sim)
  if not farmSim then
    return { { title = UI.Paint("No Upgrade Finder sim for this specialization yet.", UI.colors.muted), detail = "Run Upgrade Finder in SimC Lab and choose Send to WoW." } }, nil
  end
  local mine = c == ns.PlayerCharacter()
  local groups, scenario = ns.Farm(farmSim, farmSim == sim and state.scenario or 1, c.key)
  local rows = {}
  local total, missing, counted = 0, 0, {}
  for _, g in ipairs(groups) do
    local visible = {}
    for _, item in ipairs(g.items) do
      -- An item that drops in several places is one upgrade, listed under each source.
      local key = ns.ItemKey(item.result)
      if not counted[key] then
        counted[key] = true
        total = total + 1
        if not item.done then missing = missing + 1 end
      end
      if not (SimCLabDB.settings.hideDone and item.done) then visible[#visible + 1] = item end
    end
    if #visible > 0 then
      rows[#rows + 1] = {
        header = true,
        title = ns.Plain(g.title) .. (g.subtitle and UI.Paint("  " .. ns.Plain(g.subtitle), UI.colors.muted) or ""),
        value = g.missing > 0 and UI.Paint(g.missing .. " missing", UI.colors.accent) or UI.Paint("done", UI.colors.ok),
      }
      for _, item in ipairs(visible) do
        local r = item.result
        rows[#rows + 1] = UI.ResultRow(r, scenario, state.specId, {
          checkable = true,
          checked = item.done,
          dim = item.done,
          valueDetail = item.owned and (mine and "owned" or "") or (ns.Uncertain(r, scenario) and "uncertain" or ""),
          onCheck = function() ns.ToggleDone(c.key, r) end,
        })
      end
    end
  end
  if #rows == 0 then
    rows[1] = { title = UI.Paint(total > 0 and "Everything on the farm is done." or "This sim found no upgrades.", UI.colors.muted) }
  end
  local summary = string.format("%d upgrade%s from %d source%s, %d still missing", total, total == 1 and "" or "s", #groups, #groups == 1 and "" or "s", missing)
  return rows, summary, farmSim
end

function ns.RefreshWindow()
  if not frame or not frame:IsShown() then return end
  if not ns.data then
    frame.empty:SetText(ns.problem or "No data.")
    frame.empty:Show()
    frame.body:Hide()
    frame.characters:SetItems({})
    return
  end
  if state.key == nil or not ns.data.characters[state.key] then selectDefault() end
  renderCharacters()
  local c, spec, sim = selected()
  if not sim then
    frame.empty:SetText("No sims yet.\n\nIn SimC Lab, open an Upgrade Finder, Talent Search or Gear Compare result and choose Send to WoW, then type /reload.")
    frame.empty:Show()
    frame.body:Hide()
    return
  end
  frame.empty:Hide()
  frame.body:Show()
  local body = frame.body
  local simIndex = math.min(state.sim, #spec.sims)
  local scenario = sim.scenarios[state.scenario] or sim.scenarios[1]
  body.title:SetText(ns.Plain(c.name) .. "  " .. UI.Paint(ns.Plain(specLabel(spec)), UI.colors.muted))
  body.sim:SetText(ns.Plain(sim.title) .. UI.Paint("  " .. ns.Date(sim.created), UI.colors.muted))
  body.simIndex:SetText(simIndex .. " / " .. #spec.sims)
  body.prev:SetEnabled(simIndex > 1)
  body.next:SetEnabled(simIndex < #spec.sims)
  local settings = {}
  if type(sim.settings.season) == "string" then settings[#settings + 1] = sim.settings.season end
  if type(sim.settings.iterations) == "number" then settings[#settings + 1] = ns.Thousands(sim.settings.iterations) .. " iterations" end
  if type(sim.settings.duration) == "number" then settings[#settings + 1] = string.format("%.0f s", sim.settings.duration) end
  if sim.simc then settings[#settings + 1] = "SimC " .. sim.simc end
  body.settings:SetText(ns.Plain(table.concat(settings, "  ·  ")))
  body.scenario:SetText((#sim.scenarios > 1 and "Scenario " .. (state.scenario) .. "/" .. #sim.scenarios .. ": " or "Scenario: ") .. ns.Plain(ns.ScenarioLabel(scenario)))
  body.nextScenario:SetShown(#sim.scenarios > 1)
  if scenario.baseline then
    body.baseline:SetText("Current gear: " .. ns.Thousands(scenario.baseline.dps) .. " DPS" .. (scenario.baseline.error and (" ± " .. ns.Thousands(scenario.baseline.error)) or "") .. (scenario.metric == "score" and UI.Paint("   ranked by the DPS + survival score", UI.colors.muted) or ""))
  else
    body.baseline:SetText(UI.Paint("No baseline in this scenario.", UI.colors.muted))
  end
  local staleLine, staleTooltip = staleText(c, sim)
  body.stale:SetText(staleLine)
  body.staleArea.tooltip = staleTooltip
  local mismatch = ns.WowMismatch(sim)
  body.footer:SetText(UI.Paint(string.format("Data from SimC Lab %s, sent %s.%s", ns.data.app ~= "" and ns.data.app or "", ns.Date(ns.data.generated), mismatch and (" Simulated on WoW " .. sim.wow .. ", the game is " .. mismatch .. ".") or ""), UI.colors.muted))
  body.tabResults:SetEnabled(state.tab ~= "results")
  body.tabFarm:SetEnabled(state.tab ~= "farm")
  body.hideDone:SetShown(state.tab == "farm")
  body.hideDoneText:SetShown(state.tab == "farm")
  body.hideDone:SetChecked(SimCLabDB.settings.hideDone)
  if state.tab == "farm" then
    local rows, summary, farmSim = farmRows(c, spec, sim)
    body.summary:SetText(UI.Paint((summary or "") .. (farmSim and farmSim ~= sim and ("  ·  from the Upgrade Finder sim of " .. ns.Date(farmSim.created)) or ""), UI.colors.muted))
    body.list:SetItems(rows, true)
  else
    body.summary:SetText(UI.Paint(sim.mode == "upgrades" and "Top upgrades, best first. Shift-click an item to link it." or sim.mode == "talents" and "Best talent builds. Click a build to copy its string." or "Gear Compare variants, best first.", UI.colors.muted))
    body.list:SetItems(resultRows(c, spec, sim, scenario), true)
  end
end

-------------------------------------------------------------------------------
-- Construction
-------------------------------------------------------------------------------

local function build()
  frame = UI.Panel("SimCLabFrame", UIParent, W, H)
  frame:SetFrameStrata("HIGH")
  frame:SetToplevel(true)
  local pos = SimCLabDB.window
  if type(pos) == "table" and pos.point then
    frame:SetPoint(pos.point, UIParent, pos.relative or pos.point, pos.x or 0, pos.y or 0)
  else
    frame:SetPoint("CENTER")
  end
  UI.Movable(frame, function(self)
    local point, _, relative, x, y = self:GetPoint(1)
    SimCLabDB.window = { point = point, relative = relative, x = x, y = y }
  end)
  UI.Close(frame)
  if UISpecialFrames then table.insert(UISpecialFrames, "SimCLabFrame") end
  frame:Hide()

  local title = UI.Text(frame, "GameFontNormalLarge")
  title:SetPoint("TOPLEFT", 14, -12)
  title:SetText(UI.Paint("SimC Lab", UI.colors.accent) .. UI.Paint("  results from the desktop app", UI.colors.muted))

  -- Characters and specializations
  local left = CreateFrame("Frame", nil, frame)
  left:SetPoint("TOPLEFT", 10, -44)
  left:SetSize(180, H - 60)
  local leftTitle = UI.Text(left, "GameFontDisableSmall")
  leftTitle:SetPoint("TOPLEFT", 4, 0)
  leftTitle:SetText("CHARACTERS")
  frame.characters = UI.List(left, 14)
  frame.characters:SetPoint("TOPLEFT", left, "TOPLEFT", 0, -16)
  frame.characters:SetPoint("TOPRIGHT", left, "TOPRIGHT", 0, -16)
  frame.characters.position:SetPoint("BOTTOMLEFT", left, "BOTTOMLEFT", 4, 0)

  local divider = frame:CreateTexture(nil, "ARTWORK")
  divider:SetColorTexture(1, 1, 1, 0.08)
  divider:SetPoint("TOPLEFT", 198, -40)
  divider:SetPoint("BOTTOMLEFT", 198, 12)
  divider:SetWidth(1)

  frame.empty = UI.Text(frame, "GameFontHighlight", "CENTER")
  frame.empty:SetPoint("TOPLEFT", 214, -80)
  frame.empty:SetPoint("TOPRIGHT", -20, -80)

  local body = CreateFrame("Frame", nil, frame)
  body:SetPoint("TOPLEFT", 210, -40)
  body:SetPoint("BOTTOMRIGHT", -12, 10)
  frame.body = body

  body.title = UI.Text(body, "GameFontNormalLarge")
  body.title:SetPoint("TOPLEFT", 0, -2)
  body.sim = UI.Text(body, "GameFontHighlight")
  body.sim:SetPoint("TOPLEFT", 0, -26)
  body.next = UI.Button(body, ">", 26, 20)
  body.next:SetPoint("TOPRIGHT", body, "TOPRIGHT", -22, -22)
  body.simIndex = UI.Text(body, "GameFontHighlightSmall", "CENTER")
  body.simIndex:SetPoint("RIGHT", body.next, "LEFT", -6, 0)
  body.simIndex:SetWidth(44)
  body.prev = UI.Button(body, "<", 26, 20)
  body.prev:SetPoint("RIGHT", body.simIndex, "LEFT", -6, 0)
  body.prev:SetScript("OnClick", function() state.sim = math.max(1, state.sim - 1) state.scenario = 1 ns.RefreshWindow() end)
  body.next:SetScript("OnClick", function() state.sim = state.sim + 1 state.scenario = 1 ns.RefreshWindow() end)
  body.settings = UI.Text(body, "GameFontDisableSmall")
  body.settings:SetPoint("TOPLEFT", 0, -46)
  body.scenario = UI.Text(body, "GameFontHighlightSmall")
  body.scenario:SetPoint("TOPLEFT", 0, -64)
  body.nextScenario = UI.Button(body, "Next scenario", 104, 18)
  body.nextScenario:SetPoint("LEFT", body.scenario, "RIGHT", 10, 0)
  body.nextScenario:SetScript("OnClick", function()
    local _, _, sim = selected()
    if sim then state.scenario = state.scenario % #sim.scenarios + 1 end
    ns.RefreshWindow()
  end)
  body.baseline = UI.Text(body, "GameFontHighlightSmall")
  body.baseline:SetPoint("TOPLEFT", 0, -82)
  body.staleArea = CreateFrame("Frame", nil, body)
  body.staleArea:SetPoint("TOPLEFT", 0, -96)
  body.staleArea:SetPoint("TOPRIGHT", 0, -96)
  body.staleArea:SetHeight(18)
  body.staleArea:EnableMouse(true)
  body.staleArea:SetScript("OnEnter", function(self)
    if not self.tooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
    for i, line in ipairs(self.tooltip) do
      if i == 1 then GameTooltip:SetText(line, 1, 0.6, 0.25) else GameTooltip:AddLine(line, 0.85, 0.87, 0.9) end
    end
    GameTooltip:Show()
  end)
  body.staleArea:SetScript("OnLeave", function() GameTooltip:Hide() end)
  body.stale = UI.Text(body.staleArea, "GameFontHighlightSmall")
  body.stale:SetPoint("LEFT", 0, 0)
  body.stale:SetPoint("RIGHT", 0, 0)

  body.tabResults = UI.Button(body, "Results", 90, 22)
  body.tabResults:SetPoint("TOPLEFT", 0, -122)
  body.tabResults:SetScript("OnClick", function() state.tab = "results" ns.RefreshWindow() end)
  body.tabFarm = UI.Button(body, "Gear farm", 90, 22)
  body.tabFarm:SetPoint("LEFT", body.tabResults, "RIGHT", 6, 0)
  body.tabFarm:SetScript("OnClick", function() state.tab = "farm" ns.RefreshWindow() end)
  body.hideDone = UI.Check(body, 20)
  body.hideDone:SetPoint("LEFT", body.tabFarm, "RIGHT", 14, 0)
  body.hideDone:SetScript("OnClick", function(self) SimCLabDB.settings.hideDone = self:GetChecked() and true or false ns.RefreshWindow() end)
  body.hideDoneText = UI.Text(body, "GameFontHighlightSmall")
  body.hideDoneText:SetPoint("LEFT", body.hideDone, "RIGHT", 2, 0)
  body.hideDoneText:SetText("Hide done")

  body.summary = UI.Text(body, "GameFontDisableSmall")
  body.summary:SetPoint("TOPLEFT", 0, -150)
  body.list = UI.List(body, 9)
  body.list:SetPoint("TOPLEFT", body, "TOPLEFT", 0, -166)
  body.list:SetPoint("TOPRIGHT", body, "TOPRIGHT", 0, -166)
  body.list.position:SetPoint("TOPRIGHT", body.list, "BOTTOMRIGHT", -4, -2)
  body.footer = UI.Text(body, "GameFontDisableSmall")
  body.footer:SetPoint("BOTTOMLEFT", 0, 2)
  body.footer:SetPoint("BOTTOMRIGHT", -150, 2)

  frame:SetScript("OnShow", ns.RefreshWindow)
end

ns.On("toggle", function(tab)
  if not frame then build() end
  if frame:IsShown() and (tab == nil or tab == state.tab) then
    frame:Hide()
    return
  end
  if tab then state.tab = tab end
  frame:Show()
  ns.RefreshWindow()
end)
ns.On("data", function() state.key = nil ns.RefreshWindow() end)
ns.On("player", function() state.key = nil ns.RefreshWindow() end)
ns.On("gear", ns.RefreshWindow)
ns.On("checklist", ns.RefreshWindow)
ns.On("reset", function()
  if frame then frame:ClearAllPoints() frame:SetPoint("CENTER") end
end)
