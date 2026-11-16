-- Smoke test for the addon outside the game: lua5.1 addon/tests/smoke.lua (from the repo root).
-- A fake, minimal WoW API loads every file, fires the events and draws every tab, so nil calls,
-- typos and broken logic show up here and not as a Lua error in the middle of a dungeon.
-- It cannot prove that the real client behaves like the fake one – only that our code is sound.

local failures = 0
local function check(cond, what)
    if cond then
        io.write("  ok   " .. what .. "\n")
    else
        failures = failures + 1
        io.write("  FAIL " .. what .. "\n")
    end
end

-- ------------------------------------------------------------------ fake widgets
local frames = {}
local Widget = {}
Widget.__index = function(_, key)
    return Widget[key] or function() end -- any other widget method: do nothing
end
local function newWidget(kind, name)
    local w = setmetatable({ kind = kind, shown = true, scripts = {}, events = {}, texts = {} }, Widget)
    if name then _G[name] = w end
    table.insert(frames, w)
    return w
end
function Widget:Show()
    if self.shown then return end
    self.shown = true
    if self.scripts.OnShow then self.scripts.OnShow(self) end
end
function Widget:Hide()
    if not self.shown then return end
    self.shown = false
    if self.scripts.OnHide then self.scripts.OnHide(self) end
end
function Widget:StartMoving() self.moving = true end
function Widget:StopMovingOrSizing() self.moving = false end
function Widget:SetPoint(...) self.point = { ... } end
function Widget:ClearAllPoints() self.point = nil end
function Widget:IsShown() return self.shown end
function Widget:SetShown(on) self.shown = on and true or false end
function Widget:SetScript(what, fn) self.scripts[what] = fn end
function Widget:RegisterEvent(event)
    if event == "CHAT_MSG_COMBAT_HOSTILE_DEATH" then error("Attempt to register unknown event") end
    if string.find(event, "^COMBAT_LOG_EVENT") then error("FORBIDDEN: the addon must never register " .. event) end
    self.events[event] = true
end
function Widget:SetText(t) self.text = t end
function Widget:GetText() return self.text end
function Widget:CreateFontString() return newWidget("FontString") end
function Widget:CreateTexture() return newWidget("Texture") end
function Widget:GetPoint() return "CENTER", nil, "CENTER", 10, 20 end -- where a drag ends
function Widget:Cancel() self.cancelled = true end

function CreateFrame(kind, name) return newWidget(kind, name) end
UIParent = newWidget("Frame")
GameTooltip = newWidget("GameTooltip")
Minimap = newWidget("Minimap")
function Minimap:GetWidth() return 140 end
function Minimap:GetCenter() return 500, 500 end
function Minimap:GetEffectiveScale() return 1 end
local cursor = { 600, 500 }
function GetCursorPosition() return cursor[1], cursor[2] end
UISpecialFrames = {}
tinsert = table.insert
BackdropTemplateMixin = {}
RAID_CLASS_COLORS = { MAGE = { r = 0.25, g = 0.78, b = 0.92 }, WARRIOR = { r = 0.78, g = 0.61, b = 0.43 } }
SlashCmdList = {}

-- ------------------------------------------------------------------ fake game state
local SECRET = setmetatable({}, { __tostring = function() return "<secret>" end })
local game = { combatLog = false, chatLog = false, instanceType = "none", secrets = false, advanced = "0",
    grouped = false, partyGuids = {}, stranger = false }
local printed = {}
local realPrint = print
function print(...)
    local t = {}
    for i = 1, select("#", ...) do t[i] = tostring((select(i, ...))) end
    table.insert(printed, table.concat(t, " "))
end
function issecretvalue(v) return v == SECRET end
function time() return 1794672089 end
function GetServerTime() return 1794672089 end
function GetTime() return 1000 end
function LoggingCombat(on)
    if on ~= nil then game.combatLog = on end
    return game.combatLog
end
function LoggingChat(on)
    if on ~= nil then game.chatLog = on end
    return game.chatLog
end
function GetInstanceInfo() return "Somewhere", game.instanceType, 1, "Normal", 5, 0, false, 43 end
function UnitGUID() return "Player-1-0000000A" end
function UnitName() return "Mottled Boar" end
function UnitLevel() return 18 end
function UnitClass() return "Mage", "MAGE", 8 end
function GetCritChance() return 2.124300241470337 end
function UnitAttackPower() return 13, 2, 0 end
function UnitArmor() return 0, 184, 184, 184 end
function GetAverageItemLevel() return 11.75, 11.75, 11.75 end
function UnitFullName(unit)
    if unit == "party1" then return "Fizzle", "Boom" end
    return "Grobos", "Stinkfoot"
end
function UnitIsGroupLeader(unit) return unit == (game.leaderUnit or "player") end
function UnitExists(unit) return unit == "player" or unit == "party1" or unit == "target" end
function GetNumGroupMembers() return 2 end
function IsInGroup() return game.grouped end
function BreakUpLargeNumbers(n) return tostring(n) end
local timers = {}
C_Timer = {
    After = function(_, fn) table.insert(timers, fn) end,
    NewTimer = function(_, fn)
        local t = newWidget("Timer")
        t.cancelled = false -- unknown widget fields are functions (truthy), so set it explicitly
        table.insert(timers, function() if not t.cancelled then fn() end end)
        return t
    end,
}
local function runTimers()
    local list = timers
    timers = {}
    for i = 1, #list do list[i]() end
