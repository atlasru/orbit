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
    let smoke = r.smoke;
    let root = r.store.root.clone();
    let status = r.status.clone();
    let revision = r.snapshot.revision;
    let profile_count = r.snapshot.profiles.len();
    let preview = r.preview.is_some();
    drop(r);
    if !smoke {
        return;
    }
    let launcher = app.get_webview_window("launcher");
    let value = serde_json::json!({
        "pid": std::process::id(), "tray": app.tray_by_id("orbit").is_some(),
        "ready": status.frontend_ready, "visible": launcher.as_ref().is_some_and(|w| w.is_visible().unwrap_or(false)),
        "focused": launcher.as_ref().is_some_and(|w| w.is_focused().unwrap_or(false)),
        "position": launcher.as_ref().and_then(|w| w.outer_position().ok()),
        "size": launcher.as_ref().and_then(|w| w.inner_size().ok()),
        "url": launcher.as_ref().and_then(|w| w.url().ok()).map(|u| u.to_string()),
        "editor": app.get_webview_window("editor").is_some(),
        "status": status, "revision": revision,
        "profileCount": profile_count, "preview": preview
    });
    let _ = atomic_write(
        &root.join("runtime.json"),
        &serde_json::to_vec_pretty(&value).unwrap_or_default(),
    );
}

#[cfg(not(windows))]
pub fn run(_: tauri::AppHandle) {}

#[cfg(windows)]
pub fn run(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let result = suite(&app);
        let root = app.state::<Shared>().lock().unwrap().store.root.clone();
        let value = match &result {
            Ok(checks) => serde_json::json!({"ok": true, "checks": checks}),
            Err(error) => serde_json::json!({"ok": false, "error": error}),
        };
        let name = if root.join("smoke-complete.json").exists() {
            if app
                .state::<Shared>()
                .lock()
                .unwrap()
                .status
                .warnings
                .is_empty()
            {
                "smoke-restart.json"
            } else {
                "smoke-recovery.json"
            }
        } else {
            "smoke-result.json"
        };
        let _ = atomic_write(
            &root.join(name),
            &serde_json::to_vec_pretty(&value).unwrap(),
        );
        if result.is_ok() && name == "smoke-result.json" {
            let _ = atomic_write(&root.join("smoke-complete.json"), b"{}");
        }
        app.exit(if result.is_ok() { 0 } else { 1 });
    });
}

#[cfg(windows)]
fn wait_for(test: impl Fn() -> bool, description: &str) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(35);
    while std::time::Instant::now() < deadline {
        if test() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Err(format!("Timed out: {description}"))
}

