-- Small widget kit shared by the window, the journal panel and the loot highlights. Built only on
-- BackdropTemplate, UIPanelButtonTemplate and UIPanelCloseButton, which every client of this era has.
local _, ns = ...

local UI = {}
ns.UI = UI

UI.colors = {
  accent = { 0.95, 0.72, 0.33 },
  gain = { 0.45, 0.88, 0.58 },
  loss = { 0.96, 0.46, 0.42 },
  muted = { 0.6, 0.64, 0.7 },
  stale = { 1, 0.6, 0.25 },
  ok = { 0.45, 0.88, 0.58 },
  brand = { 0.31, 0.76, 0.97 },
}

local WHITE = "Interface\\Buttons\\WHITE8X8"

function UI.Hex(c)
  local function byte(v) return math.floor(v * 255 + 0.5) end
  return string.format("ff%02x%02x%02x", byte(c[1]), byte(c[2]), byte(c[3]))
end

function UI.Paint(text, c)
  return "|c" .. UI.Hex(c) .. text .. "|r"
end

function UI.ValueColor(value)
  if value > 0 then return UI.colors.gain end
  if value < 0 then return UI.colors.loss end
  return UI.colors.muted
end

function UI.Panel(name, parent, width, height)
  local f = CreateFrame("Frame", name, parent or UIParent, "BackdropTemplate")
  f:SetSize(width, height)
  f:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
  f:SetBackdropColor(0.06, 0.07, 0.1, 0.96)
  f:SetBackdropBorderColor(0.27, 0.3, 0.37, 1)
  return f
end

function UI.Text(parent, font, justify)
  local fs = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
  fs:SetJustifyH(justify or "LEFT")
  return fs
end

-- A font string anchored on both sides has a width, and then a long line wraps onto the next one. In a fixed
-- row that second line lands on top of the text below it, so text that must stay on one line is cut instead.
function UI.OneLine(fs)
  if fs.SetWordWrap then fs:SetWordWrap(false) end
  if fs.SetMaxLines then fs:SetMaxLines(1) end
  return fs
end

function UI.Button(parent, text, width, height)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(width or 80, height or 22)
  b:SetText(text)
  return b
end

function UI.Close(parent, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelCloseButton")
  b:SetPoint("TOPRIGHT", parent, "TOPRIGHT", 0, 0)
  b:SetScript("OnClick", onClick or function() parent:Hide() end)
  return b
end

function UI.Check(parent, size)
  local c = CreateFrame("CheckButton", nil, parent)
  c:SetSize(size or 20, size or 20)
  c:SetNormalTexture("Interface\\Buttons\\UI-CheckBox-Up")
  c:SetPushedTexture("Interface\\Buttons\\UI-CheckBox-Down")
  c:SetHighlightTexture("Interface\\Buttons\\UI-CheckBox-Highlight", "ADD")
  c:SetCheckedTexture("Interface\\Buttons\\UI-CheckBox-Check")
  return c
end

function UI.Movable(frame, onMoved)
  frame:SetMovable(true)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetClampedToScreen(true)
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    if onMoved then onMoved(self) end
  end)
end

-- A coloured border drawn around another frame, plus a label above it. Kept in a side table rather than on
-- Blizzard's frames, so nothing is written into their tables.
local marks = setmetatable({}, { __mode = "k" })

function UI.Mark(frame)
  local m = marks[frame]
  if m then return m end
  m = CreateFrame("Frame", nil, frame, "BackdropTemplate")
  m:SetPoint("TOPLEFT", frame, "TOPLEFT", -3, 3)
  m:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", 3, -3)
  m:SetBackdrop({ edgeFile = WHITE, edgeSize = 2 })
  m:SetFrameLevel((frame:GetFrameLevel() or 1) + 8)
  m.label = m:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  m.label:SetPoint("BOTTOMLEFT", m, "TOPLEFT", 2, 2)
  m:Hide()
  marks[frame] = m
  return m
end

function UI.Unmark(frame)
  local m = marks[frame]
  if m then m:Hide() end
end