end
C_AddOns = {
    GetAddOnMetadata = function() return "0.6.4" end,
    IsAddOnLoaded = function(name) return name == "Details" and game.details == true end,
}
C_Spell = { GetSpellInfo = function(id) return { name = id == 133 and "Fireball" or "Frostbolt" } end }
local sent = {}
StaticPopupDialogs = {}
local popups, reloads = {}, 0
function StaticPopup_Show(name, arg) table.insert(popups, { name = name, arg = arg }) end
C_UI = { Reload = function() reloads = reloads + 1 end }
-- chat windows (for the WowCompany chat tab)
NUM_CHAT_WINDOWS = 10
local chatWindows = { [1] = "General", [2] = "Combat Log" }
local chatSelected
DEFAULT_CHAT_FRAME = { groups = {} }
ChatFrame1 = DEFAULT_CHAT_FRAME
function GetChatWindowInfo(i) return chatWindows[i] or "" end
function FCF_OpenNewWindow(name)
    local i = 3
    while chatWindows[i] do i = i + 1 end
    local f = { groups = { SAY = true, EMOTE = true } }
    function f:AddMessageGroup(g) self.groups[g] = true end
    chatWindows[i] = name
    _G["ChatFrame" .. i] = f
    chatSelected = f
    return f
end
function ChatFrame_RemoveAllMessageGroups(f) f.groups = {} end
function FCF_SelectDockFrame(f) chatSelected = f end
function FCF_Close(f)
    for i = 3, NUM_CHAT_WINDOWS do
        if _G["ChatFrame" .. i] == f then chatWindows[i], _G["ChatFrame" .. i] = nil, nil end
    end
end
function InCombatLockdown() return false end
function SendChatMessage(msg, channel) table.insert(sent, { msg = msg, channel = channel }) end
C_CVar = {
    GetCVar = function() return game.advanced end,
    SetCVar = function(_, v) game.advanced = v end,
}
C_PartyInfo = {
    GetLootMethod = function() return 0 end,
    IsGUIDInGroup = function(guid) return game.partyGuids[guid] == true end,
}
Enum = {
    DamageMeterType = { DamageDone = 0, Dps = 1, HealingDone = 2, Hps = 3, Absorbs = 4, Interrupts = 5, Dispels = 6,
        DamageTaken = 7, AvoidableDamageTaken = 8, Deaths = 9, EnemyDamageTaken = 10 },
    DamageMeterSessionType = { Overall = 0, Current = 1, Expired = 2 },
}
local function session(kind)
    local n = function(v) return game.secrets and SECRET or v end
    if kind == 10 then -- EnemyDamageTaken: rows are mobs (and never a player)
        return { durationSeconds = 46, totalAmount = n(5000), maxAmount = n(4000), combatSources = {
            { name = "Deviate Creeper", totalAmount = n(4000), amountPerSecond = n(87), sourceGUID = "Creature-0-1-43-1-3632-1" },
            { name = "Fizzle Boom", totalAmount = n(1000), amountPerSecond = n(20), sourceGUID = "Player-1-0000000B" },
        } }
    end
    local s = {
        durationSeconds = 46, totalAmount = n(5000), maxAmount = n(3000),
        combatSources = {
            { name = "Grobos Stinkfoot", classFilename = "MAGE", totalAmount = n(3000), amountPerSecond = n(65.2),
              isLocalPlayer = true, sourceGUID = "Player-1-0000000A" },
            { name = "Fizzle Boom", classFilename = "WARRIOR", totalAmount = n(2000), amountPerSecond = n(43.5),
              isLocalPlayer = false, sourceGUID = "Player-1-0000000B" },
        },
    }
    -- mid-fight the identity fields can be secret too
    if game.secrets then
        for _, src in ipairs(s.combatSources) do
            src.isLocalPlayer, src.sourceGUID, src.name = SECRET, SECRET, SECRET
        end
    end
    return s
end
INVTYPE_2HWEAPON = "Two-Hand"
C_Item = {
    GetItemInfo = function(id)
        if id ~= 2084 then return nil end
        return "Darksteel Bastard Sword", "|Hitem:2084|h", 3, 30, 25, "Weapon", "Two-Handed Swords", 1,
            "INVTYPE_2HWEAPON", 135321, 7137, 2, 8, 2
    end,
    RequestLoadItemDataByID = function() end,
}
C_TooltipInfo = {
    GetItemByID = function()
        return { lines = {
            { leftText = "|cff0070ddDarksteel Bastard Sword|r" },
            { leftText = "Binds when equipped" },
            { leftText = "Two-Hand", rightText = "Sword" },
            { leftText = "24 - 36 Damage", rightText = "Speed 3.20" },
            { leftText = "|cff00ff00+8 Strength|r" },
        } }
    end,
}
C_DamageMeter = {
    IsDamageMeterAvailable = function() return true, "" end,
    GetCombatSessionFromType = function(_, kind)
        local s = session(kind)
        -- seen in game: out of combat "current" reports the time since the computer started
        if game.brokenCurrent then s.durationSeconds = 4270212 end
        return s
    end,
    GetCombatSessionFromID = function(_, kind) return session(kind) end,
    GetCombatSessionSourceFromType = function()
        local n = function(v) return game.secrets and SECRET or v end
        return { totalAmount = n(3000), maxAmount = n(1800), combatSpells = {
            { spellID = 133, totalAmount = n(1800), amountPerSecond = n(39.1), creatureName = "" },
            { spellID = 116, totalAmount = n(1200), amountPerSecond = n(26.1), creatureName = "" },
        } }
    end,
    GetCombatSessionSourceFromID = function() return { combatSpells = {} } end,
    GetSessionDurationSeconds = function() return 46 end,
    GetAvailableCombatSessions = function()
        return {
            { sessionID = 1, name = "Deviate Creeper", durationSeconds = 14 },
            { sessionID = 2, name = "(!) Lord Pythas", durationSeconds = 46 },
            { sessionID = 3, name = "" },
        }
    end,
}

