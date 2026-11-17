-- The meter window: small, Details!-style. A title bar with the fight time and the display, little
-- buttons for segment / display / report / options, and class-coloured bars (rank, name, total,
-- per second, share). Hover a bar: the player's top spells. Click: the spell breakdown next to the
-- window. Right-click: the displays (bookmarks). Drag the corner to resize, the title to move.
--
-- Same rules as everywhere: only you and your party (Meter.Visible), secret values are shown but
-- never compared or added up. A dot in the title shows whether the logs are on (click: on/off);
-- "Your records" (from the Companion) is one of the displays. Settings: Options → AddOns.

local _, ns = ...

local Win = {}
ns.Window = Win

local BAR = "Interface\\TargetingFrame\\UI-StatusBar"
local MEDIA = "Interface\\AddOns\\WowCompany\\Media\\"
local GOLD = { 1.00, 0.82, 0.00 }
local TITLE_H = 20
local MIN_W, MIN_H, MAX_W, MAX_H = 180, 80, 600, 640

local win, breakdown, menu
local bars = {}
local state = { scroll = 0, sessionId = nil, sessionName = nil, combatStart = nil }

-- ------------------------------------------------------------------ helpers

local function opts() return ns.db.settings end

local function classColor(class)
    class = ns.plain(class)
    local c = class and type(RAID_CLASS_COLORS) == "table" and RAID_CLASS_COLORS[class]
    if c then return c.r, c.g, c.b end
    return 0.6, 0.6, 0.6
end

-- 1234 -> "1.2K", 3456789 -> "3.46M"; a secret goes through the game's own formatting
function ns.short(n)
    if ns.isSecret(n) then return ns.fmt(n) end
    if type(n) ~= "number" then return "–" end
    local a = math.abs(n)
    if a >= 1e6 then return string.format("%.2fM", n / 1e6) end
    if a >= 1e4 then return string.format("%.1fK", n / 1e3) end
    if a >= 1e3 then return string.format("%.2fK", n / 1e3) end
    return string.format("%d", math.floor(n + 0.5))
end

local function setText(fs, v)
    if v == nil then
        fs:SetText("")
    elseif ns.isSecret(v) then
        pcall(fs.SetText, fs, v)
    else
        fs:SetText(v)
    end
end

local function font(parent, template, justify)
    local fs = parent:CreateFontString(nil, "OVERLAY", template or "GameFontHighlightSmall")
    fs:SetJustifyH(justify or "LEFT")
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    return fs
end

