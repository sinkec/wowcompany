-- In-game calendar for the portal: holidays (Darkmoon Faire, Hallow's End …) and system notices of
-- this month and the next. Never player, guild or community events – those name other players.
-- The game's calendar times are realm time; they are turned into epoch seconds here, so the
-- Companion and the portal never have to guess the realm's time zone.
--   v1|CALWIN|<from epoch s>|<to epoch s>
--   v1|CAL|<start epoch s>|<end epoch s>|holiday or system|<title>|<description>

local _, ns = ...

local Calendar = {}
ns.Calendar = Calendar

local KINDS = { HOLIDAY = "holiday", SYSTEM = "system" }
local MAX_EVENTS = 80
local RESCAN_S = 600

-- Days since 1970-01-01 for a calendar date (H. Hinnant's days_from_civil).
function Calendar.Days(y, m, d)
    if m <= 2 then y = y - 1 end
    local era = math.floor(y / 400)
    local yoe = y - era * 400
    local mp = (m + 9) % 12
    local doy = math.floor((153 * mp + 2) / 5) + d - 1
    local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
    return era * 146097 + doe - 719468
end

-- A calendar time ({year, month, monthDay, hour, minute}) read as if it were UTC.
function Calendar.AsUtc(t)
    if type(t) ~= "table" then return nil end
    local y, m, d = ns.plain(t.year), ns.plain(t.month), ns.plain(t.monthDay)
    if type(y) ~= "number" or type(m) ~= "number" or type(d) ~= "number" then return nil end
    return Calendar.Days(y, m, d) * 86400 + (ns.plain(t.hour) or 0) * 3600 + (ns.plain(t.minute) or 0) * 60
end

-- Realm time minus UTC, in seconds, rounded to a quarter of an hour.
local function realmOffset()
    if type(C_DateAndTime) ~= "table" or type(C_DateAndTime.GetCurrentCalendarTime) ~= "function" then return nil end
    local ok, now = pcall(C_DateAndTime.GetCurrentCalendarTime)
    local local_ = ok and Calendar.AsUtc(now) or nil
    if not local_ then return nil end
    return math.floor((local_ - ns.now()) / 900 + 0.5) * 900, now
end

local function text(v)
    v = ns.plain(v)
    if type(v) ~= "string" then return "" end
    v = v:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|T.-|t", "")
    return (v:gsub("[|\r\n]", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", ""):sub(1, 300))
end

local lastScan = 0

-- Reads this month and the next into WowCompanyDB.calendar.
function Calendar.Scan(force)
    if not ns.db or type(C_Calendar) ~= "table" or type(C_Calendar.GetNumDayEvents) ~= "function" then return end
    if not force and ns.now() - lastScan < RESCAN_S then return end
    -- the player is looking at another month in the calendar window: do not move it under them
    if CalendarFrame and CalendarFrame.IsShown and CalendarFrame:IsShown() then return end
    local offset, now = realmOffset()
    if not offset then return end
    lastScan = ns.now()
    pcall(C_Calendar.SetAbsMonth, now.month, now.year)

    local events, seen = {}, {}
    local from, to
    for month = 0, 1 do
        local okM, info = pcall(C_Calendar.GetMonthInfo, month)
        if not okM or type(info) ~= "table" or type(ns.plain(info.numDays)) ~= "number" then break end
        local first = Calendar.Days(info.year, info.month, 1) * 86400 - offset
        from = from or first
        to = first + info.numDays * 86400
        for day = 1, info.numDays do
            local okN, n = pcall(C_Calendar.GetNumDayEvents, month, day)
            for i = 1, (okN and type(n) == "number") and n or 0 do
                local okE, e = pcall(C_Calendar.GetDayEvent, month, day, i)
                local kind = okE and type(e) == "table" and KINDS[ns.plain(e.calendarType) or ""]
                local title = kind and text(e.title) or ""
                local start = kind and Calendar.AsUtc(e.startTime)
                if kind and title ~= "" and start then
                    start = start - offset
                    local key = title .. "@" .. start
                    if not seen[key] and #events < MAX_EVENTS then
                        seen[key] = true
                        local stop = Calendar.AsUtc(e.endTime)
                        local desc = ""
                        if kind == "holiday" and type(C_Calendar.GetHolidayInfo) == "function" then
                            local okH, h = pcall(C_Calendar.GetHolidayInfo, month, day, i)
                            if okH and type(h) == "table" then desc = text(h.description) end
                        end
                        table.insert(events, {
                            kind = kind, title = title, desc = desc,
                            startAt = start, endAt = stop and (stop - offset) or start,
                        })
                    end
                end
            end
        end
    end
    if not from then return end
    ns.db.calendar = { from = from, to = to, at = ns.now(), events = events }
    if ns.Export then ns.Export.Rebuild() end
end

-- Lines for the export (Export.Rebuild adds them).
function Calendar.Lines()
    local c = ns.db and ns.db.calendar
    if type(c) ~= "table" or type(c.events) ~= "table" or not c.from then return {} end
    local lines = { table.concat({ "v1", "CALWIN", tostring(c.from), tostring(c.to or c.from) }, "|") }
    for _, e in ipairs(c.events) do
        table.insert(lines, table.concat({
            "v1", "CAL", tostring(e.startAt or 0), tostring(e.endAt or 0), e.kind or "",
            text(e.title), text(e.desc),
        }, "|"))
    end
    return lines
end

-- The game loads the calendar only when asked; the answer arrives as CALENDAR_UPDATE_EVENT_LIST.
ns.on("PLAYER_ENTERING_WORLD", function()
    if type(C_Calendar) == "table" and type(C_Calendar.OpenCalendar) == "function" then
        pcall(C_Calendar.OpenCalendar)
    end
end)
ns.on("CALENDAR_UPDATE_EVENT_LIST", function() Calendar.Scan(false) end)
ns.on("PLAYER_LOGOUT", function() Calendar.Scan(true) end)
