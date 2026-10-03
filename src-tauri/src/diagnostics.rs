use crate::app::Shared;
use orbit_core::store::atomic_write;
use tauri::Manager;

pub fn write(app: &tauri::AppHandle) {
    let state = app.state::<Shared>();
    let Ok(r) = state.lock() else {
        return;
    };
    if !r.smoke {
        return;
    }
    let launcher = app.get_webview_window("launcher");
    let value = serde_json::json!({
        "pid": std::process::id(), "tray": app.tray_by_id("orbit").is_some(),
        "ready": r.status.frontend_ready, "visible": launcher.as_ref().is_some_and(|w| w.is_visible().unwrap_or(false)),
        "focused": launcher.as_ref().is_some_and(|w| w.is_focused().unwrap_or(false)),
        "position": launcher.as_ref().and_then(|w| w.outer_position().ok()),
        "size": launcher.as_ref().and_then(|w| w.inner_size().ok()),
        "url": launcher.as_ref().and_then(|w| w.url().ok()).map(|u| u.to_string()),
        "editor": app.get_webview_window("editor").is_some(),
        "status": r.status, "revision": r.snapshot.revision,
        "profileCount": r.snapshot.profiles.len(), "preview": r.preview.is_some()
    });
    let _ = atomic_write(
        &r.store.root.join("runtime.json"),
        &serde_json::to_vec_pretty(&value).unwrap_or_default(),
    );
}
