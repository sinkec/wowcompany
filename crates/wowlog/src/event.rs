//! Event types and the line parser.

use crate::fields;
use crate::time;
use crate::unit::{Advanced, Spell, Unit};
use std::fmt;

/// One parsed log line.
#[derive(Debug, Clone, PartialEq)]
pub struct Record {
    /// Naive local milliseconds since 1970 (see [`crate::time`]).
    pub timestamp: i64,
    /// Raw event name, e.g. `SPELL_DAMAGE`.
    pub event: String,
    /// Source unit ([`Unit::none`] for events without units).
    pub source: Unit,
    /// Destination unit ([`Unit::none`] for events without units).
    pub dest: Unit,
    pub kind: Kind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageSource {
    Swing,
    /// `SWING_DAMAGE_LANDED` – a second copy of a swing seen from the target's side.
    /// Analyzers must not add it to `Swing` totals.
    SwingLanded,
    Range,
    Spell,
    Periodic,
    Building,
    Environmental,
    /// `DAMAGE_SHIELD` (thorns-like effects).
    Shield,
    /// `DAMAGE_SPLIT`.
    Split,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Damage {
    pub amount: i64,
    pub base_amount: i64,
    /// 0 when the target survived (log uses -1).
    pub overkill: i64,
    pub school: u32,
    pub resisted: i64,
    pub blocked: i64,
    pub absorbed: i64,
    pub critical: bool,
    pub glancing: bool,
    pub crushing: bool,
    pub off_hand: bool,
    /// `Some(true)` for `AOE`, `Some(false)` for `ST`, `None` when not logged.
    pub aoe: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Heal {
    pub amount: i64,
    pub base_amount: i64,
    pub overheal: i64,
    pub absorbed: i64,
    pub critical: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Miss {
    /// `MISS`, `DODGE`, `PARRY`, `BLOCK`, `RESIST`, `ABSORB`, `IMMUNE`, `EVADE`, `DEFLECT`, `REFLECT`.
    pub miss_type: String,
    pub off_hand: bool,
    /// Amount for partial outcomes (ABSORB/BLOCK/RESIST), else 0.
    pub amount: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuraChange {
    Applied,
    Removed,
    Refresh,
    AppliedDose,
    RemovedDose,
    Broken,
    BrokenSpell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuraType {
    Buff,
    Debuff,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CastPhase {
    Start,
    Success,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeathKind {
    Died,
    Destroyed,
    Dissipates,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    CombatLogVersion {
        version: u32,
        advanced: bool,
        build: String,
        project_id: u32,
    },
    ZoneChange {
        instance_id: u32,
        name: String,
        difficulty_id: u32,
    },
    MapChange {
        ui_map_id: u32,
        name: String,
    },
    EncounterStart {
        encounter_id: u32,
        name: String,
        difficulty_id: u32,
        group_size: u32,
        instance_id: Option<u32>,
    },
    EncounterEnd {
        encounter_id: u32,
        name: String,
        difficulty_id: u32,
        group_size: u32,
        success: bool,
        fight_time_ms: Option<i64>,
    },
    /// Gear/talents snapshot at pull. Format to be confirmed on a dungeon sample –
    /// kept raw for now.
    CombatantInfo {
        guid: String,
        fields: Vec<String>,
    },
    Damage {
        source_kind: DamageSource,
        /// `None` for swings and environmental damage.
        spell: Option<Spell>,
        /// `Falling`, `Drowning`, `Fire`, `Lava`, `Slime`, `Fatigue` for environmental damage.
        environment: Option<String>,
        advanced: Option<Box<Advanced>>,
        damage: Damage,
    },
    Missed {
        source_kind: DamageSource,
        spell: Option<Spell>,
        miss: Miss,
    },
    Heal {
        spell: Spell,
        periodic: bool,
        advanced: Option<Box<Advanced>>,
        heal: Heal,
    },
    /// Damage prevented by a shield. `spell` is the attack (`None` for melee).
    Absorbed {
        spell: Option<Spell>,
        absorber: Unit,
        absorb_spell: Spell,
        amount: i64,
        critical: bool,
    },
    Energize {
        spell: Spell,
        periodic: bool,
        advanced: Option<Box<Advanced>>,
        amount: f64,
        over: f64,
        power_type: i64,
        max_power: i64,
    },
    Aura {
        spell: Spell,
        change: AuraChange,
        aura_type: AuraType,
        /// Stack count for `*_DOSE` events.
        stacks: Option<i64>,
        /// The breaking spell for `SPELL_AURA_BROKEN_SPELL`.
        broken_by: Option<Spell>,
    },
    Cast {
        spell: Spell,
        phase: CastPhase,
        advanced: Option<Box<Advanced>>,
        failed_reason: Option<String>,
    },
    Interrupt {
        spell: Spell,
        interrupted: Spell,
    },
    Dispel {
        spell: Spell,
        removed: Spell,
        aura_type: AuraType,
        stolen: bool,
    },
    Summon {
        spell: Spell,
    },
    Resurrect {
        spell: Spell,
    },
    Instakill {
        spell: Option<Spell>,
    },
    ExtraAttacks {
        spell: Spell,
        amount: i64,
    },
    Died {
        death: DeathKind,
        unconscious: bool,
    },
    PartyKill,
    /// Anything we do not model yet (kept so nothing is silently lost).
    Other {
        fields: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ParseError {}

fn err(msg: impl Into<String>) -> ParseError {
    ParseError { message: msg.into() }
}

/// Cursor over the split fields of one line.
struct Cur<'a> {
    f: Vec<&'a str>,
    i: usize,
}

impl<'a> Cur<'a> {
    fn remaining(&self) -> usize {
        self.f.len().saturating_sub(self.i)
    }
    fn peek(&self) -> Option<&'a str> {
        self.f.get(self.i).copied()
    }
    fn raw(&mut self) -> Result<&'a str, ParseError> {
        let v = self
            .f
            .get(self.i)
            .copied()
            .ok_or_else(|| err(format!("missing field #{}", self.i)))?;
        self.i += 1;
        Ok(v)
    }
    fn text(&mut self) -> Result<String, ParseError> {
        Ok(fields::text(self.raw()?).unwrap_or_default())
    }
    fn opt_text(&mut self) -> Result<Option<String>, ParseError> {
        Ok(fields::text(self.raw()?))
    }
    fn int(&mut self) -> Result<i64, ParseError> {
        let i = self.i;
        let r = self.raw()?;
        fields::int(r).ok_or_else(|| err(format!("field #{i}: expected integer, got {r:?}")))
    }
    fn uint(&mut self) -> Result<u32, ParseError> {
        let i = self.i;
        let v = self.int()?;
        u32::try_from(v).map_err(|_| err(format!("field #{i}: out of range {v}")))
    }
    /// Lenient integer for advanced-block values (`a|b` multi-power values → first).
    fn loose_int(&mut self) -> Result<i64, ParseError> {
        let r = self.raw()?;
        let first = r.split('|').next().unwrap_or(r);
        Ok(fields::int(first).unwrap_or(0))
    }
    fn float(&mut self) -> Result<f64, ParseError> {
        let i = self.i;
        let r = self.raw()?;
        fields::float(r).ok_or_else(|| err(format!("field #{i}: expected number, got {r:?}")))
    }
    fn flag(&mut self) -> Result<bool, ParseError> {
        Ok(fields::flag(self.raw()?))
    }
    fn hex(&mut self) -> Result<u32, ParseError> {
        let i = self.i;
        let r = self.raw()?;
        fields::hex(r).ok_or_else(|| err(format!("field #{i}: expected hex flags, got {r:?}")))
    }
    fn unit(&mut self) -> Result<Unit, ParseError> {
        Ok(Unit {
            guid: self.text()?,
            name: self.opt_text()?,
            flags: self.hex()?,
            raid_flags: self.hex()?,
        })
    }
    fn spell(&mut self) -> Result<Spell, ParseError> {
        Ok(Spell {
            id: self.uint()?,
            name: self.text()?,
            school: self.school()?,
        })
    }
    /// Spell school: hex (`0x4`) in most events, decimal (`4`) for the second spell of
    /// `SPELL_AURA_BROKEN_SPELL` (seen in Forever logs).
    fn school(&mut self) -> Result<u32, ParseError> {
        let r = self.raw()?;
        Ok(fields::hex(r)
            .or_else(|| fields::int(r).and_then(|v| u32::try_from(v).ok()))
            .unwrap_or(0))
    }
    /// Advanced block, if present at the cursor and followed by at least `suffix` fields.
    fn advanced(&mut self, suffix: usize) -> Result<Option<Box<Advanced>>, ParseError> {
        let present = self.remaining() >= Advanced::FIELDS + suffix && self.peek().is_some_and(fields::is_guid);
        if !present {
            return Ok(None);
        }
        let info_guid = self.text()?;
        let owner = self.text()?;
        let owner_guid = (owner != crate::unit::EMPTY_GUID && !owner.is_empty()).then_some(owner);
        let current_hp = self.loose_int()?;
        let max_hp = self.loose_int()?;
        let attack_power = self.loose_int()?;
        let spell_power = self.loose_int()?;
        let armor = self.loose_int()?;
        let absorb = self.loose_int()?;
        self.raw()?; // unknown, always 0 in samples
        self.raw()?; // unknown, always 0 in samples
        let power_type = self.loose_int()?;
        let current_power = self.loose_int()?;
        let max_power = self.loose_int()?;
        let power_cost = self.loose_int()?;
        let x = self.float()?;
        let y = self.float()?;
        let ui_map_id = self.loose_int()?;
        let facing = self.float()?;
        let level = self.loose_int()?;
        Ok(Some(Box::new(Advanced {
            info_guid,
            owner_guid,
            current_hp,
            max_hp,
            attack_power,
            spell_power,
            armor,
            absorb,
            power_type,
            current_power,
            max_power,
            power_cost,
            x,
            y,
            ui_map_id,
            facing,
            level,
        })))
    }
    fn damage(&mut self) -> Result<Damage, ParseError> {
        let amount = self.int()?;
        let base_amount = self.int()?;
        let overkill = self.int()?.max(0);
        let school = u32::try_from(self.int()?).unwrap_or(0);
        let resisted = self.int()?;
        let blocked = self.int()?;
        let absorbed = self.int()?;
        let critical = self.flag()?;
        let glancing = self.flag()?;
        let crushing = self.flag()?;
        let mut d = Damage {
            amount,
            base_amount,
            overkill,
            school,
            resisted,
            blocked,
            absorbed,
            critical,
            glancing,
            crushing,
            off_hand: false,
            aoe: None,
        };
        while let Some(f) = self.peek() {
            self.i += 1;
            match f {
                "ST" => d.aoe = Some(false),
                "AOE" => d.aoe = Some(true),
                other => d.off_hand |= fields::flag(other),
            }
        }
        Ok(d)
    }
    fn miss(&mut self) -> Result<Miss, ParseError> {
        let miss_type = self.text()?;
        let off_hand = match self.peek() {
            Some(_) => self.flag()?,
            None => false,
        };
        let amount = match self.peek() {
            Some(f) if f != "ST" && f != "AOE" => fields::int(f).unwrap_or(0),
            _ => 0,
        };
        Ok(Miss {
            miss_type,
            off_hand,
            amount,
        })
    }
    fn aura_type(&mut self) -> AuraType {
        match self.peek() {
            Some("BUFF") => {
                self.i += 1;
                AuraType::Buff
            }
            Some("DEBUFF") => {
                self.i += 1;
                AuraType::Debuff
            }
            Some(_) => {
                self.i += 1;
                AuraType::Unknown
            }
            None => AuraType::Unknown,
        }
    }
    fn rest(&mut self) -> Vec<String> {
        let v = self.f[self.i.min(self.f.len())..]
            .iter()
            .map(|s| s.to_string())
            .collect();
        self.i = self.f.len();
        v
    }
}

/// Splits a raw line into `(timestamp, payload)`.
fn split_line(line: &str) -> Result<(i64, &str), ParseError> {
    let line = line.trim_start_matches('\u{feff}').trim_end_matches(['\r', '\n']);
    let (ts, payload) = line
        .split_once("  ")
        .ok_or_else(|| err("missing two-space separator after timestamp"))?;
    let timestamp = time::parse(ts).ok_or_else(|| err(format!("bad timestamp {ts:?}")))?;
    Ok((timestamp, payload))
}

/// Parses one combat log line.
pub fn parse_line(line: &str) -> Result<Record, ParseError> {
    let (timestamp, payload) = split_line(line)?;
    let mut c = Cur {
        f: fields::split(payload),
        i: 0,
    };
    let event = c.raw()?.to_string();
    parse_payload(timestamp, event, &mut c).map_err(|e| err(format!("{}: {}", e.message, line.trim_end())))
}

fn has_units(event: &str) -> bool {
    !matches!(
        event,
        "COMBAT_LOG_VERSION"
            | "ZONE_CHANGE"
            | "MAP_CHANGE"
            | "ENCOUNTER_START"
            | "ENCOUNTER_END"
            | "COMBATANT_INFO"
            | "CHALLENGE_MODE_START"
            | "CHALLENGE_MODE_END"
            | "WORLD_MARKER_PLACED"
            | "WORLD_MARKER_REMOVED"
            | "EMOTE"
    )
}

fn parse_payload(timestamp: i64, event: String, c: &mut Cur) -> Result<Record, ParseError> {
    // Unknown/future events without a unit header end up in `Kind::Other` untouched.
    let (source, dest) = if has_units(&event) && c.remaining() >= 8 && c.peek().is_some_and(fields::is_guid) {
        (c.unit()?, c.unit()?)
    } else {
        (Unit::none(), Unit::none())
    };

    let kind = match event.as_str() {
        "COMBAT_LOG_VERSION" => {
            let version = c.uint()?;
            let mut advanced = false;
            let mut build = String::new();
            let mut project_id = 0;
            while let Some(key) = c.peek() {
                c.i += 1;
                match key {
                    "ADVANCED_LOG_ENABLED" => advanced = c.flag()?,
                    "BUILD_VERSION" => build = c.text()?,
                    "PROJECT_ID" => project_id = c.uint()?,
                    _ => {}
                }
            }
            Kind::CombatLogVersion {
                version,
                advanced,
                build,
                project_id,
            }
        }
        "ZONE_CHANGE" => Kind::ZoneChange {
            instance_id: c.uint()?,
            name: c.text()?,
            difficulty_id: c.uint()?,
        },
        "MAP_CHANGE" => Kind::MapChange {
            ui_map_id: c.uint()?,
            name: c.text()?,
        },
        "ENCOUNTER_START" => Kind::EncounterStart {
            encounter_id: c.uint()?,
            name: c.text()?,
            difficulty_id: c.uint()?,
            group_size: c.uint()?,
            instance_id: if c.remaining() > 0 { Some(c.uint()?) } else { None },
        },
        "ENCOUNTER_END" => Kind::EncounterEnd {
            encounter_id: c.uint()?,
            name: c.text()?,
            difficulty_id: c.uint()?,
            group_size: c.uint()?,
            success: c.flag()?,
            fight_time_ms: if c.remaining() > 0 { Some(c.int()?) } else { None },
        },
        "COMBATANT_INFO" => Kind::CombatantInfo {
            guid: c.text()?,
            fields: c.rest(),
        },

        // ---- damage ----
        "SWING_DAMAGE" | "SWING_DAMAGE_LANDED" => {
            let source_kind = if event == "SWING_DAMAGE" {
                DamageSource::Swing
            } else {
                DamageSource::SwingLanded
            };
            let advanced = c.advanced(10)?;
            Kind::Damage {
                source_kind,
                spell: None,
                environment: None,
                advanced,
                damage: c.damage()?,
            }
        }
        "ENVIRONMENTAL_DAMAGE" => {
            let advanced = c.advanced(11)?;
            let environment = c.opt_text()?;
            Kind::Damage {
                source_kind: DamageSource::Environmental,
                spell: None,
                environment,
                advanced,
                damage: c.damage()?,
            }
        }
        "SPELL_DAMAGE"
        | "SPELL_PERIODIC_DAMAGE"
        | "RANGE_DAMAGE"
        | "SPELL_BUILDING_DAMAGE"
        | "DAMAGE_SHIELD"
        | "DAMAGE_SPLIT" => {
            let source_kind = match event.as_str() {
                "SPELL_DAMAGE" => DamageSource::Spell,
                "SPELL_PERIODIC_DAMAGE" => DamageSource::Periodic,
                "RANGE_DAMAGE" => DamageSource::Range,
                "SPELL_BUILDING_DAMAGE" => DamageSource::Building,
                "DAMAGE_SHIELD" => DamageSource::Shield,
                _ => DamageSource::Split,
            };
            let spell = c.spell()?;
            let advanced = c.advanced(10)?;
            Kind::Damage {
                source_kind,
                spell: Some(spell),
                environment: None,
                advanced,
                damage: c.damage()?,
            }
        }
        "SWING_MISSED" => Kind::Missed {
            source_kind: DamageSource::Swing,
            spell: None,
            miss: c.miss()?,
        },
        "SPELL_MISSED"
        | "SPELL_PERIODIC_MISSED"
        | "RANGE_MISSED"
        | "DAMAGE_SHIELD_MISSED"
        | "SPELL_BUILDING_MISSED" => {
            let source_kind = match event.as_str() {
                "SPELL_PERIODIC_MISSED" => DamageSource::Periodic,
                "RANGE_MISSED" => DamageSource::Range,
                "DAMAGE_SHIELD_MISSED" => DamageSource::Shield,
                "SPELL_BUILDING_MISSED" => DamageSource::Building,
                _ => DamageSource::Spell,
            };
            Kind::Missed {
                source_kind,
                spell: Some(c.spell()?),
                miss: c.miss()?,
            }
        }
        "SPELL_ABSORBED" => {
            // Optional attacking spell (absent for melee), then absorber unit + shield spell.
            let spell = if c.peek().is_some_and(fields::is_guid) {
                None
            } else {
                Some(c.spell()?)
            };
            let absorber = c.unit()?;
            let absorb_spell = c.spell()?;
            let amount = c.int()?;
            // Remaining: [baseAmount,] critical – critical is always last.
            let critical = c.rest().last().is_some_and(|f| fields::flag(f));
            Kind::Absorbed {
                spell,
                absorber,
                absorb_spell,
                amount,
                critical,
            }
        }

        // ---- healing / resources ----
        "SPELL_HEAL" | "SPELL_PERIODIC_HEAL" => {
            let spell = c.spell()?;
            let advanced = c.advanced(5)?;
            let heal = Heal {
                amount: c.int()?,
                base_amount: c.int()?,
                overheal: c.int()?,
                absorbed: c.int()?,
                critical: c.remaining() > 0 && c.flag()?,
            };
            Kind::Heal {
                spell,
                periodic: event == "SPELL_PERIODIC_HEAL",
                advanced,
                heal,
            }
        }
        "SPELL_ENERGIZE" | "SPELL_PERIODIC_ENERGIZE" => {
            let spell = c.spell()?;
            let advanced = c.advanced(4)?;
            Kind::Energize {
                spell,
                periodic: event == "SPELL_PERIODIC_ENERGIZE",
                advanced,
                amount: c.float()?,
                over: c.float()?,
                power_type: c.int()?,
                max_power: if c.remaining() > 0 { c.int()? } else { 0 },
            }
        }

        // ---- auras ----
        "SPELL_AURA_APPLIED"
        | "SPELL_AURA_REMOVED"
        | "SPELL_AURA_REFRESH"
        | "SPELL_AURA_APPLIED_DOSE"
        | "SPELL_AURA_REMOVED_DOSE"
        | "SPELL_AURA_BROKEN"
        | "SPELL_AURA_BROKEN_SPELL" => {
            let change = match event.as_str() {
                "SPELL_AURA_APPLIED" => AuraChange::Applied,
                "SPELL_AURA_REMOVED" => AuraChange::Removed,
                "SPELL_AURA_REFRESH" => AuraChange::Refresh,
                "SPELL_AURA_APPLIED_DOSE" => AuraChange::AppliedDose,
                "SPELL_AURA_REMOVED_DOSE" => AuraChange::RemovedDose,
                "SPELL_AURA_BROKEN" => AuraChange::Broken,
                _ => AuraChange::BrokenSpell,
            };
            let spell = c.spell()?;
            let broken_by = if change == AuraChange::BrokenSpell {
                Some(c.spell()?)
            } else {
                None
            };
            let aura_type = c.aura_type();
            let stacks = match change {
                AuraChange::AppliedDose | AuraChange::RemovedDose if c.remaining() > 0 => Some(c.int()?),
                _ => None,
            };
            Kind::Aura {
                spell,
                change,
                aura_type,
                stacks,
                broken_by,
            }
        }

        // ---- casts ----
        "SPELL_CAST_START" | "SPELL_CAST_SUCCESS" | "SPELL_CAST_FAILED" => {
            let spell = c.spell()?;
            match event.as_str() {
                "SPELL_CAST_FAILED" => Kind::Cast {
                    spell,
                    phase: CastPhase::Failed,
                    advanced: None,
                    failed_reason: if c.remaining() > 0 { c.opt_text()? } else { None },
                },
                "SPELL_CAST_START" => Kind::Cast {
                    spell,
                    phase: CastPhase::Start,
                    advanced: c.advanced(0)?,
                    failed_reason: None,
                },
                _ => Kind::Cast {
                    spell,
                    phase: CastPhase::Success,
                    advanced: c.advanced(0)?,
                    failed_reason: None,
                },
            }
        }
        "SPELL_INTERRUPT" => Kind::Interrupt {
            spell: c.spell()?,
            interrupted: c.spell()?,
        },
        "SPELL_DISPEL" | "SPELL_STOLEN" => Kind::Dispel {
            spell: c.spell()?,
            removed: c.spell()?,
            aura_type: c.aura_type(),
            stolen: event == "SPELL_STOLEN",
        },
        "SPELL_SUMMON" => Kind::Summon { spell: c.spell()? },
        "SPELL_RESURRECT" => Kind::Resurrect { spell: c.spell()? },
        "SPELL_INSTAKILL" => Kind::Instakill {
            spell: if c.remaining() >= 3 { Some(c.spell()?) } else { None },
        },
        "SPELL_EXTRA_ATTACKS" => Kind::ExtraAttacks {
            spell: c.spell()?,
            amount: c.int()?,
        },

        // ---- deaths ----
        "UNIT_DIED" | "UNIT_DESTROYED" | "UNIT_DISSIPATES" => Kind::Died {
            death: match event.as_str() {
                "UNIT_DIED" => DeathKind::Died,
                "UNIT_DESTROYED" => DeathKind::Destroyed,
                _ => DeathKind::Dissipates,
            },
            unconscious: c.remaining() > 0 && c.flag()?,
        },
        "PARTY_KILL" => Kind::PartyKill,

        _ => Kind::Other { fields: c.rest() },
    };

    Ok(Record {
        timestamp,
        event,
        source,
        dest,
        kind,
    })
}
