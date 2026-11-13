//! Synthetic combat log builder. Produces real-format v22 lines (fake names/GUIDs)
//! and parses them with `wowlog`, so tests cover parser + detector together.

#![allow(dead_code, clippy::too_many_arguments)]

use wowlog::Record;

#[derive(Clone, Debug)]
pub struct U {
    pub guid: String,
    pub name: String,
    pub flags: &'static str,
}

impl U {
    fn base(&self) -> String {
        format!("{},\"{}\",{},0x80000000", self.guid, self.name, self.flags)
    }
}

pub const NONE: &str = "0000000000000000,nil,0x80000000,0x80000000";

pub fn me(name: &str, hex: &str) -> U {
    U {
        guid: format!("Player-1-{hex}"),
        name: format!("{name}-PvP-EU"),
        flags: "0x511",
    }
}
pub fn party(name: &str, hex: &str) -> U {
    U {
        guid: format!("Player-1-{hex}"),
        name: format!("{name}-PvP-EU"),
        flags: "0x512",
    }
}
pub fn stranger(name: &str, hex: &str) -> U {
    U {
        guid: format!("Player-1-{hex}"),
        name: format!("{name}-PvP-EU"),
        flags: "0x518",
    }
}
pub fn pet(name: &str, spawn: &str) -> U {
    U {
        guid: format!("Creature-0-1-389-500-416-{spawn}"),
        name: name.into(),
        flags: "0x1112",
    }
}
/// Hostile NPC in instance copy `uid`.
pub fn mob(name: &str, npc: u32, uid: u32, spawn: &str) -> U {
    U {
        guid: format!("Creature-0-1-389-{uid}-{npc}-{spawn}"),
        name: name.into(),
        flags: "0xa48",
    }
}

pub struct Log {
    pub t: i64, // ms since 2026-11-20 20:00:00
    pub lines: Vec<String>,
}

impl Log {
    pub fn new() -> Self {
        let mut l = Log {
            t: 0,
            lines: Vec::new(),
        };
        l.raw("COMBAT_LOG_VERSION,22,ADVANCED_LOG_ENABLED,0,BUILD_VERSION,1.60.1,PROJECT_ID,18");
        l
    }

    pub fn wait(&mut self, ms: i64) -> &mut Self {
        self.t += ms;
        self
    }

    fn stamp(&self) -> String {
        let total = 20 * 3_600_000 + self.t;
        let day = 20 + total / 86_400_000;
        let r = total % 86_400_000;
        format!(
            "11/{day:02}/2026 {:02}:{:02}:{:02}.{:04}",
            r / 3_600_000,
            r / 60_000 % 60,
            r / 1000 % 60,
            (r % 1000) * 10
        )
    }

    pub fn raw(&mut self, payload: &str) -> &mut Self {
        let line = format!("{}  {}", self.stamp(), payload);
        self.lines.push(line);
        self
    }

    /// Advanced block describing `info` (owner = `owner` guid).
    fn adv(info: &U, owner: Option<&U>, hp: i64, max_hp: i64) -> String {
        format!(
            "{},{},{hp},{max_hp},100,50,300,0,0,0,0,100,100,0,1.0,2.0,213,1.0,25",
            info.guid,
            owner.map(|o| o.guid.as_str()).unwrap_or("0000000000000000")
        )
    }

    pub fn zone(&mut self, id: u32, name: &str) -> &mut Self {
        self.raw(&format!("ZONE_CHANGE,{id},\"{name}\",1"))
    }

    pub fn encounter_start(&mut self, id: u32, name: &str) -> &mut Self {
        self.raw(&format!("ENCOUNTER_START,{id},\"{name}\",1,5,389"))
    }

    pub fn encounter_end(&mut self, id: u32, name: &str, success: bool, fight_ms: i64) -> &mut Self {
        self.raw(&format!(
            "ENCOUNTER_END,{id},\"{name}\",1,5,{},{fight_ms}",
            success as u8
        ))
    }

