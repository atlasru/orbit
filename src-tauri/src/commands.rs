use crate::app::{self, Bootstrap, Shared};
use base64::{engine::general_purpose::STANDARD, Engine};
use orbit_core::{
    new_id,
    store::{atomic_write, read_limited},
    Icon, Node, Profile, Snapshot,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn editor_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "editor" {
        Ok(())
    } else {
        Err("This operation requires the editor window".into())
    }
}

#[tauri::command]
pub fn get_bootstrap(app: tauri::AppHandle) -> Result<Bootstrap, String> {
    app::bootstrap(&app)
}

#[tauri::command]
pub fn frontend_ready(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "launcher" {
        return Ok(());
    }
    let preview = {
        let state = app.state::<Shared>();
        let mut r = state.lock().map_err(|e| e.to_string())?;
        r.status.frontend_ready = true;
        r.pending_open.then(|| r.preview.clone())
    };
    if let Some(preview) = preview {
        app::show(&app, preview)?;
    }
    crate::diagnostics::write(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_launcher(app: tauri::AppHandle) -> Result<(), String> {
    app::hide(&app, true)
}

#[tauri::command]
pub fn open_launcher(app: tauri::AppHandle) -> Result<(), String> {
    app::show(&app, None)
}

#[tauri::command]
pub fn open_editor(app: tauri::AppHandle) -> Result<(), String> {
    app::hide(&app, false)?;
    app::editor(&app)
}

#[tauri::command]
pub fn close_editor(window: WebviewWindow) -> Result<(), String> {
    editor_only(&window)?;
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_snapshot(
    app: tauri::AppHandle,
    window: WebviewWindow,
    snapshot: Snapshot,
) -> Result<Bootstrap, String> {
    editor_only(&window)?;
    snapshot.validate()?;
    snapshot
        .settings
        .shortcut
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|e| format!("Invalid shortcut: {e}"))?;
    let shortcut_changed;
    {
        let state = app.state::<Shared>();
        let mut r = state.lock().map_err(|e| e.to_string())?;
        if snapshot.revision != r.snapshot.revision {
            return Err("Configuration changed in another window. Reload before saving to avoid overwriting changes.".into());
        }
        let startup_changed =
            snapshot.settings.launch_at_startup != r.snapshot.settings.launch_at_startup;
        if startup_changed && !r.smoke {
            crate::native::set_autostart(snapshot.settings.launch_at_startup)?;
        }
        shortcut_changed = snapshot.settings.shortcut != r.snapshot.settings.shortcut;
        match r.store.save(&snapshot) {
            Ok(saved) => r.snapshot = saved,
            Err(e) => {
                if startup_changed && !r.smoke {
                    let _ = crate::native::set_autostart(r.snapshot.settings.launch_at_startup);
                }
                return Err(e);
            }
        }
    }
    if shortcut_changed {
        app::shortcuts(&app);
    }
    app::apply_effects(&app);
    app::publish(&app);
    crate::diagnostics::write(&app);
    app::bootstrap(&app)
}

#[tauri::command]
pub fn select_profile(app: tauri::AppHandle, profile_id: String) -> Result<Bootstrap, String> {
    {
        let state = app.state::<Shared>();
        let mut r = state.lock().map_err(|e| e.to_string())?;
        if !r.snapshot.profiles.iter().any(|p| p.id == profile_id) {
            return Err("Profile does not exist".into());
        }
        let mut next = r.snapshot.clone();
        next.active_profile_id = profile_id;
        r.snapshot = r.store.save(&next)?;
    }
    app::publish(&app);
    app::show(&app, None)?;
    app::bootstrap(&app)
}

#[tauri::command]
pub fn preview_launcher(
    app: tauri::AppHandle,
    window: WebviewWindow,
    profile: Profile,
) -> Result<(), String> {
    editor_only(&window)?;
    profile.validate()?;
    app::show(&app, Some(profile))
}

#[tauri::command]
pub async fn execute_node(
    app: tauri::AppHandle,
    window: WebviewWindow,
    profile_id: String,
    node_id: String,
) -> Result<(), String> {
    if window.label() != "launcher" {
        return Err("Actions run only from the launcher".into());
    }
    let (action, settings, epoch) = {
        let state = app.state::<Shared>();
        let r = state.lock().map_err(|e| e.to_string())?;
        if r.preview.is_some() {
            return Err("Preview never executes actions".into());
        }
        if r.snapshot.active_profile_id != profile_id {
            return Err("Launcher profile changed; reopen Orbit".into());
        }
        let profile = r.snapshot.active();
        let node = profile
            .nodes
            .iter()
            .find(|n| n.id == node_id)
            .ok_or("Node no longer exists")?;
        profile.may_execute(node)?;
        (node.action.clone(), r.snapshot.settings.clone(), r.epoch)
    };
    let result = tauri::async_runtime::spawn_blocking(move || crate::native::execute(&action))
        .await
        .map_err(|e| e.to_string())?;
    if let Err(error) = result {
        app.state::<Shared>()
            .lock()
            .map_err(|e| e.to_string())?
            .store
            .log(&error);
        return Err(error);
    }
    if settings.close_after_action {
        app::delayed_hide(app, settings.close_delay_ms as u64, epoch, false);
    }
    Ok(())
}

#[tauri::command]
pub async fn resolve_icons(
    app: tauri::AppHandle,
    nodes: Vec<Node>,
) -> Result<BTreeMap<String, String>, String> {
    if nodes.len() > 128 {
        return Err("Resolve at most 128 icons per request".into());
    }
    let root = app
        .state::<Shared>()
        .lock()
        .map_err(|e| e.to_string())?
        .store
        .root
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut icons = BTreeMap::new();
        for node in nodes {
            node.action.validate()?;
            if let Ok(Some(icon)) = crate::icons::resolve(&root, &node.icon, &node.action) {
                icons.insert(node.id, icon);
            }
        }
        Ok(icons)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pick_path(
    app: tauri::AppHandle,
    window: WebviewWindow,
    folder: bool,
) -> Result<Option<String>, String> {
    editor_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let builder = app.dialog().file().set_title("Choose action target");
        let selected = if folder {
            builder.blocking_pick_folder()
        } else {
            builder.blocking_pick_file()
        };
        selected
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pick_icon(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<Option<Icon>, String> {
    editor_only(&window)?;
    let root = app
        .state::<Shared>()
        .lock()
        .map_err(|e| e.to_string())?
        .store
        .root
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Choose icon")
            .add_filter("Images", &["png", "ico", "jpg", "jpeg"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let bytes = read_limited(&path, 2 * 1024 * 1024)?;
        Ok(Some(Icon::Custom {
            file: crate::icons::save(&root, &bytes)?,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    schema_version: u32,
    profile: Profile,
    #[serde(default)]
    icons: BTreeMap<String, String>,
}

#[tauri::command]
pub async fn export_profile(
    app: tauri::AppHandle,
    window: WebviewWindow,
    profile: Profile,
) -> Result<Option<String>, String> {
    editor_only(&window)?;
    profile.validate()?;
    let root = app
        .state::<Shared>()
        .lock()
        .map_err(|e| e.to_string())?
        .store
        .root
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Export profile")
            .set_file_name("orbit-profile.json")
            .add_filter("Orbit profile", &["json"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        let mut icons = BTreeMap::new();
        for node in &profile.nodes {
            if let Icon::Custom { file } = &node.icon {
                let bytes = read_limited(&root.join("icons").join(file), 2 * 1024 * 1024)?;
                icons.insert(file.clone(), STANDARD.encode(bytes));
            }
        }
        let bundle = Bundle {
            schema_version: 1,
            profile,
            icons,
        };
        atomic_write(
            &path,
            &serde_json::to_vec_pretty(&bundle).map_err(|e| e.to_string())?,
        )?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_profile(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> Result<Option<Profile>, String> {
    editor_only(&window)?;
    let root = app
        .state::<Shared>()
        .lock()
        .map_err(|e| e.to_string())?
        .store
        .root
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("Import profile — actions will not run")
            .add_filter("Orbit profile", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let bytes = read_limited(
            &file.into_path().map_err(|e| e.to_string())?,
            16 * 1024 * 1024,
        )?;
        import_bundle(&root, &bytes).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn import_bundle(root: &std::path::Path, bytes: &[u8]) -> Result<Profile, String> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let mut bundle: Bundle = if value.get("profile").is_some() {
        serde_json::from_value(value).map_err(|e| e.to_string())?
    } else {
        Bundle {
            schema_version: 1,
            profile: serde_json::from_value(value).map_err(|e| e.to_string())?,
            icons: BTreeMap::new(),
        }
    };
    if bundle.schema_version != 1 {
        return Err("Unsupported export schema".into());
    }
    bundle.profile.validate()?;
    if bundle.icons.len() > 128 {
        return Err("Import at most 128 custom icons".into());
    }
    // Validate the entire bundle before writing assets.
    let mut decoded = BTreeMap::new();
    for (name, bytes) in bundle.icons {
        if !orbit_core::valid_icon_file(&name) {
            return Err("Unsafe icon name in import".into());
        }
        decoded.insert(
            name,
            crate::icons::normalize(&STANDARD.decode(bytes).map_err(|e| e.to_string())?)?,
        );
    }
    let mut renamed_icons = BTreeMap::new();
    for (name, bytes) in decoded {
        renamed_icons.insert(name, crate::icons::save(root, &bytes)?);
    }
    let ids: HashMap<String, String> = bundle
        .profile
        .nodes
        .iter()
        .map(|n| (n.id.clone(), new_id()))
        .collect();
    bundle.profile.id = new_id();
    bundle.profile.trusted = false;
    for node in &mut bundle.profile.nodes {
        node.id = ids[&node.id].clone();
        node.parent_id = node.parent_id.as_ref().map(|id| ids[id].clone());
        if let Icon::Custom { file } = &mut node.icon {
            if let Some(new) = renamed_icons.get(file) {
                *file = new.clone();
            } else {
                node.icon = Icon::Auto;
            }
        }
    }
    bundle.profile.validate()?;
    Ok(bundle.profile)
}

#[tauri::command]
pub fn smoke_observation(
    app: tauri::AppHandle,
    name: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let state = app.state::<Shared>();
    let r = state.lock().map_err(|e| e.to_string())?;
    if !r.smoke {
        return Err("Test diagnostics are disabled".into());
    }
    if !orbit_core::safe_id(&name) {
        return Err("Invalid observation name".into());
    }
    atomic_write(
        &r.store.root.join(format!("{name}.json")),
        &serde_json::to_vec(&value).map_err(|e| e.to_string())?,
    )
}
