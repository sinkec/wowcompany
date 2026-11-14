-- WowCompany self-test (phase A0, see ADDON.md §4.1).
-- /wowco selftest  -> checks which game APIs this client gives to addons, prints a summary and
-- stores the full report in WowCompanyDB.selftest (written to disk on /reload or logout).
-- Nothing here plays the game for you: it only reads state and listens to events.

WowCompanyDB = WowCompanyDB or {}

local PREFIX = "|cffd8a83cWowCompany:|r "
local function say(text) print(PREFIX .. tostring(text)) end

local function isSecret(v)
    return type(issecretvalue) == "function" and issecretvalue(v) or false
end

-- A value that is safe to store and print.
local function plain(v)
    if isSecret(v) then return "<secret>" end
    local t = type(v)
    if t == "nil" or t == "number" or t == "string" or t == "boolean" then return v end
    return "<" .. t .. ">"
end

-- "C_Timer.After" -> type of _G.C_Timer.After
local function typeOf(path)
    local node = _G
    for part in string.gmatch(path, "[^%.]+") do
        if type(node) ~= "table" then return "nil" end
        node = node[part]
    end
    return type(node)
end

local APIS = {
    "CombatLogGetCurrentEventInfo", "LoggingCombat", "LoggingChat", "GetInstanceInfo", "IsInInstance",
    "UnitIsGroupLeader", "GetNumGroupMembers", "IsInGroup", "IsInRaid", "UnitGUID", "UnitFullName",
    "UnitName", "UnitClass", "UnitLevel", "GetServerTime", "GetTime", "C_Timer.After", "C_Timer.NewTicker",
    "GetItemInfo", "C_Item.GetItemInfo", "GetLootRollItemInfo", "C_LootHistory", "C_DamageMeter",
    "C_Secrets.HasSecretRestrictions", "issecretvalue", "GetCritChance", "GetSpellCritChance",
    "UnitAttackPower", "GetSpellBonusDamage", "UnitArmor", "UnitHealthMax", "UnitStat",
    "GetAverageItemLevel", "GetMoney", "UnitXP", "C_AddOns.GetAddOnMetadata", "CreateFrame",
    "BackdropTemplateMixin", "Minimap", "GetBuildInfo", "GetRealZoneText", "C_ChatInfo.SendAddonMessage",
    "CombatLogAddFilter", "C_PartyInfo", "UnitGroupRolesAssigned", "GetRaidRosterInfo",
}

local EVENTS = {
    "COMBAT_LOG_EVENT_UNFILTERED", "COMBAT_LOG_EVENT", "CHAT_MSG_LOOT", "CHAT_MSG_SYSTEM",
    "CHAT_MSG_COMBAT_HOSTILE_DEATH", "CHAT_MSG_COMBAT_XP_GAIN", "START_LOOT_ROLL", "LOOT_OPENED",
    "GROUP_ROSTER_UPDATE", "PARTY_LEADER_CHANGED", "ENCOUNTER_START", "ENCOUNTER_END", "BOSS_KILL",
    "PARTY_KILL", "UNIT_DIED", "PLAYER_DEAD", "PLAYER_ENTERING_WORLD", "ZONE_CHANGED_NEW_AREA",
    "PLAYER_REGEN_DISABLED", "PLAYER_REGEN_ENABLED", "UNIT_COMBAT", "DAMAGE_METER_COMBAT_SESSION_UPDATED",
}

local listener = CreateFrame("Frame")
local sample = { cleu = 0, cleuSecret = 0, unitCombat = 0, loot = 0 }

local function call(fn, ...)
    if type(fn) ~= "function" then return { ok = false, err = "missing" } end
    -- select("#") counts trailing/embedded nils, the # operator does not
    local function pack(...) return { n = select("#", ...), ... } end
    local r = pack(pcall(fn, ...))
    local out = { ok = r[1] }
    if not r[1] then
        out.err = tostring(r[2])
        return out
    end
    out.values = {}
    for i = 2, math.min(r.n, 10) do out.values[i - 1] = plain(r[i]) end
    return out
end

