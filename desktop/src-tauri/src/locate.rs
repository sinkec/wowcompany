//! Finding the WoW `Logs` folder.
//!
//! Verified 13. 11. 2026 on Linux: Battle.net added to Steam as a non-Steam game (Proton) →
//! `~/.steam/debian-installation/steamapps/compatdata/<shortcut id>/pfx/drive_c/Program Files (x86)/
//! World of Warcraft/_forever_/Logs`. Windows paths and Lutris/Bottles are educated guesses.

use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: PathBuf,
    /// `_forever_`, `_classic_era_`, `_retail_` …
    pub flavor: String,
    /// Newest combat log in the folder (file name) and its age in seconds.
    pub newest_log: Option<String>,
    pub newest_age_secs: Option<u64>,
}

const WOW_SUBDIRS: &[&str] = &[
    "Program Files (x86)/World of Warcraft",
    "Program Files/World of Warcraft",
    "Games/World of Warcraft",
    "World of Warcraft",
];

/// All plausible `Logs` folders on this machine, best first.
pub fn candidates() -> Vec<Candidate> {
    let mut wow_dirs = Vec::new();
    if cfg!(windows) {
        for drive in b'C'..=b'Z' {
            let root = PathBuf::from(format!("{}:\\", drive as char));
            if root.exists() {
                wow_dirs.extend(WOW_SUBDIRS.iter().map(|s| root.join(s)));
            }
        }
    } else if let Some(home) = home_dir() {
        for prefix in wine_prefixes(&home) {
            wow_dirs.extend(WOW_SUBDIRS.iter().map(|s| prefix.join("drive_c").join(s)));
        }
        if cfg!(target_os = "macos") {
            wow_dirs.push(PathBuf::from("/Applications/World of Warcraft"));
        }
    }
    from_wow_dirs(&wow_dirs)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_dir())
}

/// Wine prefixes (dirs containing `drive_c`): Steam/Proton compatdata, Lutris, Bottles, ~/.wine.
pub fn wine_prefixes(home: &Path) -> Vec<PathBuf> {
    let mut libraries: Vec<PathBuf> = Vec::new();
    for root in [
        ".steam/root",
        ".steam/steam",
        ".steam/debian-installation",
        ".local/share/Steam",
        ".var/app/com.valvesoftware.Steam/.local/share/Steam",
        "snap/steam/common/.local/share/Steam",
    ] {
        let root = home.join(root);
        if root.join("steamapps").is_dir() {
            libraries.extend(library_folders(&root));
            libraries.push(root);
        }
    }

    let mut prefixes = Vec::new();
    for lib in canonical_unique(libraries) {
        for entry in read_dirs(&lib.join("steamapps/compatdata")) {
            prefixes.push(entry.join("pfx"));
        }
    }
    prefixes.extend(read_dirs(&home.join("Games")));
    prefixes.extend(read_dirs(&home.join(".local/share/lutris/prefixes")));
    prefixes.extend(read_dirs(&home.join(".local/share/bottles/bottles")));
    prefixes.extend(read_dirs(
        &home.join(".var/app/com.usebottles.bottles/data/bottles/bottles"),
    ));
    prefixes.push(home.join(".wine"));
    canonical_unique(prefixes.into_iter().filter(|p| p.join("drive_c").is_dir()).collect())
}

/// Extra Steam libraries from `steamapps/libraryfolders.vdf` (`"path"  "/mnt/games/SteamLibrary"`).
fn library_folders(steam_root: &Path) -> Vec<PathBuf> {
    let Ok(text) = fs::read_to_string(steam_root.join("steamapps/libraryfolders.vdf")) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|l| {
            let l = l.trim();
            let rest = l.strip_prefix("\"path\"")?.trim();
            Some(PathBuf::from(rest.trim_matches('"').replace("\\\\", "\\")))
        })
        .filter(|p| p.join("steamapps").is_dir())
        .collect()
}

/// `World of Warcraft` dirs → `_flavor_/Logs` candidates (only existing ones), best first.
pub fn from_wow_dirs(wow_dirs: &[PathBuf]) -> Vec<Candidate> {
    let mut out = Vec::new();
    for wow in canonical_unique(wow_dirs.iter().filter(|p| p.is_dir()).cloned().collect()) {
        for flavor_dir in read_dirs(&wow) {
            let flavor = flavor_dir.file_name().unwrap_or_default().to_string_lossy().to_string();
            if !(flavor.starts_with('_') && flavor.ends_with('_')) {
                continue;
            }
            let logs = flavor_dir.join("Logs");
            if !logs.is_dir() {
                continue;
            }
            let newest = newest_combat_log(&logs);
            out.push(Candidate {
                path: logs,
                flavor,
                newest_log: newest
                    .as_ref()
                    .map(|(p, _)| p.file_name().unwrap_or_default().to_string_lossy().to_string()),
                newest_age_secs: newest
                    .and_then(|(_, t)| SystemTime::now().duration_since(t).ok())
                    .map(|d| d.as_secs()),
            });
        }
    }
    out.sort_by(|a, b| {
        let forever = |c: &Candidate| c.flavor != "_forever_";
        forever(a)
            .cmp(&forever(b))
            .then(
                a.newest_age_secs
                    .unwrap_or(u64::MAX)
                    .cmp(&b.newest_age_secs.unwrap_or(u64::MAX)),
            )
            .then(a.path.cmp(&b.path))
    });
    out
}

