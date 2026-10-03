#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod commands;
mod diagnostics;
mod icons;
mod native;

use app::{Runtime, Shared, Status};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::ShortcutState;

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.get(1).is_some_and(|a| a == "--action-fixture") {
        if arguments.len() == 4 {
            std::fs::write(&arguments[2], &arguments[3]).expect("Write test fixture");
        }
        return;
    }
    let smoke_root = arguments
        .windows(2)
        .find(|a| a[0] == "--smoke-test")
        .map(|a| std::path::PathBuf::from(&a[1]));
    let background = arguments.iter().any(|a| a == "--background");
    let instance_probe = arguments.iter().any(|a| a == "--instance-probe");
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            app::toggle(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        app::toggle(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap,
            commands::frontend_ready,
            commands::hide_launcher,
            commands::open_launcher,
            commands::open_editor,
            commands::close_editor,
            commands::save_snapshot,
            commands::select_profile,
            commands::preview_launcher,
            commands::execute_node,
            commands::resolve_icons,
            commands::pick_path,
            commands::pick_icon,
            commands::export_profile,
            commands::import_profile,
            commands::smoke_observation
        ])
        .setup(move |app| {
            let smoke = smoke_root.is_some();
            let root = smoke_root.clone().unwrap_or(app.path().app_data_dir()?);
            let store = orbit_core::Store::new(root).map_err(std::io::Error::other)?;
            let loaded = store.load().map_err(std::io::Error::other)?;
            let first_run = loaded.first_run;
            let mut warnings = loaded.warnings;
            if !smoke {
                if let Err(e) = native::set_autostart(loaded.snapshot.settings.launch_at_startup) {
                    warnings.push(format!("Startup setting could not be applied: {e}"));
                }
            }
            let status = Status {
                requested_shortcut: loaded.snapshot.settings.shortcut.clone(),
                registered_shortcut: None,
                shortcut_error: None,
                warnings,
                data_directory: store.root.to_string_lossy().into_owned(),
                frontend_ready: false,
                smoke,
            };
            app.manage(Mutex::new(Runtime {
                store,
                snapshot: loaded.snapshot,
                status,
                preview: None,
                pending_open: false,
                epoch: 0,
                previous_foreground: 0,
                smoke,
            }));
            app::tray(app.handle())?;
            app::shortcuts(app.handle());
            let b = app::bootstrap(app.handle()).map_err(std::io::Error::other)?;
            if !smoke
                && (!background && first_run
                    || b.status.shortcut_error.is_some()
                    || !b.status.warnings.is_empty())
            {
                app::editor(app.handle()).map_err(std::io::Error::other)?;
            }
            diagnostics::write(app.handle());
            if smoke && !instance_probe {
                diagnostics::run(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            if window.label() == "launcher" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = app::hide(app, true);
                    }
                    tauri::WindowEvent::Focused(false) => {
                        if let Ok(r) = app.state::<Shared>().lock() {
                            if r.snapshot.settings.close_on_blur
                                && window.is_visible().unwrap_or(false)
                            {
                                app::delayed_hide(app.clone(), 150, r.epoch, true);
                            }
                        }
                    }
                    _ => {}
                }
            } else if window.label() == "editor" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.emit("editor-close-request", ());
                }
            }
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        native::fatal(&format!(
            "Orbit failed to start: {error}\nCheck WebView2 Runtime and the Orbit data directory."
        ));
        std::process::exit(1);
    }
}
