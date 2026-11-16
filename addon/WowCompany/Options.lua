-- Settings page in the game's menu: Options → AddOns → WowCompany (and /wowco options).
-- Every switch calls the same code as its slash command, so the two never disagree.

local _, ns = ...

local Options = {}
ns.Options = Options

local panel, category
local checks = {}

local function s() return ns.db.settings end
local function slash(msg) if type(SlashCmdList) == "table" then SlashCmdList.WOWCOMPANY(msg) end end

local function heading(text, y)
    local fs = panel:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    fs:SetPoint("TOPLEFT", 16, y)
    fs:SetText(text)
    return fs
end

-- a checkbox with a label and a grey note under it
local function check(label, note, y, x, get, set)
    local cb = CreateFrame("CheckButton", nil, panel, "UICheckButtonTemplate")
    cb:SetSize(24, 24)
    cb:SetPoint("TOPLEFT", x or 16, y)
    local fs = panel:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    fs:SetPoint("LEFT", cb, "RIGHT", 4, 1)
    fs:SetText(label)
    if note then
        local n = panel:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
        n:SetPoint("TOPLEFT", fs, "BOTTOMLEFT", 0, -2)
        n:SetText(note)
    end
    cb:SetScript("OnClick", function(self)
        set(self:GetChecked() and true or false)
        Options.Refresh()
        if ns.Window then ns.Window.Refresh() end
    end)
    cb.get = get
    table.insert(checks, cb)
    return cb
end

local function button(label, width, x, y, onClick)
    local b = CreateFrame("Button", nil, panel, "UIPanelButtonTemplate")
    b:SetSize(width, 22)
    b:SetPoint("TOPLEFT", x, y)
    b:SetText(label)
    b:SetScript("OnClick", onClick)
    return b
end

function Options.Refresh()
    if not panel then return end
    for _, cb in ipairs(checks) do cb:SetChecked(cb.get() == true) end
    if panel.logState then
        local L = ns.Logging
        local function onoff(v) return v and "|cff4de34dON|r" or "|cffff5242off|r" end
        panel.logState:SetText("Right now:  combat log " .. onoff(L.CombatOn()) .. "  ·  chat log "
            .. onoff(L.ChatOn()) .. "  ·  advanced " .. onoff(L.Advanced()))
        panel.logNow:SetText((L.CombatOn() and L.ChatOn()) and "Stop logging now" or "Start logging now")
    end
end

local function build()
    panel = CreateFrame("Frame", "WowCompanyOptions")
    panel.name = "WowCompany"

    local logo = panel:CreateTexture(nil, "ARTWORK")
    logo:SetTexture("Interface\\AddOns\\WowCompany\\Media\\Logo")
    logo:SetSize(48, 48)
    logo:SetPoint("TOPLEFT", 14, -12)
    local title = panel:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    title:SetPoint("LEFT", logo, "RIGHT", 10, 8)
    title:SetText("WowCompany")
    local sub = panel:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    sub:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -4)
    sub:SetText("v" .. tostring(ns.version) .. "  ·  meter, logging and the bridge to the Companion app")

    -- meter window
    local y = -76
    heading("Meter window", y)
    check("Show the meter window", "/wowco opens and closes it", y - 20, 16,
        function() return ns.Window and ns.Window.IsShown() end,
        function(on) if on then ns.Window.Show() elseif ns.Window.IsShown() then ns.Window.Toggle() end end)
    check("Lock position and size", "Esc does not close it while locked", y - 54, 16,
        function() return s().winLocked end, function(on)
            s().winLocked = on
            if ns.Window then ns.Window.ApplyLock() end
        end)
    check("Show percent", nil, y - 78, 16,
        function() return s().winPercent ~= false end, function(on) s().winPercent = on end)
    local sizes = { { "Small bars", 14 }, { "Normal bars", 17 }, { "Large bars", 21 } }
    for i, sz in ipairs(sizes) do
        check(sz[1], nil, y - 102, 16 + (i - 1) * 120,
            function() return s().winBar == sz[2] end,
            function() s().winBar = sz[2] if ns.Window then ns.Window.Layout() end end)
    end
    check("Let Details! do the meter", "our window steps aside when Details! is installed", y - 126, 16,
        function() return s().deferToDetails end, function(on) slash("details " .. (on and "on" or "off")) end)

    -- logging and the Companion
    y = -250
    heading("Logging (what the Companion reads)", y)
    check("Auto-log in dungeons", "combat and chat log on when you walk in", y - 20, 16,
        function() return s().autoLog end, function(on)
            s().autoLog = on
            if ns.Logging.Check then ns.Logging.Check() end
        end)
    check("Log in the open world too", "personal records anywhere; the log grows faster", y - 54, 16,
        function() return s().logEverywhere end, function(on) ns.Logging.SetEverywhere(on) end)
    check("WowCompany chat tab", "loot and rolls reach the chat log even if your own tabs hide them", y - 88, 16,
        function() return s().chatTab ~= false end, function(on) slash("chat " .. (on and "on" or "off")) end)
    check("Ask to send the loot after a dungeon", "Send now reloads the interface for a second", y - 122, 16,
        function() return s().askSend ~= false end, function(on) slash("ask " .. (on and "on" or "off")) end)
    button("Advanced logging on", 150, 340, y - 20, function() slash("advanced") end)
    panel.logNow = button("Start logging now", 150, 340, y - 48, function()
        local on = ns.Logging.CombatOn() and ns.Logging.ChatOn()
        ns.Logging.Set(not on, true)
        Options.Refresh()
    end)
    panel.logState = panel:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    panel.logState:SetPoint("TOPLEFT", 340, y - 76)
    panel.logState:SetWidth(260)
    panel.logState:SetJustifyH("LEFT")

    -- other
    y = -410
    heading("Other", y)
    check("Minimap button", nil, y - 20, 16,
        function() return not s().minimapHidden end,
        function(on) if (not s().minimapHidden) ~= on then slash("minimap") end end)
    check("Help development (diagnostics)", "a technical report at logout – shapes and numbers, no names", y - 44, 16,
        function() return s().diagnostics end, function(on) ns.SetDiagnostics(on) end)
    button("Open the meter", 130, 16, y - 84, function() ns.Window.Show() end)
    button("Your records", 170, 152, y - 84, function() ns.Window.ShowRecords() end)
    button("Reset window spots", 150, 328, y - 84, function()
        s().win = nil
        slash("reset")
    end)

    panel:SetScript("OnShow", Options.Refresh)

    if type(Settings) == "table" and type(Settings.RegisterCanvasLayoutCategory) == "function" then
        category = Settings.RegisterCanvasLayoutCategory(panel, "WowCompany")
        Settings.RegisterAddOnCategory(category)
    elseif type(InterfaceOptions_AddCategory) == "function" then
        InterfaceOptions_AddCategory(panel)
    end
end

function Options.Open()
    if not panel then build() end
    if category and type(Settings) == "table" and type(Settings.OpenToCategory) == "function" then
        local id = category.GetID and category:GetID() or category.ID
        pcall(Settings.OpenToCategory, id)
    elseif type(InterfaceOptionsFrame_OpenToCategory) == "function" then
        InterfaceOptionsFrame_OpenToCategory(panel)
    end
end

ns.onReady(function() if not panel then build() end end)

ns.command("options", "options – the settings page (also in Options → AddOns)", Options.Open)

-- the game's addon compartment (the button with all addons, next to the minimap): opens the meter
function WowCompany_OnCompartmentClick() -- luacheck: ignore (global for the .toc)
    if ns.Window then ns.Window.Toggle() end
end
