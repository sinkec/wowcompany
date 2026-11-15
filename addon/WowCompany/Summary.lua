-- Run summary: when you walk out of a dungeon, a few lines in chat – time, bosses and who carried
-- (or died the most). Numbers are added up from every fight of the run in the game's own meter,
-- after combat, when they are plain. Only you and your party appear (Meter.Visible).
--   /wowco report   – says the last summary in /party (never /say, never /guild)
--   /wowco details on|off – let Details! do the meter; our Records and run summary stay
local _, ns = ...

local Summary = {}
ns.Summary = Summary

local KINDS = { "damage", "healing", "deaths", "interrupts" }

-- Totals per party member over the fights of the run: { [name] = { damage=, healing=, deaths=, interrupts= } }
function Summary.Totals(fights)
    local by = {}
    for i = 1, #fights do
        for _, kind in ipairs(KINDS) do
            local session = ns.Meter.Read(nil, kind, fights[i].id)
            local rows = ns.Meter.Visible(session, kind)
            for j = 1, #rows do
                local name, amount = ns.plain(rows[j].name), ns.plain(rows[j].totalAmount)
                if type(name) == "string" and type(amount) == "number" then
                    by[name] = by[name] or { damage = 0, healing = 0, deaths = 0, interrupts = 0 }
                    by[name][kind] = by[name][kind] + amount
                end
            end
        end
    end
    return by
end

local function top(by, kind)
    local bestName, best = nil, 0
    for name, t in pairs(by) do
        if t[kind] > best then bestName, best = name, t[kind] end
    end
    return bestName, best
end

-- Lines of the summary (plain text, no colours: they may go to /party).
function Summary.Lines(run, fights, now)
    local bosses = 0
    for i = 1, #fights do
        if fights[i].boss then bosses = bosses + 1 end
    end
    local by = Summary.Totals(fights)
    local lines = {
        string.format("%s done in %s – %d boss%s, %d fights.", run.zone or "Dungeon",
            ns.fmtTime(math.max(0, (run.leftAt or now) - run.startedAt)), bosses, bosses == 1 and "" or "es", #fights),
    }
    local mvp, dmg = top(by, "damage")
    local medic, heal = top(by, "healing")
    local corpse, deaths = top(by, "deaths")
    local kicker, kicks = top(by, "interrupts")
    local parts = {}
    if mvp then table.insert(parts, string.format("MVP: %s (%s damage)", mvp, ns.fmt(dmg))) end
    if medic then table.insert(parts, string.format("Medic: %s (%s healing)", medic, ns.fmt(heal))) end
    if kicker then table.insert(parts, string.format("Kicks: %s (%d)", kicker, kicks)) end
    if #parts > 0 then table.insert(lines, table.concat(parts, " · ")) end
    if corpse and deaths > 0 then
        table.insert(lines, string.format("Floor inspector: %s (%d death%s). Very thorough.", corpse, deaths,
            deaths == 1 and "" or "s"))
    else
        table.insert(lines, "Nobody died. Suspicious.")
    end
    return lines
end

-- Fights that belong to the run: after the one before we walked in.
local function runFights(run)
    local out = {}
    for _, f in ipairs(ns.Meter.Fights(200)) do
        if type(f.id) == "number" and f.id > (run.afterFight or 0) then table.insert(out, f) end
    end
    return out
end

-- Called after the meter noticed we left (Meter.lua sets run.leftAt).
local function afterLeaving()
    local run = ns.db and ns.db.state.run
    if not run or not run.leftAt or run.summarized then return end
    run.summarized = true
    local fights = runFights(run)
    if #fights == 0 then return end
    local lines = Summary.Lines(run, fights, ns.now())
    ns.db.state.lastSummary = lines
    for i = 1, #lines do ns.say(lines[i]) end
    ns.say("|cff9d9d9d/wowco report says this in /party.|r")
end

local function later()
    if type(C_Timer) == "table" and type(C_Timer.After) == "function" then
        C_Timer.After(2, afterLeaving)
    else
        afterLeaving()
    end
end
ns.on("ZONE_CHANGED_NEW_AREA", later)
ns.on("PLAYER_ENTERING_WORLD", later)

ns.command("report", "report – the last run summary in /party", function()
    local lines = ns.db.state.lastSummary
    if type(lines) ~= "table" or #lines == 0 then
        ns.say("no run summary yet – finish a dungeon first.")
        return
    end
    if type(IsInGroup) ~= "function" or not IsInGroup() or type(SendChatMessage) ~= "function" then
        ns.say("not in a party – nobody to brag to.")
        return
    end
    for i = 1, #lines do pcall(SendChatMessage, "[WowCompany] " .. lines[i], "PARTY") end
end)

-- ------------------------------------------------------------------ living with Details!

function Summary.DetailsLoaded()
    if type(C_AddOns) ~= "table" or type(C_AddOns.IsAddOnLoaded) ~= "function" then return false end
    local ok, yes = pcall(C_AddOns.IsAddOnLoaded, "Details")
    return ok and ns.plain(yes) == true
end

-- Our meter steps aside when the player asked for it and Details! is really there.
function Summary.MeterDeferred()
    return ns.db and ns.db.settings.deferToDetails == true and Summary.DetailsLoaded()
end

ns.onReady(function()
    if Summary.DetailsLoaded() and not ns.db.state.detailsHinted then
        ns.db.state.detailsHinted = true
        ns.say("Details! is here too. /wowco details on hides our meter; Records and run summaries stay.")
    end
end)

ns.command("details", "details on|off – let Details! do the meter (ours hides)", function(rest)
    if rest == "on" or rest == "off" then ns.db.settings.deferToDetails = rest == "on" end
    ns.say(ns.db.settings.deferToDetails and "meter: Details! does it." or "meter: ours.")
    if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
end)
