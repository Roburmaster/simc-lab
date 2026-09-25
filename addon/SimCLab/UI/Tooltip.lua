-- Item tooltips: "SimC Lab: +2.31% (Myth 1/6, Heroic Ula'tek)" on any item SimC Lab simulated for the
-- logged-in character and specialization, matched on item ID and the upgrade level read from its bonus IDs.
local _, ns = ...
local UI = ns.UI

local PREFIX = "|cff4fc3f7SimC Lab:|r "

-- Tooltip data can carry secret values in 12.x; they are never compared or indexed, only skipped.
local function secret(v)
  return issecretvalue and issecretvalue(v)
end

function ns.TooltipLines(link)
  local entry, exact = ns.Evaluate(link)
  if not entry then return nil end
  local r, scenario, sim = entry.result, entry.scenario, entry.sim
  local value = ns.Value(r, scenario)
  local where = {}
  local track = ns.TrackLabel(r)
  if track then where[#where + 1] = track end
  if r.sources[1] then where[#where + 1] = ns.SourceShort(r.sources[1], r.itemId) end
  local context = #where > 0 and table.concat(where, ", ") or nil
  local text = UI.Paint(ns.FormatValue(r, scenario), UI.ValueColor(value))
  local line
  if exact then
    line = PREFIX .. text .. (context and (" (" .. ns.Plain(context) .. ")") or "")
  else
    line = PREFIX .. text .. UI.Paint(" at " .. ns.Plain(track or "another level") .. (r.sources[1] and (" (" .. ns.Plain(ns.SourceShort(r.sources[1], r.itemId)) .. ")") or ""), UI.colors.muted)
  end
  local notes = {}
  if ns.Uncertain(r, scenario) then notes[#notes + 1] = "within the error" end
  if r.screening then notes[#notes + 1] = "screening only" end
  if ns.IsStale(sim) then notes[#notes + 1] = "stale: gear changed since this sim" end
  local lines = { line }
  if #notes > 0 then lines[#lines + 1] = UI.Paint("  " .. table.concat(notes, ", "), UI.colors.muted) end
  -- The same item in the sim's other scenarios.
  for index, other in ipairs(sim.scenarios) do
    if index ~= entry.scenarioIndex then
      for _, o in ipairs(other.results) do
        if o.itemId == r.itemId and ns.SameSet(o.bonusIds, r.bonusIds) then
          lines[#lines + 1] = UI.Paint("  " .. ns.Plain(ns.ScenarioLabel(other)) .. ": ", UI.colors.muted) .. UI.Paint(ns.FormatValue(o, other), UI.ValueColor(ns.Value(o, other)))
          break
        end
      end
    end
  end
  return lines
end

local function linkFrom(tooltip, data)
  local link = data and data.hyperlink
  if (not link or secret(link)) and data and data.guid and not secret(data.guid) and C_Item and C_Item.GetItemLinkByGUID then
    link = C_Item.GetItemLinkByGUID(data.guid)
  end
  if (not link or secret(link)) and TooltipUtil and TooltipUtil.GetDisplayedItem then
    local _, displayed = TooltipUtil.GetDisplayedItem(tooltip)
    link = displayed
  end
  if not link or secret(link) or type(link) ~= "string" then return nil end
  return link
end

local function onTooltip(tooltip, data)
  if not SimCLabDB or not SimCLabDB.settings.tooltip or not ns.index or not tooltip or not tooltip.AddLine then return end
  local link = linkFrom(tooltip, data)
  if not link then return end
  local lines = ns.TooltipLines(link)
  if not lines then return end
  for _, line in ipairs(lines) do tooltip:AddLine(line, 1, 1, 1) end
end

function ns.HookTooltips()
  if ns.tooltipsHooked or not (TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType) then return end
  ns.tooltipsHooked = true
  TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Item, function(tooltip, data)
    local ok, err = pcall(onTooltip, tooltip, data)
    if not ok and ns.debug then ns.Print("tooltip error: " .. tostring(err)) end
  end)
end

ns.HookTooltips()
