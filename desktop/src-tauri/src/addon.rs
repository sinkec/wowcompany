//! Link with the WowCompany WoW addon – both directions, through files (an addon has no network
//! and cannot write files; the game saves its SavedVariables on `/reload`, logout and exit).
//!
//! * addon → app: `WTF/Account/<account>/SavedVariables/WowCompany.lua`, table `export` = a list
//!   of strings in our own line format, so no Lua parser is needed here:
//!   `v1|META|<addon version>|<epoch s>`
//!   `v1|RUN|<instance id>|<start epoch s>|<end epoch s or 0>|<zone>|<leader or empty>`
//!   `v1|CHAR|<name>|<level>|<class>|<crit %>|<attack power>|<armor>|<item level>|<epoch s>`
//!   `v1|LOOT|<epoch s>|<item id>|<quality 0-6 or empty>|<count>|<item name>` (no looter: the
//!   chat log has that; this adds the id and quality the chat log lacks)
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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonLoot {
    /// UTC milliseconds.
    pub at: i64,
    pub item_id: u32,
    pub quality: Option<u8>,
    pub count: u32,
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonExport {
    pub version: Option<String>,
    /// When the addon wrote it (UTC ms).
    pub at: Option<i64>,
    pub runs: Vec<AddonRun>,
    pub chars: Vec<AddonChar>,
    /// What the character wears, with the item levels the game shows (`v1|GEAR|…`).
    #[serde(skip)]
    pub gear: Vec<AddonGear>,
    pub loot: Vec<AddonLoot>,
    /// Opt-in diagnostics report ("Help development" in the addon), sent to the portal once.
    #[serde(skip)]
    pub diag: Option<AddonDiag>,
    /// Item details by item id (`v1|ITEM|…`).
    #[serde(skip)]
    pub items: std::collections::BTreeMap<u32, wowrun::summary::ItemDetail>,
    /// The in-game calendar's holidays (`v1|CALWIN|…`, `v1|CAL|…`), for the portal's calendar.
    #[serde(skip)]
    pub calendar: Option<AddonCalendar>,
}

/// The character's gear as the game shows it: the Blizzard web API stopped giving item levels
/// for WoW Forever characters (26. 11. 2026), so the portal takes them from here.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonGear {
    pub name: String,
    pub ilvl: f64,
    pub ilvl_best: f64,
    pub items: Vec<AddonGearItem>,
    /// UTC milliseconds.
    pub at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonGearItem {
    /// Inventory slot id (1 head … 19 tabard).
    pub slot: u8,
    pub item_id: u32,
    pub ilvl: Option<u32>,
}

/// Holidays and system notices of this month and the next (never player or guild events).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonCalendar {
    /// Window the addon read (UTC ms): events in it that are missing here were cancelled.
    pub from: i64,
    pub to: i64,
    pub events: Vec<AddonCalEvent>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonCalEvent {
    pub start_at: i64,
    pub end_at: i64,
    /// `holiday` or `system`
    pub kind: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct AddonDiag {
    /// When the addon wrote it (UTC ms).
    pub at: i64,
    pub version: String,
    /// The report as JSON text.
    pub json: String,
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
        // an element of the export list (`"v1|…",`) or a single field (`["diag"] = "v1|DIAG|…",`)
        let Some(pos) = raw.find("\"v1|") else {
            continue;
        };
        let rest = &raw[pos + 1..];
        let Some(line) = lua_string(rest) else { continue };
        if line.starts_with("v1|DIAG|") {
            let f: Vec<&str> = line.splitn(5, '|').collect();
            if let (Some(at), Some(version), Some(json)) =
                (f.get(2).and_then(|s| secs_to_ms(s)), f.get(3), f.get(4))
            {
                out.diag = Some(AddonDiag {
                    at,
                    version: version.to_string(),
                    json: json.to_string(),
                });
            }
            continue;
        }
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
            Some("LOOT") if f.len() >= 7 => {
                let (Some(at), Ok(item_id)) = (secs_to_ms(f[2]), f[3].trim().parse::<u32>()) else {
                    continue;
                };
                out.loot.push(AddonLoot {
                    at,
                    item_id,
                    quality: f[4].trim().parse::<u8>().ok().filter(|q| *q <= 6),
                    count: f[5].trim().parse().unwrap_or(1),
                    name: f[6..].join("|").trim().to_string(),
                });
            }
            Some("ITEM") if f.len() >= 11 => {
                let Ok(item_id) = f[2].trim().parse::<u32>() else { continue };
                let txt = |s: &str| Some(s.trim().to_string()).filter(|s| !s.is_empty());
                out.items.insert(
                    item_id,
                    wowrun::summary::ItemDetail {
                        item_id,
                        ilvl: f[3].trim().parse().ok(),
                        req_level: f[4].trim().parse().ok(),
                        slot: txt(f[5]),
                        kind: txt(f[6]),
                        subkind: txt(f[7]),
                        sell: f[8].trim().parse().ok(),
                        bind: txt(f[9]),
                        lines: f[10..]
                            .join("|")
                            .split('~')
                            .map(str::trim)
                            .filter(|l| !l.is_empty())
                            .take(30)
                            .map(|l| l.chars().take(150).collect())
                            .collect(),
                    },
                );
            }
            Some("CALWIN") if f.len() >= 4 => {
                if let (Some(from), Some(to)) = (secs_to_ms(f[2]), secs_to_ms(f[3])) {
                    out.calendar.get_or_insert_with(Default::default).from = from;
                    out.calendar.get_or_insert_with(Default::default).to = to;
                }
            }
            Some("CAL") if f.len() >= 7 => {
                let Some(start_at) = secs_to_ms(f[2]) else { continue };
                let kind = f[4].trim();
                if kind != "holiday" && kind != "system" {
                    continue;
                }
                let cal = out.calendar.get_or_insert_with(Default::default);
                if cal.events.len() < 200 {
                    cal.events.push(AddonCalEvent {
                        start_at,
                        end_at: secs_to_ms(f[3]).unwrap_or(start_at),
                        kind: kind.to_string(),
                        title: f[5].trim().chars().take(80).collect(),
                        description: f[6..].join(" ").trim().chars().take(600).collect(),
                    });
                }
            }
            Some("GEAR") if f.len() >= 7 => {
                let items: Vec<AddonGearItem> = f[5]
                    .split(',')
                    .filter_map(|it| {
                        let mut p = it.split(':');
                        let slot = p.next()?.trim().parse().ok().filter(|s| (1..=19).contains(s))?;
                        let item_id = p.next()?.trim().parse().ok().filter(|&id| id > 0)?;
                        let ilvl = p.next().and_then(|l| l.trim().parse().ok()).filter(|&l| l > 0 && l < 1000);
                        Some(AddonGearItem { slot, item_id, ilvl })
                    })
                    .take(19)
                    .collect();
                let name = f[2].trim().to_string();
                if !name.is_empty() && !items.is_empty() {
                    out.gear.push(AddonGear {
                        name,
                        ilvl: f[3].trim().parse().unwrap_or(0.0),
                        ilvl_best: f[4].trim().parse().unwrap_or(0.0),
                        items,
                        at: secs_to_ms(f[6]).unwrap_or(0),
                    });
                }
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

/// How far apart the same loot may be in the chat log (local clock) and in the addon (server clock).
const LOOT_SLACK_MS: i64 = 5 * 60_000;

/// Fills in item id and quality of the run's loot from the addon (the chat log has neither).
/// Matched by item name and time; each addon line is used once. Returns whether anything changed.
pub fn enrich_loot(export: &AddonExport, run: &mut RunSummary) -> bool {
    let mut used = vec![false; export.loot.len()];
    let mut changed = false;
    for drop in run.loot.iter_mut() {
        if drop.item_id.is_some() && drop.quality.is_some() {
            continue;
        }
        let at = run.started_at + drop.at_ms;
        let best = export
            .loot
            .iter()
            .enumerate()
            .filter(|(i, l)| !used[*i] && l.name.eq_ignore_ascii_case(&drop.item) && (l.at - at).abs() <= LOOT_SLACK_MS)
            .min_by_key(|(_, l)| (l.at - at).abs());
        if let Some((i, l)) = best {
            used[i] = true;
            if drop.item_id.is_none() {
                drop.item_id = Some(l.item_id);
                changed = true;
            }
            if drop.quality.is_none() && l.quality.is_some() {
                drop.quality = l.quality;
                changed = true;
            }
        }
    }
    changed
}

/// Everything the addon knows about a run: leader and loot details. `(changed, leader added)`.
pub fn apply(export: &AddonExport, run: &mut RunSummary) -> (bool, bool) {
    let mut leader_added = false;
    if run.leader.is_none()
        && let Some(l) = leader_for(export, run)
    {
        run.leader = Some(l);
        leader_added = true;
    }
    let loot = enrich_loot(export, run);
    if loot {
        // the rolled items get the id/quality the loot just learned
        run.link_rolls_to_loot();
    }
    // the game's own item details for what dropped (and was rolled on)
    let ids: std::collections::BTreeSet<u32> = run
        .loot
        .iter()
        .filter_map(|l| l.item_id)
        .chain(run.rolls.iter().filter_map(|r| r.item_id))
        .collect();
    let items: Vec<_> = ids.iter().filter_map(|id| export.items.get(id).cloned()).collect();
    let items_added = items.len() > run.items.len();
    if items_added {
        run.items = items;
    }
    (leader_added || loot || items_added, leader_added)
}

// ------------------------------------------------------------------ installing the addon

/// The addon as shipped inside this app (same files as `addon/WowCompany` in the repository).
const BUNDLED: &[(&str, &str)] = &[
    (
        "WowCompany.toc",
        include_str!("../../../addon/WowCompany/WowCompany.toc"),
    ),
    (
        "CompanionData.lua",
        include_str!("../../../addon/WowCompany/CompanionData.lua"),
    ),
    ("Core.lua", include_str!("../../../addon/WowCompany/Core.lua")),
    ("Logging.lua", include_str!("../../../addon/WowCompany/Logging.lua")),
    ("Meter.lua", include_str!("../../../addon/WowCompany/Meter.lua")),
    ("Export.lua", include_str!("../../../addon/WowCompany/Export.lua")),
    ("Calendar.lua", include_str!("../../../addon/WowCompany/Calendar.lua")),
    ("Party.lua", include_str!("../../../addon/WowCompany/Party.lua")),
    ("Summary.lua", include_str!("../../../addon/WowCompany/Summary.lua")),
    ("Window.lua", include_str!("../../../addon/WowCompany/Window.lua")),
    ("Options.lua", include_str!("../../../addon/WowCompany/Options.lua")),
    ("Minimap.lua", include_str!("../../../addon/WowCompany/Minimap.lua")),
    ("Probe.lua", include_str!("../../../addon/WowCompany/Probe.lua")),
];

/// Images of the addon (logo for the window and the minimap button), installed into `Media/`.
const BUNDLED_MEDIA: &[(&str, &[u8])] = &[
    ("Logo.tga", include_bytes!("../../../addon/WowCompany/Media/Logo.tga")),
    ("LogoSmall.tga", include_bytes!("../../../addon/WowCompany/Media/LogoSmall.tga")),
];

fn toc_version(toc: &str) -> Option<String> {
    toc.lines()
        .find_map(|l| l.strip_prefix("## Version:"))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// `a` is a newer version than `b` (`0.5.10` > `0.5.9`; anything beats `?`).
pub fn is_newer(a: &str, b: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> { v.split('.').map(|p| p.trim().parse().unwrap_or(0)).collect() };
    let (x, y) = (parts(a), parts(b));
    for i in 0..x.len().max(y.len()) {
        let (p, q) = (x.get(i).copied().unwrap_or(0), y.get(i).copied().unwrap_or(0));
        if p != q {
            return p > q;
        }
    }
    false
}

/// Lua files the `.toc` lists. WoW reads the list only when the game starts: a new file in an
/// update needs a game restart, changed code alone is picked up by `/reload`.
fn toc_files(toc: &str) -> Vec<String> {
    toc.lines()
        .map(str::trim)
        .filter(|l| l.ends_with(".lua"))
        .map(str::to_string)
        .collect()
}

/// Would the installed addon need a game restart (not just `/reload`) to load the bundled one?
pub fn update_needs_restart(logs_dir: &Path) -> bool {
    let Some(old) = addon_dir(logs_dir).and_then(|d| fs::read_to_string(d.join("WowCompany.toc")).ok())
    else {
        return true;
    };
    // new images (not there yet) are also only found after a restart, to be safe
    let media_new = addon_dir(logs_dir)
        .is_some_and(|d| BUNDLED_MEDIA.iter().any(|(n, _)| !d.join("Media").join(n).is_file()));
    toc_files(&old) != toc_files(BUNDLED[0].1) || media_new
}

/// Version of the addon inside this app.
pub fn bundled_version() -> String {
    toc_version(BUNDLED[0].1).unwrap_or_default()
}

/// Version of the addon in the game folder, `None` when it is not installed.
pub fn installed_version(logs_dir: &Path) -> Option<String> {
    let toc = fs::read_to_string(addon_dir(logs_dir)?.join("WowCompany.toc")).ok()?;
    Some(toc_version(&toc).unwrap_or_else(|| "?".to_string()))
}

/// Copies the bundled addon into `<game>/Interface/AddOns/WowCompany` (install or update).
/// An existing `CompanionData.lua` (the records this app wrote) is kept. Returns the version.
pub fn install(logs_dir: &Path) -> Result<String, String> {
    let game = game_dir(logs_dir)
        .filter(|g| g.is_dir())
        .ok_or("Game folder not found next to the Logs folder.")?;
    // every file listed in the .toc must be in the bundle, or the addon would fail to load in game
    for listed in BUNDLED[0].1.lines().map(str::trim).filter(|l| l.ends_with(".lua")) {
        if !BUNDLED.iter().any(|(name, _)| *name == listed) {
            return Err(format!("addon bundle is missing {listed}"));
        }
    }
    let dir = game.join("Interface").join("AddOns").join("WowCompany");
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    for (name, text) in BUNDLED {
        let path = dir.join(name);
        if *name == "CompanionData.lua" && path.exists() {
            continue;
        }
        fs::write(&path, text).map_err(|e| format!("cannot write {name}: {e}"))?;
    }
    // files of older versions that the addon no longer has (e.g. UI.lua before 0.6.4)
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.ends_with(".lua") && name != "CompanionData.lua" && !BUNDLED.iter().any(|(n, _)| *n == name) {
                let _ = fs::remove_file(e.path());
            }
        }
    }
    let media = dir.join("Media");
    fs::create_dir_all(&media).map_err(|e| format!("cannot create {}: {e}", media.display()))?;
    for (name, bytes) in BUNDLED_MEDIA {
        fs::write(media.join(name), bytes).map_err(|e| format!("cannot write Media/{name}: {e}"))?;
    }
    Ok(bundled_version())
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
"v1|GEAR|Grobos Stinkfoot|11.75|12.50|4:6096:,16:2084:33,99:1:1,7:x:3|1794700000",
"v1|RUN|broken", -- [5]
"v1|LOOT|1794690600|2084|3|1|Darksteel Bastard Sword", -- [7]
"v1|LOOT|1794690700|2589||3|Linen Cloth", -- [8]
"v1|LOOT|1794690900|2589|1|2|Linen Cloth", -- [9]
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
        assert_eq!(e.gear.len(), 1);
        let g = &e.gear[0];
        assert_eq!((g.name.as_str(), g.ilvl, g.ilvl_best, g.at), ("Grobos Stinkfoot", 11.75, 12.5, 1_794_700_000_000));
        // a bad slot and a bad item id are skipped, an unknown item level stays empty
        assert_eq!(
            g.items,
            vec![
                AddonGearItem { slot: 4, item_id: 6096, ilvl: None },
                AddonGearItem { slot: 16, item_id: 2084, ilvl: Some(33) }
            ]
        );
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

    #[test]
    fn loot_gets_id_and_quality_from_the_addon() {
        let e = parse_export(SAVED);
        assert_eq!(e.loot.len(), 3);
        assert_eq!(
            (e.loot[0].item_id, e.loot[0].quality, e.loot[0].count),
            (2084, Some(3), 1)
        );
        assert_eq!(e.loot[1].quality, None);

        let mut r = run("Wailing Caverns", 43, 1_794_690_200, 1_794_691_700);
        let drop = |item: &str, at_s: i64| wowrun::LootDrop {
            slug: None,
            looter: "Someone".into(),
            item: item.into(),
            item_id: None,
            quality: None,
            count: 1,
            at_ms: (at_s - 1_794_690_200) * 1000,
        };
        r.loot = vec![
            drop("Darksteel Bastard Sword", 1_794_690_610),
            drop("Linen Cloth", 1_794_690_890), // nearest addon line is the second Linen Cloth
            drop("Linen Cloth", 1_794_690_705),
            drop("Mystery Meat", 1_794_690_700),            // the addon never saw it
            drop("Darksteel Bastard Sword", 1_794_699_000), // hours later: not the same drop
        ];
        assert!(enrich_loot(&e, &mut r));
        assert_eq!((r.loot[0].item_id, r.loot[0].quality), (Some(2084), Some(3)));
        assert_eq!((r.loot[1].item_id, r.loot[1].quality), (Some(2589), Some(1)));
        assert_eq!(
            (r.loot[2].item_id, r.loot[2].quality),
            (Some(2589), None),
            "id known, quality not"
        );
        assert_eq!((r.loot[3].item_id, r.loot[3].quality), (None, None));
        assert_eq!((r.loot[4].item_id, r.loot[4].quality), (None, None));
        assert_eq!(
            r.loot[0].looter, "Someone",
            "the looter comes from the chat log, untouched"
        );
        // leader and loot in one go; a second pass has nothing left to do for the leader
        let mut again = run("Wailing Caverns", 43, 1_794_690_200, 1_794_691_700);
        assert_eq!(apply(&e, &mut again), (true, true));
        assert_eq!(apply(&e, &mut again), (false, false));
    }

    #[test]
    fn reads_item_details_and_attaches_them_to_the_loot() {
        let sv = r#"WowCompanyDB = {
["export"] = {
"v1|ITEM|2084|30|25|Two-Hand|Weapon|Two-Handed Swords|7137|Binds when equipped|Binds when equipped~24 - 36 Damage  Speed 3.20~+8 Strength",
"v1|CALWIN|1793487600|1798758000",
"v1|CAL|1794700800|1794960000|holiday|Darkmoon Faire|Games and prizes",
"v1|CAL|1794700800|1794700800|player|Secret raid|",
},
}"#;
        let e = parse_export(sv);
        let cal = e.calendar.as_ref().expect("calendar");
        assert_eq!((cal.from, cal.to), (1_793_487_600_000, 1_798_758_000_000));
        assert_eq!(cal.events.len(), 1, "player events are never taken");
        assert_eq!(cal.events[0].title, "Darkmoon Faire");
        assert_eq!(cal.events[0].end_at, 1_794_960_000_000);
        let it = e.items.get(&2084).expect("item");
        assert_eq!(it.ilvl, Some(30));
        assert_eq!(it.slot.as_deref(), Some("Two-Hand"));
        assert_eq!(it.lines, vec!["Binds when equipped", "24 - 36 Damage  Speed 3.20", "+8 Strength"]);
        let mut run = run("Wailing Caverns", 43, 1_794_690_200, 1_794_691_700);
        run.loot = vec![wowrun::LootDrop {
            slug: None,
            looter: "Someone".into(),
            item: "Darksteel Bastard Sword".into(),
            item_id: Some(2084),
            quality: Some(3),
            count: 1,
            at_ms: 1000,
        }];
        let (changed, _) = apply(&e, &mut run);
        assert!(changed);
        assert_eq!(run.items.len(), 1);
        assert_eq!(run.items[0].sell, Some(7137));
    }

    #[test]
    fn reads_the_diagnostics_line() {
        let sv = r#"WowCompanyDB = {
["diag"] = "v1|DIAG|1794800000|0.5.6|{\"meter\":{\"secret\":true},\"note\":\"a|b\"}",
["export"] = {
"v1|META|0.5.6|1794800000",
},
}"#;
        let e = parse_export(sv);
        let d = e.diag.expect("diag");
        assert_eq!(d.at, 1_794_800_000_000);
        assert_eq!(d.version, "0.5.6");
        assert_eq!(d.json, r#"{"meter":{"secret":true},"note":"a|b"}"#);
        assert_eq!(e.version.as_deref(), Some("0.5.6"));
    }

    #[test]
    fn versions_compare_by_number() {
        assert!(is_newer("0.5.10", "0.5.9"));
        assert!(is_newer("0.6", "0.5.9"));
        assert!(is_newer("0.5.3", "?"));
        assert!(!is_newer("0.5.3", "0.5.3"));
        assert!(!is_newer("0.5.2", "0.5.3"));
    }

    #[test]
    fn installs_and_updates_the_bundled_addon() {
        let t = TempDir::new("addon-install");
        let logs = t.path().join("Logs");
        fs::create_dir_all(&logs).unwrap();
        assert_eq!(installed_version(&logs), None);
        assert!(!bundled_version().is_empty());

        let v = install(&logs).unwrap();
        assert_eq!(v, bundled_version());
        assert_eq!(installed_version(&logs), Some(v.clone()));
        let dir = addon_dir(&logs).unwrap();
        // every file the .toc lists is there
        let toc = fs::read_to_string(dir.join("WowCompany.toc")).unwrap();
        for f in toc.lines().filter(|l| l.trim().ends_with(".lua")) {
            assert!(dir.join(f.trim()).is_file(), "{f} missing");
        }
        for (name, _) in BUNDLED_MEDIA {
            assert!(dir.join("Media").join(name).is_file(), "Media/{name} missing");
        }
        // an update keeps the records the app wrote and repairs a damaged file
        fs::write(
            dir.join("CompanionData.lua"),
            "WowCompanyCompanionData = { schema = 1 }",
        )
        .unwrap();
        fs::write(dir.join("Core.lua"), "broken").unwrap();
        fs::write(dir.join("WowCompany.toc"), "## Version: 0.0.1\n").unwrap();
        assert_eq!(installed_version(&logs).as_deref(), Some("0.0.1"));
        install(&logs).unwrap();
        assert_eq!(installed_version(&logs), Some(v));
        assert!(
            fs::read_to_string(dir.join("CompanionData.lua"))
                .unwrap()
                .contains("schema = 1")
        );
        assert!(
            fs::read_to_string(dir.join("Core.lua"))
                .unwrap()
                .contains("WowCompany addon core")
        );
        // no game folder at all
        assert!(install(Path::new("/definitely/not/here/Logs")).is_err());
    }
}
