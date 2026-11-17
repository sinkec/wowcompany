-- Party: the WowCompany addons in your party find each other in a dungeon and tell who is recording.
-- Every member's Companion uploads the same run and the portal merges them (more recorders = a fuller
-- replay), so the useful thing in game is knowing that SOMEONE records, and that nobody runs an old addon.
-- Addon messages (prefix "WowCoParty", party/instance only, never the guild):
--   S<TAB>version<TAB>combat 0/1<TAB>chat 0/1<TAB>advanced 0/1<TAB>ask 0/1
-- sent on entering a dungeon and when the party changes (ask = 1: "tell me yours"), and again when your
-- own logging changes. Who said what lives only in memory, and only for your party.

local _, ns = ...

local Party = {}
ns.Party = Party

local PREFIX = "WowCoParty"
local TICK = 15          -- seconds between looks at your own logging while in a dungeon
local ANSWER_GAP = 5     -- at most one answer to "tell me yours" per this many seconds
local WARN_AFTER = 20    -- seconds after entering before warning that nobody records

local peers = {}         -- name -> { version, combat, chat, advanced, at }
local lastSent, lastAnswer, lastHello = nil, -math.huge, -math.huge
local HELLO_GAP = 5      -- party changes come in bursts: one hello per this many seconds
local warned = false
local ticker

local function now() return type(GetTime) == "function" and GetTime() or 0 end

local function channel()
    if type(IsInGroup) ~= "function" or not IsInGroup() then return nil end
    local instanceGroup = type(LE_PARTY_CATEGORY_INSTANCE) == "number" and IsInGroup(LE_PARTY_CATEGORY_INSTANCE)
    return instanceGroup and "INSTANCE_CHAT" or "PARTY"
end

local function flag(v) return v and "1" or "0" end

local function myStatus()
    local L = ns.Logging
    return table.concat({ "S", tostring(ns.version), flag(L.CombatOn()), flag(L.ChatOn()), flag(L.Advanced()) }, "\t")
end

local function send(ask)
    local ch = channel()
    if not ch or type(C_ChatInfo) ~= "table" or type(C_ChatInfo.SendAddonMessage) ~= "function" then return end
    local text = myStatus()
    lastSent = text
    pcall(C_ChatInfo.SendAddonMessage, PREFIX, text .. "\t" .. (ask and "1" or "0"), ch)
end

