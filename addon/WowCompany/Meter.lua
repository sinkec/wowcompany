-- The meter: numbers from Blizzard's built-in damage meter (C_DamageMeter). The combat log itself
-- is closed to addons in WoW Forever, this is the door that is open.
--
-- A session is one fight. `GetCombatSessionFromType(scope, kind)` returns
--   { durationSeconds, totalAmount, maxAmount, combatSources = { { name, classFilename, totalAmount,
--     amountPerSecond, isLocalPlayer, sourceGUID, … }, … } }
-- Values may be secret (probably during combat): they are handed to the UI untouched and never
-- compared or added up here.

local _, ns = ...

local Meter = {}
ns.Meter = Meter

-- what the player picks -> Enum.DamageMeterType name
Meter.KINDS = {
    { key = "damage", label = "Damage", enum = "DamageDone" },
    { key = "healing", label = "Healing", enum = "HealingDone" },
    { key = "taken", label = "Taken", enum = "DamageTaken" },
    { key = "interrupts", label = "Kicks", enum = "Interrupts" },
}
-- behind the 4th button ("More"): the rest of what the game's meter counts
Meter.MORE = {
    { key = "interrupts", label = "Kicks", enum = "Interrupts" },
    { key = "dispels", label = "Dispels", enum = "Dispels" },
    { key = "absorbs", label = "Shields", enum = "Absorbs" },
    { key = "avoidable", label = "Fire", enum = "AvoidableDamageTaken",
      tip = "Avoidable damage taken: standing in things you should not stand in." },
    { key = "enemies", label = "Beat up", enum = "EnemyDamageTaken",
      tip = "Damage done to each enemy (mobs, never players)." },
    { key = "deaths", label = "Deaths", enum = "Deaths" },
}

function Meter.IsMore(kindKey)
    for i = 1, #Meter.MORE do
        if Meter.MORE[i].key == kindKey then return Meter.MORE[i] end
    end
    return nil
end

