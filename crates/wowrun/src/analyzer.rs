//! Accumulates one dungeon run from parsed records and produces a [`RunSummary`].

use crate::summary::*;
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use wowlog::unit::flags;
use wowlog::{DamageSource, Kind, Record, Unit};

/// Tunables shared by the detector and the analyzer.
#[derive(Debug, Clone)]
pub struct Config {
    /// Minimum number of group *players* (incl. the recorder) for a run to count.
    pub min_players: usize,
    /// End the run after this long without group combat (inside the instance).
    pub inactivity_ms: i64,
    /// After leaving the instance (e.g. corpse run) the run continues if the group
    /// re-enters the same dungeon within this time.
    pub rejoin_grace_ms: i64,
    /// Local time of the log minus this = UTC. Supplied by the app (`+60 min` = CET).
    pub utc_offset_ms: i64,
    pub bucket_ms: i64,
    pub recap_len: usize,
    pub top_spells: usize,
    /// `SWING_DAMAGE_LANDED` within this window after an identical `SWING_DAMAGE` is a duplicate.
    pub swing_dedupe_ms: i64,
    /// Max gap between a player's own actions that still counts as "active".
    pub active_gap_ms: i64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            min_players: 2,
            inactivity_ms: 10 * 60_000,
            rejoin_grace_ms: 15 * 60_000,
            utc_offset_ms: 0,
            bucket_ms: 10_000,
            recap_len: 20,
            top_spells: 25,
            swing_dedupe_ms: 500,
            active_gap_ms: 3_500,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ZoneInfo {
    pub instance_id: u32,
    pub name: String,
    pub difficulty_id: u32,
    pub boss_count: Option<u32>,
}

/// `Name-Surname-PvP-EU` → `Name Surname`.
pub fn display_name(name: &str) -> String {
    let parts: Vec<&str> = name.split('-').collect();
    let region = |s: &str| s.len() == 2 && s.bytes().all(|b| b.is_ascii_uppercase());
    let core = if parts.len() >= 3 && region(parts[parts.len() - 1]) {
        &parts[..parts.len() - 2]
    } else {
        &parts[..]
    };
    core.join(" ")
}

/// Instance copy id from a creature GUID: `Creature-0-<server>-<instance>-<uid>-<npc>-<spawn>`.
/// Instance copy id (5th GUID part) of an NPC that lives on map `instance_id` (4th part).
/// NPCs from other maps are ignored: e.g. "Herald of Thrall" in Orgrimmar (map 1) puts a world
/// buff on players inside the dungeon (seen in a real Wailing Caverns log, 15. 11. 2026).
pub fn creature_uid(u: &Unit, instance_id: u32) -> Option<u32> {
    if !(u.guid.starts_with("Creature-") || u.guid.starts_with("Vehicle-")) {
        return None;
    }
    let mut parts = u.guid.split('-');
    let map: u32 = parts.nth(3)?.parse().ok()?;
    if map != instance_id {
        return None;
    }
    parts.next()?.parse().ok().filter(|&v| v != 0)
}

#[derive(Debug, Clone, Default)]
struct SpellAcc {
    name: String,
    amount: i64,
    hits: u32,
    crits: u32,
    min: i64,
    max: i64,
    overheal: i64,
}

impl SpellAcc {
    fn named(name: &str) -> Self {
        SpellAcc {
            name: name.to_string(),
            ..Default::default()
        }
    }
    fn add(&mut self, amount: i64, crit: bool) {
        self.amount += amount;
        self.hits += 1;
        self.crits += crit as u32;
        if self.hits == 1 || amount < self.min {
            self.min = amount;
        }
        self.max = self.max.max(amount);
    }
}

/// Spells keyed by (spell id, done by the pet).
type SpellMap = HashMap<(u32, bool), SpellAcc>;
/// Casts keyed by (spell id, done by the pet) → (name, count).
type CastMap = HashMap<(u32, bool), (String, u32)>;

/// One group player in one segment.
#[derive(Debug, Clone, Default)]
struct SegPlayerAcc {
    damage: i64,
    healing: i64,
    taken: i64,
    level: Option<i64>,
    active_ms: i64,
    interrupts: u32,
    dispels: u32,
    deaths: u32,
    dmg_spells: SpellMap,
    heal_spells: SpellMap,
    casts: CastMap,
    targets: HashMap<String, i64>,
}

#[derive(Debug, Clone)]
struct RecapRaw {
    ts: i64,
    source: Option<String>,
    spell: Option<String>,
    amount: i64,
    overkill: i64,
    hp: Option<i64>,
    max_hp: Option<i64>,
}

#[derive(Debug, Clone, Default)]
struct PlayerAcc {
    name: String,
    slug: String,
    mine: bool,
    level: Option<i64>,
    damage: i64,
    healing: i64,
    overheal: i64,
    shielding: i64,
    taken: i64,
    env_taken: i64,
    deaths: u32,
    interrupts: u32,
    dispels: u32,
    active_ms: i64,
    last_action: Option<i64>,
    hits: u32,
    crits: u32,
    dmg_spells: SpellMap,
    heal_spells: SpellMap,
    casts: CastMap,
    gear: Vec<GearItem>,
    tl_damage: Vec<i64>,
    tl_healing: Vec<i64>,
    tl_taken: Vec<i64>,
    recap: VecDeque<RecapRaw>,
    /// kind → biggest event so far (`at_ms` holds the absolute timestamp until `summarize`).
    records: BTreeMap<RecordKind, RunRecord>,
}

impl PlayerAcc {
    /// Keeps the event when it beats the current record of its kind (first one wins a tie).
    fn record(&mut self, r: RunRecord) {
        if r.amount > 0 && self.records.get(&r.kind).is_none_or(|old| old.amount < r.amount) {
            self.records.insert(r.kind, r);
        }
    }
}

#[derive(Debug, Clone)]
struct SegAcc {
    kind: SegmentKind,
    name: String,
    encounter_id: Option<u32>,
    start: i64,
    end: i64,
    result: SegmentResult,
    per: BTreeMap<String, SegPlayerAcc>,
}

impl SegAcc {
    fn new(kind: SegmentKind, name: String, encounter_id: Option<u32>, start: i64) -> Self {
        SegAcc {
            kind,
            name,
            encounter_id,
            start,
            end: start,
            result: SegmentResult::None,
            per: BTreeMap::new(),
        }
    }
    fn is_empty(&self) -> bool {
        self.per
            .values()
            .all(|p| p.damage == 0 && p.healing == 0 && p.taken == 0)
    }
}

/// State of one run (from entering the dungeon until the detector closes it).
#[derive(Debug, Clone)]
pub struct RunAcc {
    pub zone: ZoneInfo,
    pub instance_uid: Option<u32>,
    pub started_at: Option<i64>,
    pub last_activity: i64,
    pub last_event: i64,
    players: BTreeMap<String, PlayerAcc>,
    pet_owner: HashMap<String, String>,
    recent_swings: VecDeque<(i64, String, String, i64)>,
    segments: Vec<SegAcc>,
    current_seg: Option<SegAcc>,
    deaths: Vec<Death>,
    killed: BTreeSet<u32>,
    wipes: u32,
    loot: Vec<LootDrop>,
    rolls: Vec<LootRoll>,
    /// Leader from the chat log (see `Detector::push_group`): `Some(None)` = the log writer.
    pub chat_leader: Option<Option<String>>,
}

/// Max rolls kept per run (a 1 h dungeon had 35).
pub const MAX_ROLLS: usize = 500;

/// Max loot entries kept per run (the server accepts the same; a full party in a 1 h dungeon
/// loots ~250 items, so this covers very long runs). Size is guarded by `RunSummary::fit_size`.
pub const MAX_LOOT: usize = 2000;

/// Chat name → comparable key: `Mendy-Bandage-PvP-EU` / `Mendy Bandage` → `mendy bandage`.
fn name_key(name: &str) -> String {
    let lower = name.to_lowercase().replace('-', " ");
    let trimmed = lower.trim_end_matches(" pvp eu").trim_end_matches(" pvp us");
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

impl RunAcc {
    pub fn new(zone: ZoneInfo, now: i64) -> Self {
        RunAcc {
            zone,
            instance_uid: None,
            started_at: None,
            last_activity: now,
            last_event: now,
            players: BTreeMap::new(),
            pet_owner: HashMap::new(),
            recent_swings: VecDeque::new(),
            segments: Vec::new(),
            current_seg: None,
            deaths: Vec::new(),
            killed: BTreeSet::new(),
            wipes: 0,
            loot: Vec::new(),
            rolls: Vec::new(),
            chat_leader: None,
        }
    }

    /// The group player behind a chat name (`None` = the log writer, "You").
    fn chat_player(&self, who: Option<&String>) -> Option<&PlayerAcc> {
        match who {
            None => self.players.values().find(|p| p.mine),
            Some(raw) => {
                let key = name_key(raw);
                self.players.values().find(|p| name_key(&p.name) == key).or_else(|| {
                    // only a first name in chat → unique first-name match
                    let first = key.split(' ').next().unwrap_or_default();
                    let mut hits = self
                        .players
                        .values()
                        .filter(|p| name_key(&p.name).split(' ').next() == Some(first));
                    match (hits.next(), hits.next()) {
                        (Some(p), None) => Some(p),
                        _ => None,
                    }
                })
            }
        }
    }

    /// Adds a need/greed roll message from the chat log. Only party members are kept.
    pub fn push_roll(&mut self, r: &wowlog::Roll) {
        use wowlog::RollEvent;
        let Some(start) = self.started_at else { return };
        if r.timestamp < start - 60_000 {
            return;
        }
        let at_ms = r.timestamp - start;
        // the open roll for this item (the newest one not won yet, within 5 minutes)
        let open = self
            .rolls
            .iter()
            .rposition(|x| x.item == r.item && x.winner.is_none() && at_ms - x.at_ms <= 5 * 60_000);
        let idx = match (&r.event, open) {
            (RollEvent::Start, _) | (_, None) => {
                if self.rolls.len() >= MAX_ROLLS {
                    return;
                }
                self.rolls.push(LootRoll {
                    item: r.item.clone(),
                    item_id: None,
                    quality: None,
                    at_ms,
                    winner: None,
                    entries: Vec::new(),
                });
                if r.event == RollEvent::Start {
                    return;
                }
                self.rolls.len() - 1
            }
            (_, Some(i)) => i,
        };
        let Some((slug, name)) = self
            .chat_player(r.who.as_ref())
            .map(|p| (p.slug.clone(), p.name.clone()))
        else {
            return; // not a party member: never stored
        };
        let roll = &mut self.rolls[idx];
        let entry = |roll: &mut LootRoll| -> usize {
            match roll.entries.iter().position(|e| e.slug == slug) {
                Some(i) => i,
                None => {
                    roll.entries.push(RollEntry {
                        slug: slug.clone(),
                        name: name.clone(),
                        choice: RollChoice::Pass,
                        roll: None,
                    });
                    roll.entries.len() - 1
                }
            }
        };
        let choice = |c: wowlog::RollChoice| match c {
            wowlog::RollChoice::Need => RollChoice::Need,
            wowlog::RollChoice::Greed => RollChoice::Greed,
            wowlog::RollChoice::Pass => RollChoice::Pass,
        };
        match r.event {
            RollEvent::Start => {}
            RollEvent::Choice(c) => {
                let i = entry(roll);
                roll.entries[i].choice = choice(c);
            }
            RollEvent::Rolled(c, v) => {
                let i = entry(roll);
                roll.entries[i].choice = choice(c);
                roll.entries[i].roll = Some(v);
            }
            RollEvent::Won => roll.winner = Some(slug),
        }
    }

    /// Adds a loot line from the chat log (only once the run has started).
    pub fn push_loot(&mut self, l: &wowlog::Loot) {
        let Some(start) = self.started_at else { return };
        if l.timestamp < start - 60_000 || self.loot.len() >= MAX_LOOT {
            return;
        }
        let player = self.chat_player(l.looter.as_ref());
        self.loot.push(LootDrop {
            slug: player.map(|p| p.slug.clone()),
            looter: player
                .map(|p| p.name.clone())
                .or_else(|| l.looter.clone())
                .unwrap_or_else(|| "You".into()),
            item: l.item.clone(),
            item_id: l.item_id,
            quality: l.quality,
            count: l.count,
            at_ms: l.timestamp - start,
        });
    }

    pub fn is_started(&self) -> bool {
        self.started_at.is_some()
    }

    /// Group players seen so far.
    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    /// Instance copy id seen in this record (first NPC-controlled creature – pets and
    /// guardians are skipped because they carry the uid of the zone they were summoned in).
    pub fn observed_uid(rec: &Record, instance_id: u32) -> Option<u32> {
        let npc = |u: &Unit| u.flags & flags::CONTROL_PLAYER == 0 && !u.is_group();
        [&rec.source, &rec.dest]
            .into_iter()
            .filter(|u| npc(u))
            .find_map(|u| creature_uid(u, instance_id))
    }

    fn register(&mut self, u: &Unit) {
        if !(u.is_player() && u.is_group()) || self.players.contains_key(&u.guid) {
            return;
        }
        let raw = u.name.clone().unwrap_or_default();
        self.players.insert(
            u.guid.clone(),
            PlayerAcc {
                name: display_name(&raw),
                slug: wowlog::player_slug(&raw),
                mine: u.is_mine(),
                ..Default::default()
            },
        );
    }

    /// Group player responsible for `u` (the player itself or the owner of a pet/guardian).
    fn actor(&self, u: &Unit) -> Option<(String, bool)> {
        if u.is_none() {
            return None;
        }
        if u.is_player() {
            return self.players.contains_key(&u.guid).then(|| (u.guid.clone(), false));
        }
        let owner = self.pet_owner.get(&u.guid)?;
        self.players.contains_key(owner).then(|| (owner.clone(), true))
    }

    fn is_group_side(&self, u: &Unit) -> bool {
        u.is_group() || self.actor(u).is_some()
    }

    /// What may be shown about a unit outside the PC.
    fn public_name(&self, u: &Unit) -> Option<String> {
        if u.is_none() {
            return None;
        }
        if u.is_player() {
            return Some(match self.players.get(&u.guid) {
                Some(p) => p.name.clone(),
                None => "Stranger".to_string(),
            });
        }
        if u.flags & flags::CONTROL_PLAYER != 0 && self.actor(u).is_none() {
            return Some("Stranger's pet".to_string());
        }
        u.name.clone()
    }

    fn bucket(&self, ts: i64, cfg: &Config) -> usize {
        let start = self.started_at.unwrap_or(ts);
        ((ts - start).max(0) / cfg.bucket_ms) as usize
    }

    fn touch(&mut self, guid: &str, ts: i64, cfg: &Config) {
        if let Some(p) = self.players.get_mut(guid) {
            let mut active = 0;
            if let Some(last) = p.last_action {
                let gap = ts - last;
                if (0..=cfg.active_gap_ms).contains(&gap) {
                    p.active_ms += gap;
                    active = gap;
                }
            }
            p.last_action = Some(ts);
            if let Some(sp) = self.seg_player(guid) {
                sp.active_ms += active;
            }
        }
    }

    /// The group player's numbers in the current segment.
    fn seg_player(&mut self, guid: &str) -> Option<&mut SegPlayerAcc> {
        self.current_seg
            .as_mut()
            .map(|seg| seg.per.entry(guid.to_string()).or_default())
    }

    fn seg_add(&mut self, guid: &str, dmg: i64, heal: i64, taken: i64) {
        if let Some(e) = self.seg_player(guid) {
            e.damage += dmg;
            e.healing += heal;
            e.taken += taken;
        }
    }

    fn close_segment(&mut self, ts: i64) {
        if let Some(mut seg) = self.current_seg.take() {
            seg.end = ts;
            if !(seg.kind == SegmentKind::Trash && seg.is_empty()) {
                self.segments.push(seg);
            }
        }
    }

    /// Is this record group combat (group vs. non-group damage/miss)?
    fn is_activity(&self, rec: &Record) -> bool {
        match &rec.kind {
            Kind::Damage { source_kind, .. } if *source_kind != DamageSource::Environmental => {}
            Kind::Missed { .. } => {}
            _ => return false,
        }
        let (s, d) = (self.is_group_side(&rec.source), self.is_group_side(&rec.dest));
        (s && !d && !rec.dest.is_none()) || (d && !s && !rec.source.is_none())
    }

    /// Feeds one record (only while the player is inside the instance).
    pub fn push(&mut self, rec: &Record, cfg: &Config) {
        let ts = rec.timestamp;
        self.last_event = ts;

        // Always: who is in the group, who owns which pet, which instance copy.
        self.register(&rec.source);
        self.register(&rec.dest);
        match &rec.kind {
            Kind::Summon { .. } if self.players.contains_key(&rec.source.guid) => {
                self.pet_owner.insert(rec.dest.guid.clone(), rec.source.guid.clone());
            }
            Kind::Damage { advanced: Some(a), .. }
            | Kind::Heal { advanced: Some(a), .. }
            | Kind::Energize { advanced: Some(a), .. }
            | Kind::Cast { advanced: Some(a), .. } => {
                if let Some(owner) = &a.owner_guid
                    && owner != &a.info_guid
                    && !a.info_guid.starts_with("Player-")
                {
                    self.pet_owner
                        .entry(a.info_guid.clone())
                        .or_insert_with(|| owner.clone());
                }
                if let Some(p) = self.players.get_mut(&a.info_guid) {
                    p.level = Some(a.level);
                    let guid = a.info_guid.clone();
                    let level = a.level;
                    if self.started_at.is_some()
                        && let Some(sp) = self.seg_player(&guid)
                    {
                        sp.level = Some(level);
                    }
                }
            }
            Kind::CombatantInfo { guid, fields } => {
                if let Some(p) = self.players.get_mut(guid) {
                    let gear = combatant_gear(fields);
                    if !gear.is_empty() {
                        p.gear = gear;
                    }
                }
            }
            _ => {}
        }
        if self.instance_uid.is_none() {
            self.instance_uid = Self::observed_uid(rec, self.zone.instance_id);
        }

        let activity = self.is_activity(rec);
        if activity {
            if self.started_at.is_none() {
                self.started_at = Some(ts);
                self.current_seg = Some(SegAcc::new(SegmentKind::Trash, "Trash".into(), None, ts));
            }
            self.last_activity = ts;
        }
        if self.started_at.is_none() {
            return;
        }

        match &rec.kind {
            Kind::EncounterStart { encounter_id, name, .. } => {
                self.close_segment(ts);
                self.current_seg = Some(SegAcc::new(SegmentKind::Boss, name.clone(), Some(*encounter_id), ts));
                self.last_activity = ts;
            }
            Kind::EncounterEnd {
                encounter_id,
                name,
                success,
                ..
            } => {
                let open_boss = self
                    .current_seg
                    .as_ref()
                    .is_some_and(|s| s.encounter_id == Some(*encounter_id));
                if !open_boss {
                    self.close_segment(ts);
                    self.current_seg = Some(SegAcc::new(SegmentKind::Boss, name.clone(), Some(*encounter_id), ts));
                }
                if let Some(seg) = self.current_seg.as_mut() {
                    seg.result = if *success {
                        SegmentResult::Kill
                    } else {
                        SegmentResult::Wipe
                    };
                }
                if *success {
                    self.killed.insert(*encounter_id);
                } else {
                    self.wipes += 1;
                }
                self.close_segment(ts);
                self.current_seg = Some(SegAcc::new(SegmentKind::Trash, "Trash".into(), None, ts));
                self.last_activity = ts;
            }
            Kind::Damage {
                source_kind,
                spell,
                environment,
                advanced,
                damage,
            } => {
                if !self.accept_swing(rec, *source_kind, damage.amount, cfg) {
                    return;
                }
                let b = self.bucket(ts, cfg);
                let dest_group = self.is_group_side(&rec.dest);
                if let Some((guid, pet)) = self.actor(&rec.source).filter(|_| !dest_group) {
                    let (id, name) = match spell {
                        Some(s) => (s.id, s.name.clone()),
                        None => (0, "Melee".to_string()),
                    };
                    let target = self.public_name(&rec.dest);
                    let p = self.players.get_mut(&guid).expect("actor exists");
                    let kind = if damage.critical {
                        RecordKind::Crit
                    } else {
                        RecordKind::Hit
                    };
                    p.record(RunRecord {
                        kind,
                        amount: damage.amount,
                        spell: name.clone(),
                        spell_id: id,
                        unit: target.clone(),
                        at_ms: ts,
                        pet,
                    });
                    p.damage += damage.amount;
                    p.hits += 1;
                    p.crits += damage.critical as u32;
                    p.dmg_spells
                        .entry((id, pet))
                        .or_insert_with(|| SpellAcc::named(&name))
                        .add(damage.amount, damage.critical);
                    add_at(&mut p.tl_damage, b, damage.amount);
                    self.seg_add(&guid, damage.amount, 0, 0);
                    if let Some(sp) = self.seg_player(&guid) {
                        sp.dmg_spells
                            .entry((id, pet))
                            .or_insert_with(|| SpellAcc::named(&name))
                            .add(damage.amount, damage.critical);
                        if let Some(t) = &target {
                            *sp.targets.entry(t.clone()).or_default() += damage.amount;
                        }
                    }
                    self.touch(&guid, ts, cfg);
                }
                if rec.dest.is_player() && self.players.contains_key(&rec.dest.guid) {
                    let source = self.public_name(&rec.source);
                    let spell_name = spell.as_ref().map(|s| s.name.clone()).or_else(|| match source_kind {
                        DamageSource::Environmental => environment.clone(),
                        _ => Some("Melee".to_string()),
                    });
                    let (hp, max_hp) = hp_of(advanced.as_deref(), &rec.dest.guid);
                    let guid = rec.dest.guid.clone();
                    let p = self.players.get_mut(&guid).expect("checked");
                    p.record(RunRecord {
                        kind: RecordKind::HitTaken,
                        amount: damage.amount,
                        spell: spell_name.clone().unwrap_or_else(|| "Unknown".to_string()),
                        spell_id: spell.as_ref().map_or(0, |s| s.id),
                        unit: source.clone(),
                        at_ms: ts,
                        pet: false,
                    });
                    p.taken += damage.amount;
                    if *source_kind == DamageSource::Environmental {
                        p.env_taken += damage.amount;
                    }
                    add_at(&mut p.tl_taken, b, damage.amount);
                    push_recap(
                        &mut p.recap,
                        cfg.recap_len,
                        RecapRaw {
                            ts,
                            source,
                            spell: spell_name,
                            amount: -damage.amount,
                            overkill: damage.overkill,
                            hp,
                            max_hp,
                        },
                    );
                    self.seg_add(&guid, 0, 0, damage.amount);
                }
            }
            Kind::Missed { .. } => {
                if let Some((guid, _)) = self.actor(&rec.source) {
                    self.touch(&guid, ts, cfg);
                }
            }
            Kind::Heal {
                spell, advanced, heal, ..
            } => {
                let effective = heal.amount - heal.overheal;
                let b = self.bucket(ts, cfg);
                if let Some((guid, pet)) = self.actor(&rec.source) {
                    let target = self.public_name(&rec.dest);
                    let p = self.players.get_mut(&guid).expect("actor exists");
                    let kind = if heal.critical {
                        RecordKind::CritHeal
                    } else {
                        RecordKind::Heal
                    };
                    p.record(RunRecord {
                        kind,
                        amount: effective,
                        spell: spell.name.clone(),
                        spell_id: spell.id,
                        unit: target,
                        at_ms: ts,
                        pet,
                    });
                    p.healing += effective;
                    p.overheal += heal.overheal;
                    let s = p
                        .heal_spells
                        .entry((spell.id, pet))
                        .or_insert_with(|| SpellAcc::named(&spell.name));
                    s.add(effective, heal.critical);
                    s.overheal += heal.overheal;
                    add_at(&mut p.tl_healing, b, effective);
                    self.seg_add(&guid, 0, effective, 0);
                    if let Some(sp) = self.seg_player(&guid) {
                        let s = sp
                            .heal_spells
                            .entry((spell.id, pet))
                            .or_insert_with(|| SpellAcc::named(&spell.name));
                        s.add(effective, heal.critical);
                        s.overheal += heal.overheal;
                    }
                    self.touch(&guid, ts, cfg);
                }
                if rec.dest.is_player() && self.players.contains_key(&rec.dest.guid) && effective > 0 {
                    let source = self.public_name(&rec.source);
                    let (hp, max_hp) = hp_of(advanced.as_deref(), &rec.dest.guid);
                    let p = self.players.get_mut(&rec.dest.guid).expect("checked");
                    push_recap(
                        &mut p.recap,
                        cfg.recap_len,
                        RecapRaw {
                            ts,
                            source,
                            spell: Some(spell.name.clone()),
                            amount: effective,
                            overkill: 0,
                            hp,
                            max_hp,
                        },
                    );
                }
            }
            Kind::Absorbed { absorber, amount, .. } => {
                if let Some((guid, _)) = self.actor(absorber) {
                    self.players.get_mut(&guid).expect("actor exists").shielding += amount;
                }
            }
            Kind::Interrupt { .. } => {
                if let Some((guid, _)) = self.actor(&rec.source) {
                    self.players.get_mut(&guid).expect("actor exists").interrupts += 1;
                    if let Some(sp) = self.seg_player(&guid) {
                        sp.interrupts += 1;
                    }
                    self.touch(&guid, ts, cfg);
                }
            }
            Kind::Dispel { .. } => {
                if let Some((guid, _)) = self.actor(&rec.source) {
                    self.players.get_mut(&guid).expect("actor exists").dispels += 1;
                    if let Some(sp) = self.seg_player(&guid) {
                        sp.dispels += 1;
                    }
                    self.touch(&guid, ts, cfg);
                }
            }
            Kind::Cast {
                phase: wowlog::CastPhase::Success,
                spell,
                ..
            } => {
                if let Some((guid, pet)) = self.actor(&rec.source) {
                    let p = self.players.get_mut(&guid).expect("actor exists");
                    p.casts
                        .entry((spell.id, pet))
                        .or_insert_with(|| (spell.name.clone(), 0))
                        .1 += 1;
                    if let Some(sp) = self.seg_player(&guid) {
                        sp.casts
                            .entry((spell.id, pet))
                            .or_insert_with(|| (spell.name.clone(), 0))
                            .1 += 1;
                    }
                    if !pet {
                        self.touch(&guid, ts, cfg);
                    }
                }
            }
            Kind::Died { unconscious: false, .. } if rec.dest.is_player() => {
                let start = self.started_at.unwrap_or(ts);
                if self.players.contains_key(&rec.dest.guid)
                    && let Some(sp) = self.seg_player(&rec.dest.guid)
                {
                    sp.deaths += 1;
                }
                if let Some(p) = self.players.get_mut(&rec.dest.guid) {
                    p.deaths += 1;
                    let recap: Vec<RecapRaw> = p.recap.drain(..).collect();
                    let last_hit = recap.iter().rev().find(|r| r.amount < 0);
                    self.deaths.push(Death {
                        slug: p.slug.clone(),
                        at_ms: ts - start,
                        killer: last_hit.and_then(|r| r.source.clone()),
                        killing_blow: last_hit.and_then(|r| r.spell.clone()),
                        recap: recap
                            .into_iter()
                            .map(|r| RecapEntry {
                                at_ms: r.ts - ts,
                                source: r.source,
                                spell: r.spell,
                                amount: r.amount,
                                overkill: r.overkill,
                                hp: r.hp,
                                max_hp: r.max_hp,
                            })
                            .collect(),
                    });
                }
            }
            _ => {}
        }
    }

    /// Swing de-duplication: `SWING_DAMAGE_LANDED` is usually a copy of a `SWING_DAMAGE`
    /// logged 0–110 ms later, but not always (verified on the solo sample).
    fn accept_swing(&mut self, rec: &Record, kind: DamageSource, amount: i64, cfg: &Config) -> bool {
        let ts = rec.timestamp;
        while self
            .recent_swings
            .front()
            .is_some_and(|s| ts - s.0 > cfg.swing_dedupe_ms)
        {
            self.recent_swings.pop_front();
        }
        match kind {
            DamageSource::Swing => {
                self.recent_swings
                    .push_back((ts, rec.source.guid.clone(), rec.dest.guid.clone(), amount));
                true
            }
            DamageSource::SwingLanded => {
                let pos = self
                    .recent_swings
                    .iter()
                    .position(|s| s.1 == rec.source.guid && s.2 == rec.dest.guid && s.3 == amount);
                match pos {
                    Some(i) => {
                        self.recent_swings.remove(i);
                        false
                    }
                    None => true,
                }
            }
            _ => true,
        }
    }

    /// Builds the summary as if the run ended at `end` (does not modify the accumulator).
    pub fn summarize(&self, end: i64, reason: EndReason, run_key: String, cfg: &Config) -> RunSummary {
        let start = self.started_at.unwrap_or(end);
        let duration = (end - start).max(1);
        let secs = duration as f64 / 1000.0;
        let buckets = ((duration + cfg.bucket_ms - 1) / cfg.bucket_ms).max(1) as usize;

        let mut segments: Vec<Segment> = Vec::new();
        let mut open = self.current_seg.clone();
        if let Some(s) = open.as_mut() {
            s.end = end;
        }
        for s in self
            .segments
            .iter()
            .chain(open.iter().filter(|s| !(s.kind == SegmentKind::Trash && s.is_empty())))
        {
            segments.push(Segment {
                kind: s.kind,
                name: s.name.clone(),
                encounter_id: s.encounter_id,
                start_ms: s.start - start,
                end_ms: s.end - start,
                result: s.result,
                players: s
                    .per
                    .iter()
                    .filter_map(|(g, sp)| {
                        let boss = s.kind == SegmentKind::Boss;
                        self.players.get(g).map(|p| SegmentPlayer {
                            slug: p.slug.clone(),
                            damage: sp.damage,
                            healing: sp.healing,
                            damage_taken: sp.taken,
                            ilvl: sp.level,
                            active_ms: sp.active_ms,
                            interrupts: sp.interrupts,
                            dispels: sp.dispels,
                            deaths: sp.deaths,
                            // the full breakdown only for boss fights (document size)
                            spells: if boss {
                                top_spells(&sp.dmg_spells, &sp.casts, cfg.top_spells)
                            } else {
                                vec![]
                            },
                            heals: if boss {
                                top_spells(&sp.heal_spells, &sp.casts, cfg.top_spells)
                            } else {
                                vec![]
                            },
                            casts: if boss {
                                top_casts(&sp.casts, cfg.top_spells)
                            } else {
                                vec![]
                            },
                            targets: if boss { top_targets(&sp.targets, 8) } else { vec![] },
                        })
                    })
                    .collect(),
            });
        }

        let top = |m: &SpellMap, casts: &CastMap| top_spells(m, casts, cfg.top_spells);

        let mut players: Vec<PlayerSummary> = self
            .players
            .iter()
            .map(|(guid, p)| PlayerSummary {
                guid: guid.clone(),
                name: p.name.clone(),
                slug: p.slug.clone(),
                recorder: p.mine,
                level: p.level,
                damage: p.damage,
                healing: p.healing,
                overheal: p.overheal,
                shielding: p.shielding,
                damage_taken: p.taken,
                environmental_taken: p.env_taken,
                deaths: p.deaths,
                interrupts: p.interrupts,
                dispels: p.dispels,
                active_ms: p.active_ms,
                dps: round1(p.damage as f64 / secs),
                hps: round1(p.healing as f64 / secs),
                crit_pct: if p.hits > 0 {
                    round1(p.crits as f64 * 100.0 / p.hits as f64)
                } else {
                    0.0
                },
                top_damage: top(&p.dmg_spells, &p.casts),
                top_healing: top(&p.heal_spells, &p.casts),
                casts: top_casts(&p.casts, 30),
                gear: p.gear.clone(),
                records: p
                    .records
                    .values()
                    .map(|r| RunRecord {
                        at_ms: r.at_ms - start,
                        ..r.clone()
                    })
                    .collect(),
            })
            .collect();
        players.sort_by(|a, b| {
            b.damage
                .cmp(&a.damage)
                .then(b.healing.cmp(&a.healing))
                .then(a.slug.cmp(&b.slug))
        });

        let pad = |v: &Vec<i64>| -> Vec<i64> {
            let mut v = v.clone();
            v.resize(buckets, 0);
            v.truncate(buckets);
            v
        };
        let timeline = Timeline {
            bucket_ms: cfg.bucket_ms,
            players: players
                .iter()
                .map(|ps| {
                    let p = &self.players[&ps.guid];
                    PlayerTimeline {
                        slug: p.slug.clone(),
                        damage: pad(&p.tl_damage),
                        healing: pad(&p.tl_healing),
                        taken: pad(&p.tl_taken),
                    }
                })
                .collect(),
        };

        let bosses_killed = self.killed.len() as u32;
        let mut summary = RunSummary {
            schema: SCHEMA_VERSION,
            run_key,
            zone: Zone {
                instance_id: self.zone.instance_id,
                name: self.zone.name.clone(),
                difficulty_id: self.zone.difficulty_id,
                instance_uid: self.instance_uid,
            },
            started_at: start - cfg.utc_offset_ms,
            ended_at: end - cfg.utc_offset_ms,
            duration_ms: duration,
            end_reason: reason,
            result: RunResult {
                bosses_killed,
                bosses_total: self.zone.boss_count,
                wipes: self.wipes,
                cleared: self.zone.boss_count.is_some_and(|t| t > 0 && bosses_killed >= t),
            },
            recorder: self.players.values().find(|p| p.mine).map(|p| p.slug.clone()),
            players,
            segments,
            deaths: self.deaths.clone(),
            timeline,
            // loot after the last kill (boss corpse) belongs to the run too
            loot: self.loot.clone(),
            rolls: self.rolls.clone(),
            // only a party member of this run, by their display name (like the addon sends it)
            leader: self
                .chat_leader
                .as_ref()
                .and_then(|who| self.chat_player(who.as_ref()))
                .map(|p| p.name.clone()),
        };
        summary.link_rolls_to_loot();
        summary
    }

    /// GUIDs of the group players (for the run key).
    pub fn player_guids(&self) -> Vec<String> {
        self.players.keys().cloned().collect()
    }
}

/// The biggest spells, with their cast counts.
fn top_spells(m: &SpellMap, casts: &CastMap, n: usize) -> Vec<SpellStat> {
    let mut v: Vec<SpellStat> = m
        .iter()
        .filter(|(_, s)| s.amount > 0)
        .map(|(&(id, pet), s)| SpellStat {
            id,
            name: s.name.clone(),
            amount: s.amount,
            hits: s.hits,
            crits: s.crits,
            pet,
            casts: casts.get(&(id, pet)).map_or(0, |c| c.1),
            min: s.min,
            max: s.max,
            overheal: s.overheal,
        })
        .collect();
    v.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.id.cmp(&b.id)));
    v.truncate(n);
    v
}