/// Is this a combat log file name? (`WoWCombatLog.txt`, `WoWCombatLog-111326_173926.txt`)
pub fn is_combat_log(name: &str) -> bool {
    name.starts_with("WoWCombatLog") && name.ends_with(".txt")
}

/// Is this a chat log file name? (`WoWChatLog.txt`)
pub fn is_chat_log(name: &str) -> bool {
    name.starts_with("WoWChatLog") && name.ends_with(".txt")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogKind {
    Combat,
    Chat,
}

impl LogKind {
    pub fn matches(self, name: &str) -> bool {
        match self {
            LogKind::Combat => is_combat_log(name),
            LogKind::Chat => is_chat_log(name),
        }
    }
}

/// Newest `WoWCombatLog*.txt` in `dir` by modification time.
pub fn newest_combat_log(dir: &Path) -> Option<(PathBuf, SystemTime)> {
    newest_log(dir, LogKind::Combat)
}

/// Newest log of a kind in `dir` by modification time.
pub fn newest_log(dir: &Path, kind: LogKind) -> Option<(PathBuf, SystemTime)> {
    fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| kind.matches(&e.file_name().to_string_lossy()))
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            m.is_file()
                .then(|| (e.path(), m.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
        })
        .max_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)))
}

fn read_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

fn canonical_unique(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    paths
        .into_iter()
        .filter_map(|p| fs::canonicalize(&p).ok())
        .filter(|p| seen.insert(p.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    fn mk(p: &Path) {
        fs::create_dir_all(p).unwrap();
    }

    #[test]
    fn finds_proton_prefix_and_prefers_forever() {
        let t = TempDir::new("locate");
        let home = t.path();
        // Steam root reached through a symlink (as ~/.steam/root -> debian-installation)
        let steam = home.join(".steam/debian-installation");
        let wow = steam.join("steamapps/compatdata/2726133678/pfx/drive_c/Program Files (x86)/World of Warcraft");
        mk(&wow.join("_forever_/Logs"));
        mk(&wow.join("_classic_era_/Logs"));
        mk(&wow.join("Data")); // not a flavor
        mk(&wow.join("_retail_")); // no Logs
        fs::write(wow.join("_classic_era_/Logs/WoWCombatLog-010126_100000.txt"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&steam, home.join(".steam/root")).unwrap();
        // Lutris prefix
        mk(&home.join("Games/battlenet/drive_c/Program Files (x86)/World of Warcraft/_forever_/Logs"));
        // not a prefix
        mk(&home.join("Games/notes"));

        let prefixes = wine_prefixes(home);
        assert_eq!(prefixes.len(), 2, "{prefixes:?}");

        let wow_dirs: Vec<PathBuf> = prefixes
            .iter()
            .flat_map(|p| WOW_SUBDIRS.iter().map(move |s| p.join("drive_c").join(s)))
            .collect();
        let c = from_wow_dirs(&wow_dirs);
        let flavors: Vec<_> = c.iter().map(|c| c.flavor.as_str()).collect();
        assert_eq!(flavors, vec!["_forever_", "_forever_", "_classic_era_"]);
        assert_eq!(c[2].newest_log.as_deref(), Some("WoWCombatLog-010126_100000.txt"));
    }

    #[test]
    fn newest_log_by_mtime() {
        let t = TempDir::new("newest");
        let a = t.path().join("WoWCombatLog-010126_100000.txt");
        let b = t.path().join("WoWCombatLog-020126_100000.txt");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        fs::write(t.path().join("WoWChatLog.txt"), "chat").unwrap();
        let old = SystemTime::now() - std::time::Duration::from_secs(3600);
        fs::File::options()
            .write(true)
            .open(&b)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert_eq!(newest_combat_log(t.path()).unwrap().0, a);
        assert!(is_combat_log("WoWCombatLog.txt") && !is_combat_log("WoWChatLog.txt"));
    }

    #[test]
    fn library_folders_vdf() {
        let t = TempDir::new("vdf");
        let root = t.path().join("steam");
        let lib = t.path().join("games/SteamLibrary");
        mk(&root.join("steamapps"));
        mk(&lib.join("steamapps"));
        fs::write(
            root.join("steamapps/libraryfolders.vdf"),
            format!(
                "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n",
                lib.display()
            ),
        )
        .unwrap();
        assert_eq!(library_folders(&root), vec![lib]);
    }
}
