-- WowCompany addon core: saved settings, events, helpers, slash commands.
--
-- Facts about WoW Forever this addon is built on (verified in game, ADDON.md §4.1):
--   * COMBAT_LOG_EVENT* is forbidden for addons -> NEVER register it (the game shows a "blocked" popup).
--   * Numbers come from Blizzard's own meter, C_DamageMeter (see Meter.lua).
--   * Values can be "secret": never compare or calculate with them, only pass them on to the UI.
--   * The addon may switch /combatlog and /chatlog on (LoggingCombat, LoggingChat).
-- The addon only reads state and shows it. It never plays the game for you.

local ADDON, ns = ...

ns.name = ADDON
ns.PREFIX = "|cffd8a83cWowCompany:|r "

function ns.say(text) print(ns.PREFIX .. tostring(text)) end

function ns.isSecret(v) return type(issecretvalue) == "function" and issecretvalue(v) or false end

-- A value that is safe to store, compare and print (secrets and tables are replaced).
function ns.plain(v)
    if ns.isSecret(v) then return nil end
    local t = type(v)
    if t == "number" or t == "string" or t == "boolean" then return v end
    return nil
end

-- Per-second values (DPS, HPS, …): always two decimals, so they never run off their row.
-- A secret number cannot be inspected, but the game lets it be formatted into a (secret) string;
-- if even that is refused, nil is returned and the caller shows nothing instead of a raw float.
function ns.fmtRate(v)
    if v == nil then return nil end
    if not ns.isSecret(v) then
        if type(v) ~= "number" then return nil end
        return string.format("%.2f", v)
    end
    local ok, s = pcall(string.format, "%.2f", v)
    if ok and s ~= nil then return s end
    return nil
end

-- 12345.6 -> "12,346". A secret number is rounded by formatting when the game allows it,
-- otherwise returned untouched (FontString:SetText accepts it).
function ns.fmt(n)
    if ns.isSecret(n) then
        local ok, s = pcall(string.format, "%.0f", n)
        if ok and s ~= nil then return s end
        return n
    end
    if type(n) ~= "number" then return "–" end
    n = math.floor(n + 0.5)
    if type(BreakUpLargeNumbers) == "function" then
        local ok, s = pcall(BreakUpLargeNumbers, n)
        if ok and type(s) == "string" then return s end
    end
    local s = tostring(n)
    local out = string.gsub(string.reverse(s), "(%d%d%d)", "%1,")
    out = string.reverse(out)
    return (string.gsub(out, "^,", ""))
end

-- 75 -> "1:15"
function ns.fmtTime(sec)
    sec = ns.plain(sec)
    if type(sec) ~= "number" then return "–" end
    sec = math.floor(sec + 0.5)
    return string.format("%d:%02d", math.floor(sec / 60), sec % 60)
end

function ns.now() return (type(GetServerTime) == "function" and GetServerTime()) or time() end

-- ------------------------------------------------------------------ saved variables

local DEFAULTS = {
    autoLog = true, -- switch /combatlog and /chatlog on inside dungeons
    logEverywhere = false, -- … and in the open world too (personal records: biggest crit anywhere)
    meterKind = "damage",
    meterScope = "current",
    moreKind = "interrupts", -- what the meter's 4th button shows (Meter.MORE)
    deferToDetails = false, -- /wowco details on: Details! does the meter, ours steps aside
    askSend = true, -- after a dungeon: ask whether to send the loot now (= reload) – /wowco ask on|off
    chatTab = true, -- keep the "WowCompany" chat tab so loot/rolls reach the chat log – /wowco chat on|off
}

local function initDB()
    WowCompanyDB = type(WowCompanyDB) == "table" and WowCompanyDB or {}
    local db = WowCompanyDB
    db.settings = type(db.settings) == "table" and db.settings or {}
    for k, v in pairs(DEFAULTS) do
        if db.settings[k] == nil then db.settings[k] = v end
    end
    db.state = type(db.state) == "table" and db.state or {}
    db.selftest = nil -- report of the old self-test, no longer needed
    db.blocked = nil
    ns.db = db