-- the next "More" kind after `kindKey` (wraps around)
function Meter.NextMore(kindKey)
    for i = 1, #Meter.MORE do
        if Meter.MORE[i].key == kindKey then return Meter.MORE[i % #Meter.MORE + 1] end
    end
    return Meter.MORE[1]
end

Meter.SCOPES = {
    { key = "current", label = "This fight", enum = "Current" },
    { key = "overall", label = "Overall", enum = "Overall" },
}

local function enumValue(group, name)
    if type(Enum) ~= "table" or type(Enum[group]) ~= "table" then return nil end
    return Enum[group][name]
end

function Meter.Available()
    if type(C_DamageMeter) ~= "table" then return false end
    if type(C_DamageMeter.IsDamageMeterAvailable) ~= "function" then return true end
    local ok, yes = pcall(C_DamageMeter.IsDamageMeterAvailable)
    return ok and ns.plain(yes) ~= false
end

local function kindEnum(kindKey)
    for i = 1, #Meter.KINDS do
        if Meter.KINDS[i].key == kindKey then return enumValue("DamageMeterType", Meter.KINDS[i].enum) end
    end
    local more = Meter.IsMore(kindKey)
    if more then return enumValue("DamageMeterType", more.enum) end
    return enumValue("DamageMeterType", "DamageDone")
end

local function scopeEnum(scopeKey)
    for i = 1, #Meter.SCOPES do
        if Meter.SCOPES[i].key == scopeKey then return enumValue("DamageMeterSessionType", Meter.SCOPES[i].enum) end
    end
    return nil
end

-- One session: by scope ("current" / "overall") or by the id of a past fight.
function Meter.Read(scopeKey, kindKey, sessionId)
    if type(C_DamageMeter) ~= "table" then return nil end
    local kind = kindEnum(kindKey)
    if kind == nil then return nil end
    local ok, session
    if sessionId then
        if type(C_DamageMeter.GetCombatSessionFromID) ~= "function" then return nil end
        ok, session = pcall(C_DamageMeter.GetCombatSessionFromID, sessionId, kind)
    else
        local scope = scopeEnum(scopeKey)
        if scope == nil or type(C_DamageMeter.GetCombatSessionFromType) ~= "function" then return nil end
        ok, session = pcall(C_DamageMeter.GetCombatSessionFromType, scope, kind)
    end
    if not ok or type(session) ~= "table" then return nil end
    return session
end

-- The game's own per-second boards ("Dps"/"Hps" types): the built-in meter shows these as DPS/HPS,
-- and they are not the same as `amountPerSecond` of the damage/healing board. guid -> rate (plain only).
local RATE_TYPE = { damage = "Dps", healing = "Hps" }
function Meter.Rates(scopeKey, kindKey, sessionId)
    local typeName = RATE_TYPE[kindKey]
    if not typeName or type(C_DamageMeter) ~= "table" then return nil end
    local kind = enumValue("DamageMeterType", typeName)
    if kind == nil then return nil end
    local ok, session
    if sessionId then
        if type(C_DamageMeter.GetCombatSessionFromID) ~= "function" then return nil end
        ok, session = pcall(C_DamageMeter.GetCombatSessionFromID, sessionId, kind)
    else
        local scope = scopeEnum(scopeKey)
        if scope == nil or type(C_DamageMeter.GetCombatSessionFromType) ~= "function" then return nil end
        ok, session = pcall(C_DamageMeter.GetCombatSessionFromType, scope, kind)
    end
    if not ok or type(session) ~= "table" or type(session.combatSources) ~= "table" then return nil end
    local out = {}
    for _, src in ipairs(session.combatSources) do
        local guid = type(src) == "table" and ns.plain(src.sourceGUID)
        if guid then out[guid] = src.amountPerSecond end
    end
    return out
end

-- PRIVACY RULE: only you and the members of your own party are ever shown. The game's meter can
-- also list strangers who hit the same mob in the open world – those rows are dropped. A row
-- whose owner cannot be verified (identity hidden as a secret mid-fight) is dropped too, except
-- inside a dungeon with your group, where everybody present is the party.

local function inGroup()
    if type(IsInGroup) ~= "function" then return false end
    local ok, yes = pcall(IsInGroup)
    return ok and ns.plain(yes) == true
end

local function guidInGroup(guid)
    if type(C_PartyInfo) ~= "table" or type(C_PartyInfo.IsGUIDInGroup) ~= "function" then return false end
    local ok, yes = pcall(C_PartyInfo.IsGUIDInGroup, guid)
    return ok and ns.plain(yes) == true
end

local function isMine(src, myGuid)
    if ns.plain(src.isLocalPlayer) == true then return true end
    local guid = ns.plain(src.sourceGUID)
    return guid ~= nil and guid == myGuid
end

-- Rows of a session that may be shown (see the privacy rule), in the game's order.
-- The "enemies" board lists mobs (damage done to them): those rows are kept, players never.
function Meter.Visible(session, kindKey)
    local out = {}
    local sources = session and session.combatSources
    if type(sources) ~= "table" then return out end
    local myGuid = type(UnitGUID) == "function" and ns.plain(UnitGUID("player")) or nil
    local grouped = inGroup()
    local privateInstance = grouped and ns.Logging.InDungeon()
    for i = 1, #sources do
        local src = sources[i]
        if type(src) == "table" then
            local guid = ns.plain(src.sourceGUID)
            if kindKey == "enemies" then
                local isPlayer = type(guid) == "string" and string.sub(guid, 1, 7) == "Player-"
                if (type(guid) == "string" and not isPlayer) or (guid == nil and privateInstance) then
                    table.insert(out, src)
                end
            elseif isMine(src, myGuid) or privateInstance or (grouped and guid ~= nil and guidInGroup(guid)) then
                table.insert(out, src)
            end
        end
    end
    return out
end

-- One player's spells in a session (Details! reads the same API on this client):
-- { { name, amount, perSecond, pet }, … } in the game's order, or nil when the game does not say.
-- Only for a row that is already visible (the caller passes its plain GUID).
function Meter.Spells(scopeKey, kindKey, sessionId, guid)
    if type(C_DamageMeter) ~= "table" or type(guid) ~= "string" then return nil end
    local kind = kindEnum(kindKey)
    local ok, src
    if sessionId then
        if type(C_DamageMeter.GetCombatSessionSourceFromID) ~= "function" then return nil end
        ok, src = pcall(C_DamageMeter.GetCombatSessionSourceFromID, sessionId, kind, guid)
    else
        local scope = scopeEnum(scopeKey)
        if scope == nil or type(C_DamageMeter.GetCombatSessionSourceFromType) ~= "function" then return nil end
        ok, src = pcall(C_DamageMeter.GetCombatSessionSourceFromType, scope, kind, guid)
    end
    if not ok or type(src) ~= "table" or type(src.combatSpells) ~= "table" then return nil end
    local out = {}
    for i = 1, #src.combatSpells do
        local sp = src.combatSpells[i]
        if type(sp) == "table" then
            local id = ns.plain(sp.spellID)
            local name
            if type(id) == "number" and type(C_Spell) == "table" and type(C_Spell.GetSpellInfo) == "function" then
                local okInfo, info = pcall(C_Spell.GetSpellInfo, id)
                name = okInfo and type(info) == "table" and ns.plain(info.name) or nil
            end
            if id == 0 then name = "Melee" end
            local pet = ns.plain(sp.creatureName)
            table.insert(out, {
                name = name or "Some spell",
                pet = (type(pet) == "string" and pet ~= "") and pet or nil,
                amount = sp.totalAmount,
                perSecond = sp.amountPerSecond,
            })
        end
    end
    return out
end

-- The local player's row of a session; nil when it cannot be verified (a secret must not be
-- compared, and guessing could show somebody else's numbers as yours).
function Meter.Mine(session)
    local sources = session and session.combatSources
    if type(sources) ~= "table" then return nil end
    local myGuid = type(UnitGUID) == "function" and ns.plain(UnitGUID("player")) or nil
    for i = 1, #sources do
        local src = sources[i]
        if type(src) == "table" and isMine(src, myGuid) then return src end
    end
    return nil
end

-- May the session's own totals be shown? Only when nobody but the party can be in them.
function Meter.TotalsAreParty()
    return inGroup() and ns.Logging.InDungeon()
end

-- Past fights, newest first: { { id, name, duration }, … }. Bosses carry Blizzard's "(!)" mark.
function Meter.Fights(limit)
    local out = {}
    if type(C_DamageMeter) ~= "table" or type(C_DamageMeter.GetAvailableCombatSessions) ~= "function" then
        return out
    end
    local ok, list = pcall(C_DamageMeter.GetAvailableCombatSessions)
    if not ok or type(list) ~= "table" then return out end
    for i = #list, 1, -1 do
        local s = list[i]
        if type(s) == "table" then
            local name = ns.plain(s.name)
            local boss = false
            if type(name) == "string" and string.sub(name, 1, 4) == "(!) " then
                boss = true
                name = string.sub(name, 5)
            end
            table.insert(out, {
                id = ns.plain(s.sessionID),
                name = (type(name) == "string" and name ~= "") and name or "Unknown scuffle",
                duration = ns.plain(s.durationSeconds),
                boss = boss,
            })
            if limit and #out >= limit then break end
        end
    end
    return out
end

-- ------------------------------------------------------------------ the dungeon run
-- A run = one visit to a dungeon. Remembered across /reload: which dungeon, when we walked in and
-- which fight was the last one before it, so "fights in this run" can be counted from the meter.

local RUN_RESUME = 20 * 60 -- back inside within this time: same run (corpse run, vendor trip)

local function lastFightId()
    local newest = Meter.Fights(1)[1]
    return newest and newest.id or 0
end

local function trackRun()
    if not ns.db then return end
    local state = ns.db.state
    local now = ns.now()
    if ns.Logging.InDungeon() then
        local ok, name, _, _, _, _, _, _, id = pcall(GetInstanceInfo)
        name = ok and ns.plain(name) or nil
        id = ok and ns.plain(id) or nil
        local run = state.run
        local stale = run and run.leftAt and (now - run.leftAt) > RUN_RESUME
        if not run or run.zone ~= name or stale then
            -- the instance id is read here, inside the dungeon (later, outside, it is the continent's)
            state.run = {
                zone = name, instanceId = type(id) == "number" and id or nil,
                startedAt = now, afterFight = lastFightId(),
            }
        else
            run.leftAt = nil
        end
    elseif state.run and not state.run.leftAt then
        state.run.leftAt = now
    end
end
ns.on("PLAYER_ENTERING_WORLD", trackRun)
ns.on("ZONE_CHANGED_NEW_AREA", trackRun)

-- The run in progress (only while inside): { zone, elapsed, fights, bosses } or nil.
function Meter.Run()
    local run = ns.db and ns.db.state.run
    if not run or run.leftAt or not ns.Logging.InDungeon() then return nil end
    local fights, bosses = 0, 0
    local list = Meter.Fights(200)
    for i = 1, #list do
        local id = list[i].id
        if type(id) == "number" and id > (run.afterFight or 0) then
            fights = fights + 1
            if list[i].boss then bosses = bosses + 1 end
        end
    end
    return { zone = run.zone or "Dungeon", elapsed = ns.now() - run.startedAt, fights = fights, bosses = bosses }
end
