//! Run detection: a small state machine fed with parsed records (streaming).
//!
//! ```text
//!   outside ──ZONE_CHANGE→dungeon──▶ inside (run not started)
//!   inside ──first group combat──▶ run started
//!   started ──ZONE_CHANGE→elsewhere──▶ away (corpse run?) ──same dungeon again──▶ started
//!                                       └─ grace expired / other dungeon ──▶ run finished
//!   started ──no group combat for inactivity_ms──▶ run finished
//!   re-entry with a different creature instance uid ──▶ run finished (reset), new run
//! ```
//!
//! Finished runs with fewer than `min_players` group players (solo farming) are discarded.

use crate::analyzer::{Config, RunAcc, ZoneInfo};
use crate::dungeons::{self, Dungeon};
use crate::summary::{EndReason, RunSummary};
use wowlog::{Kind, Record};

pub struct Detector {
    cfg: Config,
    run: Option<RunAcc>,
    inside: bool,
    left_at: Option<i64>,
    /// After re-entering the same dungeon: compare the next creature's instance uid.
    resume_check: bool,
    discarded: u32,
}

impl Detector {
    pub fn new(cfg: Config) -> Self {
        Detector {
            cfg,
            run: None,
            inside: false,
            left_at: None,
            resume_check: false,
            discarded: 0,
        }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Runs dropped because they were too small (solo) – for diagnostics.
    pub fn discarded(&self) -> u32 {
        self.discarded
    }

    /// Name of the dungeon the player is in right now.
    pub fn current_dungeon(&self) -> Option<&str> {
        self.run.as_ref().filter(|_| self.inside).map(|r| r.zone.name.as_str())
    }

    /// Whether a run has started and is still open.
    pub fn run_in_progress(&self) -> bool {
        self.run.as_ref().is_some_and(|r| r.is_started())
    }

    /// Live view of the current run (for the in-app meter).
    pub fn snapshot(&self) -> Option<RunSummary> {
        let run = self.run.as_ref().filter(|r| r.is_started())?;
        Some(run.summarize(run.last_event, EndReason::InProgress, run_key(run), &self.cfg))
    }

    /// Feeds one record; returns runs that finished because of it.
    pub fn push(&mut self, rec: &Record) -> Vec<RunSummary> {
        let ts = rec.timestamp;
        let mut out = self.tick(ts);

        match &rec.kind {
            Kind::ZoneChange {
                instance_id,
                difficulty_id,
                ..
            } => {
                match dungeons::by_instance(*instance_id) {
                    Some(d) => self.enter(d, *difficulty_id, ts, &mut out),
                    None => self.leave(ts),
                }
                return out;
            }
            // Fallbacks in case Forever does not write ZONE_CHANGE on entering an instance.
            Kind::MapChange { name, .. } if !self.inside => {
                if let Some(d) = dungeons::by_name(name) {
                    self.enter(d, 0, ts, &mut out);
                }
            }
            Kind::EncounterStart {
                instance_id: Some(id),
                difficulty_id,
                ..
            } if !self.inside => {
                if let Some(d) = dungeons::by_instance(*id) {
                    self.enter(d, *difficulty_id, ts, &mut out);
                }
            }
            _ => {}
        }

        if !self.inside {
            return out;
        }

        if self.resume_check
            && let Some(uid) = RunAcc::observed_uid(rec)
        {
            self.resume_check = false;
            let reset = self
                .run
                .as_ref()
                .is_some_and(|r| r.instance_uid.is_some_and(|u| u != uid));
            if reset {
                let zone = self.run.as_ref().map(|r| r.zone.clone()).expect("run exists");
                self.finish_run(EndReason::InstanceReset, &mut out);
                self.run = Some(RunAcc::new(zone, ts));
            }
        }

        if let Some(run) = self.run.as_mut() {
            run.push(rec, &self.cfg);
        }
        out
    }

    /// Time passes without new lines (the app calls this e.g. every few seconds with
    /// the current time converted to log-local milliseconds).
    pub fn tick(&mut self, now: i64) -> Vec<RunSummary> {
        let mut out = Vec::new();
        let Some(run) = self.run.as_ref().filter(|r| r.is_started()) else {
            return out;
        };
        if self.inside {
            if now - run.last_activity > self.cfg.inactivity_ms {
                let zone = run.zone.clone();
                self.finish_run(EndReason::Inactivity, &mut out);
                self.run = Some(RunAcc::new(zone, now));
            }
        } else if self.left_at.is_some_and(|l| now - l > self.cfg.rejoin_grace_ms) {
            self.finish_run(EndReason::LeftInstance, &mut out);
        }
        out
    }

    /// The log ended (or the app is shutting down).
    pub fn finish(&mut self) -> Vec<RunSummary> {
        let mut out = Vec::new();
        let reason = if self.inside {
            EndReason::EndOfLog
        } else {
            EndReason::LeftInstance
        };
        self.finish_run(reason, &mut out);
        self.inside = false;
        out
    }

    /// "End run" button.
    pub fn end_manual(&mut self) -> Vec<RunSummary> {
        let mut out = Vec::new();
        let zone = self.run.as_ref().map(|r| (r.zone.clone(), r.last_event));
        self.finish_run(EndReason::Manual, &mut out);
        if let (true, Some((zone, now))) = (self.inside, zone) {
            self.run = Some(RunAcc::new(zone, now));
        }
        out
    }

    fn enter(&mut self, d: &Dungeon, difficulty_id: u32, ts: i64, out: &mut Vec<RunSummary>) {
        if let Some(run) = &self.run {
            if run.zone.instance_id == d.instance_id {
                if !self.inside {
                    // Back from a corpse run (or a reset – checked on the next creature).
                    self.inside = true;
                    self.left_at = None;
                    self.resume_check = run.is_started();
                }
                return;
            }
            self.finish_run(EndReason::NewInstance, out);
        }
        let zone = ZoneInfo {
            instance_id: d.instance_id,
            name: d.name.to_string(),
            difficulty_id,
            boss_count: d.boss_count,
        };
        self.run = Some(RunAcc::new(zone, ts));
        self.inside = true;
        self.left_at = None;
        self.resume_check = false;
    }

    fn leave(&mut self, ts: i64) {
        if !self.inside {
            return;
        }
        self.inside = false;
        self.resume_check = false;
        if self.run.as_ref().is_some_and(|r| r.is_started()) {
            self.left_at = Some(ts);
        } else {
            self.run = None;
        }
    }

    fn finish_run(&mut self, reason: EndReason, out: &mut Vec<RunSummary>) {
        self.left_at = None;
        self.resume_check = false;
        let Some(run) = self.run.take() else { return };
        if !run.is_started() {
            return;
        }
        if run.player_count() < self.cfg.min_players {
            self.discarded += 1;
            return;
        }
        out.push(run.summarize(run.last_activity, reason, run_key(&run), &self.cfg));
    }
}

/// Run key shared by all recorders of the same run.
///
/// With a creature instance uid (normal case): `instanceID | uid | local day`.
/// Without one: `instanceID | start rounded to 5 min | sorted party GUIDs`.
pub fn run_key(run: &RunAcc) -> String {
    let start = run.started_at.unwrap_or(run.last_event);
    let material = match run.instance_uid {
        Some(uid) => format!("{}|{}|{}", run.zone.instance_id, uid, start.div_euclid(86_400_000)),
        None => format!(
            "{}|t{}|{}",
            run.zone.instance_id,
            start.div_euclid(300_000),
            run.player_guids().join(",")
        ),
    };
    format!("{:016x}", fnv1a64(material.as_bytes()))
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}
