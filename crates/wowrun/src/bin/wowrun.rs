//! `wowrun <WoWCombatLog-*.txt> [--chat WoWChatLog.txt] [--compact] [--utc-offset-min N] [--min-players N]`
//!
//! Detects dungeon runs in a log and prints them as a JSON array (what the app would
//! upload). Diagnostics go to stderr.

use std::process::ExitCode;
use wowrun::{Config, Detector};

fn main() -> ExitCode {
    let mut path = None;
    let mut compact = false;
    let mut chat: Option<String> = None;
    let mut cfg = Config::default();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--compact" => compact = true,
            "--chat" => chat = args.next(),
            "--utc-offset-min" => {
                cfg.utc_offset_ms = args.next().and_then(|v| v.parse::<i64>().ok()).unwrap_or(0) * 60_000;
            }
            "--min-players" => cfg.min_players = args.next().and_then(|v| v.parse().ok()).unwrap_or(2),
            "-h" | "--help" => {
                eprintln!(
                    "usage: wowrun <WoWCombatLog-*.txt> [--chat WoWChatLog.txt] [--compact] [--utc-offset-min N] [--min-players N]"
                );
                return ExitCode::SUCCESS;
            }
            _ => path = Some(a),
        }
    }
    let Some(path) = path else {
        eprintln!(
            "usage: wowrun <WoWCombatLog-*.txt> [--chat WoWChatLog.txt] [--compact] [--utc-offset-min N] [--min-players N]"
        );
        return ExitCode::from(2);
    };
    let reader = match wowlog::open(&path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("cannot open {path}: {e}");
            return ExitCode::from(1);
        }
    };

    // chat log (loot + rolls), fed in time order between the combat records like the app does
    enum Chat {
        Loot(wowlog::Loot),
        Roll(wowlog::Roll),
        Group(wowlog::GroupLine),
    }
    let mut chat_lines: Vec<(i64, Chat)> = Vec::new();
    if let Some(c) = &chat {
        let year = 2026; // chat timestamps have no year; only order matters here
        match std::fs::read_to_string(c) {
            Ok(text) => {
                for line in text.lines() {
                    if let Some(l) = wowlog::parse_loot_line(line, year) {
                        chat_lines.push((l.timestamp, Chat::Loot(l)));
                    } else if let Some(r) = wowlog::parse_roll_line(line, year) {
                        chat_lines.push((r.timestamp, Chat::Roll(r)));
                    } else if let Some(g) = wowlog::parse_group_line(line, year) {
                        chat_lines.push((g.timestamp, Chat::Group(g)));
                    }
                }
            }
            Err(e) => {
                eprintln!("cannot read {c}: {e}");
                return ExitCode::from(1);
            }
        }
    }
    let mut chat_iter = chat_lines.into_iter().peekable();

    let mut det = Detector::new(cfg);
    let mut runs = Vec::new();
    let mut bad = 0usize;
    for item in reader {
        match item {
            Ok(Ok(rec)) => {
                while let Some((_, c)) = chat_iter.next_if(|(t, _)| *t <= rec.timestamp) {
                    match c {
                        Chat::Loot(l) => det.push_loot(&l),
                        Chat::Roll(r) => det.push_roll(&r),
                        Chat::Group(g) => det.push_group(&g),
                    }
                }
                runs.extend(det.push(&rec));
            }
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
