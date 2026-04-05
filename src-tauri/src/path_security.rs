#![allow(dead_code)]
use std::path::{Path, PathBuf};
use parking_lot::{Mutex, RwLock};
use std::sync::LazyLock;

static ALLOWED_DIRECTORIES: LazyLock<RwLock<Vec<PathBuf>>> = LazyLock::new(|| {
    RwLock::new(Vec::new())
});

pub fn add_allowed_directory(path: PathBuf) {
    let mut dirs = ALLOWED_DIRECTORIES.write();
    if !dirs.contains(&path) {
        dirs.push(path);
    }
}

#[allow(dead_code)]
pub fn remove_allowed_directory(path: &Path) {
    let mut dirs = ALLOWED_DIRECTORIES.write();
    dirs.retain(|p| p != path);
}

#[allow(dead_code)]
pub fn get_allowed_directories() -> Vec<PathBuf> {
    ALLOWED_DIRECTORIES.read().clone()
}

pub fn resolve_safe_path(
    file_path: &str,
    base_path: Option<&PathBuf>,
) -> Result<PathBuf, String> {
    let path = Path::new(file_path);
    
    let full_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        match base_path {
            Some(base) => base.join(path),
            None => return Err("No pack loaded and path is relative".into()),
        }
    };

    let canonical = normalize_path(&full_path);

    if let Some(base) = base_path {
        let base_canonical = normalize_path(base);
        if canonical.starts_with(&base_canonical) {
            return Ok(canonical);
        }
    }

    let allowed_dirs = ALLOWED_DIRECTORIES.read();
    for allowed in allowed_dirs.iter() {
        let allowed_canonical = normalize_path(allowed);
        if canonical.starts_with(&allowed_canonical) {
            return Ok(canonical);
        }
    }

    Err(format!(
        "Access denied: path '{}' is outside allowed directories",
        file_path
    ))
}

pub fn resolve_pack_path(
    file_path: &str,
    pack_path_mutex: &Mutex<Option<PathBuf>>,
) -> Result<PathBuf, String> {
    let base_path = {
        let guard = pack_path_mutex.lock();
        guard.clone()
    };
    
    resolve_safe_path(file_path, base_path.as_ref())
}

pub fn get_pack_base_path(
    pack_path_mutex: &Mutex<Option<PathBuf>>,
) -> Result<PathBuf, String> {
    let guard = pack_path_mutex.lock();
    guard.clone().ok_or_else(|| "No pack loaded".to_string())
}

pub fn normalize_path_public(path: &Path) -> PathBuf {
    normalize_path(path)
}

fn normalize_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                result.pop();
            }
            std::path::Component::CurDir => {}
            other => {
                result.push(other.as_os_str());
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_path_traversal_blocked() {
        let base = PathBuf::from("C:/packs/mypack");
        let result = resolve_safe_path("../../Windows/System32/evil.exe", Some(&base));
        assert!(result.is_err());
    }

    #[test]
    fn test_valid_relative_path() {
        let base = PathBuf::from("C:/packs/mypack");
        let result = resolve_safe_path("assets/textures/block.png", Some(&base));
        assert!(result.is_ok());
    }

    #[test]
    fn test_absolute_path_in_pack() {
        let base = PathBuf::from("C:/packs/mypack");
        let result = resolve_safe_path("C:/packs/mypack/assets/test.json", Some(&base));
        assert!(result.is_ok());
    }

    #[test]
    fn test_absolute_path_outside_pack() {
        let base = PathBuf::from("C:/packs/mypack");
        let result = resolve_safe_path("C:/Windows/evil.dll", Some(&base));
        assert!(result.is_err());
    }

    #[test]
    fn test_allowed_directory() {
        let base = PathBuf::from("C:/packs/mypack");
        add_allowed_directory(PathBuf::from("C:/plugins/myplugin"));
        let result = resolve_safe_path("C:/plugins/myplugin/data.json", Some(&base));
        assert!(result.is_ok());
        remove_allowed_directory(Path::new("C:/plugins/myplugin"));
    }
}
