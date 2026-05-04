use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::{DynamicImage, ImageFormat, RgbaImage};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::settings::{current_timestamp_ms, AppSettings};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardEntryKind {
    Text,
    Image,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: i64,
    pub kind: ClipboardEntryKind,
    pub content: String,
    pub image_path: Option<String>,
    pub image_width: Option<u32>,
    pub image_height: Option<u32>,
    pub created_at: i64,
    pub pinned: bool,
    pub last_copied_at: Option<i64>,
    pub copy_count: i64,
}

pub struct Storage {
    connection: Connection,
    media_dir: PathBuf,
}

impl Storage {
    pub fn open(path: &Path, media_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(media_dir).map_err(|error| error.to_string())?;
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        let mut storage = Self {
            connection,
            media_dir: media_dir.to_path_buf(),
        };
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
        ensure_text_column(
            &self.connection,
            "clipboard_entries",
            "kind",
            "TEXT NOT NULL DEFAULT 'text'",
        )?;
        ensure_text_column(
            &self.connection,
            "clipboard_entries",
            "entry_key",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        ensure_text_column(&self.connection, "clipboard_entries", "image_path", "TEXT")?;
        ensure_integer_column(&self.connection, "clipboard_entries", "image_width")?;
        ensure_integer_column(&self.connection, "clipboard_entries", "image_height")?;

        self.connection
            .execute(
                "UPDATE clipboard_entries
                 SET kind = 'text'
                 WHERE kind IS NULL OR TRIM(kind) = ''",
                [],
            )
            .map_err(|error| error.to_string())?;
        self.connection
            .execute(
                "UPDATE clipboard_entries
                 SET entry_key = 'text:' || content
                 WHERE entry_key IS NULL OR entry_key = ''",
                [],
            )
            .map_err(|error| error.to_string())?;
        self.connection
            .execute(
                "CREATE INDEX IF NOT EXISTS idx_entries_entry_key_created
                 ON clipboard_entries(entry_key, created_at DESC)",
                [],
            )
            .map_err(|error| error.to_string())?;

        let defaults = AppSettings::default();
        self.save_settings(&defaults)?;
        self.prune_media_directory()?;
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

    pub fn insert_text_entry(&mut self, content: &str) -> Result<Option<ClipboardEntry>, String> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let entry_key = format!("text:{trimmed}");
        self.upsert_entry(
            ClipboardEntryKind::Text,
            &entry_key,
            trimmed,
            None,
            None,
            None,
        )
    }

    pub fn insert_image_entry(
        &mut self,
        rgba_bytes: &[u8],
        width: u32,
        height: u32,
    ) -> Result<Option<ClipboardEntry>, String> {
        if rgba_bytes.is_empty() || width == 0 || height == 0 {
            return Ok(None);
        }

        let png_bytes = encode_rgba_as_png(rgba_bytes, width, height)?;
        let hash = hash_image(&png_bytes);
        let file_name = format!("{hash}.png");
        let file_path = self.media_dir.join(&file_name);

        if !file_path.exists() {
            fs::write(&file_path, png_bytes).map_err(|error| error.to_string())?;
        }

        let entry_key = format!("image:{hash}");
        let label = format!("Image • {width}×{height}");
        self.upsert_entry(
            ClipboardEntryKind::Image,
            &entry_key,
            &label,
            Some(file_path.to_string_lossy().to_string()),
            Some(width),
            Some(height),
        )
    }

    pub fn get_history(
        &self,
        query: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Vec<ClipboardEntry>, String> {
        let capped_limit = limit.unwrap_or(250).clamp(1, 5_000);
        let trimmed_query = query.unwrap_or_default().trim();

        let mut statement = if trimmed_query.is_empty() {
            self.connection
                .prepare(
                    "SELECT MIN(id) AS id,
                            MAX(kind) AS kind,
                            MAX(content) AS content,
                            MAX(image_path) AS image_path,
                            MAX(image_width) AS image_width,
                            MAX(image_height) AS image_height,
                            MAX(created_at) AS created_at,
                            MAX(pinned) AS pinned,
                            MAX(last_copied_at) AS last_copied_at,
                            SUM(COALESCE(copy_count, 1)) AS copy_count
                     FROM clipboard_entries
                     GROUP BY entry_key
                     ORDER BY pinned DESC, created_at DESC
                     LIMIT ?1",
                )
                .map_err(|error| error.to_string())?
        } else {
            self.connection
                .prepare(
                    "SELECT MIN(id) AS id,
                            MAX(kind) AS kind,
                            MAX(content) AS content,
                            MAX(image_path) AS image_path,
                            MAX(image_width) AS image_width,
                            MAX(image_height) AS image_height,
                            MAX(created_at) AS created_at,
                            MAX(pinned) AS pinned,
                            MAX(last_copied_at) AS last_copied_at,
                            SUM(COALESCE(copy_count, 1)) AS copy_count
                     FROM clipboard_entries
                     WHERE content LIKE ?1 COLLATE NOCASE
                     GROUP BY entry_key
                     ORDER BY pinned DESC, created_at DESC
                     LIMIT ?2",
                )
                .map_err(|error| error.to_string())?
        };

        let rows = if trimmed_query.is_empty() {
            statement
                .query_map([capped_limit], map_grouped_entry)
                .map_err(|error| error.to_string())?
        } else {
            let pattern = format!("%{trimmed_query}%");
            statement
                .query_map(params![pattern, capped_limit], map_grouped_entry)
                .map_err(|error| error.to_string())?
        };

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn export_history(&self) -> Result<Vec<ClipboardEntry>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT MIN(id) AS id,
                        MAX(kind) AS kind,
                        MAX(content) AS content,
                        MAX(image_path) AS image_path,
                        MAX(image_width) AS image_width,
                        MAX(image_height) AS image_height,
                        MAX(created_at) AS created_at,
                        MAX(pinned) AS pinned,
                        MAX(last_copied_at) AS last_copied_at,
                        SUM(COALESCE(copy_count, 1)) AS copy_count
                 FROM clipboard_entries
                 GROUP BY entry_key
                 ORDER BY pinned DESC, created_at DESC",
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], map_grouped_entry)
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    pub fn get_entry(&self, id: i64) -> Result<Option<ClipboardEntry>, String> {
        self.connection
            .query_row(
                "SELECT id,
                        kind,
                        content,
                        image_path,
                        image_width,
                        image_height,
                        created_at,
                        pinned,
                        last_copied_at,
                        COALESCE(copy_count, 1)
                 FROM clipboard_entries
                 WHERE id = ?1",
                [id],
                map_full_entry,
            )
            .optional()
            .map_err(|error| error.to_string())
    }

    pub fn touch_last_copied(&mut self, id: i64) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE clipboard_entries
                 SET last_copied_at = ?1
                 WHERE entry_key = (
                     SELECT entry_key FROM clipboard_entries WHERE id = ?2 LIMIT 1
                 )",
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
                 WHERE entry_key = (
                     SELECT entry_key FROM clipboard_entries WHERE id = ?1 LIMIT 1
                 )",
                [id],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn delete_entry(&mut self, id: i64) -> Result<(), String> {
        self.connection
            .execute(
                "DELETE FROM clipboard_entries
                 WHERE entry_key = (
                     SELECT entry_key FROM clipboard_entries WHERE id = ?1 LIMIT 1
                 )",
                [id],
            )
            .map_err(|error| error.to_string())?;
        self.prune_media_directory()?;
        Ok(())
    }

    pub fn clear_unpinned(&mut self) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM clipboard_entries WHERE pinned = 0", [])
            .map_err(|error| error.to_string())?;
        self.prune_media_directory()?;
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
            .query_row(
                "SELECT COUNT(DISTINCT entry_key) FROM clipboard_entries",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let overflow = total_entries.saturating_sub(settings.history_limit as i64);

        if overflow > 0 {
            transaction
                .execute(
                    "DELETE FROM clipboard_entries
                     WHERE entry_key IN (
                         SELECT entry_key FROM clipboard_entries
                         WHERE pinned = 0
                         GROUP BY entry_key
                         ORDER BY MAX(created_at) ASC
                         LIMIT ?1
                     )",
                    [overflow],
                )
                .map_err(|error| error.to_string())?;
        }

        transaction.commit().map_err(|error| error.to_string())?;
        self.prune_media_directory()?;
        Ok(())
    }

    fn upsert_entry(
        &mut self,
        kind: ClipboardEntryKind,
        entry_key: &str,
        content: &str,
        image_path: Option<String>,
        image_width: Option<u32>,
        image_height: Option<u32>,
    ) -> Result<Option<ClipboardEntry>, String> {
        let existing_id: Option<i64> = self
            .connection
            .query_row(
                "SELECT id
                 FROM clipboard_entries
                 WHERE entry_key = ?1
                 ORDER BY created_at DESC
                 LIMIT 1",
                [entry_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;

        let timestamp = current_timestamp_ms();
        let kind_str = kind_to_db(&kind);
        if let Some(id) = existing_id {
            self.connection
                .execute(
                    "UPDATE clipboard_entries
                     SET kind = ?1,
                         content = ?2,
                         image_path = ?3,
                         image_width = ?4,
                         image_height = ?5,
                         created_at = ?6,
                         last_copied_at = ?6,
                         copy_count = COALESCE(copy_count, 1) + 1
                     WHERE entry_key = ?7",
                    params![
                        kind_str,
                        content,
                        image_path,
                        image_width,
                        image_height,
                        timestamp,
                        entry_key
                    ],
                )
                .map_err(|error| error.to_string())?;

            let updated = self
                .connection
                .query_row(
                    "SELECT id,
                            kind,
                            content,
                            image_path,
                            image_width,
                            image_height,
                            created_at,
                            pinned,
                            last_copied_at,
                            COALESCE(copy_count, 1)
                     FROM clipboard_entries
                     WHERE id = ?1",
                    [id],
                    map_full_entry,
                )
                .map_err(|error| error.to_string())?;
            return Ok(Some(updated));
        }

        self.connection
            .execute(
                "INSERT INTO clipboard_entries(
                    kind,
                    entry_key,
                    content,
                    image_path,
                    image_width,
                    image_height,
                    created_at,
                    pinned,
                    copy_count
                 )
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1)",
                params![
                    kind_str,
                    entry_key,
                    content,
                    image_path,
                    image_width,
                    image_height,
                    timestamp
                ],
            )
            .map_err(|error| error.to_string())?;

        Ok(Some(ClipboardEntry {
            id: self.connection.last_insert_rowid(),
            kind,
            content: content.to_string(),
            image_path,
            image_width,
            image_height,
            created_at: timestamp,
            pinned: false,
            last_copied_at: None,
            copy_count: 1,
        }))
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

    fn prune_media_directory(&self) -> Result<(), String> {
        if !self.media_dir.exists() {
            return Ok(());
        }

        let mut statement = self
            .connection
            .prepare(
                "SELECT DISTINCT image_path
                 FROM clipboard_entries
                 WHERE image_path IS NOT NULL AND image_path != ''",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;

        let referenced = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        let referenced: std::collections::HashSet<PathBuf> =
            referenced.into_iter().map(PathBuf::from).collect();

        for entry in fs::read_dir(&self.media_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.is_file() && !referenced.contains(&path) {
                fs::remove_file(path).map_err(|error| error.to_string())?;
            }
        }

        Ok(())
    }
}

fn map_grouped_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipboardEntry> {
    Ok(ClipboardEntry {
        id: row.get(0)?,
        kind: kind_from_db(row.get::<_, String>(1)?),
        content: row.get(2)?,
        image_path: row.get(3)?,
        image_width: row.get(4)?,
        image_height: row.get(5)?,
        created_at: row.get(6)?,
        pinned: row.get::<_, i64>(7)? == 1,
        last_copied_at: row.get(8)?,
        copy_count: row.get(9)?,
    })
}

fn map_full_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipboardEntry> {
    Ok(ClipboardEntry {
        id: row.get(0)?,
        kind: kind_from_db(row.get::<_, String>(1)?),
        content: row.get(2)?,
        image_path: row.get(3)?,
        image_width: row.get(4)?,
        image_height: row.get(5)?,
        created_at: row.get(6)?,
        pinned: row.get::<_, i64>(7)? == 1,
        last_copied_at: row.get(8)?,
        copy_count: row.get(9)?,
    })
}

fn encode_rgba_as_png(rgba_bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let image = RgbaImage::from_raw(width, height, rgba_bytes.to_vec())
        .ok_or_else(|| "invalid clipboard image dimensions".to_string())?;

    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(image)
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(output.into_inner())
}

fn hash_image(png_bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(png_bytes);
    let digest = hasher.finalize();
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn kind_from_db(value: String) -> ClipboardEntryKind {
    if value.eq_ignore_ascii_case("image") {
        ClipboardEntryKind::Image
    } else {
        ClipboardEntryKind::Text
    }
}

fn kind_to_db(kind: &ClipboardEntryKind) -> &'static str {
    match kind {
        ClipboardEntryKind::Text => "text",
        ClipboardEntryKind::Image => "image",
    }
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

fn ensure_text_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    if has_column(connection, table_name, column_name)? {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"),
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_integer_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<(), String> {
    if has_column(connection, table_name, column_name)? {
        return Ok(());
    }

    connection
        .execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} INTEGER"),
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn has_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
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
    use std::fs;

    use rusqlite::Connection;

    use super::{ClipboardEntryKind, Storage};
    use crate::settings::{current_timestamp_ms, AppSettings};

    fn storage() -> Storage {
        let connection = Connection::open_in_memory().expect("memory db");
        let media_dir =
            std::env::temp_dir().join(format!("clipstack-tests-{}", current_timestamp_ms()));
        fs::create_dir_all(&media_dir).expect("media dir");
        let mut storage = Storage {
            connection,
            media_dir,
        };
        storage.initialize().expect("schema");
        storage
    }

    #[test]
    fn insert_skips_empty_values() {
        let mut storage = storage();
        let entry = storage.insert_text_entry("   ").expect("insert");
        assert!(entry.is_none());
    }

    #[test]
    fn duplicate_text_updates_copy_count() {
        let mut storage = storage();
        let first = storage.insert_text_entry("hello world").expect("first");
        let second = storage.insert_text_entry("hello world").expect("second");
        assert!(first.is_some());
        assert!(second.is_some());
        let history = storage.get_history(None, Some(10)).expect("history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].copy_count, 2);
    }

    #[test]
    fn pin_and_delete_update_rows() {
        let mut storage = storage();
        let first = storage
            .insert_text_entry("pin me")
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
                "INSERT INTO clipboard_entries(kind, entry_key, content, created_at, pinned)
                 VALUES(?1, ?2, ?3, ?4, 0)",
                rusqlite::params!["text", "text:one", "one", base],
            )
            .expect("seed one");
        storage
            .connection
            .execute(
                "INSERT INTO clipboard_entries(kind, entry_key, content, created_at, pinned)
                 VALUES(?1, ?2, ?3, ?4, 0)",
                rusqlite::params!["text", "text:two", "two", base + 1],
            )
            .expect("seed two");
        storage
            .connection
            .execute(
                "INSERT INTO clipboard_entries(kind, entry_key, content, created_at, pinned)
                 VALUES(?1, ?2, ?3, ?4, 0)",
                rusqlite::params!["text", "text:three", "three", base + 2],
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
            .insert_text_entry("pinned")
            .expect("insert")
            .expect("entry");
        storage.toggle_pin(first.id).expect("pin");
        storage
            .connection
            .execute(
                "INSERT INTO clipboard_entries(kind, entry_key, content, created_at, pinned)
                 VALUES(?1, ?2, ?3, ?4, 0)",
                rusqlite::params![
                    "text",
                    "text:stale",
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

    #[test]
    fn image_entries_are_stored_as_image_kind() {
        let mut storage = storage();
        let pixels = vec![
            255_u8, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        ];
        let image = storage
            .insert_image_entry(&pixels, 2, 2)
            .expect("insert")
            .expect("entry");
        assert_eq!(image.kind, ClipboardEntryKind::Image);
        assert!(image.image_path.is_some());
        assert_eq!(image.image_width, Some(2));
        assert_eq!(image.image_height, Some(2));
    }
}
