//! Personal records of the player who writes the log – from the WHOLE log, open world included
//! (dungeon runs have their own records in the run summary).
//!
//! Only the log owner's own character is tracked (`AFFILIATION_MINE` player). Other players
//! never leave the PC by this path: a player on the other end of a hit is anonymised.
//! Sent to `POST /companion/records` as [`PersonalUpload`].

use crate::analyzer::display_name;
use crate::dungeons;
use crate::summary::RecordKind;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use wowlog::unit::flags;
use wowlog::{DamageSource, Kind, Record, Unit};

pub const PERSONAL_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalRecord {
    pub kind: RecordKind,
    pub amount: i64,
    pub spell: String,
    /// 0 = melee / environment.
    pub spell_id: u32,
    /// Target (attacker for `HitTaken`); `None` for the environment.
    pub unit: Option<String>,
    /// UTC milliseconds.
    pub at: i64,
    /// Zone or dungeon name when the log said so.
    pub zone: Option<String>,
    pub in_dungeon: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalCharacter {
    /// Portal hero slug (`name-surname`).
    pub slug: String,
    pub name: String,
    pub records: Vec<PersonalRecord>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalUpload {
    pub schema: u32,
    pub characters: Vec<PersonalCharacter>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct CharAcc {
    name: String,
    records: BTreeMap<RecordKind, PersonalRecord>,
}

/// Running bests per character. Serialisable, so the app keeps them across restarts and
/// after the log files are deleted.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Personal {
    chars: BTreeMap<String, CharAcc>,
    /// Something changed since the last successful upload.
    dirty: bool,
    #[serde(skip)]
    utc_offset_ms: i64,
    /// Current zone: (name, is a dungeon).
    #[serde(skip)]
    zone: Option<(String, bool)>,
}

fn mine(u: &Unit) -> bool {
    u.is_player() && u.is_mine()
}

/// What may be said about the unit on the other end.
fn public_name(u: &Unit) -> Option<String> {
    if u.is_none() {
        return None;
    }
    if u.is_player() {
        return Some(if u.is_mine() { "themselves" } else { "Another player" }.to_string());
    }
    if u.flags & flags::CONTROL_PLAYER != 0 && !u.is_mine() {
        return Some("Someone's pet".to_string());
    }
    u.name.clone()
}

impl Personal {
    pub fn new(utc_offset_ms: i64) -> Personal {
        Personal {
            utc_offset_ms,
            ..Default::default()
        }
    }

    /// After loading saved state: the offset is not stored.
    pub fn set_utc_offset(&mut self, utc_offset_ms: i64) {
        self.utc_offset_ms = utc_offset_ms;
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn mark_clean(&mut self) {
        self.dirty = false;
    }

    pub fn is_empty(&self) -> bool {
        self.chars.values().all(|c| c.records.is_empty())
    }

    pub fn upload(&self) -> PersonalUpload {
        PersonalUpload {
            schema: PERSONAL_SCHEMA,
            characters: self
                .chars
                .iter()
                .filter(|(_, c)| !c.records.is_empty())
                .map(|(slug, c)| PersonalCharacter {
                    slug: slug.clone(),
                    name: c.name.clone(),
                    records: c.records.values().cloned().collect(),
                })
                .collect(),
        }
    }

    /// Keeps `r` for `who` when it beats the current record of its kind. `r.at` arrives as the
    /// log timestamp; zone and UTC are filled in here.
    fn record(&mut self, who: &Unit, mut r: PersonalRecord) {
        if r.amount <= 0 {
            return;
        }
        let raw = who.name.clone().unwrap_or_default();
        let slug = wowlog::player_slug(&raw);
        if slug.is_empty() {
            return;
        }
        let acc = self.chars.entry(slug).or_default();
        if acc.name.is_empty() {
            acc.name = display_name(&raw);
        }
        if acc.records.get(&r.kind).is_some_and(|old| old.amount >= r.amount) {
            return;
        }
        r.at -= self.utc_offset_ms;
        r.zone = self.zone.as_ref().map(|z| z.0.clone());
        r.in_dungeon = self.zone.as_ref().is_some_and(|z| z.1);
        acc.records.insert(r.kind, r);
        self.dirty = true;
    }

    pub fn push(&mut self, rec: &Record) {
        let ts = rec.timestamp;
        match &rec.kind {
            Kind::ZoneChange { instance_id, name, .. } => {
                self.zone = Some((name.clone(), dungeons::by_instance(*instance_id).is_some()));
            }
            // a sub-zone of the open world is a better label than the continent
            Kind::MapChange { name, .. } if !self.zone.as_ref().is_some_and(|z| z.1) => {
                self.zone = Some((name.clone(), false));
            }
            Kind::Damage {
                source_kind,
                spell,
                environment,
                damage,
                ..
            } => {
                let (id, name) = match spell {
                    Some(s) => (s.id, s.name.clone()),
                    None => (
                        0,
                        match source_kind {
                            DamageSource::Environmental => environment.clone().unwrap_or_else(|| "Environment".into()),
                            _ => "Melee".to_string(),
                        },
                    ),
                };
                if mine(&rec.source) && rec.source.guid != rec.dest.guid {
                    let kind = if damage.critical {
                        RecordKind::Crit
                    } else {
                        RecordKind::Hit
                    };
                    self.record(
                        &rec.source,
                        PersonalRecord {
                            kind,
                            amount: damage.amount,
                            spell: name.clone(),
                            spell_id: id,
                            unit: public_name(&rec.dest),
                            at: ts,
                            zone: None,
                            in_dungeon: false,
                        },
                    );
                }
                if mine(&rec.dest) {
                    let from = if rec.source.guid == rec.dest.guid {
                        None
                    } else {
                        public_name(&rec.source)
                    };
                    self.record(
                        &rec.dest,
                        PersonalRecord {
                            kind: RecordKind::HitTaken,
                            amount: damage.amount,
                            spell: name.clone(),
                            spell_id: id,
                            unit: from,
                            at: ts,
                            zone: None,
                            in_dungeon: false,
                        },
                    );
                }
            }
            Kind::Heal { spell, heal, .. } if mine(&rec.source) => {
                let kind = if heal.critical {
                    RecordKind::CritHeal
                } else {
                    RecordKind::Heal
                };
                let effective = heal.amount - heal.overheal;
                self.record(
                    &rec.source,
                    PersonalRecord {
                        kind,
                        amount: effective,
                        spell: spell.name.clone(),
                        spell_id: spell.id,
                        unit: public_name(&rec.dest),
                        at: ts,
                        zone: None,
                        in_dungeon: false,
                    },
                );
            }
            _ => {}
        }
    }
}
