//! What leaves the PC: the compact run summary (JSON, camelCase) sent to
//! `POST /companion/runs`. Only group (mine/party/raid) players appear in it;
//! other players are anonymised as `"Stranger"`.
//!
//! All `*_ms` offsets inside a run are relative to `started_at`.

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub schema: u32,
    /// Stable id of the run (same for every recorder of the same instance copy) – see `detector::run_key`.
    pub run_key: String,
    pub zone: Zone,
    /// UTC milliseconds (log local time minus the configured UTC offset).
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub end_reason: EndReason,
    pub result: RunResult,
    /// Slug of the player who recorded the log.
    pub recorder: Option<String>,
    pub players: Vec<PlayerSummary>,
    pub segments: Vec<Segment>,
    pub deaths: Vec<Death>,
    pub timeline: Timeline,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Zone {
    pub instance_id: u32,
    pub name: String,
    pub difficulty_id: u32,
    /// Instance copy id from creature GUIDs (`Creature-0-server-instance-<uid>-npc-spawn`).
    pub instance_uid: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EndReason {
    /// Left the instance and did not come back within the grace period.
    LeftInstance,
    /// Entered a different dungeon.
    NewInstance,
    /// Re-entered the same dungeon, but it was a fresh copy (instance reset).
    InstanceReset,
    /// No group combat for `inactivity_ms`.
    Inactivity,
    /// The log ended (file closed / app stopped).
    EndOfLog,
    /// "End run" button.
    Manual,
    /// Live snapshot of a run that is still going.
    InProgress,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub bosses_killed: u32,
    pub bosses_total: Option<u32>,
    pub wipes: u32,
    pub cleared: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSummary {
    pub guid: String,
    /// `Name Surname` (realm/region suffix removed).
    pub name: String,
    /// Portal hero slug (`name-surname`).
    pub slug: String,
    pub recorder: bool,
    /// Last value of the advanced-log `level` field (probably item level for players – unverified).
    pub level: Option<i64>,
    pub damage: i64,
    pub healing: i64,
    pub overheal: i64,
    /// Damage prevented by this player's shields.
    pub shielding: i64,
    pub damage_taken: i64,
    pub environmental_taken: i64,
    pub deaths: u32,
    pub interrupts: u32,
    pub dispels: u32,
    /// Time spent doing something (gaps ≤ 3.5 s between own actions).
    pub active_ms: i64,
    /// Damage per second over the whole run.
    pub dps: f64,
    /// Effective healing per second over the whole run.
    pub hps: f64,
    /// Crit rate of damage hits, 0–100.
    pub crit_pct: f64,
    pub top_damage: Vec<SpellStat>,
    pub top_healing: Vec<SpellStat>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellStat {
    pub id: u32,
    pub name: String,
    pub amount: i64,
    pub hits: u32,
    pub crits: u32,
    /// True when the spell came from the player's pet/guardian.
    pub pet: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SegmentKind {
    Boss,
    Trash,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SegmentResult {
    Kill,
    Wipe,
    /// Trash, or a boss fight cut off by the end of the run.
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub kind: SegmentKind,
    pub name: String,
    pub encounter_id: Option<u32>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub result: SegmentResult,
    pub players: Vec<SegmentPlayer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentPlayer {
    pub slug: String,
    pub damage: i64,
    pub healing: i64,
    pub damage_taken: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Death {
    pub slug: String,
    pub at_ms: i64,
    pub killer: Option<String>,
    pub killing_blow: Option<String>,
    /// Oldest first; `at_ms` relative to the death (≤ 0).
    pub recap: Vec<RecapEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapEntry {
    pub at_ms: i64,
    pub source: Option<String>,
    pub spell: Option<String>,
    /// Negative = damage taken, positive = healing received.
    pub amount: i64,
    pub overkill: i64,
    /// HP after the event when the advanced block describes the dead player.
    pub hp: Option<i64>,
    pub max_hp: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub bucket_ms: i64,
    pub players: Vec<PlayerTimeline>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerTimeline {
    pub slug: String,
    pub damage: Vec<i64>,
    pub healing: Vec<i64>,
    pub taken: Vec<i64>,
}