    /// Spell hit; advanced block describes the target (as in Forever).
    pub fn spell(&mut self, src: &U, dst: &U, id: u32, name: &str, amount: i64, crit: bool) -> &mut Self {
        self.spell_ok(src, dst, id, name, amount, crit, -1, 1000)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spell_ok(
        &mut self,
        src: &U,
        dst: &U,
        id: u32,
        name: &str,
        amount: i64,
        crit: bool,
        overkill: i64,
        dst_hp: i64,
    ) -> &mut Self {
        let c = if crit { "1" } else { "nil" };
        let p = format!(
            "SPELL_DAMAGE,{},{},{id},\"{name}\",0x4,{},{amount},{amount},{overkill},4,0,0,0,{c},nil,nil,ST",
            src.base(),
            dst.base(),
            Self::adv(dst, None, dst_hp, 1000)
        );
        self.raw(&p)
    }

    /// Melee swing; advanced block describes the attacker (owner set for pets).
    pub fn swing(&mut self, src: &U, dst: &U, amount: i64, owner: Option<&U>) -> &mut Self {
        let p = format!(
            "SWING_DAMAGE,{},{},{},{amount},{amount},-1,1,0,0,0,nil,nil,nil",
            src.base(),
            dst.base(),
            Self::adv(src, owner, 500, 500)
        );
        self.raw(&p)
    }

    pub fn swing_landed(&mut self, src: &U, dst: &U, amount: i64) -> &mut Self {
        let p = format!(
            "SWING_DAMAGE_LANDED,{},{},{},{amount},{amount},-1,1,0,0,0,nil,nil,nil",
            src.base(),
            dst.base(),
            Self::adv(dst, None, 500, 500)
        );
        self.raw(&p)
    }

    /// NPC hits a player; advanced block describes the player (hp after the hit).
    pub fn hit_player(
        &mut self,
        src: &U,
        dst: &U,
        id: u32,
        name: &str,
        amount: i64,
        overkill: i64,
        hp: i64,
    ) -> &mut Self {
        let p = format!(
            "SPELL_DAMAGE,{},{},{id},\"{name}\",0x4,{},{amount},{amount},{overkill},4,0,0,0,nil,nil,nil,ST",
            src.base(),
            dst.base(),
            Self::adv(dst, None, hp, 1000)
        );
        self.raw(&p)
    }

    pub fn heal(&mut self, src: &U, dst: &U, amount: i64, overheal: i64, hp: i64) -> &mut Self {
        let p = format!(
            "SPELL_HEAL,{},{},2054,\"Lesser Heal\",0x2,{},{amount},{amount},{overheal},0,nil",
            src.base(),
            dst.base(),
            Self::adv(dst, None, hp, 1000)
        );
        self.raw(&p)
    }

    pub fn lava(&mut self, dst: &U, amount: i64, overkill: i64) -> &mut Self {
        let p = format!(
            "ENVIRONMENTAL_DAMAGE,{NONE},{},{},Lava,{amount},{amount},{overkill},4,0,0,0,nil,nil,nil",
            dst.base(),
            Self::adv(dst, None, 0, 1000)
        );
        self.raw(&p)
    }

    pub fn summon(&mut self, owner: &U, p: &U) -> &mut Self {
        let line = format!("SPELL_SUMMON,{},{},688,\"Summon Imp\",0x20", owner.base(), p.base());
        self.raw(&line)
    }

    pub fn interrupt(&mut self, src: &U, dst: &U) -> &mut Self {
        let line = format!(
            "SPELL_INTERRUPT,{},{},6552,\"Pummel\",0x1,9053,\"Fireball\",0x4",
            src.base(),
            dst.base()
        );
        self.raw(&line)
    }

    pub fn absorb(&mut self, attacker: &U, victim: &U, shielder: &U, amount: i64) -> &mut Self {
        let line = format!(
            "SPELL_ABSORBED,{},{},{},17,\"Power Word: Shield\",0x2,{amount},{amount},nil",
            attacker.base(),
            victim.base(),
            shielder.base()
        );
        self.raw(&line)
    }

    pub fn died(&mut self, dst: &U) -> &mut Self {
        let line = format!("UNIT_DIED,{NONE},{},0", dst.base());
        self.raw(&line)
    }

    pub fn text(&self) -> String {
        self.lines.join("\n") + "\n"
    }

    pub fn records(&self) -> Vec<Record> {
        self.lines
            .iter()
            .map(|l| wowlog::parse_line(l).unwrap_or_else(|e| panic!("{e}")))
            .collect()
    }
}

/// Runs all records through a detector and returns finished runs (incl. `finish()`).
pub fn detect(log: &Log, cfg: wowrun::Config) -> (Vec<wowrun::RunSummary>, wowrun::Detector) {
    let mut det = wowrun::Detector::new(cfg);
    let mut runs = Vec::new();
    for r in log.records() {
        runs.extend(det.push(&r));
    }
    runs.extend(det.finish());
    (runs, det)
}
