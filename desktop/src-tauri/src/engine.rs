//! The app core without any GUI: shared state + three background workers.
//!
//! * **watcher** – finds the Logs folder, tails the newest combat log, feeds the
//!   `wowrun::Detector`, stores finished runs in the queue, keeps a live snapshot;
//! * **uploader** – sends pending runs (`POST /companion/runs`) with backoff;
//! * **linker** – one short-lived thread per "Sign in with Google" (polls the portal).

use crate::api::{Api, Poll, Upload};
use crate::locate::{self, Candidate, LogKind};
use crate::queue::{self, Counts, Queue};
use crate::settings::{Settings, TokenStore};
use crate::tail::LogTail;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use wowrun::{Config, Detector, RunSummary};

/// Logs older than this are not replayed at start-up.
const MAX_LOG_AGE_AT_START: Duration = Duration::from_secs(12 * 3600);

pub fn wall_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Current time in the log's clock (naive local time, see `wowlog::time`).
pub fn local_naive_ms() -> i64 {
    chrono::Local::now().naive_local().and_utc().timestamp_millis()
}

pub fn utc_offset_ms() -> i64 {
    chrono::Local::now().offset().local_minus_utc() as i64 * 1000
}

// ------------------------------------------------------------------ pipeline (pure)

/// Lines → runs. Separate from threads so it can be tested directly.
pub struct Pipeline {
    det: Detector,
    pub lines: u64,
    pub bad_lines: u64,
    /// From the `COMBAT_LOG_VERSION` header (`/console advancedCombatLogging 1`).
    pub advanced: Option<bool>,
    pub chat_lines: u64,
    pub loot_lines: u64,
}

impl Pipeline {
    pub fn new(min_players: usize, utc_offset_ms: i64) -> Pipeline {
        let cfg = Config {
            min_players: min_players.max(1),
            utc_offset_ms,
            ..Config::default()
        };
        Pipeline {
            det: Detector::new(cfg),
            lines: 0,
            bad_lines: 0,
            advanced: None,
            chat_lines: 0,
            loot_lines: 0,
        }
    }

    pub fn feed(&mut self, line: &str) -> Vec<RunSummary> {
        self.lines += 1;
        match wowlog::parse_line(line) {
            Ok(rec) => {
                if let wowlog::Kind::CombatLogVersion { advanced, .. } = rec.kind {
                    self.advanced = Some(advanced);
                }
                self.det.push(&rec)
            }
            Err(_) => {
                self.bad_lines += 1;
                Vec::new()
            }
        }
    }

    /// A chat log line; only loot lines matter. `year` = current year (chat logs have none).
    pub fn feed_chat(&mut self, line: &str, year: i64) {
        self.chat_lines += 1;
        if let Some(loot) = wowlog::parse_loot_line(line, year) {
            self.loot_lines += 1;
            self.det.push_loot(&loot);
        }
    }

    pub fn tick(&mut self, now_local: i64) -> Vec<RunSummary> {
        self.det.tick(now_local)
    }

    pub fn end_manual(&mut self) -> Vec<RunSummary> {
        self.det.end_manual()
    }

    pub fn finish(&mut self) -> Vec<RunSummary> {
        self.det.finish()
    }

    pub fn snapshot(&self) -> Option<RunSummary> {
        self.det.snapshot()
    }

    pub fn dungeon(&self) -> Option<String> {
        self.det.current_dungeon().map(str::to_string)
    }

    pub fn run_in_progress(&self) -> bool {
        self.det.run_in_progress()
    }

    pub fn discarded(&self) -> u32 {
        self.det.discarded()
    }
}