-- Shows a line of text selected in an edit box, ready for Ctrl+C. The game has no clipboard API.
function UI.Copy(title, text)
  local box = UI.copyBox
  if not box then
    box = UI.Panel("SimCLabCopy", UIParent, 460, 92)
    box:SetFrameStrata("DIALOG")
    box:SetPoint("CENTER")
    box.title = UI.Text(box, "GameFontNormal")
    box.title:SetPoint("TOPLEFT", 12, -10)
    box.hint = UI.Text(box, "GameFontDisableSmall")
    box.hint:SetPoint("BOTTOMLEFT", 12, 10)
    box.hint:SetText("Press Ctrl+C to copy, then Escape.")
    box.edit = CreateFrame("EditBox", nil, box, "BackdropTemplate")
    box.edit:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
    box.edit:SetBackdropColor(0, 0, 0, 0.6)
    box.edit:SetBackdropBorderColor(0.3, 0.3, 0.36, 1)
    box.edit:SetFontObject(ChatFontNormal)
    box.edit:SetTextInsets(6, 6, 0, 0)
    box.edit:SetPoint("TOPLEFT", 12, -32)
    box.edit:SetPoint("TOPRIGHT", -12, -32)
    box.edit:SetHeight(24)
    box.edit:SetAutoFocus(true)
    box.edit:SetScript("OnEscapePressed", function() box:Hide() end)
    box.edit:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
    UI.Close(box)
    UI.copyBox = box
  end
  box.title:SetText(ns.Plain(title))
  box.edit:SetText(text)
  box:Show()
  box.edit:SetFocus()
  box.edit:HighlightText()
end

-------------------------------------------------------------------------------
-- A scrolling list of fixed rows. Rows are described by tables; the list redraws the visible slice.
-------------------------------------------------------------------------------

local ROW = 30
-- The column the gain and its note are drawn in. The title and detail end where it starts.
local VALUE_WIDTH = 96

local function itemName(result)
  local name = result.name or ("Item " .. tostring(result.itemId))
  local quality = C_Item and C_Item.GetItemQualityByID and C_Item.GetItemQualityByID(result.itemId)
  local color = quality and ITEM_QUALITY_COLORS and ITEM_QUALITY_COLORS[quality]
  if color and color.hex then return color.hex .. ns.Plain(name) .. "|r" end
  return ns.Plain(name)
end
UI.ItemName = itemName

local function createRow(list, index)
  local row = CreateFrame("Button", nil, list)
  row:SetHeight(ROW)
  row:SetPoint("TOPLEFT", list, "TOPLEFT", 0, -(index - 1) * ROW)
  row:SetPoint("TOPRIGHT", list, "TOPRIGHT", 0, -(index - 1) * ROW)
  row.check = UI.Check(row, 18)
  row.check:SetPoint("LEFT", 2, 0)
  row.icon = row:CreateTexture(nil, "ARTWORK")
  row.icon:SetSize(24, 24)
  row.title = UI.OneLine(UI.Text(row, "GameFontHighlight"))
  row.title:SetPoint("TOPRIGHT", row, "TOPRIGHT", -VALUE_WIDTH, -2)
  row.detail = UI.OneLine(UI.Text(row, "GameFontDisableSmall"))
  row.detail:SetPoint("BOTTOMRIGHT", row, "BOTTOMRIGHT", -VALUE_WIDTH, 3)
  row.value = UI.OneLine(UI.Text(row, "GameFontHighlight", "RIGHT"))
  row.value:SetPoint("TOPRIGHT", row, "TOPRIGHT", -6, -2)
  row.value:SetWidth(VALUE_WIDTH - 12)
  row.valueDetail = UI.OneLine(UI.Text(row, "GameFontDisableSmall", "RIGHT"))
  row.valueDetail:SetPoint("BOTTOMRIGHT", row, "BOTTOMRIGHT", -6, 3)
  row.valueDetail:SetWidth(VALUE_WIDTH - 12)
  row.line = row:CreateTexture(nil, "BACKGROUND")
  row.line:SetColorTexture(1, 1, 1, 0.05)
  row.line:SetPoint("BOTTOMLEFT")
  row.line:SetPoint("BOTTOMRIGHT")
  row.line:SetHeight(1)
  row.highlight = row:CreateTexture(nil, "HIGHLIGHT")
  row.highlight:SetAllPoints()
  row.highlight:SetColorTexture(1, 1, 1, 0.06)
  row:SetScript("OnEnter", function(self)
    local d = self.data
    if d and d.link then
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:SetHyperlink(d.link)
      GameTooltip:Show()
    elseif d and d.tooltip then
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      for i, line in ipairs(d.tooltip) do
        if i == 1 then GameTooltip:SetText(line, 1, 1, 1) else GameTooltip:AddLine(line, 0.8, 0.82, 0.86, true) end
      end
      GameTooltip:Show()
    end
  end)
  row:SetScript("OnLeave", function() GameTooltip:Hide() end)
  row:SetScript("OnClick", function(self)
    local d = self.data
    if d and d.link and IsModifiedClick and IsModifiedClick() and HandleModifiedItemClick then
      HandleModifiedItemClick(d.link)
    elseif d and d.onClick then
      d.onClick()
    end
  end)
  row.check:SetScript("OnClick", function(self)
    local d = self:GetParent().data
    if d and d.onCheck then d.onCheck(self:GetChecked()) end
  end)
  return row
