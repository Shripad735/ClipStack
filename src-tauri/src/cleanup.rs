use crate::settings::AppSettings;
use crate::storage::Storage;

pub fn prune(storage: &mut Storage, settings: &AppSettings) -> Result<(), String> {
    storage.cleanup(settings)
}
