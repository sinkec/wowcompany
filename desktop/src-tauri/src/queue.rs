//! Local run store + upload queue (SQLite in the app data dir).
//! A run stays here after upload so the "Runs" screen works offline.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::path::Path;
use wowrun::RunSummary;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Pending,
    Uploaded,
    /// Rejected by the server (4xx) – needs a human (retry button).
    Failed,
}

impl Status {
    fn parse(s: &str) -> Status {
        match s {
            "uploaded" => Status::Uploaded,
            "failed" => Status::Failed,
            _ => Status::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRow {
    pub run_key: String,
    pub zone: String,
    pub started_at: i64,
    pub duration_ms: i64,
    pub bosses_killed: i64,
    pub bosses_total: Option<i64>,
    pub deaths: i64,
    pub players: Vec<String>,
    pub status: Status,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub url: Option<String>,
    pub uploaded_at: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub pending: i64,
    pub uploaded: i64,
    pub failed: i64,
}

pub struct Due {
    pub run_key: String,
    pub json: String,
    pub attempts: i64,
}

pub struct Queue {
    db: Connection,
}

impl Queue {
    pub fn open(path: &Path) -> rusqlite::Result<Queue> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        Self::init(Connection::open(path)?)
    }

    pub fn in_memory() -> rusqlite::Result<Queue> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(db: Connection) -> rusqlite::Result<Queue> {
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS runs (
                run_key TEXT PRIMARY KEY,
                zone TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                bosses_killed INTEGER NOT NULL,
                bosses_total INTEGER,
                deaths INTEGER NOT NULL,
                players TEXT NOT NULL,
                json TEXT NOT NULL,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                url TEXT,
                created_at INTEGER NOT NULL,
                uploaded_at INTEGER
             );
             CREATE INDEX IF NOT EXISTS runs_status ON runs(status, next_attempt_at);
             CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at);",
        )?;
        Ok(Queue { db })
    }

    /// Stores a finished run. Returns `true` if it is new or replaced a shorter recording
    /// (re-reading the same log after a restart yields the same runKey → ignored).
    pub fn enqueue(&self, run: &RunSummary, now: i64) -> rusqlite::Result<bool> {
        let json = serde_json::to_string(run).expect("summary serialises");
        let players = serde_json::to_string(&run.players.iter().map(|p| p.name.clone()).collect::<Vec<_>>())
            .expect("names serialise");
        let deaths = run.deaths.len() as i64;
        let existing: Option<(i64, String)> = self
            .db
            .query_row(
                "SELECT duration_ms, status FROM runs WHERE run_key = ?1",
                [&run.run_key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match existing {
            Some((dur, _)) if dur >= run.duration_ms => Ok(false),
            Some(_) => {
                // longer recording of a known run → upload again (server keeps the better one)
                self.db.execute(
                    "UPDATE runs SET zone=?2, started_at=?3, duration_ms=?4, bosses_killed=?5, bosses_total=?6,
                        deaths=?7, players=?8, json=?9, status='pending', attempts=0, next_attempt_at=0, last_error=NULL
                     WHERE run_key=?1",
                    params![
                        run.run_key,
                        run.zone.name,
                        run.started_at,
                        run.duration_ms,
                        run.result.bosses_killed,
                        run.result.bosses_total,
                        deaths,
                        players,
                        json
                    ],
                )?;
                Ok(true)
            }
            None => {
                self.db.execute(
                    "INSERT INTO runs (run_key, zone, started_at, duration_ms, bosses_killed, bosses_total, deaths,
                        players, json, status, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10)",
                    params![
                        run.run_key,
                        run.zone.name,
                        run.started_at,
                        run.duration_ms,
                        run.result.bosses_killed,
                        run.result.bosses_total,
                        deaths,
                        players,
                        json,
                        now
                    ],
                )?;
                Ok(true)
            }
        }
    }

    pub fn due(&self, now: i64, limit: usize) -> rusqlite::Result<Vec<Due>> {
        let mut st = self.db.prepare(
            "SELECT run_key, json, attempts FROM runs WHERE status='pending' AND next_attempt_at <= ?1
             ORDER BY started_at LIMIT ?2",
        )?;
        st.query_map(params![now, limit as i64], |r| {
            Ok(Due {
                run_key: r.get(0)?,
                json: r.get(1)?,
                attempts: r.get(2)?,
            })
        })?
        .collect()
    }

    pub fn mark_uploaded(&self, run_key: &str, url: &str, now: i64) -> rusqlite::Result<()> {
        self.db.execute(
            "UPDATE runs SET status='uploaded', url=?2, uploaded_at=?3, last_error=NULL WHERE run_key=?1",
            params![run_key, url, now],
        )?;
        Ok(())
    }

    /// Temporary problem: try again at `next_at`.
    pub fn mark_retry(&self, run_key: &str, error: &str, next_at: i64) -> rusqlite::Result<()> {
        self.db.execute(
            "UPDATE runs SET attempts=attempts+1, next_attempt_at=?3, last_error=?2 WHERE run_key=?1",
            params![run_key, error, next_at],
        )?;
        Ok(())
    }

    pub fn mark_failed(&self, run_key: &str, error: &str) -> rusqlite::Result<()> {
        self.db.execute(
            "UPDATE runs SET status='failed', attempts=attempts+1, last_error=?2 WHERE run_key=?1",
            params![run_key, error],
        )?;
        Ok(())
    }

    /// Manual retry (or after re-linking): back to pending, due now.
    pub fn retry(&self, run_key: &str) -> rusqlite::Result<()> {
        self.db.execute(
            "UPDATE runs SET status='pending', next_attempt_at=0 WHERE run_key=?1 AND status != 'uploaded'",
            [run_key],
        )?;
        Ok(())
    }

    pub fn retry_all_failed(&self) -> rusqlite::Result<usize> {
        self.db.execute(
            "UPDATE runs SET status='pending', next_attempt_at=0 WHERE status='failed'",
            [],
        )
    }

    pub fn delete(&self, run_key: &str) -> rusqlite::Result<()> {
        self.db.execute("DELETE FROM runs WHERE run_key=?1", [run_key])?;
        Ok(())
    }

    pub fn list(&self, limit: usize) -> rusqlite::Result<Vec<RunRow>> {
        let mut st = self.db.prepare(
            "SELECT run_key, zone, started_at, duration_ms, bosses_killed, bosses_total, deaths, players, status,
                    attempts, last_error, url, uploaded_at
             FROM runs ORDER BY started_at DESC LIMIT ?1",
        )?;
        st.query_map([limit as i64], |r| {
            let players: String = r.get(7)?;
            let status: String = r.get(8)?;
            Ok(RunRow {
                run_key: r.get(0)?,
                zone: r.get(1)?,
                started_at: r.get(2)?,
                duration_ms: r.get(3)?,
                bosses_killed: r.get(4)?,
                bosses_total: r.get(5)?,
                deaths: r.get(6)?,
                players: serde_json::from_str(&players).unwrap_or_default(),
                status: Status::parse(&status),
                attempts: r.get(9)?,
                last_error: r.get(10)?,
                url: r.get(11)?,
                uploaded_at: r.get(12)?,
            })
        })?
        .collect()
    }

    pub fn get_json(&self, run_key: &str) -> rusqlite::Result<Option<String>> {
        self.db
            .query_row("SELECT json FROM runs WHERE run_key=?1", [run_key], |r| r.get(0))
            .optional()
    }

    pub fn counts(&self) -> rusqlite::Result<Counts> {
        let mut c = Counts::default();
        let mut st = self.db.prepare("SELECT status, COUNT(*) FROM runs GROUP BY status")?;
        for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (s, n) = row?;
            match Status::parse(&s) {
                Status::Pending => c.pending = n,
                Status::Uploaded => c.uploaded = n,
                Status::Failed => c.failed = n,
            }
        }
        Ok(c)
    }

