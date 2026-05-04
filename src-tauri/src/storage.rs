use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::settings::{current_timestamp_ms, AppSettings};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: i64,
    pub content: String,
    pub created_at: i64,
    pub pinned: bool,
    pub last_copied_at: Option<i64>,
    pub copy_count: i64,
}

pub struct Storage {
    connection: Connection,
}

impl Storage {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        let mut storage = Self { connection };
        storage.initialize()?;
        Ok(storage)
    }

    fn initialize(&mut self) -> Result<(), String> {
        self.connection
            .execute_batch(
                "
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;
                CREATE TABLE IF NOT EXISTS clipboard_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    pinned INTEGER NOT NULL DEFAULT 0,
                    last_copied_at INTEGER,
                    copy_count INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_entries_created_at
                    ON clipboard_entries(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_entries_pinned_created
                    ON clipboard_entries(pinned DESC, created_at DESC);
                ",
            )
            .map_err(|error| error.to_string())?;

        ensure_copy_count_column(&self.connection)?;
        let defaults = AppSettings::default();
        self.save_settings(&defaults)?;
        Ok(())
    }

    pub fn load_settings(&self) -> Result<AppSettings, String> {
        let mut settings = AppSettings::default();

        let history_limit = self.get_setting_u32("history_limit")?;
        let retention_days = self.get_setting_u32("retention_days")?;
        let capture_enabled = self.get_setting_bool("capture_enabled")?;
        let launch_on_login = self.get_setting_bool("launch_on_login")?;
        let paste_on_select = self.get_setting_bool("paste_on_select")?;
        let hide_after_copy = self.get_setting_bool("hide_after_copy")?;
        let show_on_launch = self.get_setting_bool("show_on_launch")?;

        if let Some(value) = history_limit {
            settings.history_limit = value;
        }
        if let Some(value) = retention_days {
            settings.retention_days = value;
        }
        if let Some(value) = capture_enabled {
            settings.capture_enabled = value;
        }
        if let Some(value) = launch_on_login {
            settings.launch_on_login = value;
        }
        if let Some(value) = paste_on_select {
            settings.paste_on_select = value;
        }
        if let Some(value) = hide_after_copy {
            settings.hide_after_copy = value;
        }
        if let Some(value) = show_on_launch {
            settings.show_on_launch = value;
        }

        Ok(settings.sanitized())
    }

    pub fn save_settings(&mut self, settings: &AppSettings) -> Result<(), String> {
        let settings = settings.clone().sanitized();
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;

        transaction
            .execute(
                "INSERT INTO settings(key, value) VALUES('history_limit', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [settings.history_limit.to_string()],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO settings(key, value) VALUES('retention_days', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [settings.retention_days.to_string()],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO settings(key, value) VALUES('capture_enabled', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [bool_to_string(settings.capture_enabled)],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO settings(key, value) VALUES('launch_on_login', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [bool_to_string(settings.launch_on_login)],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO settings(key, value) VALUES('paste_on_select', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [bool_to_string(settings.paste_on_select)],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO settings(key, value) VALUES('hide_after_copy', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [bool_to_string(settings.hide_after_copy)],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO settings(key, value) VALUES('show_on_launch', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [bool_to_string(settings.show_on_launch)],
            )
            .map_err(|error| error.to_string())?;

        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn insert_entry(&mut self, content: &str) -> Result<Option<ClipboardEntry>, String> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let existing_id: Option<i64> = self
            .connection
            .query_row(
                "SELECT id
                 FROM clipboard_entries
                 WHERE content = ?1
                 ORDER BY created_at DESC
                 LIMIT 1",
                [trimmed],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;

        let timestamp = current_timestamp_ms();
        if let Some(id) = existing_id {
            self.connection
                .execute(
                    "UPDATE clipboard_entries
                     SET created_at = ?1,
                         last_copied_at = ?1,
                         copy_count = COALESCE(copy_count, 1) + 1
                     WHERE id = ?2",
                    params![timestamp, id],
                )
                .map_err(|error| error.to_string())?;

            let updated = self
                .connection
                .query_row(
                    "SELECT id, content, created_at, pinned, last_copied_at, copy_count
                     FROM clipboard_entries
                     WHERE id = ?1",
                    [id],
                    map_entry,
                )
                .map_err(|error| error.to_string())?;
            return Ok(Some(updated));
        }

        let created_at = timestamp;
        self.connection
            .execute(
                "INSERT INTO clipboard_entries(content, created_at, pinned, copy_count)
                 VALUES(?1, ?2, 0, 1)",
                params![trimmed, created_at],
            )
            .map_err(|error| error.to_string())?;

        Ok(Some(ClipboardEntry {
            id: self.connection.last_insert_rowid(),
            content: trimmed.to_string(),
            created_at,
            pinned: false,
            last_copied_at: None,
            copy_count: 1,
        }))
    }

    pub fn get_history(
        &self,
        query: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<ClipboardEntry>, String> {
        let capped_limit = limit.unwrap_or(250).clamp(1, 500);
        let trimmed_query = query.unwrap_or_default().trim();

        let mut statement = if trimmed_query.is_empty() {
            self.connection
                .prepare(
                    "SELECT MIN(id) AS id,
                            content,
                            MAX(created_at) AS created_at,
                            MAX(pinned) AS pinned,
                            MAX(last_copied_at) AS last_copied_at,
                            SUM(COALESCE(copy_count, 1)) AS copy_count
                     FROM clipboard_entries
                     GROUP BY content
                     ORDER BY pinned DESC, created_at DESC
                     LIMIT ?1",
                )
                .map_err(|error| error.to_string())?
        } else {
            self.connection
                .prepare(
                    "SELECT MIN(id) AS id,
                            content,
                            MAX(created_at) AS created_at,
                            MAX(pinned) AS pinned,
                            MAX(last_copied_at) AS last_copied_at,
                            SUM(COALESCE(copy_count, 1)) AS copy_count
                     FROM clipboard_entries
                     WHERE content LIKE ?1 COLLATE NOCASE
                     GROUP BY content
                     ORDER BY pinned DESC, created_at DESC
                     LIMIT ?2",
                )
                .map_err(|error| error.to_string())?
        };

        let rows = if trimmed_query.is_empty() {
            statement
                .query_map([capped_limit], map_entry)
                .map_err(|error| error.to_string())?
        } else {
            let pattern = format!("%{trimmed_query}%");
            statement
                .query_map(params![pattern, capped_limit], map_entry)
                .map_err(|error| error.to_string())?
        };

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn get_entry_content(&self, id: i64) -> Result<Option<String>, String> {
        self.connection
            .query_row(
                "SELECT content FROM clipboard_entries WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn touch_last_copied(&mut self, id: i64) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE clipboard_entries
                 SET last_copied_at = ?1
                 WHERE content = (SELECT content FROM clipboard_entries WHERE id = ?2 LIMIT 1)",
                params![current_timestamp_ms(), id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn toggle_pin(&mut self, id: i64) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE clipboard_entries
                 SET pinned = CASE pinned WHEN 1 THEN 0 ELSE 1 END
                 WHERE content = (SELECT content FROM clipboard_entries WHERE id = ?1 LIMIT 1)",
                [id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn delete_entry(&mut self, id: i64) -> Result<(), String> {
        self.connection
            .execute(
                "DELETE FROM clipboard_entries
                 WHERE content = (SELECT content FROM clipboard_entries WHERE id = ?1 LIMIT 1)",
                [id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn clear_unpinned(&mut self) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM clipboard_entries WHERE pinned = 0", [])
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn cleanup(&mut self, settings: &AppSettings) -> Result<(), String> {
        let retention_cutoff =
            current_timestamp_ms() - (settings.retention_days as i64 * 24 * 60 * 60 * 1000);

        let transaction = self
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;

        transaction
            .execute(
                "DELETE FROM clipboard_entries
                 WHERE pinned = 0 AND created_at < ?1",
                [retention_cutoff],
            )
            .map_err(|error| error.to_string())?;

        let total_entries: i64 = transaction
            .query_row("SELECT COUNT(*) FROM clipboard_entries", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        let overflow = total_entries.saturating_sub(settings.history_limit as i64);

        if overflow > 0 {
            transaction
                .execute(
                    "DELETE FROM clipboard_entries
                     WHERE id IN (
                         SELECT id FROM clipboard_entries
                         WHERE pinned = 0
                         ORDER BY created_at ASC
                         LIMIT ?1
                     )",
                    [overflow],
                )
                .map_err(|error| error.to_string())?;
        }

        transaction.commit().map_err(|error| error.to_string())
    }

    fn get_setting_u32(&self, key: &str) -> Result<Option<u32>, String> {
        let value: Option<String> = self
            .connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;

        match value {
            Some(value) => value
                .parse::<u32>()
                .map(Some)
                .map_err(|error| error.to_string()),
            None => Ok(None),
        }
    }

    fn get_setting_bool(&self, key: &str) -> Result<Option<bool>, String> {
        let value: Option<String> = self
            .connection
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;

        Ok(value.map(|raw| raw == "true"))
    }
}

fn map_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipboardEntry> {
    Ok(ClipboardEntry {
        id: row.get(0)?,
        content: row.get(1)?,
        created_at: row.get(2)?,
        pinned: row.get::<_, i64>(3)? == 1,
        last_copied_at: row.get(4)?,
        copy_count: row.get(5)?,
    })
}

fn bool_to_string(value: bool) -> String {
    if value {
        "true".to_string()
    } else {
        "false".to_string()
    }
}

fn ensure_copy_count_column(connection: &Connection) -> Result<(), String> {
    if has_column(connection, "clipboard_entries", "copy_count")? {
        return Ok(());
    }

    connection
        .execute(
            "ALTER TABLE clipboard_entries
             ADD COLUMN copy_count INTEGER NOT NULL DEFAULT 1",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn has_column(connection: &Connection, table_name: &str, column_name: &str) -> Result<bool, String> {
    let query = format!("PRAGMA table_info({table_name})");
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| error.to_string())?;
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;

    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let existing_name: String = row.get(1).map_err(|error| error.to_string())?;
        if existing_name == column_name {
            return Ok(true);
        }
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::Storage;
    use crate::settings::{current_timestamp_ms, AppSettings};

    fn storage() -> Storage {
        let connection = Connection::open_in_memory().expect("memory db");
        let mut storage = Storage { connection };
        storage.initialize().expect("schema");
        storage
    }

    #[test]
    fn insert_skips_empty_values() {
        let mut storage = storage();
        let entry = storage.insert_entry("   ").expect("insert");
        assert!(entry.is_none());
    }

    #[test]
    fn insert_skips_consecutive_duplicates() {
        let mut storage = storage();
        let first = storage.insert_entry("hello world").expect("first");
        let second = storage.insert_entry("hello world").expect("second");
        assert!(first.is_some());
        assert!(second.is_none());
    }

    #[test]
    fn pin_and_delete_update_rows() {
        let mut storage = storage();
        let first = storage
            .insert_entry("pin me")
            .expect("insert")
            .expect("entry");
        storage.toggle_pin(first.id).expect("pin");
        let history = storage.get_history(None, Some(10)).expect("history");
        assert!(history[0].pinned);

        storage.delete_entry(first.id).expect("delete");
        let history = storage.get_history(None, Some(10)).expect("history");
        assert!(history.is_empty());
    }

    #[test]
    fn cleanup_removes_oldest_unpinned_first() {
        let mut storage = storage();
        let settings = AppSettings {
            history_limit: 2,
            retention_days: 30,
            capture_enabled: true,
            launch_on_login: true,
            paste_on_select: true,
            hide_after_copy: true,
            show_on_launch: true,
        };

        let base = current_timestamp_ms();
        storage
            .connection
            .execute(
                "INSERT INTO clipboard_entries(content, created_at, pinned) VALUES(?1, ?2, 0)",
                rusqlite::params!["one", base],
            )
            .expect("seed one");
        storage
            .connection
            .execute(
                "INSERT INTO clipboard_entries(content, created_at, pinned) VALUES(?1, ?2, 0)",
                rusqlite::params!["two", base + 1],
            )
            .expect("seed two");
        storage
            .connection
            .execute(
                "INSERT INTO clipboard_entries(content, created_at, pinned) VALUES(?1, ?2, 0)",
                rusqlite::params!["three", base + 2],
            )
            .expect("seed three");

        storage.cleanup(&settings).expect("cleanup");
        let history = storage.get_history(None, Some(10)).expect("history");
        assert_eq!(history.len(), 2);
        assert!(history.iter().all(|entry| entry.content != "one"));
    }

    #[test]
    fn cleanup_respects_pinned_rows() {
        let mut storage = storage();
        let first = storage
            .insert_entry("pinned")
            .expect("insert")
            .expect("entry");
        storage.toggle_pin(first.id).expect("pin");
        storage
            .connection
            .execute(
                "INSERT INTO clipboard_entries(content, created_at, pinned) VALUES(?1, ?2, 0)",
                rusqlite::params![
                    "stale",
                    current_timestamp_ms() - 90 * 24 * 60 * 60 * 1000_i64
                ],
            )
            .expect("seed stale");

        let settings = AppSettings {
            history_limit: 250,
            retention_days: 30,
            capture_enabled: true,
            launch_on_login: true,
            paste_on_select: true,
            hide_after_copy: true,
            show_on_launch: true,
        };

        storage.cleanup(&settings).expect("cleanup");
        let history = storage.get_history(None, Some(10)).expect("history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].content, "pinned");
        assert!(history[0].pinned);
    }
}
