//! What leaves the PC: the compact run summary (JSON, camelCase) sent to
//! `POST /companion/runs`. Only group (mine/party/raid) players appear in it;
//! other players are anonymised as `"Stranger"`.
//!
//! All `*_ms` offsets inside a run are relative to `started_at`.

use serde::{Deserialize, Serialize};

/// 1 = C2–C5, 2 = + `loot` (chat log), 3 = + `records` per player (biggest crit, hit, heal …).
pub const SCHEMA_VERSION: u32 = 3;

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
    /// Items looted during the run (from `/chatlog`; empty when the chat log is off).
    #[serde(default)]
    pub loot: Vec<LootDrop>,
    /// Party leader (`Name Surname`). The combat log does not know it; the Companion fills it
    /// in from the WowCompany addon's export when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leader: Option<String>,
    /// Need/greed rolls (from `/chatlog`), party members only. Empty when nobody rolled.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rolls: Vec<LootRoll>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RollChoice {
    Need,
    Greed,
    Pass,
}

/// One item the party rolled for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LootRoll {
    pub item: String,
    /// From the matching loot entry (chat log link or the addon), when known.
    pub item_id: Option<u32>,
    pub quality: Option<u8>,
    pub at_ms: i64,
    /// Slug of the party member who won; `None` = everyone passed (or a stranger won).
    pub winner: Option<String>,
    pub entries: Vec<RollEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollEntry {
    pub slug: String,
    pub name: String,
    pub choice: RollChoice,
    /// 1–100, `None` for a pass (or when the roll line was missing).
    pub roll: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LootDrop {
    /// Party member's slug when the chat name could be matched, else `None`.
    pub slug: Option<String>,
    /// Name as shown (party display name, or the raw chat name).
    pub looter: String,
    pub item: String,
    pub item_id: Option<u32>,
    /// 0 poor … 5 legendary (from the item link colour), `None` if unknown.
    pub quality: Option<u8>,
    pub count: u32,
    pub at_ms: i64,
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
    /// Last value of the advanced-log `level` field. For players this is the **equipped item level**
    /// (same number as Blizzard's `equipped_item_level`), not the character level – verified 15. 11. 2026.
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
    /// Biggest single events of the run, at most one per kind (schema 3).
    #[serde(default)]
    pub records: Vec<RunRecord>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecordKind {
    /// Biggest critical damage hit dealt.
    Crit,
    /// Biggest non-critical damage hit dealt.
    Hit,
    /// Biggest critical heal (effective).
    CritHeal,
    /// Biggest non-critical heal (effective).
    Heal,
    /// Biggest single hit taken.
    HitTaken,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub kind: RecordKind,
    pub amount: i64,
    pub spell: String,
    /// 0 = melee / environment.
    pub spell_id: u32,
    /// The other side: target for dealt damage / healing, attacker for `HitTaken`
    /// (non-group players are anonymised).
    pub unit: Option<String>,
    pub at_ms: i64,
    /// True when the player's pet did it.
    pub pet: bool,
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

impl RunSummary {
    /// Copies item id and quality from the loot list to the rolls (the winner's loot line
    /// carries them once the chat link or the addon told us).
    pub fn link_rolls_to_loot(&mut self) {
        for r in &mut self.rolls {
            if r.item_id.is_some() && r.quality.is_some() {
                continue;
            }
            let hit = self
                .loot
                .iter()
                .filter(|l| l.item == r.item && (l.at_ms - r.at_ms).abs() <= 5 * 60_000)
                .min_by_key(|l| (l.slug != r.winner, (l.at_ms - r.at_ms).abs()));
            if let Some(l) = hit {
                r.item_id = r.item_id.or(l.item_id);
                r.quality = r.quality.or(l.quality);
            }
        }
    }
}

/// Largest run JSON we send: Convex stores the analysis in one document (limit 1 MiB).
pub const MAX_RUN_BYTES: usize = 800 * 1024;

impl RunSummary {
    fn json_len(&self) -> usize {
        serde_json::to_vec(self).map_or(0, |v| v.len())
    }

    /// Shrinks the run until its JSON fits in `max_bytes`, giving up the least useful detail
    /// first: a coarser timeline, then shorter death recaps, then fewer spells per player, then
    /// grey (poor) loot. Nothing is dropped from a run that already fits. Returns whether it changed.
    pub fn fit_size(&mut self, max_bytes: usize) -> bool {
        let mut changed = false;
        while self.json_len() > max_bytes && self.timeline.bucket_ms < 10 * 60_000 && !self.timeline.players.is_empty()
        {
            self.timeline.coarsen();
            changed = true;
        }
        if self.json_len() > max_bytes {
            for d in &mut self.deaths {
                let extra = d.recap.len().saturating_sub(10);
                d.recap.drain(..extra);
            }
            changed = true;
        }
        if self.json_len() > max_bytes {
            for p in &mut self.players {
                p.top_damage.truncate(10);
                p.top_healing.truncate(10);
            }
        }
        if self.json_len() > max_bytes {
            self.loot.retain(|l| l.quality != Some(0));
        }
        changed
    }
}

impl Timeline {
    /// Doubles the bucket size (pairs of buckets are added together).
    pub fn coarsen(&mut self) {
        let pairs = |v: &[i64]| v.chunks(2).map(|c| c.iter().sum()).collect::<Vec<i64>>();
        self.bucket_ms *= 2;
        for p in &mut self.players {
            p.damage = pairs(&p.damage);
            p.healing = pairs(&p.healing);
            p.taken = pairs(&p.taken);
        }
    }
}

#[cfg(test)]
mod size_tests {
    use super::*;

    fn big_run() -> RunSummary {
        let n = 6 * 360; // 6 h of 10 s buckets
        RunSummary {
            schema: SCHEMA_VERSION,
            run_key: "0123456789abcdef".into(),
            zone: Zone {
                instance_id: 230,
                name: "Blackrock Depths".into(),
                difficulty_id: 1,
                instance_uid: Some(1),
            },
            started_at: 0,
            ended_at: 6 * 3_600_000,
            duration_ms: 6 * 3_600_000,
            end_reason: EndReason::LeftInstance,
            result: RunResult {
                bosses_killed: 1,
                bosses_total: None,
                wipes: 0,
                cleared: false,
            },
            recorder: None,
            players: vec![],
            segments: vec![],
            deaths: vec![],
            timeline: Timeline {
                bucket_ms: 10_000,
                players: (0..5)
                    .map(|i| PlayerTimeline {
                        slug: format!("hero-{i}"),
                        damage: vec![123_456; n],
                        healing: vec![65_432; n],
                        taken: vec![98_765; n],
                    })
                    .collect(),
            },
            rolls: vec![],
            loot: (0..2000)
                .map(|i| LootDrop {
                    slug: Some("hero-0".into()),
                    looter: "Hero Zero".into(),
                    item: format!("Some Rather Long Item Name of the Whale {i}"),
                    item_id: Some(i),
                    quality: Some((i % 3) as u8),
                    count: 1,
                    at_ms: i as i64 * 1000,
                })
                .collect(),
            leader: None,
        }
    }

    #[test]
    fn small_run_is_left_alone() {
        let mut r = big_run();
        let before = r.clone();
        assert!(!r.fit_size(usize::MAX));
        assert_eq!(r, before);
    }

    #[test]
    fn big_run_shrinks_timeline_first_and_keeps_totals() {
        let mut r = big_run();
        let total: i64 = r.timeline.players[0].damage.iter().sum();
        let green = r.loot.iter().filter(|l| l.quality == Some(2)).count();
        assert!(r.fit_size(200 * 1024));
        assert!(r.json_len() <= 200 * 1024, "{}", r.json_len());
        assert!(r.timeline.bucket_ms > 10_000);
        assert_eq!(r.timeline.players[0].damage.iter().sum::<i64>(), total);
        // only grey loot may go, never the good stuff
        assert!(r.loot.iter().all(|l| l.quality != Some(0)));
        assert_eq!(r.loot.iter().filter(|l| l.quality == Some(2)).count(), green);
    }
}
