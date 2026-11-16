//! What leaves the PC: the compact run summary (JSON, camelCase) sent to
//! `POST /companion/runs`. Only group (mine/party/raid) players appear in it;
//! other players are anonymised as `"Stranger"`.
//!
//! All `*_ms` offsets inside a run are relative to `started_at`.

use serde::{Deserialize, Serialize};

/// 1 = C2–C5, 2 = + `loot` (chat log), 3 = + `records` per player (biggest crit, hit, heal …),
/// 4 = + per-boss breakdown (spells with casts/min/max, targets, ilvl), casts and gear per player.
/// Everything new is optional, so older servers/readers keep working.
pub const SCHEMA_VERSION: u32 = 4;

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
    /// What the recorder gained during the run (from `/chatlog`: XP, money, reputation, skill-ups,
    /// levels). Only the recorder – the chat log says nothing about the others' gains.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<RunProgress>,
    /// Where the party stood, every `bucket_ms` (advanced log x/y/uiMapID) – the portal's replay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replay: Option<Replay>,
}

/// Positions for the replay map. World coordinates in tenths of a yard: `x` grows to the north,
/// `y` to the west (the map draws east to the right: screen x = -y, screen y = -x).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Replay {
    pub bucket_ms: i64,
    pub players: Vec<ReplayTrack>,
}

/// One player's path: parallel arrays, `t` = bucket index from the run start (increasing).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayTrack {
    pub slug: String,
    pub t: Vec<u32>,
    pub x: Vec<i32>,
    pub y: Vec<i32>,
    /// uiMapID per point (dungeons with several floors switch maps)
    pub map: Vec<u32>,
}

impl Replay {
    /// Most points kept per player (a 2 h run at 2 s).
    pub const MAX_POINTS: usize = 3600;