-- ------------------------------------------------------------------ load the addon like the game does
local ns = {}
local dir = "addon/WowCompany/"
for line in io.lines(dir .. "WowCompany.toc") do
    if string.match(line, "%.lua$") then
        local chunk = assert(loadfile(dir .. line))
        chunk("WowCompany", ns)
    end
end

local function fire(event, ...)
    for i = 1, #frames do
        local f = frames[i]
        if f.events[event] and f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
    end
end
local function slash(msg) SlashCmdList["WOWCOMPANY"](msg) end
local function said(pattern)
    for i = 1, #printed do
        if string.find(printed[i], pattern) then return true end
    end
    return false
end

realPrint("addon smoke test")
fire("ADDON_LOADED", "SomeOtherAddon")
check(ns.db == nil, "ignores other addons loading")
fire("ADDON_LOADED", "WowCompany")
check(type(WowCompanyDB) == "table" and WowCompanyDB.settings.autoLog == true, "saved variables get defaults")
check(said("loaded"), "greets on load")
check(WowCompanyMeter ~= nil and WowCompanyMeter:IsShown(), "first run: the meter window opens by itself")
check(WowCompanyOptions ~= nil, "options: the settings page is built at load")
check(pcall(ns.Options.Open) and pcall(ns.Options.Refresh), "options: /wowco options opens it")
local function escCloses(name)
    for _, n in ipairs(UISpecialFrames) do if n == name then return true end end
    return false
end
check(escCloses("WowCompanyMeter"), "Esc closes the meter while it is not locked")
WowCompanyDB.settings.winLocked = true
ns.Window.ApplyLock()
check(not escCloses("WowCompanyMeter"), "locked meter: Esc leaves it open")
WowCompanyDB.settings.winLocked = false
ns.Window.ApplyLock()
check(pcall(WowCompany_OnCompartmentClick) and not WowCompanyMeter:IsShown(), "addon compartment toggles the meter")
WowCompany_OnCompartmentClick()
check(WowCompanyMeter.point[1] == "RIGHT", "meter: default spot on the right of the screen")

-- formatting helpers
check(ns.fmt(1234567.4) == "1234567", "fmt uses the game's number formatter")
BreakUpLargeNumbers = nil
check(ns.fmt(1234567.4) == "1,234,567" and ns.fmt(999) == "999" and ns.fmt(1000) == "1,000", "fmt fallback groups digits")
check(ns.fmt(SECRET) == SECRET, "fmt passes secrets through untouched")
check(ns.fmtRate(65.23456789) == "65.23" and ns.fmtRate(7) == "7.00" and ns.fmtRate(nil) == nil,
    "per-second values always have two decimals")
check(ns.fmtRate(SECRET) == nil, "a rate that cannot be formatted is left out, not printed raw")
check(ns.fmtTime(75) == "1:15" and ns.fmtTime(SECRET) == "–", "fmtTime")
check(ns.on("COMBAT_LOG_EVENT_UNFILTERED", function() end) == false, "refuses to register the forbidden combat log event")
check(ns.on("CHAT_MSG_COMBAT_HOSTILE_DEATH", function() end) == false, "unknown events are ignored, not fatal")

-- logging: nothing outside a dungeon, on inside, off 20 minutes after leaving
fire("PLAYER_ENTERING_WORLD", true, false)
check(game.combatLog == false and game.chatLog == false, "no logging outside a dungeon")
game.instanceType = "party"
fire("ZONE_CHANGED_NEW_AREA")
check(game.combatLog == true and game.chatLog == true, "entering a dungeon switches both logs on")
check(said("advanced combat logging is off"), "warns when advanced logging is off")
game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
check(game.combatLog == true, "leaving keeps logging for the corpse run")
game.instanceType = "party"
fire("ZONE_CHANGED_NEW_AREA")
runTimers()
check(game.combatLog == true, "coming back cancels the switch-off")
game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
runTimers()
check(game.combatLog == false and game.chatLog == false, "20 minutes outside switches our logs off")

-- a log the player started is never switched off by the addon
slash("log on")
game.instanceType = "party"
fire("ZONE_CHANGED_NEW_AREA")
game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
runTimers()
check(game.combatLog == true, "a log the player switched on stays on")
slash("log off")
check(game.combatLog == false and game.chatLog == false, "/wowco log off")
slash("log auto")
check(WowCompanyDB.settings.autoLog == false, "/wowco log auto toggles the setting")
game.instanceType = "party"
fire("ZONE_CHANGED_NEW_AREA")
check(game.combatLog == false, "auto off: dungeon does not start logging")
slash("log auto")