// ------------------------------------------------------------------ shared state

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    pub logs_dir: Option<String>,
    pub logs_dir_auto: bool,
    pub file: Option<String>,
    pub file_offset: u64,
    pub lines: u64,
    pub bad_lines: u64,
    pub dungeon: Option<String>,
    pub run_in_progress: bool,
    /// Wall-clock ms of the last line read.
    pub last_line_at: Option<i64>,
    pub discarded_solo: u32,
    pub error: Option<String>,
    /// `Some(true)` when the combat log header says advanced logging is on.
    pub advanced: Option<bool>,
    /// Chat log (`/chatlog`) for loot.
    pub chat_file: Option<String>,
    pub chat_last_line_at: Option<i64>,
    pub loot_lines: u64,
    /// Full paths of the files currently followed (cleanup protects them during a run).
    #[serde(skip)]
    pub active_files: Vec<PathBuf>,
    pub last_cleanup: Option<crate::cleanup::CleanupReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingLink {
    pub code: String,
    pub link_url: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub linked: bool,
    pub pending: Option<PendingLink>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadStatus {
    pub last_error: Option<String>,
    pub last_upload_at: Option<i64>,
    /// The server rejected our token – uploads paused until re-linked.
    pub blocked: bool,
}

pub enum Cmd {
    /// Logs folder (or min players) changed: restart tailing.
    Reconfigure,
    EndRun,
}

pub struct Core {
    pub config_dir: PathBuf,
    pub settings: Mutex<Settings>,
    pub tokens: TokenStore,
    pub queue: Mutex<Queue>,
    pub watch: Mutex<WatchStatus>,
    pub auth: Mutex<AuthStatus>,
    pub upload: Mutex<UploadStatus>,
    pub live: Mutex<Option<RunSummary>>,
    /// Bumped whenever the local run list changes (UI refreshes the Runs tab).
    pub runs_version: AtomicU64,
    /// Bumped to cancel a running link poller.
    link_gen: AtomicU64,
    wake_uploader: AtomicBool,
    cmd_tx: Mutex<Option<mpsc::Sender<Cmd>>>,
}

impl Core {
    pub fn open(config_dir: &Path, data_dir: &Path) -> Result<Arc<Core>, String> {
        let settings = Settings::load(config_dir);
        let queue = Queue::open(&data_dir.join("runs.sqlite")).map_err(|e| format!("cannot open run store: {e}"))?;
        let tokens = TokenStore::new(config_dir);
        let linked = tokens.load().is_some();
        Ok(Arc::new(Core {
            config_dir: config_dir.to_path_buf(),
            settings: Mutex::new(settings),
            tokens,
            queue: Mutex::new(queue),
            watch: Mutex::new(WatchStatus::default()),
            auth: Mutex::new(AuthStatus {
                linked,
                ..Default::default()
            }),
            upload: Mutex::new(UploadStatus::default()),
            live: Mutex::new(None),
            runs_version: AtomicU64::new(0),
            link_gen: AtomicU64::new(0),
            wake_uploader: AtomicBool::new(false),
            cmd_tx: Mutex::new(None),
        }))
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().expect("settings lock").clone()
    }

    pub fn save_settings(&self, new: Settings) -> Result<(), String> {
        let old = self.settings();
        new.save(&self.config_dir).map_err(|e| e.to_string())?;
        *self.settings.lock().expect("settings lock") = new.clone();
        if old.logs_dir != new.logs_dir || old.min_players != new.min_players {
            self.send(Cmd::Reconfigure);
        }
        if new.uploads_enabled {
            self.kick_uploader();
        }
        Ok(())
    }

    pub fn send(&self, cmd: Cmd) {
        if let Some(tx) = self.cmd_tx.lock().expect("cmd lock").as_ref() {
            let _ = tx.send(cmd);
        }
    }

    pub fn kick_uploader(&self) {
        self.wake_uploader.store(true, Ordering::SeqCst);
    }

    pub fn counts(&self) -> Counts {
        self.queue.lock().expect("queue lock").counts().unwrap_or_default()
    }

    fn store_runs(&self, runs: Vec<RunSummary>) {
        if runs.is_empty() {
            return;
        }
        let q = self.queue.lock().expect("queue lock");
        let mut changed = false;
        for r in &runs {
            match q.enqueue(r, wall_ms()) {
                Ok(c) => changed |= c,
                Err(e) => self.watch.lock().expect("watch lock").error = Some(format!("cannot store run: {e}")),
            }
        }
        drop(q);
        if changed {
            self.runs_version.fetch_add(1, Ordering::SeqCst);
            self.kick_uploader();
        }
    }

    // -------------------------------------------------------------- workers

    pub fn spawn_workers(self: &Arc<Self>) {
        let (tx, rx) = mpsc::channel();
        *self.cmd_tx.lock().expect("cmd lock") = Some(tx);
        let c = Arc::clone(self);
        thread::Builder::new()
            .name("watcher".into())
            .spawn(move || c.watcher(rx))
            .expect("spawn watcher");
        let c = Arc::clone(self);
        thread::Builder::new()
            .name("uploader".into())
            .spawn(move || c.uploader())
            .expect("spawn uploader");
    }

    fn resolve_logs_dir(&self, last_scan: &mut Option<Instant>) -> Option<(PathBuf, bool)> {
        if let Some(dir) = self.settings().logs_dir {
            return Some((dir, false));
        }
        if last_scan.is_some_and(|t| t.elapsed() < Duration::from_secs(30)) {
            return None;
        }
        *last_scan = Some(Instant::now());
        locate::candidates().into_iter().next().map(|c| (c.path, true))
    }

    fn watcher(self: Arc<Self>, rx: mpsc::Receiver<Cmd>) {
        let mut tail: Option<LogTail> = None;
        let mut chat: Option<LogTail> = None;
        let mut pipe = Pipeline::new(self.settings().min_players, utc_offset_ms());
        let mut last_scan = None;
        let mut last_tick = Instant::now();
        loop {
            while let Ok(cmd) = rx.try_recv() {
                match cmd {
                    Cmd::Reconfigure => {
                        // Start over on the new folder; replaying the log rebuilds any run in progress.
                        tail = None;
                        chat = None;
                        last_scan = None;
                        pipe = Pipeline::new(self.settings().min_players, utc_offset_ms());
                        *self.live.lock().expect("live lock") = None;
                    }
                    Cmd::EndRun => {
                        let runs = pipe.end_manual();
                        self.store_runs(runs);
                    }
                }
            }

            if tail.is_none() {
                match self.resolve_logs_dir(&mut last_scan) {
                    Some((dir, auto)) => {
                        let mut w = self.watch.lock().expect("watch lock");
                        w.logs_dir = Some(dir.display().to_string());
                        w.logs_dir_auto = auto;
                        w.error = (!dir.is_dir()).then(|| "Logs folder does not exist.".to_string());
                        drop(w);
                        chat = Some(LogTail::of_kind(dir.clone(), MAX_LOG_AGE_AT_START, LogKind::Chat));
                        tail = Some(LogTail::new(dir, MAX_LOG_AGE_AT_START));
                    }
                    None => {
                        let mut w = self.watch.lock().expect("watch lock");
                        w.logs_dir = None;
                        w.error = Some("World of Warcraft Logs folder not found. Pick it in Settings.".into());
                    }
                }
            }

            let mut more = false;
            if let Some(t) = tail.as_mut() {
                match t.poll() {
                    Ok(batch) => {
                        more = batch.more;
                        let got_lines = !batch.lines.is_empty();
                        let mut finished = Vec::new();
                        for line in &batch.lines {
                            finished.extend(pipe.feed(line));
                        }
                        self.store_runs(finished);
                        let mut w = self.watch.lock().expect("watch lock");
                        w.file = t
                            .current()
                            .map(|p| p.file_name().unwrap_or_default().to_string_lossy().to_string());
                        w.file_offset = t.offset();
                        if got_lines {
                            w.last_line_at = Some(wall_ms());
                        }
                        if w.error.as_deref().is_some_and(|e| e.starts_with("Cannot read")) {
                            w.error = None;
                        }
                    }
                    Err(e) => self.watch.lock().expect("watch lock").error = Some(format!("Cannot read log: {e}")),
                }
            }

            // chat log: loot lines (read after the combat batch so the run already exists)
            if let Some(c) = chat.as_mut() {
                match c.poll() {
                    Ok(batch) => {
                        more |= batch.more;
                        let year = chrono::Datelike::year(&chrono::Local::now()) as i64;
                        for line in &batch.lines {
                            pipe.feed_chat(line, year);
                        }
                        let mut w = self.watch.lock().expect("watch lock");
                        w.chat_file = c
                            .current()
                            .map(|p| p.file_name().unwrap_or_default().to_string_lossy().to_string());
                        if !batch.lines.is_empty() {
                            w.chat_last_line_at = Some(wall_ms());
                        }
                    }
                    Err(e) => self.watch.lock().expect("watch lock").error = Some(format!("Cannot read chat log: {e}")),
                }
            }

            if last_tick.elapsed() >= Duration::from_secs(2) {
                last_tick = Instant::now();
                let runs = pipe.tick(local_naive_ms());
                self.store_runs(runs);
            }

            {
                let mut w = self.watch.lock().expect("watch lock");
                w.lines = pipe.lines;
                w.bad_lines = pipe.bad_lines;
                w.dungeon = pipe.dungeon();
                w.run_in_progress = pipe.run_in_progress();
                w.discarded_solo = pipe.discarded();
                w.advanced = pipe.advanced;
                w.loot_lines = pipe.loot_lines;
                w.active_files = tail
                    .iter()
                    .chain(chat.iter())
                    .filter_map(|t| t.current().map(Path::to_path_buf))
                    .collect();
            }
            *self.live.lock().expect("live lock") = pipe.snapshot();

            if !more {
                thread::sleep(Duration::from_millis(500));
            }
        }
    }

    fn uploader(self: Arc<Self>) {
        let mut api: Option<Api> = None;
        loop {
            for _ in 0..12 {
                if self.wake_uploader.swap(false, Ordering::SeqCst) {
                    break;
                }
                thread::sleep(Duration::from_millis(250));
            }
            let settings = self.settings();
            if !settings.uploads_enabled || self.upload.lock().expect("upload lock").blocked {
                continue;
            }
            let Some(token) = self.tokens.load() else { continue };
            let base = settings.api_base();
            if api.as_ref().is_none_or(|a| a.base() != base) {
                api = Some(Api::new(&base));
            }
            let api = api.as_ref().expect("set above");

            let due = self
                .queue
                .lock()
                .expect("queue lock")
                .due(wall_ms(), 5)
                .unwrap_or_default();
            for d in due {
                let outcome = api.upload(&token, &d.json);
                let q = self.queue.lock().expect("queue lock");
                let mut u = self.upload.lock().expect("upload lock");
                match outcome {
                    Upload::Ok { url, .. } => {
                        let _ = q.mark_uploaded(&d.run_key, &url, wall_ms());
                        u.last_upload_at = Some(wall_ms());
                        u.last_error = None;
                    }
                    Upload::Retry { after_ms, error } => {
                        let wait = after_ms.unwrap_or_else(|| queue::backoff_ms(d.attempts));
                        let _ = q.mark_retry(&d.run_key, &error, wall_ms() + wait);
                        u.last_error = Some(error);
                    }
                    Upload::Rejected(error) => {
                        let _ = q.mark_failed(&d.run_key, &error);
                        u.last_error = Some(error);
                    }
                    Upload::Unauthorized(error) => {
                        u.blocked = true;
                        u.last_error = Some(error.clone());
                        self.auth.lock().expect("auth lock").error = Some(format!(
                            "The portal no longer accepts this device ({error}). Link it again."
                        ));
                    }
                }
                let blocked = u.blocked;
                drop(u);
                drop(q);
                self.runs_version.fetch_add(1, Ordering::SeqCst);
                if blocked {
                    break;
                }
            }
        }
    }

    // -------------------------------------------------------------- device linking

    /// Starts linking; returns the portal URL to open in the browser.
    pub fn start_link(self: &Arc<Self>) -> Result<PendingLink, String> {
        let settings = self.settings();
        let api = Api::new(&settings.api_base());
        let start = api.link_start(&settings.device_name)?;
        let pending = PendingLink {
            code: start.code.clone(),
            link_url: start.link_url.clone(),
            expires_at: start.expires_at,
        };
        {
            let mut a = self.auth.lock().expect("auth lock");
            a.pending = Some(pending.clone());
            a.error = None;
        }
        let generation = self.link_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let c = Arc::clone(self);
        thread::Builder::new()
            .name("linker".into())
            .spawn(move || c.poll_link(api, start.poll_token, start.expires_at, generation))
            .map_err(|e| e.to_string())?;
        Ok(pending)
    }

    fn poll_link(self: Arc<Self>, api: Api, poll_token: String, expires_at: i64, generation: u64) {
        let finish = |error: Option<String>| {
            let mut a = self.auth.lock().expect("auth lock");
            a.pending = None;
            a.error = error;
        };
        loop {
            thread::sleep(Duration::from_secs(3));
            if self.link_gen.load(Ordering::SeqCst) != generation {
                return; // cancelled or restarted
            }
            match api.link_poll(&poll_token) {
                Ok(Poll::Pending) | Err(_) if wall_ms() < expires_at + 5_000 => continue,
                Ok(Poll::Pending) | Err(_) => return finish(Some("The code expired. Try again.".into())),
                Ok(Poll::Approved { token }) => {
                    if let Err(e) = self.tokens.save(&token) {
                        return finish(Some(format!("Could not save the device token: {e}")));
                    }
                    self.auth.lock().expect("auth lock").linked = true;
                    {
                        let mut u = self.upload.lock().expect("upload lock");
                        u.blocked = false;
                        u.last_error = None;
                    }
                    let _ = self.queue.lock().expect("queue lock").retry_all_failed();
                    self.kick_uploader();
                    return finish(None);
                }
                Ok(Poll::Dead(why)) => {
                    let msg = match why.as_str() {
                        "denied" => "Link denied on the portal.".to_string(),
                        "expired" => "The code expired. Try again.".to_string(),
                        other => format!("Linking failed ({other}). Try again."),
                    };
                    return finish(Some(msg));
                }
            }
        }
    }

    pub fn cancel_link(&self) {
        self.link_gen.fetch_add(1, Ordering::SeqCst);
        self.auth.lock().expect("auth lock").pending = None;
    }

    pub fn unlink(&self) -> Result<(), String> {
        self.cancel_link();
        self.tokens.clear().map_err(|e| e.to_string())?;
        let mut a = self.auth.lock().expect("auth lock");
        a.linked = false;
        a.error = None;
        Ok(())
    }

    /// Deletes combat/chat logs in the Logs folder (see `cleanup` for what is kept).
    pub fn cleanup_logs(&self) -> Result<crate::cleanup::CleanupReport, String> {
        let (dir, protect) = {
            let w = self.watch.lock().expect("watch lock");
            let dir = w.logs_dir.clone().ok_or("No Logs folder yet.")?;
            let protect = if w.run_in_progress {
                w.active_files.clone()
            } else {
                Vec::new()
            };
            (PathBuf::from(dir), protect)
        };
        let mut report = crate::cleanup::cleanup_logs(&dir, &protect, Duration::from_secs(120), SystemTime::now());
        report.at = wall_ms();
        self.watch.lock().expect("watch lock").last_cleanup = Some(report.clone());
        Ok(report)
    }

    /// Called when the app quits (tray → Quit, OS shutdown).
    pub fn on_exit(&self) {
        if self.settings().delete_logs_on_exit {
            let _ = self.cleanup_logs();
        }
    }

    pub fn candidates(&self) -> Vec<Candidate> {
        locate::candidates()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    fn fixture() -> String {
        std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../crates/wowlog/tests/fixtures/synthetic_rfc.txt"
        ))
        .unwrap()
    }

    #[test]
    fn pipeline_turns_log_into_one_run() {
        let mut p = Pipeline::new(2, 3_600_000);
        let mut runs = Vec::new();
        for l in fixture().lines() {
            runs.extend(p.feed(l));
        }
        assert!(runs.is_empty(), "left the dungeon, waiting for the grace period");
        assert_eq!(p.dungeon(), None);
        assert!(p.run_in_progress());
        assert!(p.snapshot().is_some());
        runs.extend(p.finish());
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].zone.name, "Ragefire Chasm");
        assert_eq!(p.bad_lines, 0);
        // UTC = local − 1 h
        assert_eq!(
            runs[0].started_at,
            wowlog::time::parse("11/20/2026 19:00:10.000").unwrap()
        );
    }

    #[test]
    fn pipeline_reads_advanced_flag_and_chat_loot() {
        let mut p = Pipeline::new(2, 0);
        assert_eq!(p.advanced, None);
        let text = fixture();
        let lines: Vec<&str> = text.lines().collect();
        // up to (and including) the boss kill, still inside the dungeon
        let cut = lines.iter().position(|l| l.contains("ENCOUNTER_END")).unwrap() + 1;
        for l in &lines[..cut] {
            p.feed(l);
        }
        assert_eq!(p.advanced, Some(true));
        p.feed_chat("11/20 20:00:18.5000  You receive loot: [Oggleflint's Ugly Hat].", 2026);
        p.feed_chat("11/20 20:00:18.6000  [Party] Fizzle: gz on the hat lol", 2026);
        assert_eq!((p.chat_lines, p.loot_lines), (2, 1));
        for l in &lines[cut..] {
            p.feed(l);
        }
        let runs = p.finish();
        assert_eq!(runs[0].loot.len(), 1);
        assert_eq!(runs[0].loot[0].item, "Oggleflint's Ugly Hat");
        assert_eq!(runs[0].loot[0].slug.as_deref(), Some("tankus-maximus"));
    }

    #[test]
    fn tail_plus_pipeline_plus_queue() {
        let t = TempDir::new("e2e-local");
        let log = t.path().join("WoWCombatLog-112026_200000.txt");
        let text = fixture();
        let (a, b) = text.split_at(text.len() / 2);
        std::fs::write(&log, a).unwrap();

        let mut tail = LogTail::new(t.path(), MAX_LOG_AGE_AT_START);
        let mut p = Pipeline::new(2, 0);
        let q = Queue::in_memory().unwrap();
        let feed = |tail: &mut LogTail, p: &mut Pipeline| {
            for l in tail.poll().unwrap().lines {
                for r in p.feed(&l) {
                    q.enqueue(&r, 0).unwrap();
                }
            }
        };
        feed(&mut tail, &mut p);
        std::fs::OpenOptions::new()
            .append(true)
            .open(&log)
            .and_then(|mut f| std::io::Write::write_all(&mut f, b.as_bytes()))
            .unwrap();
        feed(&mut tail, &mut p);
        assert_eq!(p.lines as usize, text.lines().count());
        // 16 minutes later (log clock): grace period over → run stored
        let end = wowlog::time::parse("11/20/2026 20:17:00.000").unwrap();
        for r in p.tick(end) {
            q.enqueue(&r, 0).unwrap();
        }
        let rows = q.list(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].zone, "Ragefire Chasm");
        assert_eq!(rows[0].bosses_killed, 1);
        assert_eq!(rows[0].deaths, 1);
    }
}