    /// Keeps every other point (twice the bucket) – for runs that are too big to upload.
    pub fn coarsen(&mut self) {
        self.bucket_ms *= 2;
        for p in &mut self.players {
            let keep: Vec<usize> = (0..p.t.len())
                .filter(|&i| i == 0 || p.t[i] / 2 != p.t[i - 1] / 2)
                .collect();
            p.t = keep.iter().map(|&i| p.t[i] / 2).collect();
            p.x = keep.iter().map(|&i| p.x[i]).collect();
            p.y = keep.iter().map(|&i| p.y[i]).collect();
            p.map = keep.iter().map(|&i| p.map[i]).collect();
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProgress {
    /// All experience (kills, quests, discoveries); `xp_bonus` of it was the group bonus.
    pub xp: u64,
    pub xp_bonus: u64,
    /// Looted coins plus the share of party money, in copper.
    pub copper: u64,
    pub reputation: Vec<RepGain>,
    pub skills: Vec<SkillUp>,
    /// Levels reached during the run.
    pub levels: Vec<u32>,
    /// The recorder's failed casts by kind (`SPELL_CAST_FAILED` is logged only for the log owner).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cast_fails: Option<CastFails>,
}

/// Failed casts sorted into what they say about the player (see `fail_kind`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastFails {
    pub total: u32,
    /// "Not yet recovered", "Another action is in progress" … – pressing before it is ready.
    pub spam: u32,
    /// "No target", "Invalid target", "Your target is dead" – casting at nothing.
    pub targeting: u32,
    /// "Out of range", "Target needs to be in front of you.", "not in line of sight".
    pub range: u32,
    /// "Not enough mana/rage/energy".
    pub resources: u32,
    /// "Interrupted", "Can't do that while moving".
    pub interrupted: u32,
    /// "Can't do that while stunned/silenced/asleep …".
    pub control: u32,
    pub other: u32,
    /// The most common reasons as the game wrote them.
    pub reasons: Vec<NamedCount>,
}

/// Which kind of failure a `SPELL_CAST_FAILED` reason is (real Forever reasons, 15. 11. 2026).
pub fn fail_kind(reason: &str) -> &'static str {
    let r = reason.to_ascii_lowercase();
    if r.contains("not yet recovered")
        || r.contains("another action is in progress")
        || r.contains("not ready yet")
        || r.contains("busy")
    {
        "spam"
    } else if r.contains("no target")
        || r.contains("invalid target")
        || r.contains("target is dead")
        || r.contains("not a valid target")
    {
        "targeting"
    } else if r.contains("out of range")
        || r.contains("in front of you")
        || r.contains("line of sight")
        || r.contains("too close")
        || r.contains("facing the wrong way")
    {
        "range"
    } else if r.starts_with("not enough") {
        "resources"
    } else if r.contains("interrupted") || r.contains("while moving") {
        "interrupted"
    } else if r.starts_with("can't do that while") || r.contains("you are dead") {
        "control"
    } else {
        "other"
    }
}

impl CastFails {
    pub fn from_reasons(reasons: &[NamedCount]) -> CastFails {
        let mut f = CastFails::default();
        for r in reasons {
            f.total += r.count;
            match fail_kind(&r.name) {
                "spam" => f.spam += r.count,
                "targeting" => f.targeting += r.count,
                "range" => f.range += r.count,
                "resources" => f.resources += r.count,
                "interrupted" => f.interrupted += r.count,
                "control" => f.control += r.count,
                _ => f.other += r.count,
            }
        }
        f.reasons = reasons.iter().take(8).cloned().collect();
        f
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepGain {
    pub faction: String,
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUp {
    pub skill: String,
    /// Value before the run's first increase.
    pub from: u32,
    pub to: u32,
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
    /// Successful casts per spell (schema 4) – also spells that do no damage (buffs, CC, cooldowns).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub casts: Vec<CastStat>,
    /// Equipped items at the last boss pull (`COMBATANT_INFO`, schema 4).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub gear: Vec<GearItem>,
    /// Everything grouped like the game's Combat Log Config ("My actions" / "What happened to me?").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combat: Option<CombatLogStats>,
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
    /// Successful casts of this spell (schema 4; 0 for melee, procs and DoT ticks).
    #[serde(default)]
    pub casts: u32,
    /// Smallest / biggest single hit or heal (schema 4).
    #[serde(default)]
    pub min: i64,
    #[serde(default)]
    pub max: i64,
    /// Overhealing of a heal (schema 4; 0 for damage).
    #[serde(default)]
    pub overheal: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastStat {
    pub id: u32,
    pub name: String,
    pub count: u32,
    pub pet: bool,
}

/// Damage done to one enemy (by name; group members never appear as targets).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetStat {
    pub name: String,
    pub amount: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GearItem {
    pub item_id: u32,
    pub ilvl: u32,
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
    /// Equipped item level during the fight (advanced-log `level`, schema 4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ilvl: Option<i64>,
    #[serde(default)]
    pub active_ms: i64,
    #[serde(default)]
    pub interrupts: u32,
    #[serde(default)]
    pub dispels: u32,
    #[serde(default)]
    pub deaths: u32,
    /// Boss fights only (schema 4): damage spells, heals, casts, targets.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spells: Vec<SpellStat>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub heals: Vec<SpellStat>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub casts: Vec<CastStat>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<TargetStat>,
    /// Boss fights only: auras on the player, and debuffs the player kept on enemies (uptime).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub buffs: Vec<AuraStat>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub debuffs: Vec<AuraStat>,
    /// Boss fights only: the fight in `bucket_ms` steps (for a per-boss graph).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline: Option<BossTimeline>,
    /// Boss fights only: the fight grouped like the game's Combat Log Config.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combat: Option<CombatLogStats>,
}

/// One kind of hit (Melee, Ranged, Spells, Periodic – the game's Combat Log Config categories).
/// For "what happened to me" `misses` are attacks against the player that missed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitPart {
    pub amount: i64,
    pub hits: u32,
    pub crits: u32,
    pub misses: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedCount {
    pub name: String,
    pub count: u32,
}

/// "My actions" – what the player did.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyActions {
    pub melee: HitPart,
    pub ranged: HitPart,
    pub spells: HitPart,
    pub periodic: HitPart,
    pub heals: i64,
    pub periodic_heals: i64,
    pub power_gains: i64,
    pub drains: u32,
    pub interrupts: u32,
    pub extra_attacks: u32,
    pub summons: u32,
    pub resurrections: u32,
    pub dispels: u32,
    pub casts_started: u32,
    pub casts: u32,
    pub casts_failed: u32,
    /// Why casts failed ("Not enough mana", "Out of range" …), most common first.
    pub fail_reasons: Vec<NamedCount>,
    pub kills: u32,
    pub damage_shields: i64,
    /// The player's misses by type (MISS, DODGE, PARRY, RESIST …).
    pub misses: Vec<NamedCount>,
}

/// "What happened to me?" – what was done to the player.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoneToMe {
    pub melee: HitPart,
    pub ranged: HitPart,
    pub spells: HitPart,
    pub periodic: HitPart,
    pub environmental: i64,
    pub heals_received: i64,
    pub deaths: u32,
    /// Attacks the player avoided, by type (DODGE, PARRY, MISS, BLOCK, RESIST …).
    pub avoided: Vec<NamedCount>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombatLogStats {
    pub mine: MyActions,
    pub me: DoneToMe,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BossTimeline {
    pub bucket_ms: i64,
    pub damage: Vec<i64>,
    pub healing: Vec<i64>,
    pub taken: Vec<i64>,
}

/// How long an aura was up during a fight (for debuffs: on at least one enemy).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuraStat {
    pub id: u32,
    pub name: String,
    pub uptime_ms: i64,
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
        // the replay is the most expendable: coarser first, then gone
        while self.json_len() > max_bytes
            && let Some(r) = self.replay.as_mut()
        {
            if r.bucket_ms >= 16_000 {
                self.replay = None;
            } else {
                r.coarsen();
            }
            changed = true;
        }
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
                p.casts.truncate(10);
            }
            for sp in self.segments.iter_mut().flat_map(|s| s.players.iter_mut()) {
                sp.spells.truncate(10);
                sp.heals.truncate(10);
                sp.casts.truncate(10);
                sp.targets.truncate(5);
                sp.buffs.truncate(5);
                sp.debuffs.truncate(5);
                sp.timeline = None;
                sp.combat = None;
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
            progress: None,
            replay: None,
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

#[cfg(test)]
mod fail_tests {
    use super::*;

    #[test]
    fn real_forever_reasons_sort_into_kinds() {
        for (reason, kind) in [
            ("Not yet recovered", "spam"),
            ("Another action is in progress", "spam"),
            ("You are busy looting", "spam"),
            ("Item is not ready yet", "spam"),
            ("No target", "targeting"),
            ("Invalid target", "targeting"),
            ("Your target is dead", "targeting"),
            ("That item is not a valid target.", "targeting"),
            ("Out of range", "range"),
            ("Target needs to be in front of you.", "range"),
            ("Target not in line of sight", "range"),
            ("Not enough mana", "resources"),
            ("Interrupted", "interrupted"),
            ("Can't do that while moving", "interrupted"),
            ("Can't do that while asleep", "control"),
            ("Can't do that while stunned", "control"),
            ("You are in combat", "other"),
        ] {
            assert_eq!(fail_kind(reason), kind, "{reason}");
        }
        let f = CastFails::from_reasons(&[
            NamedCount {
                name: "Not yet recovered".into(),
                count: 176,
            },
            NamedCount {
                name: "No target".into(),
                count: 74,
            },
            NamedCount {
                name: "Not enough mana".into(),
                count: 3,
            },
        ]);
        assert_eq!((f.total, f.spam, f.targeting, f.resources), (253, 176, 74, 3));
    }
}
