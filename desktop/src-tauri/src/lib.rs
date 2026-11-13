//! WowCompany Companion – desktop app (Tauri 2). See COMPANION.md §5 and §8.2a.

pub mod api;
mod commands;
pub mod engine;
pub mod locate;
pub mod queue;
pub mod settings;
pub mod tail;
mod testutil;

use engine::Core;
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        // must be first: a second launch just focuses the running app
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let core = Core::open(&config_dir, &data_dir)?;
            core.spawn_workers();
            app.manage(Arc::clone(&core));

            let open = MenuItem::with_id(app, "open", "Open Companion", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("WowCompany Companion")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = e
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // tray tooltip = what the app is doing right now
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(3));
                    let w = core.watch.lock().expect("watch").clone();
                    let q = core.counts();
                    let state = match (&w.dungeon, w.run_in_progress) {
                        (Some(d), true) => format!("Recording: {d}"),
                        (Some(d), false) => format!("In {d}, waiting for a pull"),
                        (None, true) => "Run paused (corpse run?)".to_string(),
                        (None, false) => "Idle".to_string(),
                    };
                    let tip = if q.pending > 0 {
                        format!("WowCompany Companion – {state} · {} to upload", q.pending)
                    } else {
                        format!("WowCompany Companion – {state}")
                    };
                    if let Some(t) = handle.tray_by_id("main") {
                        let _ = t.set_tooltip(Some(tip));
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the window keeps recording in the tray
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::start_link,
            commands::cancel_link,
            commands::unlink,
            commands::locate_logs,
            commands::save_settings,
            commands::list_runs,
            commands::retry_run,
            commands::delete_run,
            commands::end_run,
            commands::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WowCompany Companion");
}