fn top_casts(m: &CastMap, n: usize) -> Vec<CastStat> {
    let mut v: Vec<CastStat> = m
        .iter()
        .map(|(&(id, pet), (name, count))| CastStat {
            id,
            name: name.clone(),
            count: *count,
            pet,
        })
        .collect();
    v.sort_by(|a, b| b.count.cmp(&a.count).then(a.id.cmp(&b.id)));
    v.truncate(n);
    v
}

fn top_targets(m: &HashMap<String, i64>, n: usize) -> Vec<TargetStat> {
    let mut v: Vec<TargetStat> = m
        .iter()
        .filter(|&(_, &a)| a > 0)
        .map(|(name, &amount)| TargetStat {
            name: name.clone(),
            amount,
        })
        .collect();
    v.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.name.cmp(&b.name)));
    v.truncate(n);
    v
}

/// Equipped items from `COMBATANT_INFO`: the second top-level `[...]` list holds one
/// `(itemId,ilvl,(enchants),(bonus ids),(gems))` per slot (verified on a real Forever log,
/// 15. 11. 2026). Empty slots (`0`) are skipped.
pub fn combatant_gear(fields: &[String]) -> Vec<GearItem> {
    let text = fields.join(",");
    let mut lists = Vec::new();
    let (mut depth, mut start) = (0i32, 0usize);
    for (i, c) in text.char_indices() {
        match c {
            '[' | '(' => {
                if c == '[' && depth == 0 {
                    start = i;
                }
                depth += 1;
            }
            ']' | ')' => {
                depth -= 1;
                if c == ']' && depth == 0 {
                    lists.push(&text[start + 1..i]);
                }
            }
            _ => {}
        }
    }
    let Some(gear) = lists.get(1) else { return Vec::new() };
    // split into the depth-1 tuples
    let mut items = Vec::new();
    let (mut depth, mut start) = (0i32, 0usize);
    for (i, c) in gear.char_indices() {
        match c {
            '(' => {
                if depth == 0 {
                    start = i + 1;
                }
                depth += 1;
            }
            ')' => {
                depth -= 1;
                if depth == 0 {
                    let mut nums = gear[start..i].split(',').map(|x| x.trim().parse::<u32>().ok());
                    if let (Some(Some(item_id)), Some(Some(ilvl))) = (nums.next(), nums.next())
                        && item_id != 0
                    {
                        items.push(GearItem { item_id, ilvl });
                    }
                }
            }
            _ => {}
        }
    }
    items
}