end

-- ------------------------------------------------------------------ events

local frame = CreateFrame("Frame")
local handlers = {}
local FORBIDDEN = { COMBAT_LOG_EVENT = true, COMBAT_LOG_EVENT_UNFILTERED = true }

-- ns.on("EVENT", function(...) end). Unknown events are ignored (the client differs from retail).
function ns.on(event, fn)
    if FORBIDDEN[event] then return false end
    if not handlers[event] then
        local ok = pcall(frame.RegisterEvent, frame, event)
        if not ok then return false end
        handlers[event] = {}
    end
    table.insert(handlers[event], fn)
    return true
end

frame:SetScript("OnEvent", function(_, event, ...)
    local list = handlers[event]
    if not list then return end
    for i = 1, #list do
        local ok, err = pcall(list[i], ...)
        if not ok and ns.db then
            -- keep the last few errors for the Companion / for debugging, never spam the chat
            ns.db.errors = ns.db.errors or {}
            if #ns.db.errors < 20 then
                table.insert(ns.db.errors, { at = ns.now(), event = event, err = tostring(err) })
            end
        end
    end
end)

local ready = {}
-- Runs once the saved variables are loaded.
function ns.onReady(fn) table.insert(ready, fn) end

ns.on("ADDON_LOADED", function(addon)
    if addon ~= ADDON then return end
    initDB()
    ns.version = "?"
    if type(C_AddOns) == "table" and type(C_AddOns.GetAddOnMetadata) == "function" then
        local ok, v = pcall(C_AddOns.GetAddOnMetadata, ADDON, "Version")
        if ok and type(v) == "string" then ns.version = v end
    end
    for i = 1, #ready do
        local ok, err = pcall(ready[i])
        if not ok then ns.say("startup error: " .. tostring(err)) end
    end
end)

-- In a fight right now? (plain events, no combat log needed)
ns.inCombat = false
ns.on("PLAYER_REGEN_DISABLED", function() ns.inCombat = true end)
ns.on("PLAYER_REGEN_ENABLED", function() ns.inCombat = false end)

-- If the game ever blocks one of our calls, remember which one instead of guessing.
local function blocked(kind)
    return function(addon, func)
        if addon ~= ADDON or not ns.db then return end
        ns.db.errors = ns.db.errors or {}
        if #ns.db.errors < 20 then
            table.insert(ns.db.errors, { at = ns.now(), event = kind, err = tostring(ns.plain(func)) })
        end
    end
end
ns.on("ADDON_ACTION_FORBIDDEN", blocked("ADDON_ACTION_FORBIDDEN"))
ns.on("ADDON_ACTION_BLOCKED", blocked("ADDON_ACTION_BLOCKED"))

-- ------------------------------------------------------------------ slash commands

local commands = {}
-- ns.command("log", "log on|off|auto – combat & chat logging", function(rest) end)
function ns.command(name, help, fn) commands[name] = { help = help, fn = fn } end

SLASH_WOWCOMPANY1 = "/wowco"
SLASH_WOWCOMPANY2 = "/wowcompany"
SlashCmdList["WOWCOMPANY"] = function(msg)
    msg = string.lower(msg or "")
    local name, rest = string.match(msg, "^(%S+)%s*(.*)$")
    if not name then
        if ns.UI and ns.UI.Toggle then ns.UI.Toggle() end
        return
    end
    local cmd = commands[name]
    if not cmd then
        ns.say("commands (plain /wowco opens the window):")
        local names = {}
        for k in pairs(commands) do table.insert(names, k) end
        table.sort(names)
        for i = 1, #names do ns.say("  /wowco " .. commands[names[i]].help) end
        return
    end
    local ok, err = pcall(cmd.fn, rest or "")
    if not ok then ns.say("that broke: " .. tostring(err)) end
end
