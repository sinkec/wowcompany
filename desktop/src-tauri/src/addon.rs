//! Link with the WowCompany WoW addon – both directions, through files (an addon has no network
//! and cannot write files; the game saves its SavedVariables on `/reload`, logout and exit).
//!
//! * addon → app: `WTF/Account/<account>/SavedVariables/WowCompany.lua`, table `export` = a list
//!   of strings in our own line format, so no Lua parser is needed here:
//!   `v1|META|<addon version>|<epoch s>`
//!   `v1|RUN|<instance id>|<start epoch s>|<end epoch s or 0>|<zone>|<leader or empty>`
//!   `v1|CHAR|<name>|<level>|<class>|<crit %>|<attack power>|<armor>|<item level>|<epoch s>`
//! * app → addon: `Interface/AddOns/WowCompany/CompanionData.lua` – the personal records, which the
//!   addon shows on its Records tab after the next `/reload` (the addon cannot see single hits).
//!
//! Folders are found from the Logs folder: `<game>/Logs` → `<game>/WTF`, `<game>/Interface`.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use wowrun::{PersonalUpload, RunSummary};

/// A run may start a little earlier/later for the addon (walking in) than for the combat log
/// (first pull), and the game server's clock is not this PC's clock.
const MATCH_SLACK_MS: i64 = 10 * 60_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonRun {
    pub instance_id: u32,
    /// UTC milliseconds.
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub zone: String,
    pub leader: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonChar {
    pub name: String,
    pub level: u32,
    pub class: String,
    pub crit: f64,
    pub attack_power: i64,
    pub armor: i64,
    pub item_level: f64,
    pub at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonExport {
    pub version: Option<String>,
    /// When the addon wrote it (UTC ms).
    pub at: Option<i64>,
    pub runs: Vec<AddonRun>,
    pub chars: Vec<AddonChar>,
}

/// The text between the quotes of a Lua string literal at the start of `s` (after the opening
/// quote), with `\"`, `\\` and `\ddd` undone. `None` if the literal never closes.
fn lua_string(s: &str) -> Option<String> {
    let mut out: Vec<u8> = Vec::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'"' => return Some(String::from_utf8_lossy(&out).into_owned()),
            b'\\' if i + 1 < b.len() => {
                let n = b[i + 1];
                if n.is_ascii_digit() {
                    let mut j = i + 1;
                    let mut v: u32 = 0;
                    while j < b.len() && j < i + 4 && b[j].is_ascii_digit() {
                        v = v * 10 + u32::from(b[j] - b'0');
                        j += 1;
                    }
                    out.push(v.min(255) as u8);
                    i = j;
                } else {
                    out.push(match n {
                        b'n' => b'\n',
                        b't' => b'\t',
                        other => other,
                    });
                    i += 2;
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    None
}

fn secs_to_ms(field: &str) -> Option<i64> {
    field.trim().parse::<i64>().ok().filter(|&s| s > 0).map(|s| s * 1000)
}

/// Reads the `v1|…` lines out of the SavedVariables text; everything else is ignored.
pub fn parse_export(text: &str) -> AddonExport {
    let mut out = AddonExport::default();
    for raw in text.lines() {
        let Some(rest) = raw.trim_start().strip_prefix('"') else {
            continue;
        };
        if !rest.starts_with("v1|") {
            continue;
        }
        let Some(line) = lua_string(rest) else { continue };
        let f: Vec<&str> = line.split('|').collect();
        match f.get(1).copied() {
            Some("META") if f.len() >= 4 => {
                out.version = Some(f[2].to_string()).filter(|v| !v.is_empty());
                out.at = secs_to_ms(f[3]);
            }
            Some("RUN") if f.len() >= 7 => {
                let Some(started_at) = secs_to_ms(f[3]) else { continue };
                out.runs.push(AddonRun {
                    instance_id: f[2].trim().parse().unwrap_or(0),
                    started_at,
                    ended_at: secs_to_ms(f[4]),
                    zone: f[5].trim().to_string(),
                    leader: Some(f[6].trim().to_string()).filter(|l| l.len() >= 2 && l.len() <= 80),
                });
            }
            Some("CHAR") if f.len() >= 10 => out.chars.push(AddonChar {
                name: f[2].trim().to_string(),
                level: f[3].trim().parse().unwrap_or(0),
                class: f[4].trim().to_string(),
                crit: f[5].trim().parse().unwrap_or(0.0),
                attack_power: f[6].trim().parse().unwrap_or(0),
                armor: f[7].trim().parse().unwrap_or(0),
                item_level: f[8].trim().parse().unwrap_or(0.0),
                at: secs_to_ms(f[9]).unwrap_or(0),
            }),
            _ => {}
        }
    }
    out
}

/// The party leader of `run` according to the addon: the addon run that overlaps it in time,
/// preferring the same dungeon name. `None` when the addon saw no such run or no leader.
pub fn leader_for(export: &AddonExport, run: &RunSummary) -> Option<String> {
    let overlaps = |a: &AddonRun| {
        let end = a.ended_at.unwrap_or(a.started_at + 6 * 3_600_000);
        a.started_at <= run.ended_at + MATCH_SLACK_MS && end >= run.started_at - MATCH_SLACK_MS
    };
    let with_leader: Vec<&AddonRun> = export
        .runs
        .iter()
        .filter(|a| a.leader.is_some() && overlaps(a))
        .collect();
    let same_zone = with_leader
        .iter()
        .find(|a| a.zone.eq_ignore_ascii_case(&run.zone.name) || a.instance_id == run.zone.instance_id);
    match (same_zone, with_leader.as_slice()) {
        (Some(a), _) => a.leader.clone(),
        (None, [only]) => only.leader.clone(),
        _ => None,
    }
}

fn game_dir(logs_dir: &Path) -> Option<&Path> {
    logs_dir.parent()
}

/// `<game>/Interface/AddOns/WowCompany` (whether or not it exists).
pub fn addon_dir(logs_dir: &Path) -> Option<PathBuf> {
    Some(game_dir(logs_dir)?.join("Interface").join("AddOns").join("WowCompany"))
}

/// The newest `WowCompany.lua` among the accounts of this game folder.
pub fn saved_variables(logs_dir: &Path) -> Option<PathBuf> {
    let accounts = game_dir(logs_dir)?.join("WTF").join("Account");
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for e in fs::read_dir(accounts).ok()?.filter_map(Result::ok) {
        let p = e.path().join("SavedVariables").join("WowCompany.lua");
        if let Ok(m) = fs::metadata(&p).and_then(|m| m.modified())
            && best.as_ref().is_none_or(|(t, _)| m > *t)
        {
            best = Some((m, p));
        }
    }
    best.map(|(_, p)| p)
}

fn lua_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' | '\r' => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// `CompanionData.lua`: the personal records as a plain Lua table the addon loads at login.
/// Deterministic (no timestamp of its own), so an unchanged file is not rewritten.
pub fn companion_data_lua(records: &PersonalUpload) -> String {
    let mut s = String::from(
        "-- Written by the WowCompany Companion app. Do not edit: it is replaced whenever a record falls.\n\
         -- The addon shows this on its Records tab after the next /reload.\n\
         WowCompanyCompanionData = {\n    schema = 1,\n    characters = {\n",
    );
    for c in &records.characters {
        s.push_str(&format!(
            "        [{}] = {{\n            name = {},\n            records = {{\n",
            lua_quote(&c.slug),
            lua_quote(&c.name)
        ));
        for r in &c.records {
            let kind = serde_json::to_value(r.kind)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            s.push_str(&format!(
                "                {{ kind = {}, amount = {}, spell = {}, unit = {}, zone = {}, inDungeon = {}, at = {} }},\n",
                lua_quote(&kind),
                r.amount,
                lua_quote(&r.spell),
                r.unit.as_deref().map_or("nil".to_string(), lua_quote),
                r.zone.as_deref().map_or("nil".to_string(), lua_quote),
                r.in_dungeon,
                r.at / 1000
            ));
        }
        s.push_str("            },\n        },\n");
    }
    s.push_str("    },\n}\n");
    s
}

/// Writes `CompanionData.lua` into the addon folder. `Ok(false)` = addon not installed or the
/// file already says the same.
pub fn write_companion_data(logs_dir: &Path, records: &PersonalUpload) -> std::io::Result<bool> {
    let Some(dir) = addon_dir(logs_dir).filter(|d| d.is_dir()) else {
        return Ok(false);
    };
    let path = dir.join("CompanionData.lua");
    let text = companion_data_lua(records);
    if fs::read_to_string(&path).is_ok_and(|old| old == text) {
        return Ok(false);
    }
    let tmp = dir.join("CompanionData.lua.tmp");
    fs::write(&tmp, &text)?;
    fs::rename(&tmp, &path)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    const SAVED: &str = r#"
WowCompanyDB = {
["settings"] = {
["autoLog"] = true,
},
["export"] = {
"v1|META|0.3.0|1794700000", -- [1]
"v1|RUN|43|1794690000|1794691800|Wailing Caverns|Fizzle Boom", -- [2]
"v1|RUN|389|1794695000|0|Ragefire Chasm|", -- [3]
"v1|CHAR|Grobos \"The\" Stinkfoot|18|MAGE|2.12|13|184|11.75|1794700000", -- [4]
"v1|RUN|broken", -- [5]
"v2|RUN|1|2|3|Future|Nobody", -- [6]
"not ours",
},
}
"#;

    fn run(zone: &str, instance_id: u32, start_s: i64, end_s: i64) -> RunSummary {
        let fixture = include_str!("../../../crates/wowlog/tests/fixtures/synthetic_rfc.txt");
        let mut det = wowrun::Detector::new(wowrun::Config::default());
        let mut runs = Vec::new();
        for l in fixture.lines() {
            if let Ok(r) = wowlog::parse_line(l) {
                runs.extend(det.push(&r));
            }
        }
        runs.extend(det.finish());
        let mut r = runs.remove(0);
        r.zone.name = zone.to_string();
        r.zone.instance_id = instance_id;
        r.started_at = start_s * 1000;
        r.ended_at = end_s * 1000;
        r
    }

    #[test]
    fn export_lines_are_read_and_junk_is_ignored() {
        let e = parse_export(SAVED);
        assert_eq!(e.version.as_deref(), Some("0.3.0"));
        assert_eq!(e.at, Some(1_794_700_000_000));
        assert_eq!(e.runs.len(), 2);
        assert_eq!(
            e.runs[0],
            AddonRun {
                instance_id: 43,
                started_at: 1_794_690_000_000,
                ended_at: Some(1_794_691_800_000),
                zone: "Wailing Caverns".into(),
                leader: Some("Fizzle Boom".into()),
            }
        );
        assert_eq!((e.runs[1].ended_at, e.runs[1].leader.clone()), (None, None));
        assert_eq!(e.chars.len(), 1);
        assert_eq!(e.chars[0].name, "Grobos \"The\" Stinkfoot");
        assert_eq!((e.chars[0].level, e.chars[0].crit, e.chars[0].armor), (18, 2.12, 184));
        assert_eq!(parse_export("garbage"), AddonExport::default());
    }

    #[test]
    fn leader_is_matched_by_time_and_dungeon() {
        let e = parse_export(SAVED);
        // combat log run starts a few minutes after the addon saw the door
        assert_eq!(
            leader_for(&e, &run("Wailing Caverns", 43, 1_794_690_200, 1_794_691_700)).as_deref(),
            Some("Fizzle Boom")
        );
        // same time, different name, but the only overlapping addon run → still it
        assert_eq!(
            leader_for(&e, &run("Jame Koče", 0, 1_794_690_200, 1_794_691_700)).as_deref(),
            Some("Fizzle Boom")
        );
        // a day later: no
        assert_eq!(
            leader_for(&e, &run("Wailing Caverns", 43, 1_794_790_000, 1_794_791_000)),
            None
        );
        // the addon run without a leader never matches
        assert_eq!(
            leader_for(&e, &run("Ragefire Chasm", 389, 1_794_695_100, 1_794_695_900)),
            None
        );
    }

    #[test]
    fn finds_files_and_writes_companion_data_once() {
        let t = TempDir::new("addon");
        let game = t.path();
        let logs = game.join("Logs");
        fs::create_dir_all(&logs).unwrap();
        assert_eq!(saved_variables(&logs), None);
        let sv = game.join("WTF/Account/ACC#1/SavedVariables");
        fs::create_dir_all(&sv).unwrap();
        fs::write(sv.join("WowCompany.lua"), SAVED).unwrap();
        assert_eq!(saved_variables(&logs), Some(sv.join("WowCompany.lua")));

        let mut personal = wowrun::Personal::new(0);
        for l in include_str!("../../../crates/wowlog/tests/fixtures/synthetic_rfc.txt").lines() {
            if let Ok(r) = wowlog::parse_line(l) {
                personal.push(&r);
            }
        }
        let up = personal.upload();
        // addon not installed → nothing is written anywhere
        assert!(!write_companion_data(&logs, &up).unwrap());
        let dir = addon_dir(&logs).unwrap();
        fs::create_dir_all(&dir).unwrap();
        assert!(write_companion_data(&logs, &up).unwrap());
        assert!(!write_companion_data(&logs, &up).unwrap(), "unchanged → not rewritten");
        let lua = fs::read_to_string(dir.join("CompanionData.lua")).unwrap();
        assert!(lua.contains("WowCompanyCompanionData = {"));
        assert!(
            lua.contains("[\"tankus-maximus\"] = {") && lua.contains("kind = \"hit\", amount = 40, spell = \"Melee\"")
        );
        assert!(!dir.join("CompanionData.lua.tmp").exists());
        assert_eq!(lua_quote("a\"b\\c\nd"), "\"a\\\"b\\\\c d\"");
    }
}
