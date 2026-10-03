use orbit_core::{
    geometry::{centered, Rect},
    Profile, Snapshot, Store, TrayClick,
};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub requested_shortcut: String,
    pub registered_shortcut: Option<String>,
    pub shortcut_error: Option<String>,
    pub warnings: Vec<String>,
    pub data_directory: String,
    pub frontend_ready: bool,
    pub smoke: bool,
}

pub struct Runtime {
    pub store: Store,
    pub snapshot: Snapshot,
    pub status: Status,
    pub preview: Option<Profile>,
    pub pending_open: bool,
    pub epoch: u64,
    pub previous_foreground: usize,
    pub smoke: bool,
}

pub type Shared = Mutex<Runtime>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub snapshot: Snapshot,
    pub status: Status,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherPayload {
    pub profile: Profile,
    pub settings: orbit_core::Settings,
    pub preview: bool,
    pub epoch: u64,
}

pub fn bootstrap(app: &tauri::AppHandle) -> Result<Bootstrap, String> {
    let state = app.state::<Shared>();
    let r = state.lock().map_err(|e| e.to_string())?;
    Ok(Bootstrap {
        snapshot: r.snapshot.clone(),
        status: r.status.clone(),
    })
}

pub fn publish(app: &tauri::AppHandle) {
    if let Ok(b) = bootstrap(app) {
        let _ = app.emit("config-changed", b);
    }
}

pub fn report(app: &tauri::AppHandle, error: String) {
    if let Some(state) = app.try_state::<Shared>() {
        if let Ok(mut r) = state.lock() {
            r.store.log(&error);
            if !r.status.warnings.contains(&error) {
                r.status.warnings.push(error.clone());
            }
        }
    }
    let _ = app.emit("orbit-error", error);
}

pub fn shortcuts(app: &tauri::AppHandle) {
    let requested = match bootstrap(app) {
        Ok(b) => b.snapshot.settings.shortcut,
        Err(_) => return,
    };
    let manager = app.global_shortcut();
    let mut error = manager.unregister_all().err().map(|e| e.to_string());
    let mut registered = None;
    match requested
        .parse::<Shortcut>()
        .map_err(|e| e.to_string())
        .and_then(|s| manager.register(s).map_err(|e| e.to_string()))
    {
        Ok(()) => registered = Some(requested.clone()),
        Err(e) => {
            error = Some(format!("{requested} could not be registered: {e}. Another application may own it. Change Shortcut in Settings or use the tray."));
            if requested != "Alt+Shift+Space" && manager.register("Alt+Shift+Space").is_ok() {
                registered = Some("Alt+Shift+Space".into());
            }
        }
    }
    let state = app.state::<Shared>();
    if let Ok(mut r) = state.lock() {
        r.status.requested_shortcut = requested;
        r.status.registered_shortcut = registered;
        r.status.shortcut_error = error;
        if let Some(error) = &r.status.shortcut_error {
            r.store.log(error);
        }
    }
    publish(app);
}

pub fn editor(app: &tauri::AppHandle) -> Result<(), String> {
    let window = if let Some(window) = app.get_webview_window("editor") {
        window
    } else {
        WebviewWindowBuilder::new(app, "editor", WebviewUrl::App("index.html?editor".into()))
            .title("Orbit Editor")
            .inner_size(1120.0, 740.0)
            .min_inner_size(900.0, 600.0)
            .visible(false)
            .build()
            .map_err(|e| format!("Cannot create editor: {e}"))?
    };
    apply_effects(app);
    window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
        .map_err(|e| e.to_string())
}