-- "1.2.10" > "1.2.9"
function Party.Newer(a, b)
    local pa, pb = {}, {}
    for n in tostring(a):gmatch("%d+") do pa[#pa + 1] = tonumber(n) end
    for n in tostring(b):gmatch("%d+") do pb[#pb + 1] = tonumber(n) end
    for i = 1, math.max(#pa, #pb) do
        local x, y = pa[i] or 0, pb[i] or 0
        if x ~= y then return x > y end
    end
    return false
end

-- who records this run: you and the party members whose addon answered (name, status)
function Party.Recorders()
    local L = ns.Logging
    local out = { {
        name = "You", version = ns.version, combat = L.CombatOn(), chat = L.ChatOn(), advanced = L.Advanced(),
        me = true,
    } }
    local names = {}
    for name in pairs(peers) do names[#names + 1] = name end
    table.sort(names)
    for _, name in ipairs(names) do
        local p = peers[name]
        out[#out + 1] = { name = name, version = p.version, combat = p.combat, chat = p.chat, advanced = p.advanced }
    end
    return out
end

-- how many record the combat log (you included)
function Party.RecordingCount()
    local n = 0
    for _, r in ipairs(Party.Recorders()) do if r.combat then n = n + 1 end end
    return n
end

-- the tooltip lines for the meter's logging light
function Party.TooltipLines()
    local lines = {}
    local list = Party.Recorders()
    if #list == 1 then
        lines[1] = { "No other WowCompany addon in this party heard yet.", 0.6, 0.6, 0.6 }
        return lines
    end
    lines[1] = { "WowCompany in this party:", 1, 0.82, 0 }
    for _, r in ipairs(list) do
        local what = (r.combat and "combat ✓" or "combat ✗") .. "  " .. (r.chat and "chat ✓" or "chat ✗")
        lines[#lines + 1] = { string.format("%s – %s  (%s)", r.name, what, tostring(r.version)),
            r.combat and 0.3 or 1, r.combat and 0.9 or 0.4, r.combat and 0.4 or 0.3 }
    end
    return lines
end

local function changed()
    if ns.Window and ns.Window.Refresh then ns.Window.Refresh() end
end

-- once per dungeon: nobody records the combat log, or someone has a newer addon
local function warn()
    if warned or not ns.Logging.InDungeon() then return end
    warned = true
    if Party.RecordingCount() == 0 then
        ns.say("|cffff5242nobody in this party is recording the combat log|r – this run won't reach the portal. "
            .. "Click the light on the meter or type |cffffffff/combatlog|r.")
    end
    for name, p in pairs(peers) do
        if Party.Newer(p.version, ns.version) then
            ns.say(name .. " has WowCompany " .. tostring(p.version) .. ", you have " .. tostring(ns.version)
                .. ". Start the Companion app – it updates the addon.")
            break
        end
    end
end

local function tick()
    if not ns.Logging.InDungeon() or not channel() then
        if ticker then ticker:Cancel() ticker = nil end
        return
    end
    if myStatus() ~= lastSent then send(false) end
end

local function startTicker()
    if ticker or type(C_Timer) ~= "table" or type(C_Timer.NewTicker) ~= "function" then return end
    ticker = C_Timer.NewTicker(TICK, tick)
end

-- entering a dungeon or a party change: say hello, ask the others
function Party.Hello()
    if not channel() then
        if next(peers) then wipe(peers) changed() end
        return
    end
    if not ns.Logging.InDungeon() or now() - lastHello < HELLO_GAP then return end
    lastHello = now()
    send(true)
    startTicker()
    if type(C_Timer) == "table" and type(C_Timer.After) == "function" then C_Timer.After(WARN_AFTER, warn) end
end

function Party.OnMessage(prefix, text, ch, sender)
    if prefix ~= PREFIX or ns.isSecret(text) or ns.isSecret(sender) then return end
    if type(text) ~= "string" or type(sender) ~= "string" then return end
    if ch ~= "PARTY" and ch ~= "INSTANCE_CHAT" and ch ~= "RAID" then return end
    local name = type(Ambiguate) == "function" and Ambiguate(sender, "none") or sender
    local me = type(UnitName) == "function" and ns.plain(UnitName("player"))
    if name == me then return end
    local kind, version, combat, chat, advanced, ask = strsplit("\t", text)
    if kind ~= "S" then return end
    peers[name] = { version = version, combat = combat == "1", chat = chat == "1", advanced = advanced == "1",
        at = now() }
    changed()
    if ask == "1" and now() - lastAnswer >= ANSWER_GAP then
        lastAnswer = now()
        send(false)
    end
end

ns.onReady(function()
    if type(C_ChatInfo) == "table" and type(C_ChatInfo.RegisterAddonMessagePrefix) == "function" then
        pcall(C_ChatInfo.RegisterAddonMessagePrefix, PREFIX)
    end
end)
ns.on("CHAT_MSG_ADDON", function(prefix, text, ch, sender) Party.OnMessage(prefix, text, ch, sender) end)
ns.on("PLAYER_ENTERING_WORLD", function()
    warned = false
    wipe(peers)
    if type(C_Timer) == "table" and type(C_Timer.After) == "function" then C_Timer.After(3, Party.Hello) end
end)
ns.on("GROUP_ROSTER_UPDATE", function()
    -- someone left: forget everyone and ask again (the ones still here answer)
    wipe(peers)
    changed()
    Party.Hello()
end)
