//! Units (source/destination of an event), spells and the advanced unit-info block.

/// Unit flag bits (`COMBATLOG_OBJECT_*`).
pub mod flags {
    pub const AFFILIATION_MINE: u32 = 0x0000_0001;
    pub const AFFILIATION_PARTY: u32 = 0x0000_0002;
    pub const AFFILIATION_RAID: u32 = 0x0000_0004;
    pub const AFFILIATION_OUTSIDER: u32 = 0x0000_0008;
    pub const AFFILIATION_MASK: u32 = 0x0000_000F;

    pub const REACTION_FRIENDLY: u32 = 0x0000_0010;
    pub const REACTION_NEUTRAL: u32 = 0x0000_0020;
    pub const REACTION_HOSTILE: u32 = 0x0000_0040;

    pub const CONTROL_PLAYER: u32 = 0x0000_0100;
    pub const CONTROL_NPC: u32 = 0x0000_0200;

    pub const TYPE_PLAYER: u32 = 0x0000_0400;
    pub const TYPE_NPC: u32 = 0x0000_0800;
    pub const TYPE_PET: u32 = 0x0000_1000;
    pub const TYPE_GUARDIAN: u32 = 0x0000_2000;
    pub const TYPE_OBJECT: u32 = 0x0000_4000;

    /// Raid target icons etc. live in `raid_flags`; `0x80000000` = none.
    pub const NONE: u32 = 0x8000_0000;
}

pub const EMPTY_GUID: &str = "0000000000000000";

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Unit {
    pub guid: String,
    pub name: Option<String>,
    pub flags: u32,
    pub raid_flags: u32,
}

impl Unit {
    /// The "nobody" unit (empty GUID, `nil` name).
    pub fn none() -> Self {
        Unit {
            guid: EMPTY_GUID.to_string(),
            name: None,
            flags: flags::NONE,
            raid_flags: flags::NONE,
        }
    }

    pub fn is_none(&self) -> bool {
        self.guid == EMPTY_GUID || self.guid.is_empty()
    }

    /// Player character (by GUID, independent of flags).
    pub fn is_player(&self) -> bool {
        self.guid.starts_with("Player-")
    }

    pub fn is_pet(&self) -> bool {
        self.guid.starts_with("Pet-") || self.flags & flags::TYPE_PET != 0
    }

    pub fn is_guardian(&self) -> bool {
        self.flags & flags::TYPE_GUARDIAN != 0
    }

    /// The player who wrote the log (or something they control, e.g. a pet).
    pub fn is_mine(&self) -> bool {
        self.flags & flags::AFFILIATION_MINE != 0
    }

    /// Mine, party or raid affiliation – the only units whose data may leave the PC.
    pub fn is_group(&self) -> bool {
        !self.is_none()
            && self.flags & (flags::AFFILIATION_MINE | flags::AFFILIATION_PARTY | flags::AFFILIATION_RAID) != 0
    }

    pub fn is_hostile(&self) -> bool {
        self.flags & flags::REACTION_HOSTILE != 0
    }

    /// NPC id from a `Creature-0-…-<npcId>-<spawn>` / `Vehicle-…` / `Pet-…` GUID.
    pub fn npc_id(&self) -> Option<u32> {
        let mut parts = self.guid.split('-');
        let kind = parts.next()?;
        if !matches!(kind, "Creature" | "Vehicle" | "Pet" | "GameObject") {
            return None;
        }
        parts.nth(4)?.parse().ok()
    }

    /// Portal hero slug from a player name: `Grobos-Stinkfoot-PvP-EU` → `grobos-stinkfoot`.
    /// Returns `None` for non-players.
    pub fn player_slug(&self) -> Option<String> {
        if !self.is_player() {
            return None;
        }
        self.name.as_deref().map(player_slug)
    }
}

/// `Name-Surname-PvP-EU` → `name-surname`. Forever is realmless: names are
/// "Name Surname" and the log appends `-<realm>-<REGION>`. Mirrors the portal's
/// `slugify` (lower case, words joined with `-`, diacritics kept).
pub fn player_slug(name: &str) -> String {
    let parts: Vec<&str> = name.split('-').collect();
    let looks_like_region = |s: &str| s.len() == 2 && s.bytes().all(|b| b.is_ascii_uppercase());
    let core = if parts.len() >= 3 && looks_like_region(parts[parts.len() - 1]) {
        &parts[..parts.len() - 2]
    } else {
        &parts[..]
    };
    core.iter()
        .flat_map(|p| p.split_whitespace())
        .filter(|p| !p.is_empty())
        .map(|p| p.to_lowercase())
        .collect::<Vec<_>>()
        .join("-")
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Spell {
    pub id: u32,
    pub name: String,
    /// Spell school bit mask (1 physical, 2 holy, 4 fire, 8 nature, 16 frost, 32 shadow, 64 arcane).
    pub school: u32,
}

/// Advanced unit info block (`/console advancedCombatLogging 1`). In Forever it is
/// present even with `ADVANCED_LOG_ENABLED,0`. It describes the unit `info_guid`
/// (for most spell damage that is the *target*, for swings the *attacker* – always
/// check the GUID rather than assuming).
///
/// Layout in v22 Forever (19 fields): infoGUID, ownerGUID, currentHP, maxHP,
/// attackPower, spellPower, armor, absorb, ?, ?, powerType, currentPower, maxPower,
/// powerCost, x, y, uiMapID, facing, level (item level for players in modern clients).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Advanced {
    pub info_guid: String,
    pub owner_guid: Option<String>,
    pub current_hp: i64,
    pub max_hp: i64,
    pub attack_power: i64,
    pub spell_power: i64,
    pub armor: i64,
    pub absorb: i64,
    pub power_type: i64,
    pub current_power: i64,
    pub max_power: i64,
    pub power_cost: i64,
    pub x: f64,
    pub y: f64,
    pub ui_map_id: i64,
    pub facing: f64,
    pub level: i64,
}

impl Advanced {
    pub const FIELDS: usize = 19;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(player_slug("Grobos-Stinkfoot-PvP-EU"), "grobos-stinkfoot");
        assert_eq!(player_slug("Elfrida-Ástrún-PvP-EU"), "elfrida-ástrún");
        assert_eq!(player_slug("Solo"), "solo");
    }

    #[test]
    fn npc_ids_and_affiliation() {
        let u = Unit {
            guid: "Creature-0-1-0-1-1548-000000BBBB".into(),
            name: Some("Cursed Darkhound".into()),
            flags: 0x10a48,
            raid_flags: flags::NONE,
        };
        assert_eq!(u.npc_id(), Some(1548));
        assert!(!u.is_group() && u.is_hostile());
        let me = Unit {
            guid: "Player-1-AB".into(),
            flags: 0x511,
            ..Default::default()
        };
        let party = Unit {
            guid: "Player-1-CD".into(),
            flags: 0x512,
            ..Default::default()
        };
        let stranger = Unit {
            guid: "Player-1-EF".into(),
            flags: 0x518,
            ..Default::default()
        };
        assert!(me.is_group() && me.is_mine());
        assert!(party.is_group() && !party.is_mine());
        assert!(!stranger.is_group());
        assert!(Unit::none().is_none() && !Unit::none().is_group());
    }
}