end

local function drawRow(row, d)
  row.data = d
  if not d then row:Hide() return end
  row:Show()
  local left = 6
  if d.checkable then
    row.check:Show()
    row.check:SetChecked(d.checked and true or false)
    left = 26
  else
    row.check:Hide()
  end
  if d.icon then
    row.icon:Show()
    row.icon:SetTexture(d.icon)
    row.icon:ClearAllPoints()
    row.icon:SetPoint("LEFT", row, "LEFT", left, 0)
    row.icon:SetDesaturated(d.dim and true or false)
    left = left + 30
  else
    row.icon:Hide()
  end
  row.title:ClearAllPoints()
  row.title:SetPoint("TOPLEFT", row, "TOPLEFT", left, d.header and -8 or -2)
  row.title:SetPoint("TOPRIGHT", row, "TOPRIGHT", -VALUE_WIDTH, -2)
  row.detail:ClearAllPoints()
  row.detail:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT", left, 3)
  row.detail:SetPoint("BOTTOMRIGHT", row, "BOTTOMRIGHT", -VALUE_WIDTH, 3)
  row.title:SetFontObject(d.header and "GameFontNormal" or "GameFontHighlight")
  row.title:SetText(d.title or "")
  row.title:SetAlpha(d.dim and 0.55 or 1)
  row.detail:SetText(d.header and "" or (d.detail or ""))
  row.value:SetText(d.value or "")
  row.valueDetail:SetText(d.valueDetail or "")
  row.line:SetShown(d.header and true or false)
end

function UI.List(parent, rows)
  local list = CreateFrame("Frame", nil, parent)
  list.rows = {}
  list.items = {}
  list.offset = 0
  list.visible = rows
  list:SetHeight(rows * ROW)
  for i = 1, rows do list.rows[i] = createRow(list, i) end
  list.position = UI.Text(parent, "GameFontDisableSmall", "RIGHT")
  list:EnableMouseWheel(true)
  list:SetScript("OnMouseWheel", function(self, delta)
    self:Scroll(-delta * 3)
  end)
  function list:Scroll(by)
    local max = math.max(0, #self.items - self.visible)
    self.offset = math.max(0, math.min(max, self.offset + by))
    self:Draw()
  end
  function list:SetItems(items, keepOffset)
    self.items = items or {}
    if not keepOffset then self.offset = 0 end
    self:Scroll(0)
  end
  function list:Draw()
    for i = 1, self.visible do drawRow(self.rows[i], self.items[self.offset + i]) end
    if #self.items > self.visible then
      self.position:SetText(string.format("%d-%d of %d, scroll for more", self.offset + 1, math.min(#self.items, self.offset + self.visible), #self.items))
    else
      self.position:SetText("")
    end
  end
  return list
end

-- Row descriptors shared by every view.
function UI.ResultRow(result, scenario, specId, extra)
  local value = ns.Value(result, scenario)
  local valueText = UI.Paint(ns.FormatValue(result, scenario), UI.ValueColor(value))
  local notes = {}
  if ns.Uncertain(result, scenario) then notes[#notes + 1] = "uncertain" end
  if result.screening then notes[#notes + 1] = "screening only" end
  local detail = {}
  if result.slot then detail[#detail + 1] = ns.SLOT_NAMES[result.slot] or result.slot end
  local track = ns.TrackLabel(result)
  if track then detail[#detail + 1] = track end
  if result.sources[1] then detail[#detail + 1] = ns.SourceShort(result.sources[1], result.itemId) .. (#result.sources > 1 and (" +" .. (#result.sources - 1)) or "") end
  local row = {
    title = result.itemId and itemName(result) or ns.Plain(result.name or "Result"),
    detail = ns.Plain(table.concat(detail, "  ·  ")),
    value = valueText,
    valueDetail = table.concat(notes, ", "),
    icon = result.itemId and C_Item and C_Item.GetItemIconByID and C_Item.GetItemIconByID(result.itemId) or nil,
    link = result.itemId and ns.ItemString(result, specId) or nil,
  }
  if extra then for k, v in pairs(extra) do row[k] = v end end
  return row
end