local function backdrop(f, alpha)
    if not f.SetBackdrop then return end
    f:SetBackdrop({
        bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 12,
        insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    f:SetBackdropColor(0.04, 0.035, 0.03, alpha or 0.88)
    f:SetBackdropBorderColor(0.85, 0.66, 0.24, 0.9)
end

local function template() return BackdropTemplateMixin and "BackdropTemplate" or nil end

local function kindDef(key)
    for _, list in ipairs({ ns.Meter.KINDS, ns.Meter.MORE }) do
        for i = 1, #list do
            if list[i].key == key then return list[i] end
        end
    end
    return ns.Meter.KINDS[1]
end

-- every display, in menu order
local function displays()
    local out, seen = {}, {}
    for _, list in ipairs({ ns.Meter.KINDS, ns.Meter.MORE }) do
        for i = 1, #list do
            if not seen[list[i].key] then
                seen[list[i].key] = true
                table.insert(out, list[i])
            end
        end
    end
    return out
end

-- seconds of the shown fight (plain), or nil
local function fightSeconds(session)
    local d = session and ns.plain(session.durationSeconds)
    if type(d) == "number" and d > 0 and d < 3 * 3600 then return d end
    if state.sessionId == nil and opts().winScope ~= "overall" and type(C_DamageMeter) == "table"
        and type(C_DamageMeter.GetSessionDurationSeconds) == "function" and type(Enum) == "table"
        and type(Enum.DamageMeterSessionType) == "table" then
        local ok, v = pcall(C_DamageMeter.GetSessionDurationSeconds, Enum.DamageMeterSessionType.Current)
        v = ok and ns.plain(v) or nil
        if type(v) == "number" and v > 0 and v < 3 * 3600 then return v end
    end
    return nil
end

local function readSession()
    local s = opts()
    return ns.Meter.Read(state.sessionId and nil or s.winScope, s.winKind, state.sessionId)
end

-- ------------------------------------------------------------------ popup menu (one level)

local function hideMenu() if menu then menu:Hide() end end

-- items: { text, checked, func, disabled, title = true for a heading, separator = true }
local function showMenu(anchor, items)
    if not menu then
        menu = CreateFrame("Frame", "WowCompanyMenu", UIParent, template())
        menu:SetFrameStrata("DIALOG")
        menu:SetClampedToScreen(true)
        backdrop(menu, 0.96)
        menu.rows = {}
        menu:EnableMouse(true)
        tinsert(UISpecialFrames, "WowCompanyMenu")
    end
    local y, width = -7, 120
    for i = 1, math.max(#items, #menu.rows) do
        local it, row = items[i], menu.rows[i]
        if it and not row then
            row = CreateFrame("Button", nil, menu)
            row:SetHeight(16)
            row.check = row:CreateTexture(nil, "ARTWORK")
            row.check:SetTexture("Interface\\Buttons\\UI-CheckBox-Check")
            row.check:SetSize(14, 14)
            row.check:SetPoint("LEFT", 2, 0)
            row.label = font(row, "GameFontHighlightSmall", "LEFT")
            row.label:SetPoint("LEFT", 18, 0)
            local hl = row:CreateTexture(nil, "HIGHLIGHT")
            hl:SetAllPoints()
            hl:SetColorTexture(1, 0.82, 0, 0.15)
            menu.rows[i] = row
        end
        if it then
            row:ClearAllPoints()
            row:SetPoint("TOPLEFT", 6, y)
            row:SetPoint("RIGHT", menu, "RIGHT", -6, 0)
            row.label:SetText(it.separator and "" or it.text or "")
            if it.title then
                row.label:SetTextColor(GOLD[1], GOLD[2], GOLD[3])
            elseif it.disabled then
                row.label:SetTextColor(0.45, 0.42, 0.38)
            else
                row.label:SetTextColor(0.93, 0.90, 0.84)
            end
            row.check:SetShown(it.checked == true)
            row:SetEnabled(not (it.title or it.separator or it.disabled))
            row:SetScript("OnClick", function()
                hideMenu()
                if it.func then it.func() end
                Win.Refresh()
            end)
            row:Show()
            local h = it.separator and 6 or 16
            row:SetHeight(h)
            y = y - h
            local w = row.label.GetStringWidth and row.label:GetStringWidth()
            if type(w) == "number" and w + 30 > width then width = w + 30 end
        elseif row then
            row:Hide()
        end
    end
    menu:SetSize(math.min(width, 260), -y + 7)
    menu:ClearAllPoints()
    menu:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -2)
    menu:Show()
end

local function displayMenu(anchor)
    local items = { { text = "Displays", title = true } }
    for _, k in ipairs(displays()) do
        table.insert(items, {
            text = k.label,
            checked = opts().winKind == k.key and not state.mySpells and not state.records,
            func = function()
                opts().winKind = k.key
                state.mySpells, state.records = false, false
                Win.CloseBreakdown()
            end,
        })
    end
    table.insert(items, { separator = true })
    table.insert(items, {
        text = "My spells",
        checked = state.mySpells == true,
        func = function() state.mySpells, state.records = true, false end,
    })
    table.insert(items, {
        text = "Your records",
        checked = state.records == true,
        func = function() state.records, state.mySpells = true, false end,
    })
    showMenu(anchor, items)
end

local function segmentMenu(anchor)
    local items = { { text = "Segments", title = true } }
    for _, sc in ipairs({ { "current", "This fight" }, { "overall", "Overall" } }) do
        table.insert(items, {
            text = sc[2],
            checked = state.sessionId == nil and opts().winScope == sc[1],
            func = function()
                opts().winScope = sc[1]
                state.sessionId, state.sessionName = nil, nil
            end,
        })
    end
    local fights = ns.Meter.Fights(12)
    if #fights > 0 then table.insert(items, { separator = true }) end
    for _, f in ipairs(fights) do
        table.insert(items, {
            text = (f.boss and "|cffffd100" or "") .. f.name .. (f.boss and "|r" or "") .. "  |cff9d9d9d"
                .. ns.fmtTime(f.duration) .. "|r",
            checked = state.sessionId == f.id,
            func = function() state.sessionId, state.sessionName = f.id, f.name end,
        })
    end
    showMenu(anchor, items)
end

-- ------------------------------------------------------------------ report (party chat only)

-- channel "SELF" = only in your own chat frame
local function report(channel)
    local s = opts()
    local session = readSession()
    local rows = ns.Meter.Visible(session, s.winKind)
    local lines, n = {}, 0
    for i = 1, #rows do
        local name, amount, per = ns.plain(rows[i].name), ns.plain(rows[i].totalAmount),
            ns.plain(rows[i].amountPerSecond)
        if not (name and type(amount) == "number") then
            ns.say("numbers are hidden mid-fight – report after it ends.")
            return
        end
        n = n + 1
        if n > 5 then break end
        table.insert(lines, string.format("%d. %s %s%s", n, name, ns.short(amount),
            type(per) == "number" and string.format(" (%.1f)", per) or ""))
    end
    if n == 0 then
        ns.say("nothing to report yet.")
        return
    end
    local title = string.format("[WowCompany] %s – %s", kindDef(s.winKind).label,
        state.sessionName or (s.winScope == "overall" and "Overall" or "This fight"))
    table.insert(lines, 1, title)
    for i = 1, #lines do
        if channel == "SELF" then
            ns.say(lines[i])
        elseif type(SendChatMessage) == "function" then
            pcall(SendChatMessage, lines[i], channel)
        end
    end
end

local function reportMenu(anchor)
    local grouped = type(IsInGroup) == "function" and IsInGroup()
    local inInstance = type(IsInGroup) == "function" and type(LE_PARTY_CATEGORY_INSTANCE) ~= "nil"
        and IsInGroup(LE_PARTY_CATEGORY_INSTANCE)
    showMenu(anchor, {
        { text = "Report top 5 to…", title = true },
        { text = "Party", disabled = not grouped, func = function() report("PARTY") end },
        { text = "Instance group", disabled = not inInstance, func = function() report("INSTANCE_CHAT") end },
        { text = "Only you (chat frame)", func = function() report("SELF") end },
    })
end

local function optionsMenu(anchor)
    local s = opts()
    showMenu(anchor, {
        { text = "WowCompany", title = true },
        { text = "Settings…", func = function() ns.Options.Open() end },
        { text = ns.Logging.CombatOn() and "Stop logging now" or "Start logging now", func = function()
            local on = ns.Logging.CombatOn() and ns.Logging.ChatOn()
            ns.Logging.Set(not on, true)
        end },
        { separator = true },
        { text = "Lock window (Esc leaves it open)", checked = s.winLocked == true, func = function()
            s.winLocked = not s.winLocked
            Win.ApplyLock()
        end },
        { text = "Show percent", checked = s.winPercent ~= false, func = function()
            s.winPercent = s.winPercent == false
        end },
        { text = "Bars: small", checked = s.winBar == 14, func = function() s.winBar = 14 Win.Layout() end },
        { text = "Bars: normal", checked = s.winBar == 17, func = function() s.winBar = 17 Win.Layout() end },
        { text = "Bars: large", checked = s.winBar == 21, func = function() s.winBar = 21 Win.Layout() end },
        { text = "Update: fast (0.25 s)", checked = s.winUpdate == 0.25, func = function() s.winUpdate = 0.25 end },
        { text = "Update: normal (0.5 s)", checked = s.winUpdate == 0.5, func = function() s.winUpdate = 0.5 end },
        { text = "Update: relaxed (1 s)", checked = s.winUpdate == 1, func = function() s.winUpdate = 1 end },
        { separator = true },
        { text = "Help development (diagnostics)", checked = s.diagnostics == true, func = function()
            ns.SetDiagnostics(not s.diagnostics)
        end },
        { text = "Hide window", func = function() win:Hide() end },
    })
end

-- ------------------------------------------------------------------ spell breakdown (next to the window)

local function spellRows(parent, count)
    local list = {}
    for i = 1, count do
        local r = CreateFrame("StatusBar", nil, parent)
        r:SetStatusBarTexture(BAR)
        r:SetMinMaxValues(0, 1)
        r:SetHeight(15)
        r:SetPoint("TOPLEFT", 6, -26 - (i - 1) * 16)
        r:SetPoint("RIGHT", parent, "RIGHT", -6, 0)
        local back = r:CreateTexture(nil, "BACKGROUND")
        back:SetAllPoints()
        back:SetColorTexture(1, 1, 1, 0.04)
        r.icon = r:CreateTexture(nil, "ARTWORK")
        r.icon:SetSize(15, 15)
        r.icon:SetPoint("LEFT")
        r.pct = font(r, "GameFontHighlightSmall", "RIGHT")
        r.pct:SetPoint("RIGHT", -3, 0)
        r.pct:SetWidth(40)
        r.per = font(r, "GameFontHighlightSmall", "RIGHT")
        r.per:SetPoint("RIGHT", r.pct, "LEFT", -2, 0)
        r.per:SetWidth(40)
        r.amount = font(r, "GameFontHighlightSmall", "RIGHT")
        r.amount:SetPoint("RIGHT", r.per, "LEFT", -2, 0)
        r.amount:SetWidth(50)
        r.name = font(r, "GameFontHighlightSmall", "LEFT")
        r.name:SetPoint("LEFT", r.icon, "RIGHT", 4, 0)
        r.name:SetPoint("RIGHT", r.amount, "LEFT", -4, 0)
        r:Hide()
        list[i] = r
    end
    return list
end

local function buildBreakdown()
    breakdown = CreateFrame("Frame", "WowCompanyBreakdown", UIParent, template())
    breakdown:SetSize(300, 26 + 12 * 16 + 8)
    breakdown:SetFrameStrata("MEDIUM")
    backdrop(breakdown, 0.94)
    breakdown.title = font(breakdown, "GameFontNormalSmall", "LEFT")
    breakdown.title:SetPoint("TOPLEFT", 8, -8)
    breakdown.title:SetPoint("RIGHT", -26, 0)
    local close = CreateFrame("Button", nil, breakdown, "UIPanelCloseButton")
    close:SetSize(22, 22)
    close:SetPoint("TOPRIGHT", 0, 0)
    close:SetScript("OnClick", function() Win.CloseBreakdown() end)
    breakdown.rows = spellRows(breakdown, 12)
    breakdown:Hide()
end

local function spellIcon(name)
    if type(C_Spell) == "table" and type(C_Spell.GetSpellTexture) == "function" and name then
        local ok, tex = pcall(C_Spell.GetSpellTexture, name)
        if ok and tex then return tex end
    end
    return "Interface\\Icons\\INV_Misc_QuestionMark"
end

local function fillBreakdown()
    if not (breakdown and breakdown:IsShown() and state.detail) then return end
    local s = opts()
    local spells = ns.Meter.Spells(state.sessionId and nil or s.winScope, s.winKind, state.sessionId,
        state.detail.guid)
    local sum, max, plain = 0, 0, true
    for _, sp in ipairs(spells or {}) do
        local a = ns.plain(sp.amount)
        if type(a) ~= "number" then plain = false break end
        sum, max = sum + a, math.max(max, a)
    end
    local r, g, b = classColor(state.detail.class)
    breakdown.title:SetText(string.format("|cff%02x%02x%02x%s|r  ·  %s", r * 255, g * 255, b * 255,
        state.detail.name or "?", kindDef(s.winKind).label))
    for i, row in ipairs(breakdown.rows) do
        local sp = spells and spells[i]
        if sp then
            row:SetStatusBarColor(r, g, b, 0.45)
            pcall(row.SetMinMaxValues, row, 0, plain and math.max(max, 1) or 1)
            pcall(row.SetValue, row, plain and sp.amount or 0)
            row.icon:SetTexture(spellIcon(sp.name))
            row.name:SetText(sp.name .. (sp.pet and (" (" .. sp.pet .. ")") or ""))
            setText(row.amount, ns.short(sp.amount))
            setText(row.per, ns.fmtRate(sp.perSecond))
            local a = ns.plain(sp.amount)
            row.pct:SetText(plain and sum > 0 and type(a) == "number" and string.format("%.1f%%", a / sum * 100) or "")
            row:Show()
        else
            row:Hide()
        end
    end
    if not spells or #spells == 0 then
        breakdown.rows[1].name:SetText(spells and "Nothing to break down." or "Hidden mid-fight.")
        breakdown.rows[1]:Show()
    end
end

function Win.OpenBreakdown(guid, name, class)
    if not breakdown then buildBreakdown() end
    state.detail = { guid = guid, name = name, class = class }
    breakdown:ClearAllPoints()
    -- next to the window, on the side with room
    local right = win:GetRight()
    local screen = UIParent.GetWidth and UIParent:GetWidth()
    if type(right) == "number" and type(screen) == "number" and right + 300 > screen then
        breakdown:SetPoint("TOPRIGHT", win, "TOPLEFT", -2, 0)
    else
        breakdown:SetPoint("TOPLEFT", win, "TOPRIGHT", 2, 0)
    end
    breakdown:Show()
    if win.light then
        local on = ns.Logging.CombatOn() and ns.Logging.ChatOn()
        win.light:SetColorTexture(on and 0.3 or 1, on and 0.9 or 0.32, on and 0.4 or 0.26, 1)
    end
    fillBreakdown()
end

function Win.CloseBreakdown()
    state.detail = nil
    if breakdown then breakdown:Hide() end
end

-- ------------------------------------------------------------------ the bars

local function tooltipFor(bar)
    -- rawget: these fields are ours and may be unset
    local src, guid = rawget(bar, "src"), rawget(bar, "guid")
    if type(GameTooltip) ~= "table" or type(src) ~= "table" then return end
    local s = opts()
    GameTooltip:SetOwner(bar, "ANCHOR_CURSOR")
    local r, g, b = classColor(src.classFilename)
    local name = ns.plain(src.name)
    GameTooltip:AddLine(name or "?", r, g, b)
    pcall(GameTooltip.AddDoubleLine, GameTooltip, kindDef(s.winKind).label, ns.short(src.totalAmount),
        1, 1, 1, 1, 1, 1)
    pcall(GameTooltip.AddDoubleLine, GameTooltip, "Per second", ns.fmtRate(src.amountPerSecond) or "–",
        1, 1, 1, 1, 1, 1)
    if guid then
        local spells = ns.Meter.Spells(state.sessionId and nil or s.winScope, s.winKind, state.sessionId, guid)
        if spells and #spells > 0 then
            GameTooltip:AddLine(" ")
            for i = 1, math.min(6, #spells) do
                pcall(GameTooltip.AddDoubleLine, GameTooltip, spells[i].name, ns.short(spells[i].amount),
                    0.93, 0.90, 0.84, 1, 1, 1)
            end
        end
        GameTooltip:AddLine(" ")
        GameTooltip:AddLine("Click: spell breakdown · Right-click: displays", 0.6, 0.6, 0.6)
    end
    GameTooltip:Show()
end

local function newBar(i)
    local bar = CreateFrame("StatusBar", nil, win.body)
    bar:SetStatusBarTexture(BAR)
    bar:SetMinMaxValues(0, 1)
    local back = bar:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints()
    back:SetColorTexture(1, 1, 1, 0.05)
    bar.pct = font(bar, "GameFontHighlightSmall", "RIGHT")
    bar.pct:SetPoint("RIGHT", -3, 0)
    bar.pct:SetWidth(34)
    bar.per = font(bar, "GameFontHighlightSmall", "RIGHT")
    bar.per:SetPoint("RIGHT", bar.pct, "LEFT", -2, 0)
    bar.per:SetWidth(38)
    bar.amount = font(bar, "GameFontHighlightSmall", "RIGHT")
    bar.amount:SetPoint("RIGHT", bar.per, "LEFT", -2, 0)
    bar.amount:SetWidth(46)
    bar.name = font(bar, "GameFontHighlightSmall", "LEFT")
    bar.name:SetPoint("LEFT", 4, 0)
    bar.name:SetPoint("RIGHT", bar.amount, "LEFT", -4, 0)
    bar:EnableMouse(true)
    bar:SetScript("OnEnter", tooltipFor)
    bar:SetScript("OnLeave", function() if type(GameTooltip) == "table" then GameTooltip:Hide() end end)
    bar:SetScript("OnMouseUp", function(self, button)
        if button == "RightButton" then
            displayMenu(self)
        else
            local guid, src = rawget(self, "guid"), rawget(self, "src")
            if not (guid and type(src) == "table") then return end
            if state.detail and state.detail.guid == guid then
                Win.CloseBreakdown()
            else
                Win.OpenBreakdown(guid, ns.plain(src.name), ns.plain(src.classFilename))
            end
        end
    end)
    bars[i] = bar
    return bar
end

-- your personal records (written by the Companion into CompanionData.lua) as rows
local RECORDS = {
    { kind = "crit", label = "Biggest crit", prep = "into" },
    { kind = "hit", label = "Biggest hit", prep = "into" },
    { kind = "critHeal", label = "Biggest crit heal", prep = "on" },
    { kind = "heal", label = "Biggest heal", prep = "on" },
    { kind = "hitTaken", label = "Hardest hit taken", prep = "from" },
}

local function recordRows()
    local mine = ns.Export.Records()
    local out = {}
    for _, def in ipairs(RECORDS) do
        for _, r in ipairs(mine and mine.records or {}) do
            if type(r) == "table" and r.kind == def.kind then
                table.insert(out, {
                    name = def.label .. ": " .. tostring(r.spell or "?")
                        .. (r.unit and (" " .. def.prep .. " " .. tostring(r.unit)) or ""),
                    totalAmount = r.amount,
                    classFilename = type(UnitClass) == "function" and select(2, UnitClass("player")) or nil,
                    spellRow = true,
                    note = (r.inDungeon and "" or "open world, ") .. tostring(r.zone or "somewhere"),
                })
            end
        end
    end
    return out
end

-- my spells as rows: the local player's breakdown in the main window
local function mySpellRows(s, session)
    local mine = ns.Meter.Mine(session)
    local guid = mine and ns.plain(mine.sourceGUID)
    if not guid then return {}, nil end
    local spells = ns.Meter.Spells(state.sessionId and nil or s.winScope, s.winKind, state.sessionId, guid) or {}
    local out = {}
    for i = 1, #spells do
        out[i] = {
            name = spells[i].name .. (spells[i].pet and (" (" .. spells[i].pet .. ")") or ""),
            totalAmount = spells[i].amount,
            amountPerSecond = spells[i].perSecond,
            classFilename = mine.classFilename,
            spellRow = true,
        }
    end
    return out, mine
end

function Win.Layout()
    if not win then return end
    local s = opts()
    local h = s.winBar or 17
    local height = win:GetHeight()
    if type(height) ~= "number" then height = (type(s.win) == "table" and s.win[6]) or 150 end
    local count = math.max(1, math.floor((height - TITLE_H - 8) / h))
    for i = 1, count do
        local bar = bars[i] or newBar(i)
        bar:SetHeight(h - 1)
        bar:ClearAllPoints()
        bar:SetPoint("TOPLEFT", 0, -(i - 1) * h)
        bar:SetPoint("RIGHT", win.body, "RIGHT", 0, 0)
    end
    for i = count + 1, #bars do bars[i]:Hide() end
    win.visibleBars = count
    Win.Refresh()
end

function Win.Refresh()
    if not (win and win:IsShown()) then return end
    local s = opts()
    local session = readSession()
    local rows
    -- Details! does the counting (/wowco details on): our bars step aside, records still work
    local deferred = not state.records and ns.Summary and ns.Summary.MeterDeferred()
    if deferred then
        rows = {}
    elseif state.records then
        rows = recordRows()
    elseif state.mySpells then
        rows = mySpellRows(s, session)
    else
        rows = ns.Meter.Visible(session, s.winKind)
    end
    local sum, max, plain = 0, 0, true
    for i = 1, #rows do
        local a = ns.plain(rows[i].totalAmount)
        if type(a) ~= "number" then plain = false break end
        sum, max = sum + a, math.max(max, a)
    end
    -- per second as the game's own DPS/HPS boards count it (= the built-in meter); fallback: the row's
    local rates = not state.records and not state.mySpells and not deferred
        and ns.Meter.Rates(state.sessionId and nil or s.winScope, s.winKind, state.sessionId) or nil
    local first = math.max(0, math.min(state.scroll, #rows - (win.visibleBars or 1)))
    state.scroll = first
    for i = 1, (win.visibleBars or 0) do
        local bar, src = bars[i], rows[first + i]
        if src then
            local r, g, b = classColor(src.classFilename)
            bar:SetStatusBarColor(r, g, b, ns.plain(src.isLocalPlayer) and 0.9 or 0.65)
            pcall(bar.SetMinMaxValues, bar, 0, plain and math.max(max, 1) or (session and session.maxAmount) or 1)
            pcall(bar.SetValue, bar, src.totalAmount)
            local name = src.spellRow and src.name or ns.plain(src.name)
            if name then
                bar.name:SetText((first + i) .. ". " .. name)
            else
                pcall(bar.name.SetText, bar.name, src.name)
            end
            setText(bar.amount, ns.short(src.totalAmount))
            local guidRate = rates and ns.plain(src.sourceGUID) and rates[ns.plain(src.sourceGUID)]
            setText(bar.per, ns.fmtRate(guidRate or src.amountPerSecond))
            local a = ns.plain(src.totalAmount)
            bar.pct:SetText(not state.records and s.winPercent ~= false and plain and sum > 0 and type(a) == "number"
                and string.format("%.0f%%", a / sum * 100) or "")
            bar.pct:SetWidth(s.winPercent ~= false and 34 or 1)
            local guid = ns.plain(src.sourceGUID)
            bar.guid = (not src.spellRow and s.winKind ~= "enemies" and type(guid) == "string"
                and guid:sub(1, 7) == "Player-") and guid or nil
            bar.src = src
            bar:Show()
        else
            bar.src, bar.guid = nil, nil
            bar:Hide()
        end
    end

    -- title: [time] display · segment
    local secs
    if ns.inCombat and state.combatStart and state.sessionId == nil and s.winScope ~= "overall" then
        secs = ns.now() - state.combatStart
    else
        secs = fightSeconds(session)
    end
    local label = state.records and "Your records"
        or state.mySpells and ("My spells – " .. kindDef(s.winKind).label) or kindDef(s.winKind).label
    if state.records then secs = nil end
    local seg = state.sessionName or (s.winScope == "overall" and "Overall" or nil)
    win.title:SetText((secs and ("[" .. ns.fmtTime(secs) .. "] ") or "") .. label
        .. (seg and ("  |cff9d9d9d" .. seg .. "|r") or ""))
    if #rows == 0 then
        local hidden = session and type(session.combatSources) == "table" and #session.combatSources > 0
        win.empty:SetText(deferred and "Details! is doing the counting.\n/wowco details off brings ours back."
            or state.records and ("No records yet. Keep the Companion running and make\n"
                .. "something bleed – they show up after /reload or the next login.")
            or not ns.Meter.Available() and "No damage meter here."
            or hidden and "Hidden mid-fight." or "Nothing yet. Go hit something.")
        win.empty:Show()
    else
        win.empty:Hide()
    end
    fillBreakdown()
end

-- ------------------------------------------------------------------ the window

local function iconButton(parent, texture, tip, onClick)
    local b = CreateFrame("Button", nil, parent)
    b:SetSize(14, 14)
    local t = b:CreateTexture(nil, "ARTWORK")
    t:SetAllPoints()
    t:SetTexture(texture)
    if t.SetTexCoord then t:SetTexCoord(0.08, 0.92, 0.08, 0.92) end
    b:SetAlpha(0.8)
    b:SetScript("OnEnter", function(self)
        self:SetAlpha(1)
        if type(GameTooltip) ~= "table" then return end
        GameTooltip:SetOwner(self, "ANCHOR_TOP")
        GameTooltip:SetText(tip, GOLD[1], GOLD[2], GOLD[3])
        GameTooltip:Show()
    end)
    b:SetScript("OnLeave", function(self)
        self:SetAlpha(0.8)
        if type(GameTooltip) == "table" then GameTooltip:Hide() end
    end)
    b:SetScript("OnClick", function(self) onClick(self) end)
    return b
end

local function savePlace()
    local point, _, rel, x, y = win:GetPoint(1)
    local w, h = win:GetWidth(), win:GetHeight()
    if point then opts().win = { point, rel, x, y, w, h } end
end

local function build()
    local s = opts()
    win = CreateFrame("Frame", "WowCompanyMeter", UIParent, template())
    local saved = type(s.win) == "table" and s.win or nil
    win:SetSize(saved and saved[5] or 240, saved and saved[6] or 150)
    if saved then
        win:SetPoint(saved[1], UIParent, saved[2], saved[3], saved[4])
    else
        win:SetPoint("RIGHT", UIParent, "RIGHT", -40, -80)
    end
    win:SetFrameStrata("MEDIUM")
    win:SetClampedToScreen(true)
    backdrop(win)
    win:EnableMouse(true)
    win:SetMovable(true)
    win:SetResizable(true)
    if win.SetResizeBounds then win:SetResizeBounds(MIN_W, MIN_H, MAX_W, MAX_H) end
    win:SetScript("OnShow", function() opts().winOpen = true end)
    win:SetScript("OnHide", function()
        opts().winOpen = false
        hideMenu()
        Win.CloseBreakdown()
    end)

    -- title bar: logo (menu), title, segment · display · report · options, close
    local bar = CreateFrame("Frame", nil, win)
    bar:SetPoint("TOPLEFT", 4, -4)
    bar:SetPoint("TOPRIGHT", -4, -4)
    bar:SetHeight(TITLE_H - 2)
    bar:EnableMouse(true)
    bar:RegisterForDrag("LeftButton")
    bar:SetScript("OnDragStart", function() if not opts().winLocked then win:StartMoving() end end)
    bar:SetScript("OnDragStop", function()
        win:StopMovingOrSizing()
        savePlace()
    end)
    bar:SetScript("OnMouseUp", function(self, button) if button == "RightButton" then displayMenu(self) end end)
    local shade = bar:CreateTexture(nil, "BACKGROUND")
    shade:SetAllPoints()
    shade:SetColorTexture(0, 0, 0, 0.45)

    local logo = iconButton(bar, MEDIA .. "LogoSmall", "WowCompany", optionsMenu)
    logo:SetSize(16, 16)
    logo:SetPoint("LEFT", 1, 0)

    local close = iconButton(bar, "Interface\\Buttons\\UI-StopButton", "Hide (/wowco opens it)",
        function() win:Hide() end)
    close:SetPoint("RIGHT", -1, 0)
    local optionsBtn = iconButton(bar, "Interface\\Icons\\Trade_Engineering", "Options", optionsMenu)
    optionsBtn:SetPoint("RIGHT", close, "LEFT", -3, 0)
    local reportBtn = iconButton(bar, "Interface\\Icons\\INV_Letter_15", "Report to party", reportMenu)
    reportBtn:SetPoint("RIGHT", optionsBtn, "LEFT", -3, 0)
    local displayBtn = iconButton(bar, "Interface\\Icons\\INV_Misc_Book_09", "Displays", displayMenu)
    displayBtn:SetPoint("RIGHT", reportBtn, "LEFT", -3, 0)
    local segmentBtn = iconButton(bar, "Interface\\Icons\\INV_Misc_PocketWatch_01", "Segments", segmentMenu)
    segmentBtn:SetPoint("RIGHT", displayBtn, "LEFT", -3, 0)

    -- logging light: green = combat and chat log on (the Companion gets everything), red = off
    local light = CreateFrame("Button", nil, bar)
    light:SetSize(8, 8)
    light:SetPoint("LEFT", logo, "RIGHT", 4, 0)
    win.light = light:CreateTexture(nil, "ARTWORK")
    win.light:SetAllPoints()
    light:SetScript("OnClick", function()
        local on = ns.Logging.CombatOn() and ns.Logging.ChatOn()
        ns.Logging.Set(not on, true)
        Win.Refresh()
    end)
    light:SetScript("OnEnter", function(self)
        if type(GameTooltip) ~= "table" then return end
        GameTooltip:SetOwner(self, "ANCHOR_TOP")
        GameTooltip:SetText("Logging", GOLD[1], GOLD[2], GOLD[3])
        GameTooltip:AddLine(ns.Logging.Describe(), 1, 1, 1, true)
        GameTooltip:AddLine("Click: logs on / off", 0.6, 0.6, 0.6)
        GameTooltip:Show()
    end)
    light:SetScript("OnLeave", function() if type(GameTooltip) == "table" then GameTooltip:Hide() end end)

    win.title = font(bar, "GameFontNormalSmall", "LEFT")
    win.title:SetPoint("LEFT", light, "RIGHT", 4, 0)
    win.title:SetPoint("RIGHT", segmentBtn, "LEFT", -4, 0)

    win.body = CreateFrame("Frame", nil, win)
    win.body:SetPoint("TOPLEFT", 5, -(TITLE_H + 3))
    win.body:SetPoint("BOTTOMRIGHT", -5, 5)
    win.body:EnableMouse(true)
    win.body:SetScript("OnMouseUp", function(self, button) if button == "RightButton" then displayMenu(self) end end)
    win.body:EnableMouseWheel(true)
    win.body:SetScript("OnMouseWheel", function(_, delta)
        state.scroll = math.max(0, state.scroll - delta)
        Win.Refresh()
    end)
    win.empty = font(win.body, "GameFontDisableSmall", "CENTER")
    win.empty:SetPoint("CENTER")

    -- resize grip
    local grip = CreateFrame("Button", nil, win)
    grip:SetSize(14, 14)
    grip:SetPoint("BOTTOMRIGHT", -2, 2)
    grip:SetNormalTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Up")
    grip:SetHighlightTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Highlight")
    grip:SetPushedTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Down")
    grip:SetScript("OnMouseDown", function() if not opts().winLocked then win:StartSizing("BOTTOMRIGHT") end end)
    grip:SetScript("OnMouseUp", function()
        win:StopMovingOrSizing()
        savePlace()
        Win.Layout()
    end)
    win:SetScript("OnSizeChanged", function() Win.Layout() end)

    local since = 0
    win:SetScript("OnUpdate", function(_, elapsed)
        since = since + elapsed
        if since >= (opts().winUpdate or 0.5) then
            since = 0
            Win.Refresh()
        end
    end)
    Win.ApplyLock()
    Win.Layout()
end

-- locked: no moving or resizing, and Escape does not close it
function Win.ApplyLock()
    ns.EscCloses("WowCompanyMeter", not opts().winLocked)
end

function Win.Show()
    if not ns.db then return end
    if not win then build() end
    win:Show()
    Win.Layout()
end

function Win.Toggle()
    if win and win:IsShown() then win:Hide() else Win.Show() end
end

-- a meter display by key ("damage", "enemies" …), leaving records / my spells
function Win.SetDisplay(kind)
    opts().winKind = kind
    state.records, state.mySpells = false, false
    Win.Refresh()
end

function Win.ShowRecords()
    state.records, state.mySpells = true, false
    Win.Show()
end

function Win.IsShown() return win ~= nil and win:IsShown() end

ns.on("PLAYER_REGEN_DISABLED", function() state.combatStart = ns.now() end)
ns.on("PLAYER_REGEN_ENABLED", function()
    state.combatStart = nil
    Win.Refresh()
end)

-- Back to the default spot (for when it got dragged off somewhere silly).
ns.command("reset", "reset – meter window back to its default spot and size, unlocked", function()
    local s = opts()
    s.win, s.winLocked = nil, false
    if win then
        win:ClearAllPoints()
        win:SetPoint("RIGHT", UIParent, "RIGHT", -40, -80)
        win:SetSize(240, 150)
        Win.ApplyLock()
    end
    Win.Show()
    ns.say("window reset.")
end)

-- New records from the Companion (CompanionData.lua is read only at login / reload): say them once.
local function announceRecords()
    local mine = ns.Export.Records()
    if not mine then return end
    local seen = ns.db.state.recordsSeenAt or 0
    local newest = seen
    for _, def in ipairs(RECORDS) do
        for _, r in ipairs(mine.records or {}) do
            if type(r) == "table" and r.kind == def.kind and type(r.at) == "number" and r.at > seen then
                ns.say(string.format("|cffffd100New record!|r %s %s – %s%s", def.label, ns.fmt(r.amount),
                    tostring(r.spell or "?"), r.unit and (" " .. def.prep .. " " .. tostring(r.unit)) or ""))
                if r.at > newest then newest = r.at end
            end
        end
    end
    ns.db.state.recordsSeenAt = newest
end

ns.onReady(function()
    pcall(announceRecords)
    ns.say("v" .. tostring(ns.version) .. " loaded. |cffffffff/wowco|r opens the meter, |cffffffff/wowco options|r "
        .. "the settings. " .. ns.Logging.Describe() .. ".")
    local s = ns.db.settings
    s.winKind = s.winKind or "damage"
    s.winScope = s.winScope or "current"
    s.winBar = s.winBar or 17
    s.winUpdate = s.winUpdate or 0.5
    if s.winOpen ~= false then Win.Show() end
end)
