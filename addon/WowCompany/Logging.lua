-- Combat and chat logging: switched on automatically inside dungeons, so nobody has to remember
-- /combatlog and /chatlog. The Companion app reads those two files.
--
-- "Everywhere" (off by default) keeps them on in the open world as well, so the Companion can
-- catch your biggest crit anywhere. The log grows about 5–10 MB per hour of fighting; the
-- Companion deletes the files when it quits.
--
-- Rules:
--   * only logs that THIS addon switched on are ever switched off again;
--   * switching off waits 20 minutes after leaving the dungeon (corpse runs come back in, and
--     toggling the log off and on could start a new log file in the middle of a run);
--   * a fresh login starts with both logs off (the game forgets them), so our markers are cleared.

local _, ns = ...

local Logging = {}
ns.Logging = Logging

local OFF_DELAY = 20 * 60
local offTimer

local function get(fn)
    if type(fn) ~= "function" then return nil end
    local ok, on = pcall(fn)
    if not ok then return nil end
    return ns.plain(on) and true or false
end

local function set(fn, on)
    if type(fn) ~= "function" then return false end
    local ok = pcall(fn, on)
    return ok
end

function Logging.CombatOn() return get(LoggingCombat) end
function Logging.ChatOn() return get(LoggingChat) end

-- "1" when advanced combat logging is on (HP and item level in the log), nil if unknown.
function Logging.Advanced()
    if type(C_CVar) ~= "table" or type(C_CVar.GetCVar) ~= "function" then return nil end
    local ok, v = pcall(C_CVar.GetCVar, "advancedCombatLogging")
    v = ok and ns.plain(v) or nil
    if v == nil then return nil end
    return v == "1"
end

function Logging.InDungeon()
    if type(GetInstanceInfo) ~= "function" then return false end
    local ok, _, instanceType = pcall(GetInstanceInfo)
    instanceType = ok and ns.plain(instanceType) or nil
    return instanceType == "party" or instanceType == "raid"
end

-- ------------------------------------------------------------------ the "WowCompany" chat tab
-- /chatlog writes only what some chat window shows. With "Item Loot" or "System Messages" switched
-- off in every window (Chat settings → Other), the Companion gets no loot, no rolls and no leader
-- (happened 15. 11. 2026). So the addon keeps a chat tab of its own that shows exactly what the
-- Companion reads; the player's own chat stays as it is.
local TAB = "WowCompany"
-- loot + rolls, leader (system + party), and what YOU gained in the run: XP, money, reputation,
-- skill-ups (the Companion adds them to the run). Never trade/general channels, whispers or guild.
local GROUPS = { "LOOT", "SYSTEM", "PARTY", "PARTY_LEADER", "RAID", "RAID_LEADER", "RAID_WARNING",
    "INSTANCE_CHAT", "INSTANCE_CHAT_LEADER", "COMBAT_XP_GAIN", "MONEY", "COMBAT_FACTION_CHANGE", "SKILL" }

local function chatTab()
    if type(GetChatWindowInfo) ~= "function" then return nil, nil end
    for i = 1, (tonumber(NUM_CHAT_WINDOWS) or 10) do
        local ok, name = pcall(GetChatWindowInfo, i)
        if ok and name == TAB then return _G["ChatFrame" .. i], i end
    end
    return nil, nil
end

local function addGroup(frame, group)
    if type(frame.AddMessageGroup) == "function" then return pcall(frame.AddMessageGroup, frame, group) end
    if type(ChatFrame_AddMessageGroup) == "function" then return pcall(ChatFrame_AddMessageGroup, frame, group) end
    return false
end

-- Makes sure the tab exists and shows what the logs need. Returns "created", "ok", "off",
-- "combat" (try again later) or "unsupported" (the client has no such chat API).
function Logging.EnsureChatTab()
    if not ns.db or ns.db.settings.chatTab == false then return "off" end
    if type(InCombatLockdown) == "function" and InCombatLockdown() then return "combat" end
    local frame = chatTab()
    local created = false
    if not frame then
        if type(FCF_OpenNewWindow) ~= "function" then return "unsupported" end
        local ok, f = pcall(FCF_OpenNewWindow, TAB)
        frame = (ok and type(f) == "table") and f or chatTab()
        if not frame then return "unsupported" end
        created = true
        -- a new window starts with say/emote/…: ours shows only what the Companion reads
        if type(ChatFrame_RemoveAllMessageGroups) == "function" then
            pcall(ChatFrame_RemoveAllMessageGroups, frame)
        elseif type(frame.RemoveAllMessageGroups) == "function" then
            pcall(frame.RemoveAllMessageGroups, frame)
        end
    end
    for i = 1, #GROUPS do addGroup(frame, GROUPS[i]) end
    if created then
        -- opening a window selects it: keep the player's main tab in front
        if type(FCF_SelectDockFrame) == "function" and DEFAULT_CHAT_FRAME then
            pcall(FCF_SelectDockFrame, DEFAULT_CHAT_FRAME)
        end
        ns.say("added a chat tab \"" .. TAB .. "\" so loot, rolls and the party leader reach the chat log "
            .. "for the portal. Your own chat stays as it is. /wowco chat off removes it.")
    end
    return created and "created" or "ok"
end

function Logging.RemoveChatTab()
    local frame = chatTab()
    if frame and type(FCF_Close) == "function" then pcall(FCF_Close, frame) end
end