local function runSelftest()
    local report = { at = time(), apis = {}, events = {}, calls = {} }

    for _, name in ipairs(APIS) do report.apis[name] = typeOf(name) end

    for _, ev in ipairs(EVENTS) do
        local ok, err = pcall(listener.RegisterEvent, listener, ev)
        report.events[ev] = ok and "ok" or ("error: " .. tostring(err))
    end

    report.calls.build = call(GetBuildInfo)
    report.calls.secretRestrictions = call(C_Secrets and C_Secrets.HasSecretRestrictions)
    report.calls.loggingCombat = call(LoggingCombat) -- no argument = "is it on?"
    report.calls.loggingChat = call(LoggingChat)
    report.calls.instance = call(GetInstanceInfo)
    report.calls.fullName = call(UnitFullName, "player")
    report.calls.name = call(UnitName, "player")
    report.calls.guid = call(UnitGUID, "player")
    report.calls.leader = call(UnitIsGroupLeader, "player")
    report.calls.groupSize = call(GetNumGroupMembers)
    report.calls.serverTime = call(GetServerTime)
    report.calls.crit = call(GetCritChance)
    report.calls.attackPower = call(UnitAttackPower, "player")
    report.calls.armor = call(UnitArmor, "player")
    report.calls.itemLevel = call(GetAverageItemLevel)

    report.sample = sample
    WowCompanyDB.selftest = report

    local missing, blocked = {}, {}
    for _, name in ipairs(APIS) do
        if report.apis[name] == "nil" then missing[#missing + 1] = name end
    end
    for _, ev in ipairs(EVENTS) do
        if report.events[ev] ~= "ok" then blocked[#blocked + 1] = ev end
    end
    say("self-test done. " .. (#APIS - #missing) .. "/" .. #APIS .. " APIs, "
        .. (#EVENTS - #blocked) .. "/" .. #EVENTS .. " events.")
    if #missing > 0 then say("missing APIs: " .. table.concat(missing, ", ")) end
    if #blocked > 0 then say("refused events: " .. table.concat(blocked, ", ")) end
    say("Now hit a mob or two (so I can see whether combat numbers are hidden), loot something,")
    say("then type |cffffffff/reload|r. The report is saved for the Companion app.")
end

listener:SetScript("OnEvent", function(_, event, ...)
    if event == "COMBAT_LOG_EVENT_UNFILTERED" or event == "COMBAT_LOG_EVENT" then
        sample.cleu = sample.cleu + 1
        if type(CombatLogGetCurrentEventInfo) == "function" then
            local ok, _, sub, _, _, _, _, _, _, _, _, _, a12, a13, a14, a15 = pcall(CombatLogGetCurrentEventInfo)
            if ok then
                if isSecret(sub) or isSecret(a12) or isSecret(a15) then
                    sample.cleuSecret = sample.cleuSecret + 1
                end
                if not sample.firstCleu then
                    sample.firstCleu = { plain(sub), plain(a12), plain(a13), plain(a14), plain(a15) }
                end
            end
        end
    elseif event == "UNIT_COMBAT" then
        sample.unitCombat = sample.unitCombat + 1
        if not sample.firstUnitCombat then
            local unit, action, descriptor, amount, school = ...
            sample.firstUnitCombat = { plain(unit), plain(action), plain(descriptor), plain(amount), plain(school) }
        end
    elseif event == "CHAT_MSG_LOOT" then
        sample.loot = sample.loot + 1
        if not sample.firstLoot then
            -- only the shape matters: does the line carry an item link (id + quality colour)?
            local s = plain((...))
            if type(s) == "string" and s ~= "<secret>" then
                sample.firstLoot = {
                    hasLink = string.find(s, "|Hitem:", 1, true) ~= nil,
                    hasColor = string.find(s, "|c", 1, true) ~= nil,
                    length = string.len(s),
                }
            else
                sample.firstLoot = { secret = true }
            end
        end
    end
end)

SLASH_WOWCOMPANY1 = "/wowco"
SLASH_WOWCOMPANY2 = "/wowcompany"
SlashCmdList["WOWCOMPANY"] = function(msg)
    msg = string.lower(msg or "")
    if msg == "selftest" or msg == "test" then
        local ok, err = pcall(runSelftest)
        if not ok then
            WowCompanyDB.selftest = { at = time(), crashed = tostring(err) }
            say("self-test crashed: " .. tostring(err))
        end
    else
        say("commands: /wowco selftest")
    end
end
