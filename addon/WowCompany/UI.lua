-- The window: Now · Meter · Fights · Records · Logging.
--
-- Look: the classic WoW dialog – gold dialog border on a dark stone background, the header banner
-- with the title, our round logo as a portrait in the corner, red panel buttons and the stock close
-- button; cards in tooltip style, class-coloured bars. Only the game's own textures and fonts, plus
-- the logo (Media/Logo.tga).
--
-- Only you and your own party are ever listed (Meter.Visible); strangers are never shown.
-- Open with /wowco. Drag it anywhere; the pin button locks it in place. The position, the pin and
-- whether it was open are remembered. /wowco reset puts it back at the top of the screen.

local _, ns = ...

local UI = {}
ns.UI = UI

-- ------------------------------------------------------------------ theme

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
local WIDTH, HEIGHT = 460, 356
local PAD = 16
local HEADER, FOOTER = 72, 24 -- header = banner + the row of tabs under it
local MEDIA = "Interface\\AddOns\\WowCompany\\Media\\"
local ROWS, ROW_H = 9, 20

local main -- the window, built on first use
local rows, fightRows, cards, logRows, recordRows = {}, {}, {}, {}, {}
local view = { tab = "now", sessionId = nil, sessionName = nil, detail = nil } -- detail = { guid, name }

local function color(fs, c, a) fs:SetTextColor(c[1], c[2], c[3], a or 1) end

local function text(parent, font, justify, c)
    local fs = parent:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
    fs:SetJustifyH(justify or "LEFT")
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    if c then color(fs, c) end
    return fs
end

local function template() return BackdropTemplateMixin and "BackdropTemplate" or nil end

-- The outer frame: the game's gold dialog border on the dark dialog background.
local function windowBackdrop(f)
    if not f.SetBackdrop then return end
    f:SetBackdrop({
        bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background-Dark",
        edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Gold-Border",
        tile = true,
        tileSize = 32,
        edgeSize = 32,
        insets = { left = 11, right = 12, top = 12, bottom = 11 },
    })
    f:SetBackdropColor(1, 1, 1, 0.97)
    f:SetBackdropBorderColor(1, 1, 1, 1)
end