#[cfg(windows)]
fn keys(keys: &[u16]) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    };
    let input = |key, flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let mut inputs = Vec::new();
    for &key in keys {
        inputs.push(input(key, 0));
    }
    for &key in keys.iter().rev() {
        inputs.push(input(key, KEYEVENTF_KEYUP));
    }
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        Err(format!(
            "SendInput injected {sent}/{} events: {}",
            inputs.len(),
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn observation(root: &std::path::Path, name: &str) -> Result<serde_json::Value, String> {
    let path = root.join(format!("{name}.json"));
    wait_for(|| path.exists(), name)?;
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if value["ok"] != true {
        return Err(format!("{name}: {value}"));
    }
    Ok(value)
}

#[cfg(windows)]
fn suite(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri::Emitter;
    wait_for(
        || {
            app.state::<Shared>()
                .lock()
                .is_ok_and(|r| r.status.frontend_ready)
        },
        "bundled WebView2 frontend ready",
    )?;
    let root = app
        .state::<Shared>()
        .lock()
        .map_err(|e| e.to_string())?
        .store
        .root
        .clone();
    let window = app
        .get_webview_window("launcher")
        .ok_or("Missing launcher")?;
    if app.tray_by_id("orbit").is_none() {
        return Err("Tray did not initialize".into());
    }
    let url = window.url().map_err(|e| e.to_string())?.to_string();
    if url.contains(":1420") || url.contains("127.0.0.1") {
        return Err(format!("Production still uses Vite: {url}"));
    }
    let mut checks = vec![
        "application started".into(),
        "tray exists".into(),
        "bundled frontend loaded without Vite".into(),
    ];
    if root.join("smoke-complete.json").exists() {
        let b = crate::app::bootstrap(app)?;
        if b.snapshot.profiles.len() != 2
            || !b
                .snapshot
                .profiles
                .iter()
                .any(|p| p.name == "Work" && p.nodes[0].label == "Edited fixture")
        {
            return Err("Edited profiles did not persist across restart".into());
        }
        if !b.status.warnings.is_empty() {
            if !b
                .status
                .warnings
                .iter()
                .any(|w| w.contains("Recovered last valid backup"))
            {
                return Err("Corruption did not recover a valid backup".into());
            }
            checks.push("corrupt config preserved and valid backup loaded".into());
        } else {
            if b.snapshot.active().name != "Work" {
                return Err("Active profile did not persist".into());
            }
            checks
                .push("profiles, node actions, and active profile persisted across restart".into());
        }
        return Ok(checks);
    }
    let b = crate::app::bootstrap(app)?;
    let shortcut = b
        .status
        .registered_shortcut
        .ok_or("Neither primary nor fallback shortcut registered")?;
    let chord = if shortcut == "Alt+Shift+Space" {
        vec![0x12, 0x10, 0x20]
    } else {
        vec![0x12, 0x20]
    };
    let handle = window.hwnd().map_err(|e| e.to_string())?;
    keys(&chord)?;
    wait_for(
        || window.is_visible().unwrap_or(false),
        "native global shortcut opens launcher",
    )?;
    wait_for(
        || window.is_focused().unwrap_or(false),
        "launcher receives native keyboard focus",
    )?;
    let area =
        crate::native::monitor(&b.snapshot.settings.monitor).ok_or("Cannot query monitor")?;
    let expected =
        orbit_core::geometry::centered(area.0, area.1, b.snapshot.settings.launcher_scale);
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    if (position.x - expected.x).abs() > 2
        || (position.y - expected.y).abs() > 2
        || size.width.abs_diff(expected.size) > 2
    {
        return Err(format!(
            "Wrong monitor placement: {position:?}, {size:?}, expected {expected:?}"
        ));
    }
    checks.push(format!(
        "native shortcut {shortcut} opens focused launcher on monitor work area"
    ));
    window
        .emit("smoke-request", "navigation")
        .map_err(|e| e.to_string())?;
    observation(&root, "ui-navigation")?;
    wait_for(
        || root.join("action fixture.txt").exists(),
        "actual application execution writes fixture",
    )?;
    let actual =
        std::fs::read_to_string(root.join("action fixture.txt")).map_err(|e| e.to_string())?;
    if actual != "literal & | ^ % hello \"quote\" Привет" {
        return Err(format!("Argument was altered by shell: {actual}"));
    }
    checks.push(
        "WebView2 arrows, Enter, nested menus, paging, and direct executable arguments".into(),
    );
    keys(&[0x1b])?;
    wait_for(
        || !window.is_visible().unwrap_or(true),
        "native Escape hides launcher",
    )?;
    keys(&chord)?;
    wait_for(
        || window.is_visible().unwrap_or(false),
        "reopen persistent launcher",
    )?;
    if window.hwnd().map_err(|e| e.to_string())? != handle {
        return Err("Launcher was recreated".into());
    }
    checks.push("native Escape and persistent window reuse".into());
    crate::app::show(app, Some(b.snapshot.active().clone()))?;
    window
        .emit("smoke-request", "preview")
        .map_err(|e| e.to_string())?;
    observation(&root, "ui-preview")?;
    crate::app::hide(app, false)?;
    checks.push("preview suppresses actions in both frontend and Rust".into());
    crate::app::editor(app)?;
    observation(&root, "editor-ready")?;
    app.get_webview_window("editor")
        .ok_or("Editor did not open")?
        .emit("smoke-editor-request", "edit")
        .map_err(|e| e.to_string())?;
    observation(&root, "ui-editor")?;
    if root.join("editor fixture.txt").exists() {
        return Err("Editor executed an action while configuring it".into());
    }
    checks.push("native editor create/type/edit, Undo/Redo, save, profile switching; no execution during editing".into());
    Ok(checks)
}
