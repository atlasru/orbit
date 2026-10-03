use crate::{new_id, safe_id, Profile, Settings, Snapshot, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_JSON: u64 = 8 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    revision: u64,
    settings: Settings,
    active_profile_id: String,
    profiles: Vec<ProfileRef>,
}

#[derive(Serialize, Deserialize)]
struct ProfileRef {
    id: String,
    file: String,
}

pub struct Store {
    pub root: PathBuf,
}

pub struct Loaded {
    pub snapshot: Snapshot,
    pub warnings: Vec<String>,
    pub first_run: bool,
}

pub fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > limit {
        return Err(format!("{} is too large", path.display()));
    }
    use std::io::Read;
    let mut data = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > limit {
        return Err("File exceeds size limit".into());
    }
    Ok(data)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Path has no parent")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    tmp.write_all(bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    tmp.persist(path)
        .map_err(|e| format!("Atomic replacement of {} failed: {e}", path.display()))?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

impl Store {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        for folder in ["profiles", "icons", "backups", "logs"] {
            fs::create_dir_all(root.join(folder)).map_err(|e| e.to_string())?;
        }
        Ok(Self { root })
    }

    fn parse(&self, bytes: &[u8]) -> Result<Snapshot, String> {
        let version = serde_json::from_slice::<serde_json::Value>(bytes)
            .map_err(|e| e.to_string())?
            .get("schemaVersion")
            .and_then(|v| v.as_u64())
            .ok_or("Missing schema version")?;
        if version == 1 {
            let mut snapshot: Snapshot =
                serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
            snapshot.schema_version = SCHEMA_VERSION;
            snapshot.validate()?;
            return Ok(snapshot);
        }
        if version != SCHEMA_VERSION as u64 {
            return Err(format!("Unsupported configuration schema {version}"));
        }
        let manifest: Manifest = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        let mut profiles = Vec::new();
        for reference in manifest.profiles {
            if !safe_id(&reference.id) || !reference.file.strip_suffix(".json").is_some_and(safe_id)
            {
                return Err("Unsafe profile reference".into());
            }
            let data = read_limited(&self.root.join("profiles").join(reference.file), MAX_JSON)?;
            let profile: Profile = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
            if profile.id != reference.id {
                return Err("Profile ID does not match manifest".into());
            }
            profiles.push(profile);
        }
        let snapshot = Snapshot {
            schema_version: SCHEMA_VERSION,
            revision: manifest.revision,
            settings: manifest.settings,
            active_profile_id: manifest.active_profile_id,
            profiles,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub fn load(&self) -> Result<Loaded, String> {
        let path = self.root.join("config.json");
        if !path.exists() {
            let snapshot = self.save(&Snapshot::default())?;
            return Ok(Loaded {
                snapshot,
                warnings: vec![],
                first_run: true,
            });
        }
        let original = read_limited(&path, MAX_JSON);
        let parsed = original
            .as_ref()
            .map_err(Clone::clone)
            .and_then(|b| self.parse(b));
        match parsed {
            Ok(snapshot) => {
                let bytes = original.unwrap();
                let version = serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()
                    ["schemaVersion"]
                    .as_u64();
                if version == Some(1) {
                    atomic_write(
                        &self
                            .root
                            .join("backups")
                            .join(format!("pre-migration-{}.json", new_id())),
                        &bytes,
                    )?;
                    let snapshot = self.save(&snapshot)?;
                    Ok(Loaded {
                        snapshot,
                        warnings: vec![
                            "Configuration migrated to schema 2. Original preserved in backups."
                                .into(),
                        ],
                        first_run: false,
                    })
                } else {
                    Ok(Loaded {
                        snapshot,
                        warnings: vec![],
                        first_run: false,
                    })
                }
            }
            Err(error) => {
                // Preserve even an oversized/corrupt file before a later user save can replace it.
                let corrupt = self
                    .root
                    .join("backups")
                    .join(format!("corrupt-{}.json", new_id()));
                fs::copy(&path, &corrupt)
                    .map_err(|e| format!("Cannot preserve damaged config: {e}"))?;
                let backup = self.root.join("backups/last-good.json");
                let restored = read_limited(&backup, MAX_JSON).and_then(|b| self.parse(&b));
                let (snapshot, recovery) = match restored {
                    Ok(s) => (s, "Recovered last valid backup."),
                    Err(_) => (Snapshot::default(), "No valid backup. Loaded safe defaults; original preserved. Save in editor to recover."),
                };
                Ok(Loaded {
                    snapshot,
                    warnings: vec![format!(
                        "Configuration error: {error}. {recovery} Damaged file: {}",
                        corrupt.display()
                    )],
                    first_run: false,
                })
            }
        }
    }

    pub fn save(&self, snapshot: &Snapshot) -> Result<Snapshot, String> {
        snapshot.validate()?;
        let config = self.root.join("config.json");
        let prior = read_limited(&config, MAX_JSON)
            .ok()
            .filter(|bytes| self.parse(bytes).is_ok());
        let mut saved = snapshot.clone();
        saved.revision = saved.revision.checked_add(1).ok_or("Revision overflow")?;
        let mut references = Vec::new();
        // Immutable profile generations are committed before the manifest. A crash cannot
        // leave a valid config pointing to partially rewritten profiles.
        for profile in &saved.profiles {
            let file = format!("{}-{}.json", profile.id, new_id());
            atomic_write(
                &self.root.join("profiles").join(&file),
                &serde_json::to_vec_pretty(profile).map_err(|e| e.to_string())?,
            )?;
            references.push(ProfileRef {
                id: profile.id.clone(),
                file,
            });
        }
        if let Some(bytes) = prior {
            atomic_write(&self.root.join("backups/last-good.json"), &bytes)?;
        }
        let manifest = Manifest {
            schema_version: SCHEMA_VERSION,
            revision: saved.revision,
            settings: saved.settings.clone(),
            active_profile_id: saved.active_profile_id.clone(),
            profiles: references,
        };
        atomic_write(
            &config,
            &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
        )?;
        Ok(saved)
    }

    pub fn log(&self, message: &str) {
        let path = self.root.join("logs/orbit.log");
        if fs::metadata(&path).is_ok_and(|m| m.len() > 1024 * 1024) {
            let _ = fs::rename(&path, self.root.join("logs/orbit.previous.log"));
        }
        if let Ok(mut file) = fs::OpenOptions::new().append(true).create(true).open(path) {
            let time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let _ = writeln!(file, "{time} {}", message.replace(['\n', '\r'], " "));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        (dir, store)
    }
    #[test]
    fn roundtrip_and_corruption_recover_last_valid_generation() {
        let (_dir, s) = store();
        let first = s.load().unwrap().snapshot;
        let mut changed = first.clone();
        changed.profiles[0].name = "Work".into();
        let second = s.save(&changed).unwrap();
        assert_eq!(s.load().unwrap().snapshot, second);
        fs::write(s.root.join("config.json"), b"{broken").unwrap();
        let recovered = s.load().unwrap();
        assert_eq!(recovered.snapshot, first);
        assert!(!recovered.warnings.is_empty());
        assert_eq!(fs::read(s.root.join("config.json")).unwrap(), b"{broken");
        let _ = s.save(&recovered.snapshot).unwrap();
        assert_eq!(s.load().unwrap().snapshot.profiles[0].name, "Default");
    }
    #[test]
    fn invalid_save_does_not_change_disk() {
        let (_dir, s) = store();
        let mut snapshot = s.load().unwrap().snapshot;
        let before = fs::read(s.root.join("config.json")).unwrap();
        snapshot.active_profile_id = "missing".into();
        assert!(s.save(&snapshot).is_err());
        assert_eq!(before, fs::read(s.root.join("config.json")).unwrap());
    }
    #[test]
    fn missing_profile_recovers_backup() {
        let (_dir, s) = store();
        let first = s.load().unwrap().snapshot;
        s.save(&first).unwrap();
        let m: Manifest =
            serde_json::from_slice(&fs::read(s.root.join("config.json")).unwrap()).unwrap();
        fs::remove_file(s.root.join("profiles").join(&m.profiles[0].file)).unwrap();
        assert_eq!(s.load().unwrap().snapshot, first);
    }
    #[test]
    fn schema_migration_preserves_original() {
        let (_dir, s) = store();
        let mut legacy = Snapshot::default();
        legacy.schema_version = 1;
        let bytes = serde_json::to_vec(&legacy).unwrap();
        fs::write(s.root.join("config.json"), &bytes).unwrap();
        let loaded = s.load().unwrap();
        assert_eq!(loaded.snapshot.schema_version, 2);
        assert!(fs::read_dir(s.root.join("backups"))
            .unwrap()
            .filter_map(Result::ok)
            .any(|e| e
                .file_name()
                .to_string_lossy()
                .starts_with("pre-migration-")));
        assert_eq!(s.load().unwrap().snapshot, loaded.snapshot);
    }
    #[test]
    fn corrupt_first_run_preserves_file_and_loads_defaults() {
        let (_dir, s) = store();
        fs::write(s.root.join("config.json"), b"oops").unwrap();
        let loaded = s.load().unwrap();
        loaded.snapshot.validate().unwrap();
        assert!(loaded.warnings[0].contains("safe defaults"));
        assert_eq!(fs::read(s.root.join("config.json")).unwrap(), b"oops");
    }
}
