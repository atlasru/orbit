use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const SCHEMA_VERSION: u32 = 2;
pub const PROFILE_VERSION: u32 = 1;

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub shortcut: String,
    pub launch_at_startup: bool,
    pub tray_click: TrayClick,
    pub close_after_action: bool,
    pub close_delay_ms: u32,
    pub close_on_blur: bool,
    pub language: String,
    pub opacity: f64,
    pub blur: bool,
    pub accent: String,
    pub animations: bool,
    pub reduced_motion: bool,
    pub show_labels: bool,
    pub launcher_scale: f64,
    pub monitor: MonitorPolicy,
    pub keyboard: KeyboardMode,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "Alt+Space".into(),
            launch_at_startup: false,
            tray_click: TrayClick::Launcher,
            close_after_action: true,
            close_delay_ms: 0,
            close_on_blur: true,
            language: "en".into(),
            opacity: 0.90,
            blur: false,
            accent: "#a89cfa".into(),
            animations: true,
            reduced_motion: false,
            show_labels: true,
            launcher_scale: 1.0,
            monitor: MonitorPolicy::Foreground,
            keyboard: KeyboardMode::Directional,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TrayClick {
    #[default]
    Launcher,
    Editor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum MonitorPolicy {
    #[default]
    Foreground,
    Cursor,
    Primary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum KeyboardMode {
    #[default]
    Directional,
    Sequential,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema_version: u32,
    pub revision: u64,
    pub settings: Settings,
    pub active_profile_id: String,
    pub profiles: Vec<Profile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub trusted: bool,
    pub nodes: Vec<Node>,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub parent_id: Option<String>,
    pub label: String,
    #[serde(default)]
    pub icon: Icon,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Icon {
    #[default]
    Auto,
    Builtin {
        name: String,
    },
    Custom {
        file: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Application {
        executable: String,
        args: Vec<String>,
        working_directory: Option<String>,
    },
    File {
        path: String,
    },
    Folder {
        path: String,
    },
    Url {
        url: String,
    },
    Command {
        executable: String,
        args: Vec<String>,
        working_directory: Option<String>,
    },
    Submenu,
    System {
        action: SystemAction,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SystemAction {
    WindowsSettings,
    TaskManager,
    Explorer,
    Terminal,
    Lock,
}

impl Action {
    pub fn is_executable(&self) -> bool {
        matches!(self, Self::Application { .. } | Self::Command { .. })
    }

    pub fn validate(&self) -> Result<(), String> {
        let nonempty = |s: &str| -> Result<(), String> {
            if s.trim().is_empty() || s.len() > 32768 || s.contains('\0') {
                Err("Action contains an empty, oversized, or invalid value".into())
            } else {
                Ok(())
            }
        };
        match self {
            Self::Application {
                executable,
                args,
                working_directory,
            }
            | Self::Command {
                executable,
                args,
                working_directory,
            } => {
                nonempty(executable)?;
                if args.len() > 512 || args.iter().any(|a| a.contains('\0') || a.len() > 32768) {
                    return Err("Invalid executable arguments".into());
                }
                if let Some(wd) = working_directory {
                    nonempty(wd)?;
                }
            }
            Self::File { path } | Self::Folder { path } => nonempty(path)?,
            Self::Url { url } => {
                nonempty(url)?;
                let parsed = url::Url::parse(url).map_err(|_| "URL must be absolute")?;
                if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
                    return Err("Only http, https and mailto URLs are allowed".into());
                }
            }
            Self::Submenu | Self::System { .. } => {}
        }
        Ok(())
    }
}

impl Profile {
    pub fn empty(name: String) -> Self {
        Self {
            schema_version: PROFILE_VERSION,
            id: new_id(),
            name,
            trusted: true,
            nodes: vec![],
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != PROFILE_VERSION {
            return Err("Unsupported profile schema".into());
        }
        if !safe_id(&self.id) || self.name.trim().is_empty() || self.name.len() > 120 {
            return Err("Invalid profile ID or name".into());
        }
        if self.nodes.len() > 10000 {
            return Err("Profile exceeds 10000 nodes".into());
        }
        let mut map = HashMap::new();
        for node in &self.nodes {
            if !safe_id(&node.id) || map.insert(node.id.as_str(), node).is_some() {
                return Err("Duplicate or invalid node ID".into());
            }
            if node.label.trim().is_empty() || node.label.len() > 160 {
                return Err("Node needs a label of at most 160 bytes".into());
            }
            if let Icon::Custom { file } = &node.icon {
                if !valid_icon_file(file) {
                    return Err("Invalid custom icon filename".into());
                }
            }
            if let Icon::Builtin { name } = &node.icon {
                if !matches!(
                    name.as_str(),
                    "app"
                        | "file"
                        | "folder"
                        | "globe"
                        | "command"
                        | "submenu"
                        | "settings"
                        | "terminal"
                        | "lock"
                        | "orbit"
                        | "game"
                        | "work"
                ) {
                    return Err("Unknown built-in icon".into());
                }
            }
            node.action.validate()?;
        }
        for node in &self.nodes {
            if let Some(parent) = &node.parent_id {
                let parent = map
                    .get(parent.as_str())
                    .ok_or("Node has a missing parent")?;
                if !matches!(parent.action, Action::Submenu) {
                    return Err("Parent must be a submenu".into());
                }
            }
        }
        // Iterative coloring keeps even very deep valid trees off the call stack.
        let mut done = HashSet::new();
        for node in &self.nodes {
            let mut chain = Vec::new();
            let mut visiting = HashSet::new();
            let mut current = Some(node.id.as_str());
            while let Some(id) = current {
                if done.contains(id) {
                    break;
                }
                if !visiting.insert(id) {
                    return Err("Menu contains a cycle".into());
                }
                chain.push(id);
                current = map[id].parent_id.as_deref();
            }
            done.extend(chain);
        }
        Ok(())
    }

    pub fn may_execute(&self, node: &Node) -> Result<(), String> {
        if !self.trusted && node.action.is_executable() {
            return Err(
                "Review this imported profile in the editor and enable executable actions first"
                    .into(),
            );
        }
        if matches!(node.action, Action::Submenu) {
            return Err("Submenus are navigation, not executable actions".into());
        }
        node.action.validate()
    }
}

pub fn valid_icon_file(file: &str) -> bool {
    file.strip_suffix(".png").is_some_and(safe_id)
}

impl Snapshot {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err("Unsupported configuration schema".into());
        }
        if self.profiles.is_empty() || self.profiles.len() > 100 {
            return Err("Keep between 1 and 100 profiles".into());
        }
        let mut ids = HashSet::new();
        for profile in &self.profiles {
            profile.validate()?;
            if !ids.insert(&profile.id) {
                return Err("Duplicate profile ID".into());
            }
        }
        if !ids.contains(&self.active_profile_id) {
            return Err("Active profile does not exist".into());
        }
        let s = &self.settings;
        if s.shortcut.trim().is_empty() || s.shortcut.len() > 100 {
            return Err("Shortcut is empty or too long".into());
        }
        if !s.opacity.is_finite()
            || !(0.35..=1.0).contains(&s.opacity)
            || !s.launcher_scale.is_finite()
            || !(0.7..=1.6).contains(&s.launcher_scale)
            || s.close_delay_ms > 5000
        {
            return Err("Appearance or close delay is out of range".into());
        }
        if s.accent.len() != 7
            || !s.accent.starts_with('#')
            || !s.accent[1..].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Accent must be a #RRGGBB color".into());
        }
        if !matches!(s.language.as_str(), "en" | "ru") {
            return Err("Supported languages: en, ru".into());
        }
        Ok(())
    }

    pub fn active(&self) -> &Profile {
        self.profiles
            .iter()
            .find(|p| p.id == self.active_profile_id)
            .expect("validated active profile")
    }
}

impl Default for Snapshot {
    fn default() -> Self {
        let mut profile = Profile::empty("Default".into());
        let system_menu = new_id();
        profile.nodes = vec![
            Node {
                id: new_id(),
                parent_id: None,
                label: "Explorer".into(),
                icon: Icon::Auto,
                action: Action::System {
                    action: SystemAction::Explorer,
                },
            },
            Node {
                id: new_id(),
                parent_id: None,
                label: "Browser".into(),
                icon: Icon::Auto,
                action: Action::Url {
                    url: "https://example.com".into(),
                },
            },
            Node {
                id: new_id(),
                parent_id: None,
                label: "Terminal".into(),
                icon: Icon::Auto,
                action: Action::System {
                    action: SystemAction::Terminal,
                },
            },
            Node {
                id: system_menu.clone(),
                parent_id: None,
                label: "System".into(),
                icon: Icon::Builtin {
                    name: "settings".into(),
                },
                action: Action::Submenu,
            },
            Node {
                id: new_id(),
                parent_id: Some(system_menu.clone()),
                label: "Windows Settings".into(),
                icon: Icon::Auto,
                action: Action::System {
                    action: SystemAction::WindowsSettings,
                },
            },
            Node {
                id: new_id(),
                parent_id: Some(system_menu.clone()),
                label: "Task Manager".into(),
                icon: Icon::Auto,
                action: Action::System {
                    action: SystemAction::TaskManager,
                },
            },
            Node {
                id: new_id(),
                parent_id: Some(system_menu),
                label: "Lock".into(),
                icon: Icon::Auto,
                action: Action::System {
                    action: SystemAction::Lock,
                },
            },
        ];
        Self {
            schema_version: SCHEMA_VERSION,
            revision: 0,
            settings: Settings::default(),
            active_profile_id: profile.id.clone(),
            profiles: vec![profile],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_roundtrips() {
        let s = Snapshot::default();
        s.validate().unwrap();
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(s, serde_json::from_str::<Snapshot>(&json).unwrap());
        assert!(json.contains("windowsSettings"));
        assert!(json.contains("parentId"));
    }

    #[test]
    fn rejects_cycles_duplicate_ids_and_non_menu_parents() {
        let mut p = Profile::empty("test".into());
        let node = |id: &str, parent: Option<&str>| Node {
            id: id.into(),
            parent_id: parent.map(String::from),
            label: id.into(),
            icon: Icon::Auto,
            action: Action::Submenu,
        };
        p.nodes = vec![node("a", Some("b")), node("b", Some("a"))];
        assert!(p.validate().unwrap_err().contains("cycle"));
        p.nodes = vec![node("a", None), node("a", None)];
        assert!(p.validate().is_err());
        p.nodes = vec![node("a", Some("missing"))];
        assert!(p.validate().is_err());
        p.nodes = vec![node("a", None), node("b", Some("a"))];
        p.nodes[0].action = Action::System {
            action: SystemAction::Explorer,
        };
        assert!(p.validate().is_err());
    }

    #[test]
    fn accepts_deep_tree_without_recursion_or_depth_cap() {
        let mut p = Profile::empty("deep".into());
        for i in 0..5000 {
            p.nodes.push(Node {
                id: format!("n{i}"),
                parent_id: (i > 0).then(|| format!("n{}", i - 1)),
                label: "Menu".into(),
                icon: Icon::Auto,
                action: Action::Submenu,
            });
        }
        p.validate().unwrap();
    }

    #[test]
    fn untrusted_executables_require_review() {
        let mut p = Profile::empty("import".into());
        p.trusted = false;
        let n = Node {
            id: new_id(),
            parent_id: None,
            label: "exec".into(),
            icon: Icon::Auto,
            action: Action::Command {
                executable: "program.exe".into(),
                args: vec!["& not a shell".into()],
                working_directory: None,
            },
        };
        assert!(p.may_execute(&n).is_err());
        p.trusted = true;
        p.may_execute(&n).unwrap();
    }

    #[test]
    fn prevents_path_traversal_and_dangerous_url_schemes() {
        assert!(!safe_id("../config"));
        assert!(!valid_icon_file("../file.png"));
        for url in [
            "file:///C:/evil.exe",
            "javascript:alert(1)",
            "ms-settings:",
            "https://test\0",
        ] {
            assert!(Action::Url { url: url.into() }.validate().is_err());
        }
        Action::Url {
            url: "https://example.com/?x=%26".into(),
        }
        .validate()
        .unwrap();
    }
}