-- log everywhere: open world too, off again right away when switched off outside a dungeon
game.instanceType = "none"
slash("log off")
slash("log everywhere")
check(WowCompanyDB.settings.logEverywhere == true and game.combatLog == true and game.chatLog == true,
    "/wowco log everywhere starts logging in the open world")
game.instanceType = "party"
fire("ZONE_CHANGED_NEW_AREA")
game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
runTimers()
check(game.combatLog == true, "everywhere: leaving a dungeon keeps logging")
slash("log everywhere")
check(WowCompanyDB.settings.logEverywhere == false and game.combatLog == false and game.chatLog == false,
    "switching everywhere off stops our logs at once")
slash("advanced")
check(game.advanced == "1", "/wowco advanced sets the cvar")

-- meter data
local fights = ns.Meter.Fights(10)
check(#fights == 3 and fights[1].name == "Unknown scuffle" and fights[2].boss and fights[2].name == "Lord Pythas",
    "fights: newest first, boss mark stripped, empty name replaced")
check(ns.Meter.Read("current", "damage").totalAmount == 5000, "reads the current fight")
check(ns.Meter.Read("nonsense", "damage") == nil, "unknown scope gives nothing")

-- window: every tab, plain and secret values
local function textOf(label)
    for i = 1, #frames do
        if frames[i].text == label then return frames[i] end
    end
end

-- /wowco = the small meter window (Window.lua), /wowco panel = the big one
check(WowCompanyMeter ~= nil and WowCompanyMeter:IsShown(), "meter window opens on load")
slash("")
check(not WowCompanyMeter:IsShown() and WowCompanyDB.settings.winOpen == false, "/wowco closes the meter and remembers it")
slash("")
check(WowCompanyMeter:IsShown() and WowCompanyDB.settings.winOpen == true, "/wowco opens it again")
check(textOf("1. Grobos Stinkfoot") ~= nil and textOf("3.00K") ~= nil, "meter: party rows with short numbers")
for _, k in ipairs({ "damage", "healing", "taken", "interrupts", "dispels", "absorbs", "avoidable", "enemies", "deaths" }) do
    WowCompanyDB.settings.winKind = k
    check(pcall(ns.Window.Refresh), "meter window display " .. k)
end
WowCompanyDB.settings.winKind = "damage"
check(pcall(ns.Window.OpenBreakdown, "Player-1-0000000A", "Grobos Stinkfoot", "MAGE"), "meter: spell breakdown opens")
check(pcall(WowCompanyMeter.scripts.OnUpdate, WowCompanyMeter, 1), "meter: refresh tick")
ns.Window.CloseBreakdown()

-- drag, lock, reset (the meter window)
local win = WowCompanyMeter
local titleBar
for i = 1, #frames do
    if frames[i] ~= win and frames[i] ~= WowCompanyMinimapButton and frames[i].scripts.OnDragStart then titleBar = frames[i] end
end
titleBar.scripts.OnDragStart(titleBar)
check(win.moving == true, "meter: drag by the title bar")
titleBar.scripts.OnDragStop(titleBar)
check(WowCompanyDB.settings.win[1] == "CENTER" and WowCompanyDB.settings.win[3] == 10, "meter: drop remembers the spot")
WowCompanyDB.settings.winLocked = true
win.moving = false
titleBar.scripts.OnDragStart(titleBar)
check(win.moving == false, "locked meter does not move")
slash("reset")
check(WowCompanyDB.settings.win == nil and WowCompanyDB.settings.winLocked == false and win.point[1] == "RIGHT",
    "/wowco reset: default spot, unlocked")
-- PRIVACY: strangers are never listed; party members only when they really are in the party
game.instanceType = "none"
local function names(list)
    local t = {}
    for i = 1, #list do t[i] = list[i].name end
    return table.concat(t, ",")
