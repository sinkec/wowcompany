//! Test helpers (temp dirs without extra crates, sample run).
#![cfg(test)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new(tag: &str) -> TempDir {
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!(
            "wowcompany-test-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        TempDir(p)
    }
    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A finished run from the wowlog fixture, with a chosen key and duration.
pub fn sample_run(run_key: &str, duration_ms: i64) -> wowrun::RunSummary {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../crates/wowlog/tests/fixtures/synthetic_rfc.txt"
    ))
    .unwrap();
    let mut det = wowrun::Detector::new(wowrun::Config::default());
    let mut runs = Vec::new();
    for l in text.lines() {
        runs.extend(det.push(&wowlog::parse_line(l).unwrap()));
    }
    runs.extend(det.finish());
    let mut r = runs.remove(0);
    r.run_key = run_key.to_string();
    r.duration_ms = duration_ms;
    r.ended_at = r.started_at + duration_ms;
    // order players as the tests expect
    r.players.sort_by_key(|p| match p.slug.as_str() {
        "tankus-maximus" => 0,
        _ => 1,
    });
    for p in r.players.iter_mut() {
        if p.slug == "tankus-maximus" {
            p.name = "Grobos Stinkfoot".into();
        }
        if p.slug == "fizzle-boom" {
            p.name = "Fizzle Boom".into();
        }
    }
    r.players
        .retain(|p| p.name == "Grobos Stinkfoot" || p.name == "Fizzle Boom");
    r
}
