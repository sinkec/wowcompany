-- The window: Now · Meter · Fights · Logging.
--
-- Look: a dark parchment panel with the game's own tooltip border, gold headings, class-coloured
-- bars and stat cards – it should read like a part of the WoW interface, not like a web page.
-- Only the game's stock fonts and textures are used (nothing is shipped with the addon).
--
-- Only you and your own party are ever listed (Meter.Visible); strangers are never shown.
-- Open with /wowco. Drag it anywhere; the pin button locks it in place. The position, the pin and
-- whether it was open are remembered. /wowco reset puts it back at the top of the screen.

local _, ns = ...

local UI = {}
ns.UI = UI

-- ------------------------------------------------------------------ theme

local WHITE = "Interface\\Buttons\\WHITE8x8"
local BAR = "Interface\\TargetingFrame\\UI-StatusBar"
local C = {
    gold = { 1.00, 0.82, 0.00 },
    brass = { 0.85, 0.66, 0.24 },
    text = { 0.93, 0.90, 0.84 },
    dim = { 0.62, 0.58, 0.52 },
    faint = { 0.42, 0.39, 0.35 },
    good = { 0.30, 0.90, 0.40 },
    bad = { 1.00, 0.32, 0.26 },
}
local WIDTH, HEIGHT = 400, 300
local PAD = 12
local HEADER, FOOTER = 30, 20
local ROWS, ROW_H = 9, 20

local main -- the window, built on first use
local rows, fightRows, cards, logRows = {}, {}, {}, {}
local view = { tab = "now", sessionId = nil, sessionName = nil }

local function color(fs, c, a) fs:SetTextColor(c[1], c[2], c[3], a or 1) end

local function text(parent, font, justify, c)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
    fs:SetJustifyH(justify or "LEFT")
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    if c then color(fs, c) end
    return fs
end

local function template() return BackdropTemplateMixin and "BackdropTemplate" or nil end