end
local sess = ns.Meter.Read("current", "damage")
check(names(ns.Meter.Visible(sess)) == "Grobos Stinkfoot", "alone in the open world: a stranger on the same mob is hidden")
game.grouped = true
check(names(ns.Meter.Visible(sess)) == "Grobos Stinkfoot", "in a group: someone who is not in it stays hidden")
game.partyGuids["Player-1-0000000B"] = true
check(names(ns.Meter.Visible(sess)) == "Grobos Stinkfoot,Fizzle Boom", "party member is shown")
game.partyGuids = {}
game.instanceType = "party"
check(#ns.Meter.Visible(sess) == 2, "dungeon with the group: everyone inside is the party")
game.grouped = false
check(#ns.Meter.Visible(sess) == 1, "dungeon alone: still only you")
game.secrets = true
game.instanceType = "none"
check(#ns.Meter.Visible(ns.Meter.Read("current", "damage")) == 0 and ns.Meter.Mine(ns.Meter.Read("current", "damage")) == nil,
    "identity hidden mid-fight in the open world: nothing is shown, nothing is guessed")
game.secrets = false

-- the dungeon run: counted from the fights after walking in, shown as a banner on the Now page
check(ns.Meter.Run() == nil, "no run outside a dungeon")
game.instanceType = "party"
fire("ZONE_CHANGED_NEW_AREA")
local run = ns.Meter.Run()
check(run ~= nil and run.zone == "Somewhere" and run.fights == 0 and run.bosses == 0, "walking in starts a run with no fights yet")
WowCompanyDB.state.run.afterFight = 1 -- as if fight 1 happened before the dungeon
run = ns.Meter.Run()
check(run.fights == 2 and run.bosses == 1, "fights and bosses of the run are counted from the meter")

game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
check(ns.Meter.Run() == nil and WowCompanyDB.state.run.leftAt ~= nil, "leaving pauses the run")
game.instanceType = "party"
fire("ZONE_CHANGED_NEW_AREA")
check(ns.Meter.Run() ~= nil and WowCompanyDB.state.run.afterFight == 1, "coming back (corpse run) continues the same run")
game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
slash("log off")

-- export for the Companion: run with its leader, character stats, only on our own party
local function exported(pattern)
    for _, l in ipairs(WowCompanyDB.export or {}) do
        if string.find(l, pattern) then return l end
    end
end
game.instanceType, game.grouped, game.leaderUnit = "party", true, "party1"
WowCompanyDB.state.run = nil
fire("ZONE_CHANGED_NEW_AREA")
fire("GROUP_ROSTER_UPDATE")
check(exported("^v1|META|0%.6%.4|%d+$") ~= nil, "export: META line with the addon version")
local runLine = exported("^v1|RUN|")
check(runLine ~= nil and string.find(runLine, "|43|", 1, true) and string.find(runLine, "|0|Somewhere|Fizzle Boom$"),
    "export: run in progress with instance id, zone and the party leader (" .. tostring(runLine) .. ")")
check(exported("^v1|CHAR|Grobos Stinkfoot|18|MAGE|2%.12|15|184|11%.75|%d+$") ~= nil, "export: character stats")
game.leaderUnit = "player"
fire("PARTY_LEADER_CHANGED")
check(string.find(exported("^v1|RUN|"), "|Grobos Stinkfoot$") ~= nil, "export: leader change is picked up")
game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
check(string.find(exported("^v1|RUN|"), "|0|Somewhere|") == nil and not said("/reload"),
    "export: leaving closes the run, no /reload nagging (leader comes from the chat log)")
game.grouped, game.instanceType = false, "party"
WowCompanyDB.state.run = nil
WowCompanyDB.runs = {}
fire("ZONE_CHANGED_NEW_AREA")
check(string.find(exported("^v1|RUN|"), "|Somewhere|$") ~= nil, "export: alone in a dungeon there is no leader to name")
game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
fire("PLAYER_LOGOUT")
check(#WowCompanyDB.export >= 3, "export is rebuilt right before the game saves")
slash("log off")

-- loot: item id + quality for the Companion, only inside a run, never a name
local P = ns.Export.ParseLoot
local l1 = P("You receive loot: |cff0070dd|Hitem:2084::::::::18:::::::|h[Darksteel Bastard Sword]|h|r.")
check(l1 and l1.itemId == 2084 and l1.quality == 3 and l1.count == 1 and l1.name == "Darksteel Bastard Sword",
    "loot link: id, quality from the colour, name")
local l2 = P("Fizzle Boom receives loot: |cnIQ2:|Hitem:2589::::|h[Linen Cloth]|h|rx3.")
check(l2 and l2.itemId == 2589 and l2.quality == 2 and l2.count == 3, "loot link: new colour form and stack count")
check(P("|HlootHistory:7|h[Loot]|h: Fizzle Boom has selected Greed for: |cff1eff00|Hitem:3184::::|h[Hook Dagger]|h|r") == nil
    and P("|HlootHistory:7|h[Loot]|h: Fizzle Boom won: |cff1eff00|Hitem:3184::::|h[Hook Dagger]|h|r") == nil,
    "roll messages (they start with a [Loot] link) are not loot")
check(P("You receive loot: Linen Clothx3") == nil and P(SECRET) == nil and P(nil) == nil,
    "loot without a link (or a secret line) is skipped")
WowCompanyDB.loot = {}
fire("CHAT_MSG_LOOT", "You receive loot: |cff1eff00|Hitem:2589::::|h[Linen Cloth]|h|rx3.")
check(#WowCompanyDB.loot == 0, "loot outside a dungeon run is not recorded")
game.instanceType = "party"
fire("ZONE_CHANGED_NEW_AREA")
fire("CHAT_MSG_LOOT", "Fizzle Boom receives loot: |cff0070dd|Hitem:2084::::|h[Darksteel Bastard Sword]|h|r.")
local lootLine = exported("^v1|LOOT|")
local itemLine = exported("^v1|ITEM|2084|")
check(itemLine == "v1|ITEM|2084|30|25|Two-Hand|Weapon|Two-Handed Swords|7137|Binds when equipped|"
    .. "Binds when equipped~Two-Hand  Sword~24 - 36 Damage  Speed 3.20~+8 Strength",
    "export: ITEM line with the game's own details, colour codes stripped (" .. tostring(itemLine) .. ")")
check(lootLine ~= nil and string.find(lootLine, "|2084|3|1|Darksteel Bastard Sword$") ~= nil
    and not string.find(lootLine, "Fizzle", 1, true), "export: LOOT line has the item, never the looter (" .. tostring(lootLine) .. ")")
game.instanceType = "none"
fire("ZONE_CHANGED_NEW_AREA")
slash("log off")

-- minimap button
check(WowCompanyMinimapButton ~= nil and WowCompanyMinimapButton:IsShown(), "minimap button is there")
local mm = WowCompanyMinimapButton
local wasOpen = WowCompanyMeter:IsShown()
mm.scripts.OnClick(mm, "LeftButton")
check(WowCompanyMeter:IsShown() ~= wasOpen, "minimap: click toggles the meter window")
mm.scripts.OnClick(mm, "LeftButton")
local opened = false
local realOpen = ns.Options.Open
ns.Options.Open = function() opened = true end
mm.scripts.OnClick(mm, "RightButton")
ns.Options.Open = realOpen
check(opened, "minimap: right-click opens the settings")
-- the logging light in the meter title switches the logs
local light
for i = 1, #frames do
    local f = frames[i]
    if f.scripts.OnClick and f.scripts.OnEnter and rawget(f, "kind") == "Button" and f ~= mm then
        local okTip = pcall(f.scripts.OnEnter, f)
        if okTip and GameTooltip.text == "Logging" then light = f end
    end
end
check(light ~= nil, "meter: there is a logging light")
light.scripts.OnClick(light)
check(game.combatLog == true and game.chatLog == true, "logging light: click starts logging")
light.scripts.OnClick(light)
check(game.combatLog == false, "logging light: click again stops it")
cursor = { 500, 700 } -- straight above the minimap
mm.scripts.OnDragStart(mm)
mm.scripts.OnUpdate(mm)
mm.scripts.OnDragStop(mm)
check(math.abs(WowCompanyDB.settings.minimapAngle - 90) < 0.01 and math.abs(mm.point[4]) < 0.01 and mm.point[5] > 70,
    "minimap: dragging moves it around the edge and remembers the angle")
check(pcall(mm.scripts.OnEnter, mm) and pcall(mm.scripts.OnLeave, mm), "minimap: tooltip")
slash("minimap")
check(WowCompanyDB.settings.minimapHidden == true and not mm:IsShown(), "/wowco minimap hides it")
slash("minimap")
check(mm:IsShown(), "/wowco minimap shows it again")

-- records written by the Companion (CompanionData.lua)
check(ns.Export.Records() == nil, "no Companion data yet")
ns.Window.ShowRecords()
local emptyShown
for i = 1, #frames do
    local t = rawget(frames[i], "text")
    if type(t) == "string" and string.find(t, "No records yet", 1, true) then emptyShown = frames[i].shown end
end
check(emptyShown == true, "records: empty state explains what to do")
WowCompanyCompanionData = { schema = 1, characters = {
    ["someone-else"] = { name = "Someone Else", records = { { kind = "crit", amount = 99999, spell = "Nope" } } },
    ["grobos-stinkfoot"] = { name = "Grobos Stinkfoot", records = {
        { kind = "crit", amount = 1204, spell = "Fireball", unit = "Mottled Boar", zone = "Durotar", inDungeon = false },
        { kind = "hitTaken", amount = 1890, spell = "Lava", zone = "Ragefire Chasm", inDungeon = true },
    } },
} }
check(ns.Export.Records().name == "Grobos Stinkfoot", "records: picks this character, not another one on file")
ns.Window.Refresh()
local function hasText(pattern)
    for i = 1, #frames do
        local t = rawget(frames[i], "text")
        if type(t) == "string" and string.find(t, pattern, 1, true) then return true end
    end
    return false
end
check(hasText("1.20K") and hasText("Biggest crit: Fireball into Mottled Boar"), "records: crit with spell and target")
check(hasText("1.89K") and hasText("Lava") and not hasText("100.0K") and not hasText("Nope"),
    "records: hit taken shown, the other character's numbers are not")
ns.Window.SetDisplay("damage")
WowCompanyCompanionData = nil

-- buttons explain themselves on hover and never break
local hovered = 0
for i = 1, #frames do
    local enter, leave = frames[i].scripts.OnEnter, frames[i].scripts.OnLeave
    if enter and leave then
        local okE, okL = pcall(enter, frames[i]), pcall(leave, frames[i])
        if okE and okL then hovered = hovered + 1 else
            hovered = -1000
            local _, e = pcall(enter, frames[i])
            io.stderr:write("hover failed: " .. tostring(e) .. "\n")
        end
    end
end
check(hovered > 10, "hovering every button and tab works (" .. hovered .. " widgets)")

-- the Now page: your own numbers of the current fight
local function widgetWith(pattern)
    for i = 1, #frames do
        local t = rawget(frames[i], "text")
        if type(t) == "string" and string.find(t, pattern) then return frames[i] end
    end
end
ns.Window.SetDisplay("damage")
check(widgetWith("Fizzle Boom") == nil and widgetWith("Grobos Stinkfoot") ~= nil,
    "meter window lists you, not the stranger")
check(textOf("65.20") ~= nil, "meter: your per-second value")
game.brokenCurrent = true
ns.Window.Refresh()
check(widgetWith("71170") == nil and textOf("[0:46] Damage") ~= nil,
    "meter: a broken 'current' duration is not shown – the game's duration call is (0:46)")
game.brokenCurrent = nil
-- past fights may come without a duration in the session table: the game's duration call fills it in
local fromId = C_DamageMeter.GetCombatSessionFromID
C_DamageMeter.GetCombatSessionFromID = function(id, kind) local x = fromId(id, kind) x.durationSeconds = nil return x end
local listed = C_DamageMeter.GetAvailableCombatSessions
C_DamageMeter.GetAvailableCombatSessions = function()
    local l = listed()
    for _, x in ipairs(l) do x.durationSeconds = nil end
    return l
end
ns.Window.Refresh()
check(textOf("[0:46] Damage") ~= nil, "meter: duration from GetSessionDurationSeconds when the session table has none")
C_DamageMeter.GetCombatSessionFromID, C_DamageMeter.GetAvailableCombatSessions = fromId, listed
-- diagnostics: opt-in, written at logout, gone when switched off
check(WowCompanyDB.settings.diagnostics == false, "diagnostics: off by default")
SlashCmdList.WOWCOMPANY("diag on")
fire("PLAYER_REGEN_DISABLED")
fire("PLAYER_REGEN_ENABLED")
fire("PLAYER_LOGOUT")
check(WowCompanyDB.settings.diagnostics == true and type(WowCompanyDB.probe) == "table", "diagnostics: report saved at logout when on")
check(type(WowCompanyDB.diag) == "string" and WowCompanyDB.diag:find("^v1|DIAG|%d+|0%.%d+%.%d+|{") ~= nil,
    "diagnostics: one DIAG line with JSON for the Companion")
check(ns.toJson({ a = 'say "hi"\n', b = { 1, 2 }, c = 0 / 0 }) == '{"a":"say \\"hi\\"\\u000a","b":[1,2],"c":null}',
    "diagnostics: JSON escapes quotes and control characters")
SlashCmdList.WOWCOMPANY("diag off")
check(WowCompanyDB.probe == nil and WowCompanyDB.diag == nil, "diagnostics: switching off deletes the report")
fire("PLAYER_REGEN_DISABLED")
game.secrets = true
local okNow, errNow = pcall(ns.Window.Refresh)
check(okNow, "meter: survives secret values mid-fight" .. (okNow and "" or (": " .. tostring(errNow))))
check(textOf(SECRET) == nil, "meter: open world, identity hidden mid-fight -> no numbers of unknown owners")
game.grouped, game.instanceType = true, "party"
ns.Window.Refresh()
check(textOf(SECRET) ~= nil, "meter: dungeon with the party -> secret values are passed to the UI untouched")
game.grouped, game.instanceType = false, "none"
game.secrets = false
fire("PLAYER_REGEN_ENABLED")

game.secrets = true
local ok, err = pcall(ns.Window.Refresh)
check(ok, "draws the meter with secret values" .. (ok and "" or (": " .. tostring(err))))
for _, kind in ipairs(ns.Meter.KINDS) do
    WowCompanyDB.settings.winKind = kind.key
    check(pcall(ns.Window.Refresh), "meter kind " .. kind.key)
end
check(pcall(WowCompanyMeter.scripts.OnUpdate, WowCompanyMeter, 1), "live refresh tick")
game.secrets = false

-- probe: samples and report
fire("PLAYER_REGEN_DISABLED")
runTimers()
fire("PLAYER_REGEN_ENABLED")
runTimers()
fire("CHAT_MSG_LOOT", "You receive loot: |cff1eff00|Hitem:2589::::::::18:::::::|h[Linen Cloth]|h|rx3.")
fire("CHAT_MSG_LOOT", SECRET)
fire("DAMAGE_METER_COMBAT_SESSION_UPDATED", 1, 2)
slash("probe")
local p = WowCompanyDB.probe
check(type(p) == "table" and p.sample.combat[1].during and p.sample.combat[1].after, "probe samples a fight")
check(p.sample.loot[1].itemId == 2589 and p.sample.loot[1].color == "ff1eff00" and p.sample.loot[1].count == 3
    and p.sample.loot[1].mine, "probe reads the loot link")
local sawSecret = false
for _, l in ipairs(p.sample.loot) do
    if l.secret == true then sawSecret = true end
end
check(sawSecret, "probe survives a secret loot line")
check(p.group.members.player.leader == true and p.group.members.player.hasSurname, "probe sees the leader")

-- unknown command prints help, a broken handler does not kill the addon
slash("wat")
check(said("/wowco log on"), "unknown command lists the commands")
ns.on("PLAYER_DEAD", function() error("boom") end)
check(pcall(fire, "PLAYER_DEAD") and #WowCompanyDB.errors == 1, "a failing handler is recorded, not raised")

-- ------------------------------------------------------------------ 0.5: more kinds, breakdown, summary, Details!
local st = WowCompanyDB.settings
for _, k in ipairs(ns.Meter.MORE) do
    st.winKind = k.key
    check(pcall(ns.Window.Refresh), "meter kind " .. k.key)
end
ns.Window.SetDisplay("enemies")
check(widgetWith("Deviate Creeper") ~= nil and widgetWith("Fizzle Boom") == nil, "beat up: lists mobs, never a player")
-- click a player for the spells, click again to close
ns.Window.SetDisplay("damage")
local mine
for i = 1, #frames do
    if rawget(frames[i], "guid") == "Player-1-0000000A" and frames[i].kind == "StatusBar" then mine = frames[i] end
end
check(mine ~= nil, "breakdown: your bar is clickable")
mine.scripts.OnMouseUp(mine, "LeftButton")
check(widgetWith("Fireball") ~= nil and widgetWith("Frostbolt") ~= nil and textOf("60.0%") ~= nil,
    "breakdown: your spells by name with their share")
mine.scripts.OnMouseUp(mine, "LeftButton")
check(not WowCompanyBreakdown:IsShown(), "breakdown: click again closes it")
game.secrets = true
check(pcall(ns.Window.Refresh), "breakdown: survives secrets")
game.secrets = false
-- Details! defer
game.details = true
slash("details on")
ns.Window.Refresh()
check(widgetWith("Details! is doing the counting") ~= nil, "details on: our meter steps aside")
slash("details off")
ns.Window.Refresh()
check(widgetWith("Grobos Stinkfoot") ~= nil, "details off: our meter is back")
game.details = false
-- run summary after leaving the dungeon
local now = GetServerTime()
WowCompanyDB.loot = { { at = now - 600, count = 2, itemId = 2589, quality = 1, name = "Linen Cloth" },
    { at = now - 7200, count = 1, itemId = 1, quality = 0, name = "From an older run" } }
WowCompanyDB.state.run = { zone = "Wailing Caverns", startedAt = now - 3552, leftAt = now, afterFight = 0 }
for k in pairs(popups) do popups[k] = nil end -- earlier test dungeons asked too
fire("ZONE_CHANGED_NEW_AREA")
runTimers()
check(said("Wailing Caverns done in 59:12") and said("1 boss, 3 fights"), "summary: time, bosses and fights in chat")
check(said("MVP: Grobos Stinkfoot") and not said("Fizzle Boom %("), "summary: MVP, only you and your party")
local before = #printed
fire("ZONE_CHANGED_NEW_AREA")
runTimers()
check(#printed == before, "summary: said once per run")
check(#popups == 1 and popups[1].name == "WOWCOMPANY_SEND" and popups[1].arg == "2",
    "send question: asked once, counts only this run's loot")
local dlg = StaticPopupDialogs.WOWCOMPANY_SEND
check(dlg and dlg.button1 == "Send now" and dlg.button2 == "Later", "send question: Send now / Later")
dlg.OnAccept()
check(reloads == 1, "send now: reloads (the game saves the notes for the Companion)")

slash("report")
check(said("not in a party") and #sent == 0, "report: nobody to tell outside a party")
game.grouped = true
slash("report")
check(#sent >= 2 and sent[1].channel == "PARTY" and string.find(sent[1].msg, "Wailing Caverns", 1, true),
    "report: the summary goes to /party only")
game.grouped = false
-- a run left long ago (old addon, then logout / game restart) is not announced at login
for k in pairs(popups) do popups[k] = nil end
local beforeLogin = #printed
WowCompanyDB.state.run = { zone = "Wailing Caverns", startedAt = now - 7200, leftAt = now - 3600, afterFight = 0 }
fire("PLAYER_ENTERING_WORLD")
runTimers()
check(#popups == 0 and #printed == beforeLogin and WowCompanyDB.state.run.summarized == true,
    "login: an old run gets no summary and no send question")
-- "don't ask again"
dlg.OnAlt()
check(WowCompanyDB.settings.askSend == false, "don't ask again: switches it off")
WowCompanyDB.state.run = { zone = "Deadmines", startedAt = now - 100, leftAt = now, afterFight = 0 }
fire("ZONE_CHANGED_NEW_AREA")
runTimers()
check(#popups == 0, "don't ask again: no popup after the next dungeon")
slash("ask on")
check(WowCompanyDB.settings.askSend == true, "/wowco ask on brings it back")

-- ------------------------------------------------------------------ the WowCompany chat tab
local function tabs()
    local n, frame = 0, nil
    for i = 1, NUM_CHAT_WINDOWS do
        if chatWindows[i] == "WowCompany" then n, frame = n + 1, _G["ChatFrame" .. i] end
    end
    return n, frame
end
slash("log on")
local nTabs, tabFrame = tabs()
check(nTabs == 1 and tabFrame.groups.LOOT and tabFrame.groups.SYSTEM and tabFrame.groups.PARTY_LEADER
    and not tabFrame.groups.SAY, "chat tab: shows loot, system, party leader – not say/emote")
check(tabFrame.groups.COMBAT_XP_GAIN and tabFrame.groups.MONEY and tabFrame.groups.COMBAT_FACTION_CHANGE
    and tabFrame.groups.SKILL and not tabFrame.groups.TRADESKILLS and not tabFrame.groups.CHANNEL,
    "chat tab: your XP, money, reputation, skill-ups – no tradeskill spam, no channels")
check(chatSelected == DEFAULT_CHAT_FRAME, "chat tab: the player's main tab stays in front")
slash("log off")
slash("log on")
check(tabs() == 1, "chat tab: made once, not again on every log on")
slash("chat off")
check(tabs() == 0 and WowCompanyDB.settings.chatTab == false, "/wowco chat off removes it")
slash("log on")
check(tabs() == 0, "chat tab: stays away after chat off")
slash("chat on")
check(tabs() == 1, "/wowco chat on brings it back")
slash("log off")

realPrint(failures == 0 and "all addon checks passed" or (failures .. " addon check(s) FAILED"))
os.exit(failures == 0 and 0 or 1)
