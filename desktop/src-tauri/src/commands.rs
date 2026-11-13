//! Tauri commands (called from the Svelte UI with `invoke`).

use crate::engine::{AuthStatus, Cmd, Core, PendingLink, UploadStatus, WatchStatus};
use crate::locate::Candidate;
use crate::queue::{Counts, RunRow};
use crate::settings::Settings;
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tauri::State;
use tauri_plugin_opener::OpenerExt;
use wowrun::RunSummary;

type Core_<'a> = State<'a, Arc<Core>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDto {
    pub version: &'static str,
    pub api_base: String,
    pub settings: Settings,
    pub auth: AuthStatus,
    pub watch: WatchStatus,
    pub upload: UploadStatus,
    pub queue: Counts,
    pub runs_version: u64,
    pub live: Option<RunSummary>,
}

#[tauri::command]
pub fn get_status(core: Core_<'_>) -> StatusDto {
    let settings = core.settings();
    StatusDto {
        version: env!("CARGO_PKG_VERSION"),
        api_base: settings.api_base(),
        auth: core.auth.lock().expect("auth").clone(),
        watch: core.watch.lock().expect("watch").clone(),
        upload: core.upload.lock().expect("upload").clone(),
        queue: core.counts(),
        runs_version: core.runs_version.load(Ordering::SeqCst),
        live: core.live.lock().expect("live").clone(),
        settings,
    }
}

#[tauri::command]
pub async fn start_link(app: tauri::AppHandle, core: State<'_, Arc<Core>>) -> Result<PendingLink, String> {
    let core = Arc::clone(&core);
    let pending = tauri::async_runtime::spawn_blocking(move || core.start_link())
        .await
        .map_err(|e| e.to_string())??;
    app.opener()
        .open_url(&pending.link_url, None::<&str>)
        .map_err(|e| format!("cannot open browser: {e}"))?;
    Ok(pending)
}

#[tauri::command]
pub fn cancel_link(core: Core_<'_>) {
    core.cancel_link();
}

#[tauri::command]
pub fn unlink(core: Core_<'_>) -> Result<(), String> {
    core.unlink()
}

#[tauri::command]
pub async fn locate_logs(core: State<'_, Arc<Core>>) -> Result<Vec<Candidate>, String> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.candidates())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(core: Core_<'_>, settings: Settings) -> Result<(), String> {
    core.save_settings(settings)
}

#[tauri::command]
pub fn list_runs(core: Core_<'_>, limit: Option<usize>) -> Result<Vec<RunRow>, String> {
    core.queue
        .lock()
        .expect("queue")
        .list(limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn retry_run(core: Core_<'_>, run_key: String) -> Result<(), String> {
    core.queue
        .lock()
        .expect("queue")
        .retry(&run_key)
        .map_err(|e| e.to_string())?;
    core.upload.lock().expect("upload").blocked = false;
    core.runs_version.fetch_add(1, Ordering::SeqCst);
    core.kick_uploader();
    Ok(())
}

#[tauri::command]
pub fn delete_run(core: Core_<'_>, run_key: String) -> Result<(), String> {
    core.queue
        .lock()
        .expect("queue")
        .delete(&run_key)
        .map_err(|e| e.to_string())?;
    core.runs_version.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn end_run(core: Core_<'_>) {
    core.send(Cmd::EndRun);
}

#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only web links".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_logs_now(core: State<'_, Arc<Core>>) -> Result<crate::cleanup::CleanupReport, String> {
    let core = Arc::clone(&core);
    tauri::async_runtime::spawn_blocking(move || core.cleanup_logs())
        .await
        .map_err(|e| e.to_string())?
}