pub fn apply_effects(app: &tauri::AppHandle) {
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window("editor") {
        use tauri::window::{Effect, EffectsBuilder};
        let enabled = bootstrap(app).is_ok_and(|b| b.snapshot.settings.blur);
        let result = if enabled {
            window.set_effects(Some(
                EffectsBuilder::new()
                    .effect(Effect::Acrylic)
                    .color((20, 22, 29, 210).into())
                    .build(),
            ))
        } else {
            window.set_effects(None::<tauri::utils::config::WindowEffectsConfig>)
        };
        if let Err(e) = result {
            report(
                app,
                format!("Acrylic unavailable; using dark surfaces: {e}"),
            );
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

pub fn show(app: &tauri::AppHandle, preview: Option<Profile>) -> Result<(), String> {
    let window = app
        .get_webview_window("launcher")
        .ok_or("Launcher window is missing")?;
    let (settings, profile, epoch) = {
        let state = app.state::<Shared>();
        let mut r = state.lock().map_err(|e| e.to_string())?;
        r.preview = preview;
        if !r.status.frontend_ready {
            r.pending_open = true;
            return Ok(());
        }
        r.pending_open = false;
        r.epoch += 1;
        let foreground = crate::native::foreground();
        if foreground != 0 {
            r.previous_foreground = foreground;
        }
        (
            r.snapshot.settings.clone(),
            r.preview
                .clone()
                .unwrap_or_else(|| r.snapshot.active().clone()),
            r.epoch,
        )
    };
    let area = crate::native::monitor(&settings.monitor)
        .or_else(|| {
            window.primary_monitor().ok().flatten().map(|monitor| {
                let work = monitor.work_area();
                (
                    Rect {
                        x: work.position.x,
                        y: work.position.y,
                        width: work.size.width,
                        height: work.size.height,
                    },
                    monitor.scale_factor(),
                )
            })
        })
        .ok_or("No monitor is available")?;
    let placement = centered(area.0, area.1, settings.launcher_scale);
    window
        .set_size(PhysicalSize::new(placement.size, placement.size))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(placement.x, placement.y))
        .map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    let is_preview = app
        .state::<Shared>()
        .lock()
        .map_err(|e| e.to_string())?
        .preview
        .is_some();
    window
        .emit(
            "launcher-opened",
            LauncherPayload {
                profile,
                settings,
                preview: is_preview,
                epoch,
            },
        )
        .map_err(|e| e.to_string())?;
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|e| e.to_string())?;
    crate::diagnostics::write(app);
    Ok(())
}

pub fn hide(app: &tauri::AppHandle, restore: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("launcher")
        .ok_or("Launcher is missing")?;
    let focused = window.is_focused().unwrap_or(false);
    let prior = {
        let state = app.state::<Shared>();
        let mut r = state.lock().map_err(|e| e.to_string())?;
        r.epoch += 1;
        r.preview = None;
        r.pending_open = false;
        r.previous_foreground
    };
    window
        .hide()
        .and_then(|_| window.set_always_on_top(false))
        .map_err(|e| e.to_string())?;
    if focused && restore {
        crate::native::restore_foreground(prior);
    }
    crate::diagnostics::write(app);
    Ok(())
}

pub fn toggle(app: &tauri::AppHandle) {
    let result = if app
        .get_webview_window("launcher")
        .is_some_and(|w| w.is_visible().unwrap_or(false))
    {
        hide(app, true)
    } else {
        show(app, None)
    };
    if let Err(e) = result {
        report(app, e);
    }
}

pub fn delayed_hide(app: tauri::AppHandle, delay: u64, epoch: u64, only_unfocused: bool) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        let valid = app.state::<Shared>().lock().is_ok_and(|r| r.epoch == epoch);
        if !valid {
            return;
        }
        if only_unfocused
            && app
                .get_webview_window("launcher")
                .is_some_and(|w| w.is_focused().unwrap_or(false))
        {
            return;
        }
        if let Err(e) = hide(&app, false) {
            report(&app, e);
        }
    });
}

pub fn request_editor(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = editor(&app) {
            report(&app, error);
        }
    });
}

pub fn tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "open", "Open Orbit", true, None::<&str>)?,
            &MenuItem::with_id(app, "editor", "Editor and Settings", true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "Quit Orbit", true, None::<&str>)?,
        ],
    )?;
    let mut builder = TrayIconBuilder::with_id("orbit")
        .menu(&menu)
        .tooltip("Orbit — Alt+Space")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let result = match event.id().as_ref() {
                "open" => show(app, None),
                "editor" => {
                    request_editor(app);
                    Ok(())
                }
                "quit" => {
                    app.exit(0);
                    Ok(())
                }
                _ => Ok(()),
            };
            if let Err(e) = result {
                report(app, e);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let app = tray.app_handle();
                if bootstrap(app).is_ok_and(|b| b.snapshot.settings.tray_click == TrayClick::Editor)
                {
                    request_editor(app);
                } else {
                    toggle(app);
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
