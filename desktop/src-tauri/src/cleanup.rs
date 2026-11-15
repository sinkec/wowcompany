//! Deleting combat and chat logs (on app exit or on demand).
//!
//! Safety rules – a file is kept when:
//! * it feeds a run that is still in progress (`protect`), or
//! * the game wrote to it within `recent` (WoW is probably still logging into it: on Linux
//!   the game would keep writing into a deleted file and the data would be lost; on Windows
//!   the delete simply fails while the game holds the file).

use crate::locate::{is_chat_log, is_combat_log};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub deleted: Vec<String>,
    /// `(file, why)`
    pub kept: Vec<(String, String)>,
    pub freed_bytes: u64,
    /// Wall-clock ms when it ran.
    pub at: i64,
    /// Set when the automatic cleanup did not run: why the logs are still needed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting: Option<String>,
}

/// Is the game running right now? `None` = could not tell (treated as "maybe").
///
/// When WoW is closed nothing can still be writing the logs, so they can all go; while it
/// runs, a file written in the last two minutes is kept (see the rules above).
pub fn game_running() -> Option<bool> {
    game_running_impl()
}

/// A process name or command line that belongs to the game client.
fn is_game_process(text: &str) -> bool {
    let t = text.to_ascii_lowercase();
    ["wow.exe", "wowclassic.exe", "wow-64.exe"]
        .iter()
        .any(|n| t.contains(n))
}

#[cfg(target_os = "linux")]
fn game_running_impl() -> Option<bool> {
    // Under Proton/Wine the Windows path of the client is in the process command line.
    let entries = fs::read_dir("/proc").ok()?;
    for e in entries.filter_map(Result::ok) {
        let name = e.file_name();
        if !name.to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        if let Ok(cmd) = fs::read(e.path().join("cmdline"))
            && is_game_process(&String::from_utf8_lossy(&cmd))
        {
            return Some(true);
        }
    }
    Some(false)
}

#[cfg(target_os = "windows")]
fn game_running_impl() -> Option<bool> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(is_game_process(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn game_running_impl() -> Option<bool> {
    None
}

pub fn cleanup_logs(dir: &Path, protect: &[PathBuf], recent: Duration, now: SystemTime) -> CleanupReport {
    let mut report = CleanupReport::default();
    let Ok(entries) = fs::read_dir(dir) else { return report };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().unwrap_or_default().to_string_lossy();
            p.is_file() && (is_combat_log(&n) || is_chat_log(&n))
        })
        .collect();
    files.sort();
    for path in files {
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let meta = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if protect.iter().any(|p| p == &path) {
            report.kept.push((name, "a run is still being recorded from it".into()));
            continue;
        }
        let fresh = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .is_some_and(|age| age < recent);
        if fresh {
            report.kept.push((name, "the game is still writing to it".into()));
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => {
                report.freed_bytes += meta.len();
                report.deleted.push(name);
            }
            Err(e) => report.kept.push((name, format!("could not delete: {e}"))),
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn deletes_old_logs_but_keeps_active_and_protected_ones() {
        let t = TempDir::new("cleanup");
        let d = t.path();
        let old = SystemTime::now() - Duration::from_secs(3600);
        for n in [
            "WoWCombatLog-111326_173926.txt",
            "WoWCombatLog-111326_190000.txt",
            "WoWChatLog.txt",
            "WoWCombatLog-111326_200000.txt",
        ] {
            fs::write(d.join(n), "x".repeat(10)).unwrap();
        }
        for n in [
            "WoWCombatLog-111326_173926.txt",
            "WoWCombatLog-111326_190000.txt",
            "WoWChatLog.txt",
        ] {
            fs::File::options()
                .write(true)
                .open(d.join(n))
                .unwrap()
                .set_modified(old)
                .unwrap();
        }
        fs::write(d.join("Client.log"), "not ours").unwrap();
        fs::File::options()
            .write(true)
            .open(d.join("Client.log"))
            .unwrap()
            .set_modified(old)
            .unwrap();

        let protect = vec![d.join("WoWCombatLog-111326_190000.txt")];
        let r = cleanup_logs(d, &protect, Duration::from_secs(120), SystemTime::now());
        assert_eq!(r.deleted, vec!["WoWChatLog.txt", "WoWCombatLog-111326_173926.txt"]);
        assert_eq!(r.freed_bytes, 20);
        let kept: Vec<_> = r.kept.iter().map(|k| k.0.as_str()).collect();
        assert_eq!(
            kept,
            vec!["WoWCombatLog-111326_190000.txt", "WoWCombatLog-111326_200000.txt"]
        );
        assert!(d.join("Client.log").exists(), "other game logs are never touched");

        // nothing protected, everything old → all gone
        let later = SystemTime::now() + Duration::from_secs(3600);
        let r2 = cleanup_logs(d, &[], Duration::from_secs(120), later);
        assert_eq!(r2.deleted.len(), 2);
        assert!(r2.kept.is_empty());
    }

    #[test]
    fn recognises_the_game_process() {
        assert!(is_game_process(r"Z:\games\World of Warcraft\_forever_\Wow.exe"));
        assert!(is_game_process("\"WowClassic.exe\",\"1234\",\"Console\""));
        assert!(!is_game_process("/usr/bin/wowcompany-companion"));
        assert!(!is_game_process("firefox https://wowcompany.vercel.app"));
        // this test binary is not the game; on Linux the answer is a definite yes/no
        #[cfg(target_os = "linux")]
        assert!(game_running().is_some());
    }

    #[test]
    fn closed_game_means_fresh_files_go_too() {
        let t = TempDir::new("cleanup-closed");
        let d = t.path();
        fs::write(d.join("WoWCombatLog-111426_200000.txt"), "fresh").unwrap();
        fs::write(d.join("WoWChatLog.txt"), "fresh").unwrap();
        // game still open: both were written just now → kept
        let open = cleanup_logs(d, &[], Duration::from_secs(120), SystemTime::now());
        assert!(open.deleted.is_empty() && open.kept.len() == 2);
        // game closed: no grace window
        let closed = cleanup_logs(d, &[], Duration::ZERO, SystemTime::now());
        assert_eq!(closed.deleted.len(), 2);
        assert!(closed.kept.is_empty());
    }

    #[test]
    fn missing_folder_is_fine() {
        let r = cleanup_logs(
            Path::new("/definitely/not/here"),
            &[],
            Duration::from_secs(1),
            SystemTime::now(),
        );
        assert_eq!(r, CleanupReport::default());
    }
}
