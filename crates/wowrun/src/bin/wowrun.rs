//! `wowrun <WoWCombatLog-*.txt> [--compact] [--utc-offset-min N] [--min-players N]`
//!
//! Detects dungeon runs in a log and prints them as a JSON array (what the app would
//! upload). Diagnostics go to stderr.

use std::process::ExitCode;
use wowrun::{Config, Detector};

fn main() -> ExitCode {
    let mut path = None;
    let mut compact = false;
    let mut cfg = Config::default();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--compact" => compact = true,
            "--utc-offset-min" => {
                cfg.utc_offset_ms = args.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(0) * 60_000;
            }
            "--min-players" => cfg.min_players = args.next().and_then(|v| v.parse().ok()).unwrap_or(2),
            "-h" | "--help" => {
                eprintln!("usage: wowrun <WoWCombatLog-*.txt> [--compact] [--utc-offset-min N] [--min-players N]");
                return ExitCode::SUCCESS;
            }
            _ => path = Some(a),
        }
    }
    let Some(path) = path else {
        eprintln!("usage: wowrun <WoWCombatLog-*.txt> [--compact] [--utc-offset-min N] [--min-players N]");
        return ExitCode::from(2);
    };
    let reader = match wowlog::open(&path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("cannot open {path}: {e}");
            return ExitCode::from(1);
        }
    };

    let mut det = Detector::new(cfg);
    let mut runs = Vec::new();
    let mut bad = 0usize;
    for item in reader {
        match item {
            Ok(Ok(rec)) => runs.extend(det.push(&rec)),
            Ok(Err(b)) => {
                bad += 1;
                if bad <= 5 {
                    eprintln!("line {}: {}", b.line_no, b.error);
                }
            }
            Err(e) => {
                eprintln!("read error: {e}");
                return ExitCode::from(1);
            }
        }
    }
    runs.extend(det.finish());

    let json = if compact {
        serde_json::to_string(&runs)
    } else {
        serde_json::to_string_pretty(&runs)
    };
    match json {
        Ok(j) => {
            eprintln!(
                "runs {}  discarded (too few players) {}  bad lines {}  json {} KB",
                runs.len(),
                det.discarded(),
                bad,
                serde_json::to_string(&runs).map(|s| s.len() / 1024).unwrap_or(0)
            );
            println!("{j}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("json error: {e}");
            ExitCode::from(1)
        }
    }
}