fn add_at(v: &mut Vec<i64>, i: usize, amount: i64) {
    if v.len() <= i {
        v.resize(i + 1, 0);
    }
    v[i] += amount;
}

fn push_recap(q: &mut VecDeque<RecapRaw>, cap: usize, e: RecapRaw) {
    q.push_back(e);
    while q.len() > cap {
        q.pop_front();
    }
}

fn hp_of(adv: Option<&wowlog::Advanced>, guid: &str) -> (Option<i64>, Option<i64>) {
    match adv {
        Some(a) if a.info_guid == guid => (Some(a.current_hp), Some(a.max_hp)),
        _ => (None, None),
    }
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(display_name("Fizzle-Boom-PvP-EU"), "Fizzle Boom");
        let u = Unit {
            guid: "Creature-0-1-43-23810-1548-000000BBBB".into(),
            ..Default::default()
        };
        assert_eq!(creature_uid(&u, 43), Some(23810));
        // an NPC from another map (world buff giver in a city) is not the dungeon copy
        let herald = Unit {
            guid: "Creature-0-7099-1-50227-10719-000079AC6D".into(),
            ..Default::default()
        };
        assert_eq!(creature_uid(&herald, 43), None);
    }

    #[test]
    fn gear_from_combatant_info() {
        // shape of a real Forever COMBATANT_INFO (after the GUID), shortened
        let line = "0,35,81,62,39,40,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,720,1485,[(104976,129637,5),(104975,129636,2)],(0,0,0,0),[(279391,23,(),(),()),(0,0,(),(),()),(15018,20,(),(12736),()),(4568,21,(),(12742),())],[Creature-0-6866-1-19410-10719-000079B309,16609,1],1,0,0,0";
        let fields: Vec<String> = line.split(',').map(str::to_string).collect();
        assert_eq!(
            combatant_gear(&fields),
            vec![
                GearItem {
                    item_id: 279391,
                    ilvl: 23
                },
                GearItem {
                    item_id: 15018,
                    ilvl: 20
                },
                GearItem {
                    item_id: 4568,
                    ilvl: 21
                },
            ]
        );
        assert!(combatant_gear(&[]).is_empty());
    }
}
