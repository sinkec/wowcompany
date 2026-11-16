//! The app core without any GUI: shared state + three background workers.
//!
//! * **watcher** – finds the Logs folder, tails the newest combat log, feeds the
//!   `wowrun::Detector`, stores finished runs in the queue, keeps a live snapshot;
//! * **uploader** – sends pending runs (`POST /companion/runs`) with backoff;
//! * **linker** – one short-lived thread per "Sign in with Google" (polls the portal).

use crate::addon::{self, AddonChar, AddonExport};
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
use wowrun::{Config, Detector, Personal, PersonalUpload, RunSummary};

/// Personal records are uploaded at most this often.
const RECORDS_UPLOAD_GAP_MS: i64 = 60_000;
/// How far back stored runs get late data from the addon.
const ADDON_BACKFILL_MS: i64 = 48 * 3_600_000;
/// After the server refused them (4xx): try again this much later.
const RECORDS_REJECTED_GAP_MS: i64 = 3_600_000;

/// Saved personal bests; a missing or broken file starts empty.
fn load_personal(path: &Path) -> Personal {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Logs older than this are not replayed at start-up.
const MAX_LOG_AGE_AT_START: Duration = Duration::from_secs(12 * 3600);
/// How often to look whether WoW is running (on Windows this starts a process).
const GAME_CHECK: Duration = Duration::from_secs(30);
/// Automatic log cleanup this long after the game was closed (see the watcher).
const CLEANUP_AFTER_CLOSE: Duration = Duration::from_secs(60);

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

    /// One combat log line. `personal` collects the log owner's own records from the whole
    /// log (open world too); it lives outside the pipeline so it survives a reconfigure.
    pub fn feed(&mut self, line: &str, personal: &mut Personal) -> Vec<RunSummary> {
        self.lines += 1;
        match wowlog::parse_line(line) {
            Ok(rec) => {
                if let wowlog::Kind::CombatLogVersion { advanced, .. } = rec.kind {
                    self.advanced = Some(advanced);
                }
                personal.push(&rec);
                self.det.push(&rec)
            }
            Err(_) => {
                self.bad_lines += 1;
                Vec::new()
            }
        }
    }

    /// A chat log line; loot and need/greed rolls matter. `year` = current year (chat logs have none).
    pub fn feed_chat(&mut self, line: &str, year: i64) {
        self.chat_lines += 1;
        if let Some(loot) = wowlog::parse_loot_line(line, year) {
            self.loot_lines += 1;
            self.det.push_loot(&loot);
        } else if let Some(roll) = wowlog::parse_roll_line(line, year) {
            self.det.push_roll(&roll);
        } else if let Some(g) = wowlog::parse_group_line(line, year) {
            // the party leader without the addon (and without /reload)
            self.det.push_group(&g);
        } else if let Some(p) = wowlog::parse_progress_line(line, year) {
            // what the recorder gained: XP, money, reputation, skill-ups
            self.det.push_progress(&p);
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
    /// App is quitting and the game is closed: close any run in progress, store it, then answer.
    Finish(mpsc::Sender<()>),
}

/// What the app knows about the WowCompany addon (for the UI).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonStatus {
    /// `Interface/AddOns/WowCompany` exists.
    pub installed: bool,
    /// Version the addon reported in its last export.
    pub version: Option<String>,
    /// When the addon last saved its data (UTC ms) – it only reaches the disk on `/reload` or logout.
    pub data_at: Option<i64>,
    pub runs: usize,
    pub chars: Vec<AddonChar>,
    /// Runs that got their party leader from the addon in this session.
    pub leaders_added: u32,
    /// Version of the addon in the game folder (`None` = not installed).
    pub installed_version: Option<String>,
    /// Version of the addon shipped inside this app.
    pub bundled_version: String,
    /// The addon was just updated in the game folder (from, to, game restart needed rather than
    /// `/reload`). The game itself cannot be told: it reads addon files only on load.
    pub updated: Option<AddonUpdated>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonUpdated {
    pub from: String,
    pub to: String,
    pub restart: bool,
    pub at: i64,
}

#[derive(Default)]
struct AddonState {
    export: AddonExport,
    mtime: Option<SystemTime>,
    installed: bool,
    installed_version: Option<String>,
    leaders_added: u32,
    updated: Option<AddonUpdated>,
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
    /// The log owner's personal bests (whole log, open world included); saved in `records.json`.
    pub personal: Mutex<Personal>,
    personal_path: PathBuf,
    addon: Mutex<AddonState>,
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
        let personal_path = data_dir.join("records.json");
        let mut personal = load_personal(&personal_path);
        personal.set_utc_offset(utc_offset_ms());
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
            personal: Mutex::new(personal),
            personal_path,
            addon: Mutex::new(AddonState::default()),
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

    /// Personal bests for the UI and the upload.
    pub fn personal_records(&self) -> PersonalUpload {
        self.personal.lock().expect("personal lock").upload()
    }

    /// Writes `records.json` (temp file + rename, so a crash never leaves half a file).
    fn save_personal(&self) {
        let json = match serde_json::to_string(&*self.personal.lock().expect("personal lock")) {
            Ok(j) => j,
            Err(_) => return,
        };
        let tmp = self.personal_path.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &self.personal_path);
        }
    }

    /// Installs or updates the addon that ships inside this app into the game folder.
    pub fn install_addon(&self) -> Result<String, String> {
        let dir = self
            .watch
            .lock()
            .expect("watch lock")
            .logs_dir
            .clone()
            .ok_or("No Logs folder yet – pick it in Settings first.")?;
        let version = addon::install(Path::new(&dir))?;
        let mut a = self.addon.lock().expect("addon lock");
        a.installed = true;
        a.installed_version = Some(version.clone());
        Ok(version)
    }

    /// The addon in the game folder is older than the one inside this app (e.g. right after the
    /// app updated itself): copy the new one over, when the player allows it in Settings.
    fn auto_update_addon(&self, logs_dir: &Path) {
        if !self.settings.lock().expect("settings").auto_update_addon {
            return;
        }
        let Some(old) = addon::installed_version(logs_dir) else {
            return;
        };
        let new = addon::bundled_version();
        if !addon::is_newer(&new, &old) {
            return;
        }
        let restart = addon::update_needs_restart(logs_dir);
        if addon::install(logs_dir).is_ok() {
            self.addon.lock().expect("addon lock").updated = Some(AddonUpdated {
                from: old,
                to: new,
                restart,
                at: wall_ms(),
            });
        }
    }

    pub fn addon_status(&self) -> AddonStatus {
        let a = self.addon.lock().expect("addon lock");
        AddonStatus {
            installed: a.installed,
            version: a.export.version.clone(),
            data_at: a.export.at,
            runs: a.export.runs.len(),
            chars: a.export.chars.clone(),
            leaders_added: a.leaders_added,
            installed_version: a.installed_version.clone(),
            bundled_version: addon::bundled_version(),
            updated: a.updated.clone(),
        }
    }

    /// Both directions of the addon link (called every few seconds by the watcher):
    /// read the addon's export when its file changed and add what it knows to stored runs;
    /// write the personal records where the addon can load them.
    fn sync_addon(&self, logs_dir: &Path) {
        let installed = addon::addon_dir(logs_dir).is_some_and(|d| d.is_dir());
        let file = addon::saved_variables(logs_dir);
        let mtime = file
            .as_ref()
            .and_then(|f| std::fs::metadata(f).and_then(|m| m.modified()).ok());
        if installed {
            self.auto_update_addon(logs_dir);
        }
        let changed = {
            let mut a = self.addon.lock().expect("addon lock");
            a.installed = installed;
            a.installed_version = addon::installed_version(logs_dir);
            let changed = mtime.is_some() && mtime != a.mtime;
            if changed {
                a.mtime = mtime;
                a.export = file
                    .as_ref()
                    .and_then(|f| std::fs::read(f).ok())
                    .map(|b| addon::parse_export(&String::from_utf8_lossy(&b)))
                    .unwrap_or_default();
            }
            changed
        };
        if changed {
            self.add_leaders_to_stored_runs();
        }
        if installed {
            let records = self.personal_records();
            if !records.characters.is_empty() {
                let _ = addon::write_companion_data(logs_dir, &records);
            }
        }
    }

    /// The addon's data reaches the disk late (on `/reload`), often after the run was stored or
    /// even uploaded: add the leader to recent runs that lack one and send them again.
    fn add_leaders_to_stored_runs(&self) {
        let export = self.addon.lock().expect("addon lock").export.clone();
        if export.runs.is_empty() && export.loot.is_empty() {
            return;
        }
        let q = self.queue.lock().expect("queue lock");
        let recent = q.recent_json(wall_ms() - ADDON_BACKFILL_MS).unwrap_or_default();
        let (mut added, mut updated) = (0u32, 0u32);
        for (run_key, json) in recent {
            let Ok(mut run) = serde_json::from_str::<RunSummary>(&json) else {
                continue;
            };
            // leader + item ids/quality of the loot
            let (changed, leader_added) = addon::apply(&export, &mut run);
            if !changed {
                continue;
            }
            if let Ok(json) = serde_json::to_string(&run)
                && q.update_json(&run_key, &json).is_ok()
            {
                updated += 1;
                added += u32::from(leader_added);
            }
        }
        drop(q);
        if updated > 0 {
            self.addon.lock().expect("addon lock").leaders_added += added;
            self.runs_version.fetch_add(1, Ordering::SeqCst);
            self.kick_uploader();
        }
    }

    fn store_runs(&self, mut runs: Vec<RunSummary>) {
        if runs.is_empty() {
            return;
        }
        // the party leader, when the addon already told us
        {
            let a = self.addon.lock().expect("addon lock");
            for r in runs.iter_mut() {
                addon::apply(&a.export, r);
                // a very long run must still fit in one server document
                r.fit_size(wowrun::summary::MAX_RUN_BYTES);
            }
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
        let mut last_addon_sync: Option<Instant> = None;
        let mut last_game_check: Option<Instant> = None;
        let mut game_was_running: Option<bool> = None;
        // the game was closed at this moment and its logs have not been cleaned up yet
        let mut closed_at: Option<Instant> = None;
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
                    Cmd::Finish(done) => {
                        let runs = pipe.finish();
                        self.store_runs(runs);
                        *self.live.lock().expect("live lock") = None;
                        self.watch.lock().expect("watch lock").run_in_progress = false;
                        let _ = done.send(());
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
                        let new_record = {
                            let mut personal = self.personal.lock().expect("personal lock");
                            let was_dirty = personal.is_dirty();
                            let before = personal.upload();
                            for line in &batch.lines {
                                finished.extend(pipe.feed(line, &mut personal));
                            }
                            // dirty alone is not enough: it stays set while an upload is pending
                            personal.is_dirty() && (!was_dirty || personal.upload() != before)
                        };
                        if new_record {
                            self.save_personal();
                            self.kick_uploader();
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

            // WowCompany addon: its export in, the personal records out
            if last_addon_sync.is_none_or(|t| t.elapsed() >= Duration::from_secs(5)) {
                last_addon_sync = Some(Instant::now());
                let dir = self.watch.lock().expect("watch lock").logs_dir.clone();
                if let Some(dir) = dir {
                    self.sync_addon(Path::new(&dir));
                }
            }

            // Logs go once WoW is closed and every run from them is on the portal (not before:
            // the raw log is the only copy until the upload went through).
            if last_game_check.is_none_or(|t| t.elapsed() >= GAME_CHECK) {
                last_game_check = Some(Instant::now());
                let running = crate::cleanup::game_running();
                if game_was_running == Some(true) && running == Some(false) {
                    closed_at = Some(Instant::now());
                }
                if running == Some(true) {
                    closed_at = None;
                }
                if running.is_some() {
                    game_was_running = running;
                }
                // wait a bit: the addon's SavedVariables are written on logout and may still
                // update a stored run (leader, loot quality), which then uploads again
                if let Some(at) = closed_at
                    && at.elapsed() >= CLEANUP_AFTER_CLOSE
                    && !more
                    && self.settings().delete_logs_on_exit
                {
                    match self.logs_still_needed() {
                        Some(why) => self.note_cleanup_waiting(why),
                        None => {
                            let _ = self.cleanup_logs_auto();
                            closed_at = None;
                        }
                    }
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
        // personal records: not before this time (one attempt a minute is plenty)
        let mut records_next_at = 0i64;
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

            // personal records (whole log, open world): one small request when something improved
            if wall_ms() >= records_next_at && !self.upload.lock().expect("upload lock").blocked {
                let pending = {
                    let p = self.personal.lock().expect("personal lock");
                    (p.is_dirty() && !p.is_empty()).then(|| p.upload())
                };
                if let Some(snapshot) = pending {
                    records_next_at = wall_ms() + RECORDS_UPLOAD_GAP_MS;
                    let json = serde_json::to_string(&snapshot).unwrap_or_default();
                    match api.upload_records(&token, &json) {
                        Upload::Rejected(_) => {
                            // e.g. a server that does not know this endpoint yet: keep the records
                            // (nothing is lost) and ask again in an hour instead of hammering it
                            records_next_at = wall_ms() + RECORDS_REJECTED_GAP_MS;
                        }
                        Upload::Ok { .. } => {
                            let mut p = self.personal.lock().expect("personal lock");
                            // a newer record may have arrived while the request was in flight
                            if p.upload() == snapshot {
                                p.mark_clean();
                            }
                            drop(p);
                            self.save_personal();
                        }
                        Upload::Retry { after_ms, .. } => {
                            records_next_at =
                                wall_ms() + after_ms.unwrap_or(RECORDS_UPLOAD_GAP_MS).max(RECORDS_UPLOAD_GAP_MS);
                        }
                        Upload::Unauthorized(error) => {
                            let mut u = self.upload.lock().expect("upload lock");
                            u.blocked = true;
                            u.last_error = Some(error);
                        }
                    }
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
    /// "Delete logs now": everything that is not in use.
    pub fn cleanup_logs(&self) -> Result<crate::cleanup::CleanupReport, String> {
        self.cleanup_logs_keeping(Duration::ZERO)
    }

    /// Automatic cleanup: also keeps logs younger than the "keep logs for N days" setting.
    fn cleanup_logs_auto(&self) -> Result<crate::cleanup::CleanupReport, String> {
        let days = u64::from(self.settings().keep_logs_days);
        self.cleanup_logs_keeping(Duration::from_secs(days * 86_400))
    }

    fn cleanup_logs_keeping(&self, keep: Duration) -> Result<crate::cleanup::CleanupReport, String> {
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
        // Game closed → nothing can still be writing, so even the newest file goes.
        // Game open or unknown → keep what was written in the last two minutes.
        let recent = match crate::cleanup::game_running() {
            Some(false) => Duration::ZERO,
            _ => Duration::from_secs(120),
        }
        .max(keep);
        let mut report = crate::cleanup::cleanup_logs(&dir, &protect, recent, SystemTime::now());
        report.at = wall_ms();
        self.watch.lock().expect("watch lock").last_cleanup = Some(report.clone());
        Ok(report)
    }

    /// Why the logs may not be deleted automatically yet, or `None` when everything they
    /// contain is safe: no run is being recorded and every stored run is on the portal
    /// (when uploads are off or the app is not linked, the run stored in the app is all there is).
    fn logs_still_needed(&self) -> Option<String> {
        if self.watch.lock().expect("watch lock").run_in_progress {
            return Some("a run is still being recorded".into());
        }
        let uploading = self.settings().uploads_enabled && self.auth.lock().expect("auth lock").linked;
        if uploading {
            let c = self.counts();
            let waiting = c.pending + c.failed;
            if waiting > 0 {
                return Some(format!("{waiting} run(s) not on the portal yet"));
            }
        }
        None
    }

    fn note_cleanup_waiting(&self, why: String) {
        let mut w = self.watch.lock().expect("watch lock");
        let mut report = w.last_cleanup.clone().unwrap_or_default();
        if report.waiting.as_deref() != Some(why.as_str()) {
            report.waiting = Some(why);
            w.last_cleanup = Some(report);
        }
    }

    /// Called when the app quits (tray → Quit, OS shutdown).
    pub fn on_exit(&self) {
        // personal records survive the logs
        self.save_personal();
        if !self.settings().delete_logs_on_exit {
            return;
        }
        // The game is closed: whatever run was still open is over. Store it first (it uploads on
        // the next start); until it is on the portal its log stays and goes in a later cleanup.
        if crate::cleanup::game_running() == Some(false) {
            let (tx, rx) = mpsc::channel();
            self.send(Cmd::Finish(tx));
            let _ = rx.recv_timeout(Duration::from_secs(3));
        }
        // a run that has not reached the portal keeps its log; the next cleanup gets it
        if self.logs_still_needed().is_none() {
            let _ = self.cleanup_logs_auto();
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
        let mut personal = Personal::new(0);
        let mut runs = Vec::new();
        for l in fixture().lines() {
            runs.extend(p.feed(l, &mut personal));
        }
        assert!(runs.is_empty(), "left the dungeon, waiting for the grace period");
        assert_eq!(p.dungeon(), None);
        assert!(p.run_in_progress());
        assert!(p.snapshot().is_some());
        runs.extend(p.finish());
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].zone.name, "Ragefire Chasm");
        assert_eq!(p.bad_lines, 0);
        // the log owner's own bests are collected on the side (only theirs)
        let up = personal.upload();
        assert_eq!(up.characters.len(), 1);
        assert_eq!(up.characters[0].slug, "tankus-maximus");
        let hit = &up.characters[0].records[0];
        assert_eq!((hit.amount, hit.spell.as_str(), hit.in_dungeon), (40, "Melee", true));
        assert!(personal.is_dirty());
        // UTC = local − 1 h
        assert_eq!(
            runs[0].started_at,
            wowlog::time::parse("11/20/2026 19:00:10.000").unwrap()
        );
    }

    #[test]
    fn pipeline_reads_advanced_flag_and_chat_loot() {
        let mut p = Pipeline::new(2, 0);
        let mut personal = Personal::new(0);
        assert_eq!(p.advanced, None);
        let text = fixture();
        let lines: Vec<&str> = text.lines().collect();
        // up to (and including) the boss kill, still inside the dungeon
        let cut = lines.iter().position(|l| l.contains("ENCOUNTER_END")).unwrap() + 1;
        for l in &lines[..cut] {
            p.feed(l, &mut personal);
        }
        assert_eq!(p.advanced, Some(true));
        p.feed_chat("11/20 20:00:18.5000  You receive loot: [Oggleflint's Ugly Hat].", 2026);
        p.feed_chat("11/20 20:00:18.6000  [Party] Fizzle: gz on the hat lol", 2026);
        assert_eq!((p.chat_lines, p.loot_lines), (2, 1));
        // a need/greed roll: party members kept, a stranger never stored
        for l in [
            "11/20 20:00:10.000  Loot: Oggleflint's Ugly Hat",
            "11/20 20:00:11.000  Loot: Fizzle Boom has selected Greed for: Oggleflint's Ugly Hat",
            "11/20 20:00:11.500  Loot: You have selected Need for: Oggleflint's Ugly Hat",
            "11/20 20:00:12.000  Loot: Random Stranger has selected Need for: Oggleflint's Ugly Hat",
            "11/20 20:00:13.000  Loot: Need Roll - 77 for Oggleflint's Ugly Hat by Tankus Maximus",
            "11/20 20:00:13.000  Loot: Need Roll - 99 for Oggleflint's Ugly Hat by Random Stranger",
            "11/20 20:00:13.000  Loot: Greed Roll - 12 for Oggleflint's Ugly Hat by Fizzle Boom",
            "11/20 20:00:13.100  Loot: You won: Oggleflint's Ugly Hat",
        ] {
            p.feed_chat(l, 2026);
        }
        for l in &lines[cut..] {
            p.feed(l, &mut personal);
        }
        let runs = p.finish();
        assert_eq!(runs[0].loot.len(), 1);
        assert_eq!(runs[0].loot[0].item, "Oggleflint's Ugly Hat");
        assert_eq!(runs[0].loot[0].slug.as_deref(), Some("tankus-maximus"));
        let rolls = &runs[0].rolls;
        assert_eq!(rolls.len(), 1);
        assert_eq!(rolls[0].winner.as_deref(), Some("tankus-maximus"));
        let e: Vec<_> = rolls[0]
            .entries
            .iter()
            .map(|e| (e.slug.as_str(), e.choice, e.roll))
            .collect();
        assert_eq!(
            e,
            vec![
                ("fizzle-boom", wowrun::summary::RollChoice::Greed, Some(12)),
                ("tankus-maximus", wowrun::summary::RollChoice::Need, Some(77)),
            ]
        );
        assert!(!serde_json::to_string(&runs[0]).unwrap().contains("Stranger"));
    }

    #[test]
    fn leader_comes_from_the_chat_log_without_the_addon() {
        let run_with = |chat: &str| {
            let mut p = Pipeline::new(2, 0);
            let mut personal = Personal::new(0);
            // the invite comes before the dungeon
            p.feed_chat(chat, 2026);
            let mut runs = Vec::new();
            for l in fixture().lines() {
                runs.extend(p.feed(l, &mut personal));
            }
            runs.extend(p.finish());
            runs.remove(0).leader
        };
        assert_eq!(
            run_with("11/20 19:55:00.000  Fizzle Boom has invited you to join a group.").as_deref(),
            Some("Fizzle Boom")
        );
        assert_eq!(
            run_with("11/20 19:55:00.000  You are now the group leader.").as_deref(),
            Some("Tankus Maximus")
        );
        // somebody who is not in the run's party is never named
        assert_eq!(
            run_with("11/20 19:55:00.000  Random Stranger is now the group leader."),
            None
        );
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
        let mut personal = Personal::new(0);
        let q = Queue::in_memory().unwrap();
        let mut feed = |tail: &mut LogTail, p: &mut Pipeline| {
            for l in tail.poll().unwrap().lines {
                for r in p.feed(&l, &mut personal) {
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

    #[test]
    fn addon_leader_is_added_to_new_and_to_already_uploaded_runs() {
        let t = crate::testutil::TempDir::new("addon-core");
        let core = Core::open(&t.path().join("cfg"), &t.path().join("data")).unwrap();
        let mut p = Pipeline::new(2, 0);
        let mut personal = Personal::new(0);
        let mut runs = Vec::new();
        for l in fixture().lines() {
            runs.extend(p.feed(l, &mut personal));
        }
        runs.extend(p.finish());
        let mut run = runs.remove(0);
        // the stored-run backfill only looks at recent runs
        let len = run.ended_at - run.started_at;
        run.started_at = wall_ms() - 3_600_000;
        run.ended_at = run.started_at + len;

        // 1) run stored and uploaded before the addon said anything → no leader
        core.store_runs(vec![run.clone()]);
        let stored = |core: &Core| -> RunSummary {
            let q = core.queue.lock().unwrap();
            serde_json::from_str(&q.get_json(&run.run_key).unwrap().unwrap()).unwrap()
        };
        assert_eq!(stored(&core).leader, None);
        core.queue
            .lock()
            .unwrap()
            .mark_uploaded(&run.run_key, "https://x/runs/1", wall_ms())
            .unwrap();

        // 2) the addon's export arrives (on /reload): the leader is added and the run goes out again
        let line = format!(
            "\"v1|RUN|{}|{}|{}|{}|Fizzle Boom\", -- [1]",
            run.zone.instance_id,
            run.started_at / 1000 - 120,
            run.ended_at / 1000 + 60,
            run.zone.name
        );
        core.addon.lock().unwrap().export = addon::parse_export(&line);
        core.add_leaders_to_stored_runs();
        assert_eq!(stored(&core).leader.as_deref(), Some("Fizzle Boom"));
        assert_eq!(
            core.queue.lock().unwrap().status_of(&run.run_key).unwrap(),
            Some(queue::Status::Pending)
        );
        assert_eq!(core.addon_status().leaders_added, 1);
        // again: nothing left to add
        core.add_leaders_to_stored_runs();
        assert_eq!(core.addon_status().leaders_added, 1);

        // 3) a run that finishes after the addon spoke gets the leader straight away
        let mut second = run.clone();
        second.run_key = "feedfacefeedface".into();
        core.store_runs(vec![second]);
        let q = core.queue.lock().unwrap();
        let json = q.get_json("feedfacefeedface").unwrap().unwrap();
        assert!(json.contains("\"leader\":\"Fizzle Boom\""));
    }

    #[test]
    fn logs_stay_until_every_run_is_on_the_portal() {
        let t = crate::testutil::TempDir::new("logs-needed");
        let core = Core::open(&t.path().join("cfg"), &t.path().join("data")).unwrap();
        let mut p = Pipeline::new(2, 0);
        let mut personal = Personal::new(0);
        let mut runs = Vec::new();
        for l in fixture().lines() {
            runs.extend(p.feed(l, &mut personal));
        }
        runs.extend(p.finish());
        let run = runs.remove(0);
        core.store_runs(vec![run.clone()]);
        core.auth.lock().unwrap().linked = true;

        // linked + uploading: a pending run keeps the logs
        assert!(core.logs_still_needed().unwrap().contains("not on the portal"));
        // uploaded → the logs may go
        core.queue
            .lock()
            .unwrap()
            .mark_uploaded(&run.run_key, "https://x/runs/1", wall_ms())
            .unwrap();
        assert_eq!(core.logs_still_needed(), None);
        // a run being recorded always keeps them
        core.watch.lock().unwrap().run_in_progress = true;
        assert!(core.logs_still_needed().is_some());
        core.watch.lock().unwrap().run_in_progress = false;
        // not linked: nothing will ever upload, the run stored in the app is the copy
        let mut other = run.clone();
        other.run_key = "fedcba9876543210".into();
        core.store_runs(vec![other]);
        assert!(core.logs_still_needed().is_some());
        core.auth.lock().unwrap().linked = false;
        assert_eq!(core.logs_still_needed(), None);
    }
}
