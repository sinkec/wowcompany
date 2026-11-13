//! User settings (JSON in the app config dir) and the device token file.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Production Convex HTTP endpoint (`*.convex.site`). Override with the env var
/// `WOWCOMPANY_API` (at build or run time) or in Settings → Advanced.
pub const PROD_API: &str = "https://laudable-crane-432.eu-west-1.convex.site";
pub const PORTAL_URL: &str = "https://wowcompany.vercel.app";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Folder with `WoWCombatLog-*.txt` (`…/World of Warcraft/_forever_/Logs`). `None` = auto-detect.
    pub logs_dir: Option<PathBuf>,
    /// Custom API base URL (empty = default).
    pub api_url: String,
    /// Upload finished runs automatically.
    pub uploads_enabled: bool,
    /// Minimum group players for a run to count (2 = no solo farming).
    pub min_players: usize,
    /// Name shown in "My devices".
    pub device_name: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            logs_dir: None,
            api_url: String::new(),
            uploads_enabled: true,
            min_players: 2,
            device_name: default_device_name(),
        }
    }
}

impl Settings {
    /// Effective API base: env var at run time > settings > env var at build time > production.
    pub fn api_base(&self) -> String {
        let pick = std::env::var("WOWCOMPANY_API")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| Some(self.api_url.clone()).filter(|s| !s.trim().is_empty()))
            .or_else(|| option_env!("WOWCOMPANY_API").map(str::to_string))
            .unwrap_or_else(|| PROD_API.to_string());
        pick.trim().trim_end_matches('/').to_string()
    }

    pub fn load(dir: &Path) -> Settings {
        fs::read_to_string(dir.join("settings.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> io::Result<()> {
        fs::create_dir_all(dir)?;
        let tmp = dir.join("settings.json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(self).map_err(io::Error::other)?)?;
        fs::rename(tmp, dir.join("settings.json"))
    }
}

fn default_device_name() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| fs::read_to_string("/etc/hostname").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "My PC".to_string());
    let os = if cfg!(windows) {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Linux"
    };
    format!("{host} ({os})")
}

/// Device token stored in a user-only file (0600 on Unix). OS keyring is a later
/// improvement (COMPANION.md §14 C4).
pub struct TokenStore {
    path: PathBuf,
}

impl TokenStore {
    pub fn new(dir: &Path) -> Self {
        TokenStore {
            path: dir.join("device-token"),
        }
    }

    pub fn load(&self) -> Option<String> {
        fs::read_to_string(&self.path)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| s.starts_with("wcc_"))
    }

    pub fn save(&self, token: &str) -> io::Result<()> {
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&self.path)?;
        f.write_all(token.as_bytes())?;
        f.sync_all()
    }

    pub fn clear(&self) -> io::Result<()> {
        match fs::remove_file(&self.path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn settings_round_trip_and_defaults() {
        let d = TempDir::new("settings");
        assert_eq!(Settings::load(d.path()), Settings::default());
        let s = Settings {
            logs_dir: Some("/x/Logs".into()),
            min_players: 3,
            ..Settings::default()
        };
        s.save(d.path()).unwrap();
        assert_eq!(Settings::load(d.path()), s);
        // unknown / missing fields fall back to defaults
        fs::write(d.path().join("settings.json"), r#"{"minPlayers":1,"future":true}"#).unwrap();
        let l = Settings::load(d.path());
        assert_eq!(l.min_players, 1);
        assert!(l.uploads_enabled);
    }

    #[test]
    fn token_file_is_private() {
        let d = TempDir::new("token");
        let t = TokenStore::new(d.path());
        assert_eq!(t.load(), None);
        t.save("wcc_secret").unwrap();
        assert_eq!(t.load().as_deref(), Some("wcc_secret"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(d.path().join("device-token"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        t.clear().unwrap();
        t.clear().unwrap();
        assert_eq!(t.load(), None);
    }
}
