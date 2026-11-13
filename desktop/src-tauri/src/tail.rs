//! Following the newest combat log while the game writes it.
//!
//! Polling (every ~0.5 s) instead of inotify: robust for files inside Wine prefixes and
//! on Windows, and cheap (one `stat` + read of new bytes).

use crate::locate::{LogKind, newest_log};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Read at most this much per poll so the UI stays responsive on huge files.
const MAX_CHUNK: usize = 8 * 1024 * 1024;

#[derive(Debug, Default)]
pub struct Batch {
    /// Complete lines (without line endings).
    pub lines: Vec<String>,
    /// A different file is being followed since this batch.
    pub switched_to: Option<PathBuf>,
    /// More data is waiting (chunk limit hit) – poll again soon.
    pub more: bool,
}

pub struct LogTail {
    dir: PathBuf,
    kind: LogKind,
    /// Files older than this at start-up are ignored (the run they contain is long over).
    max_age_at_start: Duration,
    started: bool,
    /// Stale file skipped at start-up (path, mtime) – followed only once it changes.
    skipped: Option<(PathBuf, SystemTime)>,
    current: Option<PathBuf>,
    file: Option<File>,
    offset: u64,
    partial: Vec<u8>,
}

impl LogTail {
    pub fn new(dir: impl Into<PathBuf>, max_age_at_start: Duration) -> Self {
        Self::of_kind(dir, max_age_at_start, LogKind::Combat)
    }

    pub fn of_kind(dir: impl Into<PathBuf>, max_age_at_start: Duration, kind: LogKind) -> Self {
        LogTail {
            dir: dir.into(),
            kind,
            max_age_at_start,
            started: false,
            skipped: None,
            current: None,
            file: None,
            offset: 0,
            partial: Vec::new(),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn current(&self) -> Option<&Path> {
        self.current.as_deref()
    }

    pub fn offset(&self) -> u64 {
        self.offset
    }

    pub fn poll(&mut self) -> io::Result<Batch> {
        let mut batch = Batch::default();

        if let Some((newest, mtime)) = newest_log(&self.dir, self.kind)
            && self.current.as_deref() != Some(newest.as_path())
        {
            let skip = if self.started {
                self.skipped.as_ref().is_some_and(|(p, t)| *p == newest && *t == mtime)
            } else {
                // At start-up skip stale files (their runs are long over).
                let stale = SystemTime::now()
                    .duration_since(mtime)
                    .is_ok_and(|d| d > self.max_age_at_start);
                if stale {
                    self.skipped = Some((newest.clone(), mtime));
                }
                stale
            };
            if !skip {
                self.flush_partial(&mut batch);
                self.file = Some(File::open(&newest)?);
                self.current = Some(newest.clone());
                self.offset = 0;
                batch.switched_to = Some(newest);
            }
        }
        self.started = true;

        let Some(file) = self.file.as_mut() else {
            return Ok(batch);
        };
        let len = file.metadata()?.len();
        if len < self.offset {
            // truncated / replaced in place
            self.offset = 0;
            self.partial.clear();
        }
        if len == self.offset {
            return Ok(batch);
        }
        let want = ((len - self.offset) as usize).min(MAX_CHUNK);
        file.seek(SeekFrom::Start(self.offset))?;
        let mut buf = vec![0u8; want];
        let n = read_up_to(file, &mut buf)?;
        buf.truncate(n);
        self.offset += n as u64;
        batch.more = self.offset < len;

        let mut start = 0;
        for i in 0..buf.len() {
            if buf[i] == b'\n' {
                let mut line = std::mem::take(&mut self.partial);
                line.extend_from_slice(&buf[start..i]);
                push_line(&mut batch.lines, &line);
                start = i + 1;
            }
        }
        self.partial.extend_from_slice(&buf[start..]);
        Ok(batch)
    }

    /// A file switch means the old file is complete: its unterminated last line counts.
    fn flush_partial(&mut self, batch: &mut Batch) {
        if !self.partial.is_empty() {
            let line = std::mem::take(&mut self.partial);
            push_line(&mut batch.lines, &line);
        }
    }
}

fn push_line(out: &mut Vec<String>, bytes: &[u8]) {
    let s = String::from_utf8_lossy(bytes);
    let s = s.trim_end_matches('\r');
    if !s.trim().is_empty() {
        out.push(s.to_string());
    }
}

fn read_up_to(f: &mut File, buf: &mut [u8]) -> io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match f.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;
    use std::io::Write;

    fn append(p: &Path, s: &str) {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(p)
            .unwrap()
            .write_all(s.as_bytes())
            .unwrap();
    }

    #[test]
    fn follows_partial_lines_and_switches_files() {
        let t = TempDir::new("tail");
        let a = t.path().join("WoWCombatLog-111326_173926.txt");
        let mut tail = LogTail::new(t.path(), Duration::from_secs(3600));
        assert!(tail.poll().unwrap().lines.is_empty());

        append(&a, "line 1\r\nline 2\nhalf");
        let b1 = tail.poll().unwrap();
        assert_eq!(b1.switched_to.as_deref(), Some(a.as_path()));
        assert_eq!(b1.lines, vec!["line 1", "line 2"]);

        append(&a, " done\n\n");
        assert_eq!(tail.poll().unwrap().lines, vec!["half done"]);
        assert!(tail.poll().unwrap().lines.is_empty());

        append(&a, "tail without newline");
        assert!(tail.poll().unwrap().lines.is_empty());

        // New file (game re-enabled /combatlog): old partial line is flushed, new file read from 0.
        std::thread::sleep(Duration::from_millis(20));
        let b = t.path().join("WoWCombatLog-111326_190000.txt");
        append(&b, "new 1\n");
        let later = SystemTime::now() + Duration::from_secs(5);
        File::options()
            .write(true)
            .open(&b)
            .unwrap()
            .set_modified(later)
            .unwrap();
        let b2 = tail.poll().unwrap();
        assert_eq!(b2.switched_to.as_deref(), Some(b.as_path()));
        assert_eq!(b2.lines, vec!["tail without newline", "new 1"]);
    }

    #[test]
    fn stale_file_ignored_at_start_and_truncation_handled() {
        let t = TempDir::new("stale");
        let a = t.path().join("WoWCombatLog.txt");
        append(&a, "old\n");
        let old = SystemTime::now() - Duration::from_secs(2 * 3600);
        File::options().write(true).open(&a).unwrap().set_modified(old).unwrap();
        let mut tail = LogTail::new(t.path(), Duration::from_secs(3600));
        assert!(tail.poll().unwrap().lines.is_empty());
        assert!(tail.poll().unwrap().lines.is_empty(), "still stale on the next poll");
        assert!(tail.current().is_none());

        // the game writes into it again → it becomes the newest *changed* file
        append(&a, "fresh\n");
        let b = tail.poll().unwrap();
        assert_eq!(b.lines, vec!["old", "fresh"]);

        std::fs::write(&a, "x\n").unwrap(); // truncated
        assert_eq!(tail.poll().unwrap().lines, vec!["x"]);
    }
}