ns.command("chat", "chat on|off – the WowCompany chat tab that makes loot and rolls reach the chat log",
    function(rest)
        if rest == "off" then
            ns.db.settings.chatTab = false
            Logging.RemoveChatTab()
            ns.say("chat tab removed. Loot reaches the chat log only if a chat window shows Item Loot.")
            return
        end
        ns.db.settings.chatTab = true
        local r = Logging.EnsureChatTab()
        if r == "unsupported" then
            ns.say("this client cannot add chat tabs. Turn on Item Loot and System Messages in a chat window "
                .. "(Chat settings → Other) so loot reaches the log.")
        elseif r == "combat" then
            ns.say("after the fight, please.")
        else
            ns.say("chat tab \"" .. TAB .. "\" is ready.")
        end
    end)

-- Switch both logs. `byUser` = typed by the player (then we never switch them off on our own).
function Logging.Set(on, byUser)
    local state = ns.db.state
    if on then
        Logging.EnsureChatTab()
        if Logging.CombatOn() == false and set(LoggingCombat, true) then state.weStartedCombat = not byUser end
        if Logging.ChatOn() == false and set(LoggingChat, true) then state.weStartedChat = not byUser end
    else
        if byUser or state.weStartedCombat then set(LoggingCombat, false) end
        if byUser or state.weStartedChat then set(LoggingChat, false) end
        state.weStartedCombat, state.weStartedChat = nil, nil
    end
    if ns.Window and ns.Window.Refresh then ns.Window.Refresh() end
end

local function describe()
    local function word(v) return v == nil and "unknown" or (v and "|cff40ff40ON|r" or "|cffff5050off|r") end
    return "combat log " .. word(Logging.CombatOn()) .. ", chat log " .. word(Logging.ChatOn())
end
Logging.Describe = describe

local function cancelOff()
    if offTimer then
        offTimer:Cancel()
        offTimer = nil
    end
end

-- Should the logs be running here?
function Logging.Wanted()
    local s = ns.db.settings
    if not s.autoLog then return false end
    return s.logEverywhere or Logging.InDungeon()
end

-- Called when the zone changes (and when a setting changes).
function Logging.Check()
    if not ns.db or not ns.db.settings.autoLog then return end
    local state = ns.db.state
    if Logging.Wanted() then
        cancelOff()
        local before = (Logging.CombatOn() and 1 or 0) + (Logging.ChatOn() and 1 or 0)
        Logging.Set(true, false)
        local after = (Logging.CombatOn() and 1 or 0) + (Logging.ChatOn() and 1 or 0)
        if after > before then
            if Logging.InDungeon() then
                ns.say("dungeon detected, logging switched on (" .. describe() .. "). Try not to die on camera.")
            else
                ns.say("logging everywhere is on (" .. describe() .. "). Every crit counts now.")
            end
            if Logging.Advanced() == false then
                ns.say("advanced combat logging is off – type |cffffffff/wowco advanced|r once "
                    .. "for better death recaps.")
            end
        end
    elseif (state.weStartedCombat or state.weStartedChat) and not offTimer then
        if type(C_Timer) == "table" and type(C_Timer.NewTimer) == "function" then
            offTimer = C_Timer.NewTimer(OFF_DELAY, function()
                offTimer = nil
                if not Logging.Wanted() then
                    Logging.Set(false, false)
                    ns.say("out of the dungeon for 20 minutes, logging switched off again.")
                end
            end)
        end
    end
end

ns.on("PLAYER_ENTERING_WORLD", function(isInitialLogin)
    if ns.db and ns.plain(isInitialLogin) == true then
        -- the game forgets logging on login, so nothing of ours is running any more
        ns.db.state.weStartedCombat, ns.db.state.weStartedChat = nil, nil
    end
    Logging.Check()
end)
ns.on("ZONE_CHANGED_NEW_AREA", function() Logging.Check() end)

-- Open-world logging on/off. Switching it off outside a dungeon stops our logs right away
-- (no corpse run to wait for out here).
function Logging.SetEverywhere(on)
    ns.db.settings.logEverywhere = on and true or false
    if on then
        ns.db.settings.autoLog = true
        Logging.Check()
    elseif not Logging.InDungeon() then
        cancelOff()
        Logging.Set(false, false)
    end
    if ns.Window and ns.Window.Refresh then ns.Window.Refresh() end
end

ns.command("log", "log on | off | auto | everywhere – combat and chat logging", function(rest)
    if rest == "on" then
        Logging.Set(true, true)
    elseif rest == "off" then
        cancelOff()
        Logging.Set(false, true)
    elseif rest == "auto" then
        ns.db.settings.autoLog = not ns.db.settings.autoLog
        ns.say("automatic logging in dungeons: " .. (ns.db.settings.autoLog and "ON" or "off"))
        Logging.Check()
    elseif rest == "everywhere" then
        Logging.SetEverywhere(not ns.db.settings.logEverywhere)
        ns.say("logging in the open world: " .. (ns.db.settings.logEverywhere and "ON" or "off"))
    end
    ns.say(describe())
end)

ns.command("advanced", "advanced – switch advanced combat logging on (HP, item level in the log)", function()
    if type(C_CVar) ~= "table" or type(C_CVar.SetCVar) ~= "function" then
        ns.say("this client has no C_CVar.SetCVar. Type: /console advancedCombatLogging 1")
        return
    end
    local ok = pcall(C_CVar.SetCVar, "advancedCombatLogging", "1")
    if ok and Logging.Advanced() then
        ns.say("advanced combat logging is ON. If a log is already running, toggle it: /wowco log off, /wowco log on.")
    else
        ns.say("could not set it from here. Type: /console advancedCombatLogging 1")
    end
end)
