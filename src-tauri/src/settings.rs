use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub history_limit: u32,
    pub retention_days: u32,
    pub capture_enabled: bool,
    pub launch_on_login: bool,
    pub paste_on_select: bool,
    pub hide_after_copy: bool,
    pub show_on_launch: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            history_limit: 250,
            retention_days: 30,
            capture_enabled: true,
            launch_on_login: true,
            paste_on_select: true,
            hide_after_copy: true,
            show_on_launch: true,
        }
    }
}

impl AppSettings {
    pub fn sanitized(self) -> Self {
        Self {
            history_limit: self.history_limit.clamp(25, 500),
            retention_days: self.retention_days.clamp(1, 365),
            capture_enabled: self.capture_enabled,
            launch_on_login: self.launch_on_login,
            paste_on_select: self.paste_on_select,
            hide_after_copy: self.hide_after_copy,
            show_on_launch: self.show_on_launch,
        }
    }
}

pub fn current_timestamp_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

pub fn sync_launch_on_login(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let manager = app.autolaunch();
        if settings.launch_on_login {
            manager.enable().map_err(|error| error.to_string())?;
        } else {
            manager.disable().map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}
