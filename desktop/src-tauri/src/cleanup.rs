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
