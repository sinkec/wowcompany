-- Probe: answers the questions about WoW Forever that are still open (ADDON.md §4.1), without
-- touching anything forbidden. It samples quietly while you play and `/wowco probe` writes the
-- report into WowCompanyDB.probe (saved on /reload or logout; the Companion's author reads it).
--
-- Open questions:
--   1. Are the meter's numbers secret DURING combat?
--   2. What does C_DamageMeter.GetCombatSessionSourceFrom… return (spells? biggest hits?)
--   3. Does CHAT_MSG_LOOT carry an item link (item id + quality colour)?
--   4. Who is the party leader, seen from an addon?
--   5. Does an addon get its OWN position inside a dungeon (UnitPosition, C_Map), in and out of
--      combat? (For recording each member's exact path; OpenMap notes it can be secret here.)
-- No names of other players are stored: only shapes, flags and numbers.

local _, ns = ...

local sample = { loot = {}, combat = {}, meterEvents = 0, position = {} }

local function isSecret(v) return ns.isSecret(v) end

-- Shallow, safe copy for the report (depth and size limited, secrets marked).
local function dump(v, depth)
    depth = depth or 0
    if isSecret(v) then return "<secret>" end
    local t = type(v)
    if t ~= "table" then
        if t == "nil" or t == "number" or t == "string" or t == "boolean" then return v end
        return "<" .. t .. ">"
    end
    if depth >= 4 then return "<table>" end
    local out, n = {}, 0
    for k, val in pairs(v) do
        n = n + 1
        if n > 30 then
            out["..."] = "more"
            break
        end
        out[tostring(k)] = dump(val, depth + 1)
    end
    return out
end

local function enumValue(group, name)
    return type(Enum) == "table" and type(Enum[group]) == "table" and Enum[group][name] or nil
end

-- How the current fight looks right now: which fields are secret?
local function meterShape()
    local s = ns.Meter.Read("current", "damage")
    if not s then return { session = false } end
    local out = {
        session = true,
        secretTotal = isSecret(s.totalAmount),
        secretMax = isSecret(s.maxAmount),
        secretDuration = isSecret(s.durationSeconds),
        sources = type(s.combatSources) == "table" and #s.combatSources or 0,
    }
    local first = type(s.combatSources) == "table" and s.combatSources[1]
    if type(first) == "table" then
        out.secretName = isSecret(first.name)
        out.secretAmount = isSecret(first.totalAmount)
        out.secretPerSecond = isSecret(first.amountPerSecond)
        out.secretClass = isSecret(first.classFilename)
        out.secretGuid = isSecret(first.sourceGUID)
    end
    return out
end

local function later(sec, fn)
    if type(C_Timer) == "table" and type(C_Timer.After) == "function" then C_Timer.After(sec, fn) end
end

-- 1. secrets during and after combat (the first five fights are enough)
ns.on("PLAYER_REGEN_DISABLED", function()
    if #sample.combat >= 5 then return end
    local entry = { inDungeon = ns.Logging.InDungeon() }
    table.insert(sample.combat, entry)
    later(3, function() entry.during = meterShape() end)
end)
ns.on("PLAYER_REGEN_ENABLED", function()
    local entry = sample.combat[#sample.combat]
    if not entry or entry.after then return end
    later(1.5, function() entry.after = meterShape() end)
end)

-- how often and with what the meter announces changes
ns.on("DAMAGE_METER_COMBAT_SESSION_UPDATED", function(...)
    sample.meterEvents = sample.meterEvents + 1
    if not sample.firstMeterEvent then sample.firstMeterEvent = dump({ ... }) end
end)

-- 3. loot lines: shape only
ns.on("CHAT_MSG_LOOT", function(msg)
    if #sample.loot >= 6 then return end
    local s = ns.plain(msg)
    if type(s) ~= "string" then
        table.insert(sample.loot, { secret = true })
        return
    end
    table.insert(sample.loot, {
        hasLink = string.find(s, "|Hitem:", 1, true) ~= nil,
        itemId = tonumber(string.match(s, "|Hitem:(%d+)")),
        color = string.match(s, "|c(%x%x%x%x%x%x%x%x)") or string.match(s, "|c(n[%w_]+):"),
        mine = string.sub(s, 1, 4) == "You ",
        count = tonumber(string.match(s, "x(%d+)%.?$")),
        length = string.len(s),
    })
end)

-- 5. own position in a dungeon: a sample every 2 s from entering, at most 60 (two minutes of play)
local POS_EVERY, POS_MAX = 2, 60
local posTicker
local function round(v, step)
    if type(v) ~= "number" then return v end
    return math.floor(v / step + 0.5) * step
end
local function posValue(v)
    if isSecret(v) then return "<secret>" end
    if type(v) == "number" then return round(v, 0.1) end
    return v == nil and "<nil>" or dump(v)
end
function ns.ProbePosition()
    local entry = { t = ns.now(), combat = ns.inCombat and true or false }
    local ok, y, x, z, map = pcall(UnitPosition, "player")
    entry.unitPosition = ok and { y = posValue(y), x = posValue(x), z = posValue(z), map = posValue(map) }
        or ("error: " .. tostring(y))
    if type(C_Map) == "table" then
        local okB, best = pcall(C_Map.GetBestMapForUnit, "player")
        entry.bestMap = okB and posValue(best) or "error"
        if okB and type(best) == "number" and not isSecret(best) then
            local okP, pos = pcall(C_Map.GetPlayerMapPosition, best, "player")
            if not okP then
                entry.mapPosition = "error"
            elseif pos == nil or isSecret(pos) then
                entry.mapPosition = posValue(pos)
            else
                local okXY, px, py = pcall(pos.GetXY, pos)
                entry.mapPosition = okXY and { x = posValue(px), y = posValue(py) } or "error"
            end
        end
    end
    return entry
end
local function samplePosition()
    if #sample.position >= POS_MAX or not ns.Logging.InDungeon() then
        if posTicker then posTicker:Cancel() posTicker = nil end
        return
    end
    table.insert(sample.position, ns.ProbePosition())
end
local function startPositionSampling()
    if posTicker or #sample.position >= POS_MAX or not ns.Logging.InDungeon() then return end
    if type(C_Timer) ~= "table" or type(C_Timer.NewTicker) ~= "function" then return end
    samplePosition()
    posTicker = C_Timer.NewTicker(POS_EVERY, samplePosition)
end
ns.on("PLAYER_ENTERING_WORLD", function() later(3, startPositionSampling) end)
ns.on("ZONE_CHANGED_NEW_AREA", function() later(3, startPositionSampling) end)

local function call(fn, ...)
    if type(fn) ~= "function" then return "missing" end
    local function pack(...) return { n = select("#", ...), ... } end
    local r = pack(pcall(fn, ...))
    if not r[1] then return "error: " .. tostring(r[2]) end
    local out = {}
    for i = 2, math.min(r.n, 8) do out[i - 1] = dump(r[i]) end
    return out
end

local function report()
    local out = { at = ns.now(), version = ns.version, sample = sample }

    -- 2. per-source detail of the meter
    local guid = type(UnitGUID) == "function" and ns.plain(UnitGUID("player")) or nil
    local overall = enumValue("DamageMeterSessionType", "Overall")
    local damage = enumValue("DamageMeterType", "DamageDone")
    local taken = enumValue("DamageMeterType", "DamageTaken")
    out.source = {}
    if type(C_DamageMeter) == "table" and guid and overall ~= nil then
        out.source.damage = call(C_DamageMeter.GetCombatSessionSourceFromType, overall, damage, guid)
        out.source.taken = call(C_DamageMeter.GetCombatSessionSourceFromType, overall, taken, guid)
        local fights = ns.Meter.Fights(1)
        if fights[1] and fights[1].id then
            out.source.lastFight = call(C_DamageMeter.GetCombatSessionSourceFromID, fights[1].id, damage, guid)
            -- DPS two ways: the damage board's per-second vs the game's own Dps board
            if type(Enum) == "table" and type(Enum.DamageMeterType) == "table" and Enum.DamageMeterType.Dps then
                out.source.lastFightDpsBoard = call(C_DamageMeter.GetCombatSessionFromID, fights[1].id,
                    Enum.DamageMeterType.Dps)
            end
            out.source.lastFightDuration = call(C_DamageMeter.GetSessionDurationSeconds, enumValue(
                "DamageMeterSessionType", "Current"))
        end
    end
    out.fights = #ns.Meter.Fights(200)
    out.meterNow = meterShape()

    -- 4. party: who leads (flags only, no names)
    out.group = { size = call(GetNumGroupMembers), inGroup = call(IsInGroup), members = {} }
    for _, unit in ipairs({ "player", "party1", "party2", "party3", "party4" }) do
        if type(UnitExists) ~= "function" or UnitExists(unit) then
            local okLeader, leader = pcall(UnitIsGroupLeader, unit)
            local okName, _, surname = pcall(UnitFullName, unit)
            local sn = okName and ns.plain(surname) or nil
            out.group.members[unit] = {
                leader = okLeader and ns.plain(leader) or "error",
                hasSurname = type(sn) == "string" and sn ~= "",
            }
        end
    end
    if type(C_PartyInfo) == "table" then out.group.lootMethod = call(C_PartyInfo.GetLootMethod) end

    out.instance = call(GetInstanceInfo)
    -- 5. own position: right now, and the samples since entering a dungeon
    out.positionNow = ns.ProbePosition()
    out.positionNow.inDungeon = ns.Logging.InDungeon()
    out.logging = { combat = ns.Logging.CombatOn(), chat = ns.Logging.ChatOn(), advanced = ns.Logging.Advanced() }
    return out
end

-- JSON for the Companion (it reads SavedVariables as text and sends the report to the portal).
local function json(v, depth)
    depth = depth or 0
    local t = type(v)
    if t == "string" then
        return '"' .. v:gsub('[%c"\\]', function(c)
            if c == '"' then return '\\"' elseif c == "\\" then return "\\\\" end
            return string.format("\\u%04x", string.byte(c))
        end) .. '"'
    elseif t == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return "null" end
        return string.format("%.14g", v)
    elseif t == "boolean" then
        return tostring(v)
    elseif t == "table" and depth < 8 then
        local n = #v
        local parts = {}
        if n > 0 then
            for i = 1, n do parts[i] = json(v[i], depth + 1) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        for k, val in pairs(v) do
            table.insert(parts, json(tostring(k)) .. ":" .. json(val, depth + 1))
        end
        table.sort(parts)
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return "null"
end
ns.toJson = json

-- Opt-in (Logging tab → "Help development"): the same report is written on every logout and /reload,
-- so the next version can be built on what the game really does. Switching it off deletes it.
-- `diag` = one line the Companion picks up: v1|DIAG|<epoch s>|<addon version>|<json>
local MAX_DIAG = 90000
ns.on("PLAYER_LOGOUT", function()
    if not (ns.db and ns.db.settings.diagnostics) then return end
    -- nothing happened since the game loaded (a quick /reload): keep the last report, send nothing new
    if #sample.combat == 0 and #sample.loot == 0 and #sample.position == 0 then return end
    local r = report()
    ns.db.probe = r
    local body = json(r)
    if #body > MAX_DIAG then body = json({ tooBig = #body, version = ns.version }) end
    ns.db.diag = "v1|DIAG|" .. tostring(ns.now()) .. "|" .. tostring(ns.version) .. "|" .. body
end)

function ns.SetDiagnostics(on)
    ns.db.settings.diagnostics = on and true or false
    if not on then ns.db.probe, ns.db.diag = nil, nil end
    ns.say(on and "diagnostics on: a technical report (no names) is saved at logout. Thank you, hero."
        or "diagnostics off: the report is gone.")
end

ns.command("diag", "diag on|off – help development with a technical report at logout", function(rest)
    if rest == "on" or rest == "off" then ns.SetDiagnostics(rest == "on") end
    ns.say(ns.db.settings.diagnostics and "diagnostics: on." or "diagnostics: off.")
end)

ns.command("probe", "probe – save a technical report for the Companion's author (then /reload)", function()
    ns.db.probe = report()
    local now = ns.db.probe.positionNow
    local up = type(now.unitPosition) == "table" and now.unitPosition.x or now.unitPosition
    ns.say("probe saved: " .. #sample.combat .. " fights, " .. #sample.loot .. " loot lines, "
        .. #sample.position .. " position samples (own position now: " .. tostring(up) .. "). "
        .. "Type |cffffffff/reload|r to write it to disk.")
end)