    #[allow(dead_code)]
    pub fn status_of(&self, run_key: &str) -> rusqlite::Result<Option<Status>> {
        self.db
            .query_row("SELECT status FROM runs WHERE run_key=?1", [run_key], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map(|o| o.map(|s| Status::parse(&s)))
    }
}

/// Backoff for temporary failures: 30 s, 1 min, 2 min … capped at 1 h.
pub fn backoff_ms(attempts: i64) -> i64 {
    let exp = attempts.clamp(0, 7) as u32;
    (30_000i64 * 2i64.pow(exp)).min(3_600_000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::sample_run;

    #[test]
    fn enqueue_dedupes_and_tracks_status() {
        let q = Queue::in_memory().unwrap();
        let run = sample_run("abcdef0123456789", 600_000);
        assert!(q.enqueue(&run, 1).unwrap());
        assert!(!q.enqueue(&run, 2).unwrap(), "same run again (log re-read) is ignored");
        assert_eq!(q.counts().unwrap().pending, 1);

        let due = q.due(10, 10).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(serde_json::from_str::<RunSummary>(&due[0].json).unwrap(), run);

        q.mark_retry(&run.run_key, "offline", 1000).unwrap();
        assert!(q.due(999, 10).unwrap().is_empty());
        assert_eq!(q.due(1000, 10).unwrap()[0].attempts, 1);

        q.mark_uploaded(&run.run_key, "https://x/runs/1", 1001).unwrap();
        assert_eq!(q.status_of(&run.run_key).unwrap(), Some(Status::Uploaded));
        assert!(q.due(i64::MAX, 10).unwrap().is_empty());

        // a longer recording of the same run goes up again
        let longer = sample_run("abcdef0123456789", 700_000);
        assert!(q.enqueue(&longer, 3).unwrap());
        assert_eq!(q.status_of(&run.run_key).unwrap(), Some(Status::Pending));

        q.mark_failed(&run.run_key, "400 bad runKey").unwrap();
        let rows = q.list(10).unwrap();
        assert_eq!(rows[0].status, Status::Failed);
        assert_eq!(rows[0].last_error.as_deref(), Some("400 bad runKey"));
        assert_eq!(rows[0].players, vec!["Grobos Stinkfoot", "Fizzle Boom"]);
        assert_eq!(q.retry_all_failed().unwrap(), 1);
        assert_eq!(q.counts().unwrap().pending, 1);
        q.delete(&run.run_key).unwrap();
        assert!(q.list(10).unwrap().is_empty());
    }

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff_ms(0), 30_000);
        assert_eq!(backoff_ms(1), 60_000);
        assert_eq!(backoff_ms(20), 3_600_000);
    }
}
