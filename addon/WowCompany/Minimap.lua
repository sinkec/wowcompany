-- Minimap button: left click opens the window, right click switches logging, drag moves it
-- around the minimap. /wowco minimap hides or shows it. Stock textures only.

local _, ns = ...

local button
local RADIUS_PAD = 6

local function place()
    if not button then return end
    local angle = math.rad(ns.db.settings.minimapAngle or 215)
    local radius = (Minimap:GetWidth() or 140) / 2 + RADIUS_PAD
    button:ClearAllPoints()
    button:SetPoint("CENTER", Minimap, "CENTER", math.cos(angle) * radius, math.sin(angle) * radius)
end

-- While dragging: follow the cursor's direction from the middle of the minimap.
local function follow()
    local mx, my = Minimap:GetCenter()
    local cx, cy = GetCursorPosition()
    local scale = Minimap:GetEffectiveScale()
    if not (mx and my and cx and cy and scale) or scale == 0 then return end
    ns.db.settings.minimapAngle = math.deg(math.atan2(cy / scale - my, cx / scale - mx))
    place()
end

local function build()
    button = CreateFrame("Button", "WowCompanyMinimapButton", Minimap)
    button:SetSize(31, 31)
    button:SetFrameStrata("MEDIUM")
    button:SetFrameLevel(8)
    button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    button:RegisterForDrag("LeftButton")

    local icon = button:CreateTexture(nil, "BACKGROUND")
    icon:SetTexture("Interface\\AddOns\\WowCompany\\Media\\LogoSmall") -- our logo, already round
    icon:SetSize(21, 21)
    icon:SetPoint("CENTER", 0, 1)
    local border = button:CreateTexture(nil, "OVERLAY")
    border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
    border:SetSize(52, 52)
    border:SetPoint("TOPLEFT")
    button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

    button:SetScript("OnClick", function(_, mouse)
        if mouse == "RightButton" then
            ns.Options.Open()
        else
            ns.Window.Toggle()
        end
    end)
    button:SetScript("OnDragStart", function(self) self:SetScript("OnUpdate", follow) end)
    button:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
    button:SetScript("OnEnter", function(self)
        if type(GameTooltip) ~= "table" then return end
        GameTooltip:SetOwner(self, "ANCHOR_LEFT")
        GameTooltip:SetText("WowCompany", 1, 0.82, 0)
        GameTooltip:AddLine("Click: the meter", 1, 1, 1)
        GameTooltip:AddLine("Right-click: settings", 1, 1, 1)
        GameTooltip:AddLine("Drag: move around the minimap", 0.7, 0.7, 0.7)
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function()
        if type(GameTooltip) == "table" then GameTooltip:Hide() end
    end)
end

local function apply()
    if type(Minimap) ~= "table" then return end
    if ns.db.settings.minimapHidden then
        if button then button:Hide() end
        return
    end
    if not button then build() end
    place()
    button:Show()
end

ns.onReady(function()
    local ok, err = pcall(apply)
    if not ok then ns.say("minimap button failed: " .. tostring(err)) end
end)

ns.command("minimap", "minimap – show or hide the minimap button", function()
    ns.db.settings.minimapHidden = not ns.db.settings.minimapHidden
    apply()
    ns.say("minimap button " .. (ns.db.settings.minimapHidden and "hidden" or "shown") .. ".")
end)