-- The outer frame: the game's tooltip border around a dark fill.
local function windowBackdrop(f)
    if not f.SetBackdrop then return end
    f:SetBackdrop({
        bgFile = "Interface\\ChatFrame\\ChatFrameBackground",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        edgeSize = 14,
        insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    f:SetBackdropColor(0.05, 0.04, 0.03, 0.94)
    f:SetBackdropBorderColor(C.brass[1], C.brass[2], C.brass[3], 1)
end

-- A card or a button: flat fill with a hairline edge.
local function panel(f, strong)
    if not f.SetBackdrop then return end
    f:SetBackdrop({ bgFile = WHITE, edgeFile = WHITE, edgeSize = 1 })
    f:SetBackdropColor(0.13, 0.10, 0.07, strong and 0.95 or 0.75)
    f:SetBackdropBorderColor(C.brass[1], C.brass[2], C.brass[3], strong and 0.55 or 0.22)
end

local function line(parent, alpha)
    local t = parent:CreateTexture(nil, "ARTWORK")
    t:SetColorTexture(C.brass[1], C.brass[2], C.brass[3], alpha or 0.35)
    t:SetHeight(1)
    return t
end

local function tooltip(widget, title, body)
    widget:SetScript("OnEnter", function(self)
        if self.hover then self:hover(true) end
        if type(GameTooltip) ~= "table" then return end
        GameTooltip:SetOwner(self, "ANCHOR_TOP")
        GameTooltip:SetText(title, C.gold[1], C.gold[2], C.gold[3])
        if body then GameTooltip:AddLine(body, 1, 1, 1, true) end
        GameTooltip:Show()
    end)
    widget:SetScript("OnLeave", function(self)
        if self.hover then self:hover(false) end
        if type(GameTooltip) == "table" then GameTooltip:Hide() end
    end)
end

-- A bordered button. `SetChosen(true)` marks the active option of a group.
local function button(parent, label, width, onClick, tipTitle, tipBody)
    local b = CreateFrame("Button", nil, parent, template())
    b:SetSize(width, 20)
    panel(b, true)
    b.label = text(b, "GameFontHighlightSmall", "CENTER", C.dim)
    b.label:SetPoint("CENTER")
    b.label:SetText(label)
    b.chosen = false
    function b:paint(hovering)
        local on = self.chosen
        color(self.label, on and C.gold or (hovering and C.text or C.dim))
        if self.SetBackdropBorderColor then
            self:SetBackdropBorderColor(C.brass[1], C.brass[2], C.brass[3], (on or hovering) and 0.95 or 0.4)
        end
        if self.SetBackdropColor then
            self:SetBackdropColor(on and 0.24 or 0.13, on and 0.18 or 0.10, on and 0.08 or 0.07, 0.95)
        end
    end
    function b:hover(hovering) self:paint(hovering) end
    function b:SetChosen(on)
        self.chosen = on and true or false
        self:paint(false)
    end
    b:SetScript("OnClick", onClick)
    tooltip(b, tipTitle or label, tipBody)
    b:paint(false)
    return b
end

-- A header tab: plain text with a gold underline when active.
local function tab(parent, label, width, onClick)
    local b = CreateFrame("Button", nil, parent)
    b:SetSize(width, HEADER - 6)
    b.label = text(b, "GameFontNormal", "CENTER", C.dim)
    b.label:SetPoint("CENTER", 0, 1)
    b.label:SetText(label)
    b.under = b:CreateTexture(nil, "ARTWORK")
    b.under:SetColorTexture(C.gold[1], C.gold[2], C.gold[3], 1)
    b.under:SetHeight(2)
    b.under:SetPoint("BOTTOMLEFT", 4, 0)
    b.under:SetPoint("BOTTOMRIGHT", -4, 0)
    b.chosen = false
    function b:SetChosen(on)
        self.chosen = on and true or false
        color(self.label, on and C.gold or C.dim)
        self.under:SetShown(self.chosen)
    end
    b:SetScript("OnEnter", function(self)
        if not self.chosen then color(self.label, C.text) end
    end)
    b:SetScript("OnLeave", function(self) color(self.label, self.chosen and C.gold or C.dim) end)
    b:SetScript("OnClick", onClick)
    b:SetChosen(false)
    return b
end

local function classColor(class)
    class = ns.plain(class)
    local c = class and type(RAID_CLASS_COLORS) == "table" and RAID_CLASS_COLORS[class]
    if c then return c.r, c.g, c.b end
    return 0.6, 0.6, 0.6
end

-- Shows a value that may be secret: a secret can be handed to SetText, nothing else.
local function show(fs, v)
    if v == nil then
        fs:SetText("–")
    else
        pcall(fs.SetText, fs, v)
    end
end

-- "65.20 DPS": two decimals, always (ns.fmtRate). A rate that cannot be formatted is left out.
local function showRate(fs, per, unit)
    local s = ns.fmtRate(per)
    if s == nil then
        fs:SetText("")
        return
    end
    if unit and unit ~= "" then
        -- joining works for plain text; for a secret string it may be refused, then show it bare
        local ok, joined = pcall(function() return s .. " " .. unit end)
        if ok then s = joined end
    end
    show(fs, s)
end

-- ------------------------------------------------------------------ now tab
-- One page for the fight you are in (or the one you just finished): who, how long, and your own
-- numbers on four cards. In a dungeon a banner sums up the run, and every card also carries the
-- overall figure. Everything is re-read twice a second.

local NOW = {
    { key = "damage", label = "Damage", unit = "DPS" },
    { key = "healing", label = "Healing", unit = "HPS" },
    { key = "taken", label = "Damage taken", unit = "/ sec" },
    { key = "interrupts", label = "Kicks", unit = "" },
}

local function buildNow(parent)
    main.nowTitle = text(parent, "GameFontNormalLarge", "LEFT", C.text)
    main.nowTitle:SetPoint("TOPLEFT", 0, 0)
    main.nowTitle:SetPoint("RIGHT", parent, "RIGHT", -70, 0)
    main.nowTime = text(parent, "GameFontNormalLarge", "RIGHT", C.gold)
    main.nowTime:SetPoint("TOPRIGHT", 0, 0)
    main.nowState = text(parent, "GameFontHighlightSmall", "LEFT", C.dim)
    main.nowState:SetPoint("TOPLEFT", 0, -20)
    main.nowState:SetPoint("RIGHT", 0, 0)

    local gap = 8
    local cardW = (WIDTH - 2 * PAD - gap) / 2
    local cardH = 64
    for i, def in ipairs(NOW) do
        local col, rowIndex = (i - 1) % 2, math.floor((i - 1) / 2)
        local card = CreateFrame("Frame", nil, parent, template())
        card:SetSize(cardW, cardH)
        card:SetPoint("TOPLEFT", col * (cardW + gap), -42 - rowIndex * (cardH + gap))
        panel(card)
        card.def = def
        card.label = text(card, "GameFontHighlightSmall", "LEFT", C.dim)
        card.label:SetPoint("TOPLEFT", 8, -7)
        card.label:SetText(string.upper(def.label))
        card.rate = text(card, "GameFontHighlightSmall", "RIGHT", C.brass)
        card.rate:SetPoint("TOPRIGHT", -8, -7)
        card.rate:SetWidth(96) -- fixed width: a long value is cut, never spills over the label
        card.value = text(card, "GameFontNormalLarge", "LEFT", C.gold)
        card.value:SetPoint("LEFT", 8, -2)
        card.value:SetPoint("RIGHT", -8, -2)
        card.overall = text(card, "GameFontHighlightSmall", "LEFT", C.faint)
        card.overall:SetPoint("BOTTOMLEFT", 8, 6)
        card.overall:SetPoint("RIGHT", -8, 0)
        cards[i] = card
    end
end

local function refreshNow()
    local duration, anySession, shared = nil, false, false
    for i = 1, #cards do
        local card = cards[i]
        local session = ns.Meter.Read("current", card.def.key)
        local mine = ns.Meter.Mine(session)
        if session then
            anySession = true
            if duration == nil then duration = session.durationSeconds end
        end
        if mine then
            show(card.value, ns.fmt(mine.totalAmount))
            showRate(card.rate, card.def.unit ~= "" and mine.amountPerSecond or nil, card.def.unit)
        elseif session and type(session.combatSources) == "table" and #session.combatSources > 0
            and ns.Meter.TotalsAreParty() then
            -- dungeon with the party, mid-fight: rows cannot be told apart, show the party's total
            shared = true
            show(card.value, ns.fmt(session.totalAmount))
            card.rate:SetText("party")
        else
            card.value:SetText("–")
            card.rate:SetText("")
        end
        -- the same figure over everything the meter remembers (the whole run in a dungeon)
        local overall = ns.Meter.Mine(ns.Meter.Read("overall", card.def.key))
        local amount = overall and ns.plain(overall.totalAmount)
        card.overall:SetText(type(amount) == "number" and ("Overall  " .. ns.fmt(amount)) or "")
    end

    -- who are we hitting: the target while fighting, otherwise the name of the last fight
    local named = false
    if ns.inCombat and type(UnitExists) == "function" and UnitExists("target") then
        local ok, name = pcall(UnitName, "target")
        if ok and name ~= nil then
            show(main.nowTitle, name)
            named = true
        end
    end
    if not named then
        local last = ns.Meter.Fights(1)[1]
        main.nowTitle:SetText(last and last.name or "No fight yet")
    end
    show(main.nowTime, ns.isSecret(duration) and duration or (duration and ns.fmtTime(duration) or ""))

    local state
    if ns.inCombat then
        state = "|cffff5242In combat|r" .. (shared and "  ·  party total" or "")
    elseif anySession then
        state = "|cff4de666Last fight|r" .. (shared and "  ·  party total" or "  ·  your numbers")
    else
        state = "Go hit something."
    end
    local run = ns.Meter.Run()
    if run then
        state = state .. "  ·  |cffd8a83c" .. run.zone .. "|r " .. ns.fmtTime(run.elapsed) .. "  ·  "
            .. run.fights .. (run.fights == 1 and " fight" or " fights")
            .. (run.bosses > 0 and ("  ·  " .. run.bosses .. (run.bosses == 1 and " boss" or " bosses")) or "")
    end
    main.nowState:SetText(state)
end

-- ------------------------------------------------------------------ meter tab

local function buildRows(parent)
    for i = 1, ROWS do
        local bar = CreateFrame("StatusBar", nil, parent)
        bar:SetHeight(ROW_H - 3)
        bar:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_H)
        bar:SetPoint("TOPRIGHT", 0, -(i - 1) * ROW_H)
        bar:SetStatusBarTexture(BAR)
        bar:SetMinMaxValues(0, 1)
        local back = bar:CreateTexture(nil, "BACKGROUND")
        back:SetAllPoints()
        back:SetColorTexture(1, 1, 1, 0.04)
        bar.share = text(bar, "GameFontHighlightSmall", "RIGHT", C.dim)
        bar.share:SetPoint("RIGHT", -5, 0)
        bar.share:SetWidth(36)
        bar.perSecond = text(bar, "GameFontHighlightSmall", "RIGHT", C.text)
        bar.perSecond:SetPoint("RIGHT", bar.share, "LEFT", -4, 0)
        bar.perSecond:SetWidth(58)
        bar.amount = text(bar, "GameFontHighlightSmall", "RIGHT", C.text)
        bar.amount:SetPoint("RIGHT", bar.perSecond, "LEFT", -4, 0)
        bar.amount:SetWidth(70)
        bar.name = text(bar, "GameFontHighlightSmall", "LEFT", C.text)
        bar.name:SetPoint("LEFT", 6, 0)
        bar.name:SetPoint("RIGHT", bar.amount, "LEFT", -6, 0)
        bar:Hide()
        rows[i] = bar
    end
end

-- Everything that touches possibly-secret values goes through pcall: a secret may be shown, not inspected.
local function fillRow(bar, index, src, maxAmount, sum)
    local r, g, b = classColor(src.classFilename)
    bar:SetStatusBarColor(r, g, b, ns.plain(src.isLocalPlayer) and 0.85 or 0.55)
    pcall(bar.SetMinMaxValues, bar, 0, maxAmount)
    pcall(bar.SetValue, bar, src.totalAmount)
    local name = ns.plain(src.name)
    if name then
        bar.name:SetText(index .. ".  " .. name)
    else
        pcall(bar.name.SetText, bar.name, src.name)
    end
    show(bar.amount, ns.fmt(src.totalAmount))
    showRate(bar.perSecond, src.amountPerSecond, nil)
    local amount = ns.plain(src.totalAmount)
    if sum and sum > 0 and type(amount) == "number" then
        bar.share:SetText(string.format("%d%%", math.floor(amount / sum * 100 + 0.5)))
    else
        bar.share:SetText("")
    end
    bar:Show()
end

local function refreshMeter()
    local s = ns.db.settings
    local session = ns.Meter.Read(s.meterScope, s.meterKind, view.sessionId)
    -- only you and your party (Meter.Visible drops strangers and unverifiable rows)
    local sources = ns.Meter.Visible(session)
    -- bar length, share and total: from the visible rows when the numbers are plain
    local maxAmount, sum, plainNumbers = 0, 0, true
    for i = 1, #sources do
        local amount = ns.plain(sources[i].totalAmount)
        if type(amount) ~= "number" then
            plainNumbers = false
            break
        end
        sum = sum + amount
        if amount > maxAmount then maxAmount = amount end
    end
    local partyOnly = ns.Meter.TotalsAreParty()
    local shown = 0
    for i = 1, #sources do
        if shown >= ROWS then break end
        shown = shown + 1
        fillRow(rows[shown], shown, sources[i], plainNumbers and math.max(maxAmount, 1) or session.maxAmount,
            plainNumbers and sum or nil)
    end
    for i = shown + 1, ROWS do rows[i]:Hide() end

    local title
    if view.sessionId then
        title = view.sessionName or "Old fight"
    else
        title = s.meterScope == "overall" and "Overall" or "This fight"
    end
    local dur = session and ns.plain(session.durationSeconds)
    main.meterTitle:SetText(title .. (dur and ("   " .. ns.fmtTime(dur)) or ""))
    if shown == 0 then
        local hidden = session and type(session.combatSources) == "table" and #session.combatSources > 0
        main.meterEmpty:SetText(not ns.Meter.Available() and "The game's damage meter is not available here."
            or hidden and "Numbers are hidden mid-fight. They show up when it ends."
            or "Nothing to count yet. Go hit something.")
        main.meterEmpty:Show()
    else
        main.meterEmpty:Hide()
    end
    if shown > 0 and plainNumbers then
        main.meterTotal:SetText(ns.fmt(sum))
    elseif shown > 0 and partyOnly and session.totalAmount ~= nil then
        pcall(main.meterTotal.SetText, main.meterTotal, ns.fmt(session.totalAmount))
    else
        main.meterTotal:SetText("")
    end
end

-- ------------------------------------------------------------------ fights tab

local function refreshFights()
    local fights = ns.Meter.Fights(#fightRows)
    for i = 1, #fightRows do
        local row, f = fightRows[i], fights[i]
        if f then
            row.fight = f
            row.label:SetText(f.name)
            color(row.label, f.boss and C.gold or C.text)
            row.tag:SetText(f.boss and "BOSS" or "")
            row.time:SetText(ns.fmtTime(f.duration))
            row:Show()
        else
            row.fight = nil
            row:Hide()
        end
    end
    main.fightsEmpty:SetShown(#fights == 0)
end

local function buildFights(parent)
    for i = 1, 10 do
        local row = CreateFrame("Button", nil, parent)
        row:SetHeight(ROW_H)
        row:SetPoint("TOPLEFT", 0, -(i - 1) * ROW_H)
        row:SetPoint("TOPRIGHT", 0, -(i - 1) * ROW_H)
        if i % 2 == 0 then
            local stripe = row:CreateTexture(nil, "BACKGROUND")
            stripe:SetAllPoints()
            stripe:SetColorTexture(1, 1, 1, 0.03)
        end
        row.time = text(row, "GameFontHighlightSmall", "RIGHT", C.dim)
        row.time:SetPoint("RIGHT", -6, 0)
        row.time:SetWidth(44)
        row.tag = text(row, "GameFontHighlightSmall", "RIGHT", C.brass)
        row.tag:SetPoint("RIGHT", row.time, "LEFT", -6, 0)
        row.tag:SetWidth(40)
        row.label = text(row, "GameFontHighlightSmall", "LEFT", C.text)
        row.label:SetPoint("LEFT", 6, 0)
        row.label:SetPoint("RIGHT", row.tag, "LEFT", -6, 0)
        local hl = row:CreateTexture(nil, "HIGHLIGHT")
        hl:SetAllPoints()
        hl:SetColorTexture(C.gold[1], C.gold[2], C.gold[3], 0.12)
        row:SetScript("OnClick", function(self)
            if not self.fight or not self.fight.id then return end
            view.sessionId, view.sessionName = self.fight.id, self.fight.name
            UI.Show("meter")
        end)
        fightRows[i] = row
    end
end

-- ------------------------------------------------------------------ logging tab

local LOG_ROWS = {
    { key = "combat", label = "Combat log", hint = "damage, healing, deaths, your biggest crit" },
    { key = "chat", label = "Chat log", hint = "who looted what" },
    { key = "advanced", label = "Advanced logging", hint = "HP and item level – /wowco advanced" },
    { key = "auto", label = "Auto-log in dungeons", hint = "switches both logs on when you walk in" },
    { key = "everywhere", label = "Log in the open world", hint = "records anywhere; the log grows faster" },
}

local function buildLogging(parent)
    for i, def in ipairs(LOG_ROWS) do
        local y = -(i - 1) * 30
        local row = { def = def }
        row.dot = parent:CreateTexture(nil, "ARTWORK")
        row.dot:SetSize(8, 8)
        row.dot:SetPoint("TOPLEFT", 2, y - 5)
        row.label = text(parent, "GameFontNormal", "LEFT", C.text)
        row.label:SetPoint("TOPLEFT", 18, y)
        row.label:SetText(def.label)
        row.state = text(parent, "GameFontNormal", "RIGHT", C.dim)
        row.state:SetPoint("TOPRIGHT", 0, y)
        row.hint = text(parent, "GameFontHighlightSmall", "LEFT", C.faint)
        row.hint:SetPoint("TOPLEFT", 18, y - 14)
        row.hint:SetText(def.hint)
        logRows[i] = row
    end
    main.logToggle = button(parent, "Start logging", 110, function()
        local on = ns.Logging.CombatOn() and ns.Logging.ChatOn()
        ns.Logging.Set(not on, true)
    end, "Combat and chat log", "Switches both logs on or off right now.")
    main.logToggle:SetPoint("BOTTOMLEFT", 0, 0)
    main.autoToggle = button(parent, "Auto", 96, function()
        ns.db.settings.autoLog = not ns.db.settings.autoLog
        ns.Logging.Check()
        UI.Refresh()
    end, "Auto-log in dungeons", "Logging starts when you enter a dungeon and stops 20 minutes after you leave.")
    main.autoToggle:SetPoint("LEFT", main.logToggle, "RIGHT", 6, 0)
    main.everywhereToggle = button(parent, "Everywhere", 120, function()
        ns.Logging.SetEverywhere(not ns.db.settings.logEverywhere)
    end, "Log in the open world", "Keeps the logs on outside dungeons, so the Companion catches your biggest "
        .. "crit anywhere. The Companion deletes the log files when it quits.")
    main.everywhereToggle:SetPoint("LEFT", main.autoToggle, "RIGHT", 6, 0)
end

local function refreshLogging()
    local L = ns.Logging
    local values = {
        combat = L.CombatOn(),
        chat = L.ChatOn(),
        advanced = L.Advanced(),
        auto = ns.db.settings.autoLog and true or false,
        everywhere = ns.db.settings.logEverywhere and true or false,
    }
    for i = 1, #logRows do
        local row = logRows[i]
        local on = values[row.def.key]
        local c = on == nil and C.faint or (on and C.good or C.bad)
        row.dot:SetColorTexture(c[1], c[2], c[3], 1)
        row.state:SetText(on == nil and "unknown" or (on and "ON" or "off"))
        color(row.state, c)
    end
    local both = values.combat and values.chat
    main.logToggle.label:SetText(both and "Stop logging" or "Start logging")
    main.autoToggle:SetChosen(values.auto)
    main.everywhereToggle:SetChosen(values.everywhere)
end

-- ------------------------------------------------------------------ footer (always visible)

local function refreshFooter()
    local L = ns.Logging
    local combat, chat = L.CombatOn(), L.ChatOn()
    local c = combat and C.good or C.bad
    main.recDot:SetColorTexture(c[1], c[2], c[3], 1)
    if combat then
        main.recText:SetText("REC" .. (chat and "  combat + loot" or "  combat only"))
    else
        main.recText:SetText("not recording")
    end
    color(main.recText, combat and C.text or C.dim)
    local run = ns.Meter.Run()
    main.where:SetText(run and run.zone or (ns.db.settings.logEverywhere and "open world" or ""))
end

-- ------------------------------------------------------------------ window

-- Default spot: top of the screen, in the middle.
local function place()
    main:ClearAllPoints()
    local pos = ns.db.settings.pos
    if type(pos) == "table" and pos[1] then
        main:SetPoint(pos[1], UIParent, pos[2] or pos[1], pos[3] or 0, pos[4] or 0)
    else
        main:SetPoint("TOP", UIParent, "TOP", 0, -120)
    end
end

-- Pinned = cannot be dragged (so it does not move when you click around in a fight).
local function applyPin()
    local pinned = ns.db.settings.pinned and true or false
    main:SetMovable(not pinned)
    main.pin.label:SetText(pinned and "pinned" or "pin")
    main.pin:SetChosen(pinned)
end

local function page()
    local f = CreateFrame("Frame", nil, main)
    f:SetPoint("TOPLEFT", PAD, -(HEADER + 10))
    f:SetPoint("BOTTOMRIGHT", -PAD, FOOTER + 8)
    return f
end

local function build()
    main = CreateFrame("Frame", "WowCompanyFrame", UIParent, template())
    main:SetSize(WIDTH, HEIGHT)
    main:SetFrameStrata("HIGH") -- above the regular interface
    main:SetClampedToScreen(true)
    windowBackdrop(main)
    main:EnableMouse(true)
    main:SetMovable(true)
    main:RegisterForDrag("LeftButton")
    main:SetScript("OnDragStart", function(self)
        if not ns.db.settings.pinned then self:StartMoving() end
    end)
    main:SetScript("OnDragStop", function(self)
        self:StopMovingOrSizing()
        local point, _, relPoint, x, y = self:GetPoint(1)
        if point then ns.db.settings.pos = { point, relPoint, x, y } end
    end)
    main:SetScript("OnShow", function() ns.db.settings.open = true end)
    main:SetScript("OnHide", function() ns.db.settings.open = false end)
    place()
    tinsert(UISpecialFrames, "WowCompanyFrame") -- Escape closes it

    -- header: title, tabs, pin, close
    local title = text(main, "GameFontNormal", "LEFT", C.gold)
    title:SetPoint("TOPLEFT", PAD, -10)
    title:SetText("WowCompany")
    local headLine = line(main, 0.4)
    headLine:SetPoint("TOPLEFT", 6, -HEADER)
    headLine:SetPoint("TOPRIGHT", -6, -HEADER)

    local close = button(main, "x", 20, function() main:Hide() end, "Close", "/wowco opens it again.")
    close:SetPoint("TOPRIGHT", -8, -6)
    main.pin = button(main, "pin", 50, function()
        ns.db.settings.pinned = not ns.db.settings.pinned
        applyPin()
    end, "Pin the window", "Pinned: it stays put. Unpinned: drag it anywhere.")
    main.pin:SetPoint("RIGHT", close, "LEFT", -4, 0)
    applyPin()

    main.tabs = {}
    local x = 104
    for _, t in ipairs({ { "now", "Now", 40 }, { "meter", "Meter", 48 }, { "fights", "Fights", 48 },
        { "logging", "Logging", 56 } }) do
        local b = tab(main, t[2], t[3], function() UI.Show(t[1]) end)
        b:SetPoint("TOPLEFT", x, -4)
        x = x + t[3] + 2
        main.tabs[t[1]] = b
    end

    -- footer: recording light, where we are, version
    local footLine = line(main, 0.25)
    footLine:SetPoint("BOTTOMLEFT", 6, FOOTER + 2)
    footLine:SetPoint("BOTTOMRIGHT", -6, FOOTER + 2)
    main.recDot = main:CreateTexture(nil, "ARTWORK")
    main.recDot:SetSize(8, 8)
    main.recDot:SetPoint("BOTTOMLEFT", PAD, 8)
    main.recText = text(main, "GameFontHighlightSmall", "LEFT", C.dim)
    main.recText:SetPoint("LEFT", main.recDot, "RIGHT", 6, 0)
    local ver = text(main, "GameFontHighlightSmall", "RIGHT", C.faint)
    ver:SetPoint("BOTTOMRIGHT", -PAD, 6)
    ver:SetText("v" .. tostring(ns.version))
    main.where = text(main, "GameFontHighlightSmall", "RIGHT", C.brass)
    main.where:SetPoint("RIGHT", ver, "LEFT", -8, 0)

    -- pages
    main.now = page()
    buildNow(main.now)

    local meter = page()
    main.meter = meter
    main.kindButtons, main.scopeButtons = {}, {}
    local bx = 0
    for _, k in ipairs(ns.Meter.KINDS) do
        local b = button(meter, k.label, 58, function()
            ns.db.settings.meterKind = k.key
            UI.Refresh()
        end, k.label)
        b:SetPoint("TOPLEFT", bx, 0)
        bx = bx + 61
        main.kindButtons[k.key] = b
    end
    bx = 0
    for i = #ns.Meter.SCOPES, 1, -1 do
        local sc = ns.Meter.SCOPES[i]
        local b = button(meter, sc.label, 64, function()
            ns.db.settings.meterScope = sc.key
            view.sessionId, view.sessionName = nil, nil
            UI.Refresh()
        end, sc.label)
        b:SetPoint("TOPRIGHT", -bx, 0)
        bx = bx + 67
        main.scopeButtons[sc.key] = b
    end
    local list = CreateFrame("Frame", nil, meter)
    list:SetPoint("TOPLEFT", 0, -28)
    list:SetPoint("BOTTOMRIGHT", 0, 18)
    buildRows(list)
    main.meterEmpty = text(list, "GameFontHighlightSmall", "CENTER", C.dim)
    main.meterEmpty:SetPoint("CENTER")
    main.meterTitle = text(meter, "GameFontHighlightSmall", "LEFT", C.dim)
    main.meterTitle:SetPoint("BOTTOMLEFT", 0, 0)
    main.meterTotal = text(meter, "GameFontNormal", "RIGHT", C.gold)
    main.meterTotal:SetPoint("BOTTOMRIGHT", 0, 0)

    local fights = page()
    main.fights = fights
    local hint = text(fights, "GameFontHighlightSmall", "LEFT", C.dim)
    hint:SetPoint("TOPLEFT", 0, 0)
    hint:SetText("Recent fights – click one to open it in the meter")
    local fl = CreateFrame("Frame", nil, fights)
    fl:SetPoint("TOPLEFT", 0, -20)
    fl:SetPoint("BOTTOMRIGHT", 0, 0)
    buildFights(fl)
    main.fightsEmpty = text(fl, "GameFontHighlightSmall", "CENTER", C.dim)
    main.fightsEmpty:SetPoint("CENTER")
    main.fightsEmpty:SetText("No fights on record. Suspiciously peaceful.")

    main.logging = page()
    buildLogging(main.logging)

    -- live refresh while the window is open
    local since = 0
    main:SetScript("OnUpdate", function(_, elapsed)
        since = since + elapsed
        if since >= 0.5 then
            since = 0
            UI.Refresh()
        end
    end)
    main:Hide() -- UI.Show() shows it right after, which records it as open again
end

function UI.Refresh()
    if not main or not main:IsShown() then return end
    for key, b in pairs(main.tabs) do b:SetChosen(key == view.tab) end
    main.now:SetShown(view.tab == "now")
    main.meter:SetShown(view.tab == "meter")
    main.fights:SetShown(view.tab == "fights")
    main.logging:SetShown(view.tab == "logging")
    refreshFooter()
    if view.tab == "now" then
        refreshNow()
    elseif view.tab == "meter" then
        for key, b in pairs(main.kindButtons) do b:SetChosen(key == ns.db.settings.meterKind) end
        for key, b in pairs(main.scopeButtons) do
            b:SetChosen(not view.sessionId and key == ns.db.settings.meterScope)
        end
        refreshMeter()
    elseif view.tab == "fights" then
        refreshFights()
    else
        refreshLogging()
    end
end

function UI.Show(tabKey)
    if not ns.db then return end
    if not main then build() end
    if tabKey then view.tab = tabKey end
    main:Show()
    UI.Refresh()
end

function UI.Toggle()
    if main and main:IsShown() then main:Hide() else UI.Show() end
end

-- Back to the default spot, unpinned (for when it got dragged off somewhere silly).
function UI.Reset()
    ns.db.settings.pos, ns.db.settings.pinned = nil, nil
    UI.Show()
    place()
    applyPin()
end

ns.command("reset", "reset – window back to the top of the screen, unpinned", function()
    UI.Reset()
    ns.say("window reset.")
end)

ns.onReady(function()
    -- open on login unless it was closed last time (first run: open, so you can see it works)
    if ns.db.settings.open ~= false then UI.Show() end
    ns.say("v" .. tostring(ns.version) .. " loaded. |cffffffff/wowco|r opens the meter. "
        .. ns.Logging.Describe() .. ".")
end)