-- A card: tooltip style (the game's tooltip border and background).
local function panel(f, strong)
    if not f.SetBackdrop then return end
    f:SetBackdrop({
        bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true,
        tileSize = 16,
        edgeSize = 12,
        insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    f:SetBackdropColor(0.09, 0.07, 0.05, strong and 0.95 or 0.8)
    f:SetBackdropBorderColor(C.brass[1], C.brass[2], C.brass[3], strong and 0.9 or 0.6)
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

-- The game's red panel button (UIPanelButtonTemplate). `SetChosen(true)` marks the active option of
-- a group: highlight locked on, gold label.
local function button(parent, label, width, onClick, tipTitle, tipBody)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetSize(width, 22)
    local fs = b.GetFontString and b:GetFontString()
    if type(fs) ~= "table" then fs = type(b.Text) == "table" and b.Text or nil end
    if not fs then
        fs = text(b, "GameFontHighlightSmall", "CENTER", C.dim)
        fs:SetPoint("CENTER")
    end
    b.label = fs
    if b.label.SetFontObject then b.label:SetFontObject("GameFontHighlightSmall") end
    b.label:SetText(label)
    b.chosen = false
    function b:paint(hovering)
        local on = self.chosen
        color(self.label, on and C.gold or (hovering and C.text or C.dim))
        if on and self.LockHighlight then
            self:LockHighlight()
        elseif self.UnlockHighlight then
            self:UnlockHighlight()
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
    b:SetSize(width, 24)
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

-- Longest believable fight. Out of combat the game's "current" session can report the time since
-- the computer started (seen: 71170 minutes, DPS 0.00) – anything longer than this is not a fight.
local MAX_FIGHT = 3 * 3600

local function sane(sec)
    local v = ns.plain(sec)
    return type(v) == "number" and v > 0 and v <= MAX_FIGHT and v or nil
end

-- The game's own call for a fight's length. It takes a session TYPE (diagnostics 16. 11.: "Current"
-- right after a fight = 19 s), not a fight id – out of combat "Current" is the fight that just ended.
local function sessionSeconds()
    if type(C_DamageMeter) ~= "table" or type(C_DamageMeter.GetSessionDurationSeconds) ~= "function"
        or type(Enum) ~= "table" or type(Enum.DamageMeterSessionType) ~= "table" then
        return nil
    end
    local ok, v = pcall(C_DamageMeter.GetSessionDurationSeconds, Enum.DamageMeterSessionType.Current)
    return ok and sane(v) or nil
end

local function refreshNow()
    local duration, anySession, shared = nil, false, false
    -- out of combat: the last finished fight, read by its id (its own duration); in combat: "current"
    local last = not ns.inCombat and ns.Meter.Fights(1)[1] or nil
    local lastId = last and type(last.id) == "number" and last.id or nil
    for i = 1, #cards do
        local card = cards[i]
        local session = lastId and ns.Meter.Read(nil, card.def.key, lastId) or ns.Meter.Read("current", card.def.key)
        local mine = ns.Meter.Mine(session)
        local secs
        if session then
            anySession = true
            if ns.isSecret(session.durationSeconds) then
                secs = session.durationSeconds -- mid-fight secret: shown untouched, never compared
            else
                secs = sane(session.durationSeconds) or (last and sane(last.duration)) or sessionSeconds()
            end
            if duration == nil then duration = secs end
        end
        if mine then
            show(card.value, ns.fmt(mine.totalAmount))
            local rate = mine.amountPerSecond
            -- when the game's duration was nonsense, its rate is too: recompute from a plain total
            local broken = session and not ns.isSecret(session.durationSeconds) and not sane(session.durationSeconds)
            local total = ns.plain(mine.totalAmount)
            if broken then
                rate = (type(total) == "number" and type(secs) == "number" and secs > 0) and total / secs or nil
            end
            showRate(card.rate, card.def.unit ~= "" and rate or nil, card.def.unit)
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
        local newest = last or ns.Meter.Fights(1)[1]
        main.nowTitle:SetText(newest and newest.name or "No fight yet")
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
        -- click a player: their spells; click again (any row): back to the list
        bar:EnableMouse(true)
        bar:SetScript("OnMouseUp", function(self)
            if view.detail then
                view.detail = nil
            elseif self.guid then
                view.detail = { guid = self.guid, name = self.srcName }
            end
            UI.Refresh()
        end)
        bar:Hide()
        rows[i] = bar
    end
end

-- Everything that touches possibly-secret values goes through pcall: a secret may be shown, not inspected.
local function fillRow(bar, index, src, maxAmount, sum, clickable)
    -- only a plain player GUID opens a breakdown (mobs on the "Beat up" board do not)
    local guid = ns.plain(src.sourceGUID)
    bar.guid = (clickable and type(guid) == "string" and string.sub(guid, 1, 7) == "Player-") and guid or nil
    bar.srcName = ns.plain(src.name)
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

-- One player's spells (click on a row): same bars, spell names instead of players.
local function refreshDetail()
    local s = ns.db.settings
    local spells = ns.Meter.Spells(s.meterScope, s.meterKind, view.sessionId, view.detail.guid)
    local maxAmount, sum, plainNumbers = 0, 0, true
    for i = 1, #(spells or {}) do
        local amount = ns.plain(spells[i].amount)
        if type(amount) ~= "number" then
            plainNumbers = false
            break
        end
        sum = sum + amount
        if amount > maxAmount then maxAmount = amount end
    end
    local shown = 0
    for i = 1, #(spells or {}) do
        if shown >= ROWS then break end
        shown = shown + 1
        local sp, bar = spells[i], rows[shown]
        bar.guid = nil
        bar:SetStatusBarColor(C.brass[1], C.brass[2], C.brass[3], 0.6)
        pcall(bar.SetMinMaxValues, bar, 0, plainNumbers and math.max(maxAmount, 1) or 1)
        pcall(bar.SetValue, bar, plainNumbers and sp.amount or 0)
        bar.name:SetText(shown .. ".  " .. sp.name .. (sp.pet and (" (" .. sp.pet .. ")") or ""))
        show(bar.amount, ns.fmt(sp.amount))
        showRate(bar.perSecond, sp.perSecond, nil)
        local amount = ns.plain(sp.amount)
        bar.share:SetText((plainNumbers and sum > 0 and type(amount) == "number")
            and string.format("%d%%", math.floor(amount / sum * 100 + 0.5)) or "")
        bar:Show()
    end
    for i = shown + 1, ROWS do rows[i]:Hide() end
    main.meterTitle:SetText((view.detail.name or "Someone") .. " – spells (click to go back)")
    main.meterTotal:SetText(plainNumbers and shown > 0 and ns.fmt(sum) or "")
    if shown == 0 then
        main.meterEmpty:SetText(spells and "Nothing to break down."
            or "No breakdown here (hidden mid-fight?). Click to go back.")
        main.meterEmpty:Show()
    else
        main.meterEmpty:Hide()
    end
end

local function refreshMeter()
    local s = ns.db.settings
    if ns.Summary and ns.Summary.MeterDeferred() then
        for i = 1, ROWS do rows[i]:Hide() end
        main.meterTitle:SetText("")
        main.meterTotal:SetText("")
        main.meterEmpty:SetText("Details! is doing the counting.\n/wowco details off brings ours back.")
        main.meterEmpty:Show()
        return
    end
    if view.detail then return refreshDetail() end
    local session = ns.Meter.Read(s.meterScope, s.meterKind, view.sessionId)
    -- only you and your party (Meter.Visible drops strangers and unverifiable rows)
    local sources = ns.Meter.Visible(session, s.meterKind)
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
            plainNumbers and sum or nil, s.meterKind ~= "enemies")
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
            view.sessionId, view.sessionName, view.detail = self.fight.id, self.fight.name, nil
            UI.Show("meter")
        end)
        fightRows[i] = row
    end
end

-- ------------------------------------------------------------------ records tab
-- Personal bests. The addon cannot see single hits (the game hides them), so these come from
-- the Companion app, which reads the combat log and writes them into the addon's folder.

local RECORDS = {
    { kind = "crit", label = "Biggest crit", prep = "into" },
    { kind = "hit", label = "Biggest hit", prep = "into" },
    { kind = "critHeal", label = "Biggest crit heal", prep = "on" },
    { kind = "heal", label = "Biggest heal", prep = "on" },
    { kind = "hitTaken", label = "Hardest hit taken", prep = "from" },
}

local function buildRecords(parent)
    for i, def in ipairs(RECORDS) do
        local y = -(i - 1) * 36
        local row = { def = def }
        row.label = text(parent, "GameFontHighlightSmall", "LEFT", C.dim)
        row.label:SetPoint("TOPLEFT", 0, y)
        row.label:SetText(string.upper(def.label))
        row.amount = text(parent, "GameFontNormalLarge", "RIGHT", C.gold)
        row.amount:SetPoint("TOPRIGHT", 0, y - 2)
        row.amount:SetWidth(110)
        row.detail = text(parent, "GameFontHighlightSmall", "LEFT", C.text)
        row.detail:SetPoint("TOPLEFT", 0, y - 14)
        row.detail:SetPoint("RIGHT", row.amount, "LEFT", -8, 0)
        if i > 1 then
            local sep = line(parent, 0.12)
            sep:SetPoint("TOPLEFT", 0, y + 5)
            sep:SetPoint("TOPRIGHT", 0, y + 5)
        end
        recordRows[i] = row
    end
    main.recordsEmpty = text(parent, "GameFontHighlightSmall", "CENTER", C.dim)
    main.recordsEmpty:SetPoint("CENTER", 0, 10)
    main.recordsEmpty:SetWidth(WIDTH - 4 * PAD)
    if main.recordsEmpty.SetWordWrap then main.recordsEmpty:SetWordWrap(true) end
    main.recordsEmpty:SetText("No records here yet.\n\nKeep the Companion app running with the combat log on "
        .. "and make something bleed. New records show up at your next login.")
    main.recordsHint = text(parent, "GameFontHighlightSmall", "LEFT", C.faint)
    main.recordsHint:SetPoint("BOTTOMLEFT", 0, 0)
    main.recordsHint:SetText("From the Companion app · new ones at the next login")
end

local function refreshRecords()
    local mine = ns.Export.Records()
    local any = false
    for i = 1, #recordRows do
        local row = recordRows[i]
        local found
        if mine then
            for _, r in ipairs(mine.records) do
                if type(r) == "table" and r.kind == row.def.kind then found = r end
            end
        end
        if found then
            any = true
            row.amount:SetText(ns.fmt(found.amount))
            local detail = tostring(found.spell or "?")
            if found.unit then detail = detail .. " " .. row.def.prep .. " " .. tostring(found.unit) end
            detail = detail .. "  |cff6b635a·  " .. (found.inDungeon and "" or "open world, ")
                .. tostring(found.zone or "somewhere") .. "|r"
            row.detail:SetText(detail)
        else
            row.amount:SetText("–")
            row.detail:SetText("")
        end
        local visible = mine ~= nil
        row.label:SetShown(visible)
        row.amount:SetShown(visible)
        row.detail:SetShown(visible)
    end
    main.recordsEmpty:SetShown(not any)
    main.recordsHint:SetShown(any)
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

    -- opt-in diagnostics for development (Probe.lua)
    local diag = CreateFrame("CheckButton", nil, parent, "UICheckButtonTemplate")
    diag:SetSize(24, 24)
    diag:SetPoint("BOTTOMLEFT", -4, 26)
    diag:SetScript("OnClick", function(self)
        ns.SetDiagnostics(self:GetChecked() and true or false)
    end)
    tooltip(diag, "Help development", "Saves a technical report at logout: how the game's meter, loot "
        .. "messages and party info look on this client. Shapes and numbers only – no names. Off by default; "
        .. "switching it off deletes the report. Same as /wowco diag on|off.")
    local diagLabel = text(parent, "GameFontHighlightSmall", "LEFT", C.text)
    diagLabel:SetPoint("LEFT", diag, "RIGHT", 2, 1)
    diagLabel:SetText("Help development: share diagnostics (no names)")
    main.diag = diag
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
    if main.diag and main.diag.SetChecked then main.diag:SetChecked(ns.db.settings.diagnostics == true) end
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
    ns.EscCloses("WowCompanyFrame", not pinned) -- pinned: Escape leaves it alone
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

    -- header: the dialog banner with the title, the logo as a round portrait, close and pin
    local banner = main:CreateTexture(nil, "ARTWORK")
    banner:SetTexture("Interface\\DialogFrame\\UI-DialogBox-Header")
    banner:SetSize(250, 62)
    banner:SetPoint("TOP", 0, 13)
    local title = text(main, "GameFontNormal", "CENTER", C.gold)
    title:SetPoint("TOP", banner, "TOP", 0, -13)
    title:SetText("WowCompany")

    local portrait = CreateFrame("Frame", nil, main)
    portrait:SetSize(54, 54)
    portrait:SetPoint("TOPLEFT", -14, 14)
    portrait:SetFrameLevel((main.GetFrameLevel and main:GetFrameLevel() or 1) + 5)
    local logo = portrait:CreateTexture(nil, "ARTWORK")
    logo:SetTexture(MEDIA .. "Logo")
    logo:SetSize(42, 42)
    logo:SetPoint("CENTER")
    local ring = portrait:CreateTexture(nil, "OVERLAY")
    ring:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
    ring:SetSize(90, 90)
    ring:SetPoint("TOPLEFT", -3, 3)

    local close = CreateFrame("Button", nil, main, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -5, -5)
    close:SetScript("OnClick", function() main:Hide() end)
    tooltip(close, "Close", "/wowco opens it again.")
    main.pin = button(main, "pin", 52, function()
        ns.db.settings.pinned = not ns.db.settings.pinned
        applyPin()
    end, "Pin the window", "Pinned: it stays put. Unpinned: drag it anywhere.")
    main.pin:SetPoint("RIGHT", close, "LEFT", -2, 0)
    applyPin()

    local headLine = line(main, 0.4)
    headLine:SetPoint("TOPLEFT", 14, -HEADER)
    headLine:SetPoint("TOPRIGHT", -14, -HEADER)

    main.tabs = {}
    local x = (WIDTH - 250) / 2 -- 5 tabs, 250 px together, centred under the banner
    for _, t in ipairs({ { "now", "Now", 38 }, { "meter", "Meter", 46 }, { "fights", "Fights", 46 },
        { "records", "Records", 58 }, { "logging", "Logging", 54 } }) do
        local b = tab(main, t[2], t[3], function() UI.Show(t[1]) end)
        b:SetPoint("TOPLEFT", x, -(HEADER - 26))
        x = x + t[3] + 2
        main.tabs[t[1]] = b
    end

    -- footer: recording light, where we are, version
    local footLine = line(main, 0.25)
    footLine:SetPoint("BOTTOMLEFT", 14, FOOTER + 2)
    footLine:SetPoint("BOTTOMRIGHT", -14, FOOTER + 2)
    main.recDot = main:CreateTexture(nil, "ARTWORK")
    main.recDot:SetSize(8, 8)
    main.recDot:SetPoint("BOTTOMLEFT", PAD, 11)
    main.recText = text(main, "GameFontHighlightSmall", "LEFT", C.dim)
    main.recText:SetPoint("LEFT", main.recDot, "RIGHT", 6, 0)
    local ver = text(main, "GameFontHighlightSmall", "RIGHT", C.faint)
    ver:SetPoint("BOTTOMRIGHT", -PAD, 9)
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
        local more = k.key == "interrupts" -- the 4th button cycles through Meter.MORE
        local b = button(meter, k.label, 58, function()
            local st = ns.db.settings
            if more then
                if ns.Meter.IsMore(st.meterKind) then st.moreKind = ns.Meter.NextMore(st.meterKind).key end
                st.meterKind = st.moreKind
            else
                st.meterKind = k.key
            end
            view.detail = nil
            UI.Refresh()
        end, more and "More" or k.label,
            more and "Kicks, dispels, shields, fire (avoidable damage), beat up (damage per enemy), deaths. "
                .. "Click again for the next one." or nil)
        b:SetPoint("TOPLEFT", bx, 0)
        bx = bx + 61
        main.kindButtons[k.key] = b
    end
    bx = 0
    for i = #ns.Meter.SCOPES, 1, -1 do
        local sc = ns.Meter.SCOPES[i]
        local b = button(meter, sc.label, 64, function()
            ns.db.settings.meterScope = sc.key
            view.sessionId, view.sessionName, view.detail = nil, nil, nil
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

    main.records = page()
    buildRecords(main.records)

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
    main.records:SetShown(view.tab == "records")
    main.logging:SetShown(view.tab == "logging")
    refreshFooter()
    if view.tab == "now" then
        refreshNow()
    elseif view.tab == "meter" then
        local st = ns.db.settings
        local more = ns.Meter.IsMore(st.meterKind) or ns.Meter.IsMore(st.moreKind) or ns.Meter.MORE[1]
        for key, b in pairs(main.kindButtons) do
            if key == "interrupts" then
                b.label:SetText(more.label)
                b:SetChosen(ns.Meter.IsMore(st.meterKind) ~= nil)
            else
                b:SetChosen(key == st.meterKind)
            end
        end
        for key, b in pairs(main.scopeButtons) do
            b:SetChosen(not view.sessionId and key == ns.db.settings.meterScope)
        end
        refreshMeter()
    elseif view.tab == "fights" then
        refreshFights()
    elseif view.tab == "records" then
        refreshRecords()
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

ns.command("panel", "panel – the big window: run, records, logging", function() UI.Toggle() end)

ns.command("reset", "reset – window back to the top of the screen, unpinned", function()
    UI.Reset()
    ns.say("window reset.")
end)

ns.onReady(function()
    -- open on login unless it was closed last time (first run: open, so you can see it works)
    -- 0.6: the small meter window is the default; the big panel opens only when asked for
    -- (once: forget that it was open in older versions)
    local st = ns.db.settings
    if not st.panelV6 then
        st.panelV6, st.open = true, false
    end
    if st.open == true then UI.Show() end
    ns.say("v" .. tostring(ns.version) .. " loaded. |cffffffff/wowco|r opens the meter. "
        .. ns.Logging.Describe() .. ".")
end)
