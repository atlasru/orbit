#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn show_launcher(window: &WebviewWindow) {
    // Center on the monitor containing the launcher window (primary as fallback).
    if let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
    {
        let area = monitor.work_area();
        if let Ok(size) = window.outer_size() {
            let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
            let y = area.position.y + (area.size.height as i32 - size.height as i32) / 2;
            if let Err(error) = window.set_position(tauri::Position::Physical(
                tauri::PhysicalPosition::new(x, y),
            )) {
                eprintln!("Orbit: cannot center launcher: {error}");
            }
        }
    }
    if let Err(error) = window.show().and_then(|_| window.set_focus()) {
        eprintln!("Orbit: cannot show launcher: {error}");
    }
}

#[tauri::command]
fn hide_launcher(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn run_action(action: &str, window: WebviewWindow) -> Result<(), String> {
    // Fixed built-in allowlist. Never interpolate user content into a command shell.
    #[cfg(target_os = "windows")]
    {
        let (program, argument) = match action {
            "files" => ("explorer.exe", None),
            "browser" => ("explorer.exe", Some("https://example.com")),
            "settings" => ("explorer.exe", Some("ms-settings:")),
            "terminal" => ("wt.exe", None),
            _ => return Err("Unknown action".into()),
        };
        let mut command = std::process::Command::new(program);
        if let Some(argument) = argument {
            command.arg(argument);
        }
        command.spawn().map_err(|error| format!("Could not launch {action}: {error}"))?;
        window.hide().map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (action, window);
        Err("Orbit currently supports Windows only".into())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                if let Err(error) = window.hide() {
                                    eprintln!("Orbit: cannot hide launcher: {error}");
                                }
                            } else {
                                show_launcher(&window);
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![hide_launcher, run_action])
        .setup(|app| {
            // Alt+Space is also used by Windows and other launchers. Never abort startup
            // merely because a global shortcut is already occupied.
            let shortcuts = app.global_shortcut();
            match shortcuts.register("Alt+Space") {
                Ok(()) => println!("Orbit: shortcut Alt+Space registered"),
                Err(error) => {
                    eprintln!("Orbit: Alt+Space unavailable ({error}); trying Alt+Shift+Space");
                    match shortcuts.register("Alt+Shift+Space") {
                        Ok(()) => println!("Orbit: shortcut Alt+Shift+Space registered"),
                        Err(error) => eprintln!(
                            "Orbit: no shortcut available ({error}); use the system tray > Open Orbit"
                        ),
                    }
                }
            }

            let menu = tauri::menu::Menu::with_items(
                app,
                &[
                    &tauri::menu::MenuItem::with_id(app, "open", "Open Orbit", true, None::<&str>)?,
                    &tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
                ],
            )?;
            let mut tray = tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_launcher(&window);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Orbit runtime error");
}
