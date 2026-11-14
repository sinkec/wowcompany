-- Export for the Companion app: what the combat log does not know. An addon has no network and
-- cannot write files; the game saves WowCompanyDB on /reload, logout and exit, and the Companion
-- reads WowCompanyDB.export from there. Lines in a fixed format, so the app needs no Lua parser:
--   v1|META|<addon version>|<epoch s>
--   v1|RUN|<instance id>|<start epoch s>|<end epoch s or 0>|<zone>|<leader or empty>
--   v1|CHAR|<name>|<level>|<class>|<crit %>|<attack power>|<armor>|<item level>|<epoch s>
-- Privacy: the only other player ever named here is the leader of YOUR party.

local _, ns = ...

local Export = {}
ns.Export = Export

local MAX_RUNS = 30

-- No separators or line breaks inside a field.
local function clean(v)
    v = ns.plain(v)
    if v == nil then return "" end
    return (string.gsub(tostring(v), "[|\r\n]", " "))
end

local function fullName(unit)
    if type(UnitFullName) ~= "function" then return nil end
    local ok, name, surname = pcall(UnitFullName, unit)
    name = ok and ns.plain(name) or nil
    surname = ok and ns.plain(surname) or nil
    if type(name) ~= "string" or name == "" then return nil end
    if type(surname) == "string" and surname ~= "" then return name .. " " .. surname end
    return name
end

-- The leader of the player's own group, or nil (alone, or the game will not say).
function Export.Leader()
    if type(IsInGroup) ~= "function" or type(UnitIsGroupLeader) ~= "function" then return nil end
    local okGroup, grouped = pcall(IsInGroup)
    if not okGroup or ns.plain(grouped) ~= true then return nil end
    for _, unit in ipairs({ "player", "party1", "party2", "party3", "party4" }) do
        if type(UnitExists) ~= "function" or UnitExists(unit) then
            local ok, leads = pcall(UnitIsGroupLeader, unit)
            if ok and ns.plain(leads) == true then return fullName(unit) end
        end
    end
    return nil
end

local function number(fn, ...)
    if type(fn) ~= "function" then return 0 end
    local ok, a, b = pcall(fn, ...)
    if not ok then return 0 end
    return ns.plain(a), ns.plain(b)
end

local function charLine()
    local name = fullName("player")
    if not name then return nil end
    local level = number(UnitLevel, "player")
    local _, class = number(UnitClass, "player")
    local crit = number(GetCritChance)
    local base, bonus = number(UnitAttackPower, "player")
    local _, armor = number(UnitArmor, "player")
    local _, ilvl = number(GetAverageItemLevel)
    local function n(v, fmt) return type(v) == "number" and string.format(fmt or "%d", v) or "0" end
    return table.concat({
        "v1", "CHAR", clean(name), n(level), clean(class), n(crit, "%.2f"),
        n((type(base) == "number" and base or 0) + (type(bonus) == "number" and bonus or 0)),
        n(armor), n(ilvl, "%.2f"), n(ns.now()),
    }, "|")
end

-- Rewrites WowCompanyDB.export from the remembered runs and the character's current stats.
function Export.Rebuild()
    if not ns.db then return end
    local lines = { table.concat({ "v1", "META", clean(ns.version), tostring(ns.now()) }, "|") }
    for _, r in ipairs(ns.db.runs or {}) do
        table.insert(lines, table.concat({
            "v1", "RUN", tostring(r.instanceId or 0), tostring(r.startedAt or 0), tostring(r.endedAt or 0),
            clean(r.zone), clean(r.leader),
        }, "|"))
    end
    local char = charLine()
    if char then table.insert(lines, char) end
    ns.db.export = lines
end

-- Mirrors the run the meter tracks (Meter.lua: db.state.run) into the list for the Companion.
local function sync()
    if not ns.db then return end
    ns.db.runs = type(ns.db.runs) == "table" and ns.db.runs or {}
    local run = ns.db.state.run
    if run then
        local list = ns.db.runs
        local last = list[#list]
        if not last or last.startedAt ~= run.startedAt then
            local instanceId = 0
            if type(GetInstanceInfo) == "function" then
                local ok, _, _, _, _, _, _, _, id = pcall(GetInstanceInfo)
                id = ok and ns.plain(id) or nil
                if type(id) == "number" then instanceId = id end
            end
            last = { zone = run.zone, instanceId = instanceId, startedAt = run.startedAt }
            table.insert(list, last)
            while #list > MAX_RUNS do table.remove(list, 1) end
        end
        local wasInside = last.endedAt == nil
        last.endedAt = run.leftAt
        if not run.leftAt then
            local leader = Export.Leader()
            if leader then last.leader = leader end
        elseif wasInside then
            ns.say("out of the dungeon. |cffffffff/reload|r when you have a moment hands the run's "
                .. "extras (party leader) to the Companion.")
        end
    end
    Export.Rebuild()
end

ns.on("PLAYER_ENTERING_WORLD", sync)
ns.on("ZONE_CHANGED_NEW_AREA", sync)
ns.on("GROUP_ROSTER_UPDATE", sync)
ns.on("PARTY_LEADER_CHANGED", sync)
ns.on("PLAYER_LOGOUT", sync) -- also fires on /reload, right before the game saves
ns.onReady(function()
    ns.db.runs = type(ns.db.runs) == "table" and ns.db.runs or {}
end)

-- ------------------------------------------------------------------ records from the Companion

-- The player's records written by the Companion (CompanionData.lua), or nil.
function Export.Records()
    local data = WowCompanyCompanionData
    if type(data) ~= "table" or type(data.characters) ~= "table" then return nil end
    local me = fullName("player")
    local only, count = nil, 0
    for _, c in pairs(data.characters) do
        if type(c) == "table" and type(c.records) == "table" then
            if me and c.name == me then return c end
            only, count = c, count + 1
        end
    end
    -- one character on file and the name could not be compared: it is this one
    if count == 1 and not me then return only end
    return nil
end
