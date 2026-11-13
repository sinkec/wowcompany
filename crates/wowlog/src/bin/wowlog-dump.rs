//! `wowlog-dump <file> [--group] [--deaths N]` – development summary of a combat log.
//!
//! Prints: header, time span, event counts, zones/maps, encounters, damage/healing per
//! player, deaths and parse errors. `--group` limits the player tables to mine/party/raid.

use std::collections::{BTreeMap, HashMap};
use std::process::ExitCode;
use wowlog::{DamageSource, Kind, Record, time};

#[derive(Default)]
struct PlayerStats {
    name: String,
    group: bool,
    damage: i64,
    healing: i64,
    overheal: i64,
    taken: i64,
    deaths: u32,
}

fn stats_for<'a>(players: &'a mut HashMap<String, PlayerStats>, u: &wowlog::Unit) -> Option<&'a mut PlayerStats> {
    if !u.is_player() {
        return None;
    }
    let s = players.entry(u.guid.clone()).or_default();
    if s.name.is_empty() {
        s.name = u.name.clone().unwrap_or_default();
    }
    s.group |= u.is_group();
    Some(s)
}

fn main() -> ExitCode {
    let mut path = None;
    let mut group_only = false;
    let mut max_deaths = 20usize;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--group" => group_only = true,
            "--deaths" => max_deaths = args.next().and_then(|v| v.parse().ok()).unwrap_or(20),
            "-h" | "--help" => {
                eprintln!("usage: wowlog-dump <WoWCombatLog-*.txt> [--group] [--deaths N]");
                return ExitCode::SUCCESS;
            }
            _ => path = Some(a),
        }
    }
    let Some(path) = path else {
        eprintln!("usage: wowlog-dump <WoWCombatLog-*.txt> [--group] [--deaths N]");
        return ExitCode::from(2);
    };
    let reader = match wowlog::open(&path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("cannot open {path}: {e}");
            return ExitCode::from(1);
        }
    };

    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut players: HashMap<String, PlayerStats> = HashMap::new();
    let mut deaths: Vec<String> = Vec::new();
    let mut zones: Vec<String> = Vec::new();
    let mut encounters: Vec<String> = Vec::new();
    let mut bad = Vec::new();
    let (mut first, mut last) = (None::<i64>, 0i64);
    let mut header = String::new();
    let mut total = 0usize;

    for item in reader {
        let item = match item {
            Ok(i) => i,
            Err(e) => {
                eprintln!("read error: {e}");
                return ExitCode::from(1);
            }
        };
        let rec: Record = match item {
            Ok(r) => r,
            Err(b) => {
                bad.push(b);
                continue;
            }
        };
        total += 1;
        first.get_or_insert(rec.timestamp);
        last = rec.timestamp;
        *counts.entry(rec.event.clone()).or_default() += 1;
        let at = time::format(rec.timestamp);

        match &rec.kind {
            Kind::CombatLogVersion {
                version,
                advanced,
                build,
                project_id,
            } => {
                header = format!("v{version} build {build} project {project_id} advanced={advanced}");
            }
            Kind::ZoneChange {
                instance_id,
                name,
                difficulty_id,
            } => {
                zones.push(format!(
                    "{at}  ZONE {name} (instance {instance_id}, difficulty {difficulty_id})"
                ));
            }
            Kind::MapChange { ui_map_id, name } => {
                zones.push(format!("{at}  MAP  {name} (uiMap {ui_map_id})"));
            }
            Kind::EncounterStart {
                encounter_id,
                name,
                difficulty_id,
                group_size,
                instance_id,
            } => {
                encounters.push(format!(
                    "{at}  START {name} ({encounter_id}) diff {difficulty_id} size {group_size} instance {instance_id:?}"
                ));
            }
            Kind::EncounterEnd {
                encounter_id,
                name,
                success,
                fight_time_ms,
                ..
            } => {
                encounters.push(format!(
                    "{at}  END   {name} ({encounter_id}) {} {fight_time_ms:?} ms",
                    if *success { "KILL" } else { "WIPE" }
                ));
            }
            Kind::Damage {
                source_kind, damage, ..
            } => {
                if *source_kind != DamageSource::SwingLanded {
                    if let Some(s) = stats_for(&mut players, &rec.source) {
                        s.damage += damage.amount;
                    }
                    if let Some(s) = stats_for(&mut players, &rec.dest) {
                        s.taken += damage.amount;
                    }
                }
            }
            Kind::Heal { heal, .. } => {
                if let Some(s) = stats_for(&mut players, &rec.source) {
                    s.healing += heal.amount - heal.overheal;
                    s.overheal += heal.overheal;
                }
            }
            Kind::Died { .. } => {
                let who = rec.dest.name.clone().unwrap_or_else(|| rec.dest.guid.clone());
                if let Some(s) = stats_for(&mut players, &rec.dest) {
                    s.deaths += 1;
                }
                deaths.push(format!("{at}  {who}"));
            }
            _ => {}
        }
    }

    println!("file     {path}");
    println!("header   {header}");
    if let Some(f) = first {
        println!(
            "span     {} → {} ({:.1} min)",
            time::format(f),
            time::format(last),
            (last - f) as f64 / 60_000.0
        );
    }
    println!("records  {total}   bad lines {}", bad.len());

    println!("\n== events");
    let mut by_count: Vec<_> = counts.iter().collect();
    by_count.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    for (k, v) in by_count {
        println!("{v:>8}  {k}");
    }

    println!("\n== zones / maps");
    for z in &zones {
        println!("{z}");
    }
    println!("\n== encounters");
    if encounters.is_empty() {
        println!("(none)");
    }
    for e in &encounters {
        println!("{e}");
    }

    println!("\n== players{}", if group_only { " (group only)" } else { "" });
    println!(
        "{:<28} {:>5} {:>10} {:>10} {:>10} {:>10} {:>6}",
        "name", "group", "damage", "healing", "overheal", "taken", "deaths"
    );
    let mut list: Vec<_> = players.values().filter(|p| !group_only || p.group).collect();
    list.sort_by(|a, b| b.damage.cmp(&a.damage).then(b.healing.cmp(&a.healing)));
    for p in list {
        println!(
            "{:<28} {:>5} {:>10} {:>10} {:>10} {:>10} {:>6}",
            p.name,
            if p.group { "yes" } else { "" },
            p.damage,
            p.healing,
            p.overheal,
            p.taken,
            p.deaths
        );
    }

    println!(
        "\n== deaths ({} total, showing {})",
        deaths.len(),
        deaths.len().min(max_deaths)
    );
    for d in deaths.iter().take(max_deaths) {
        println!("{d}");
    }

    if !bad.is_empty() {
        println!("\n== bad lines (first 10)");
        for b in bad.iter().take(10) {
            println!("line {}: {}", b.line_no, b.error);
        }
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}
