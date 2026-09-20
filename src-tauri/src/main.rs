#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn show_launcher(window: &WebviewWindow) {
    if let Some(monitor) = window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten()) {
        let area = monitor.work_area();
        let size = window.outer_size().unwrap_or_default();
        let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
        let y = area.position.y + (area.size.height as i32 - size.height as i32) / 2;
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x,y)));
    }
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn hide_launcher(window: WebviewWindow) -> Result<(), String> { window.hide().map_err(|e| e.to_string()) }

#[tauri::command]
fn run_action(action: &str, window: WebviewWindow) -> Result<(), String> {
    // Deliberate allowlist: arbitrary commands and imported actions are not executed.
    let target = match action {
        "files" => "explorer.exe",
        "browser" => "https://example.com",
        "settings" => "ms-settings:",
        "terminal" => "wt.exe",
        _ => return Err("Unknown action".into()),
    };
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", "", target]).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = target; return Err("Windows only".into()); }
    window.hide().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_shortcut("Alt+Space").expect("shortcut format").with_handler(|app, _, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) { let _ = window.hide(); } else { show_launcher(&window); }
                }
            }
        }).build())
        .invoke_handler(tauri::generate_handler![hide_launcher, run_action])
        .setup(|app| {
            app.global_shortcut().register("Alt+Space")?;
            let menu = tauri::menu::Menu::with_items(app, &[
                &tauri::menu::MenuItem::with_id(app,"open","Open Orbit",true,None::<&str>)?,
                &tauri::menu::MenuItem::with_id(app,"quit","Quit",true,None::<&str>)?,
            ])?;
            let mut tray = tauri::tray::TrayIconBuilder::new().menu(&menu).on_menu_event(|app,event| {
                match event.id().as_ref() {
                    "open" => { if let Some(window)=app.get_webview_window("main") { show_launcher(&window); } },
                    "quit" => app.exit(0),
                    _ => {}
                }
            });
            if let Some(icon)=app.default_window_icon() { tray=tray.icon(icon.clone()); }
            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Orbit runtime error");
}