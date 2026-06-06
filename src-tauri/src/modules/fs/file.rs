use std::ffi::OsString;
use std::fs::OpenOptions;
use std::path::Path;
use std::time::UNIX_EPOCH;
use std::{fs, io::Write};

use serde::Serialize;
use tauri::Emitter;
use tempfile::NamedTempFile;

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

const MAX_READ_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_BINARY_WRITE_BYTES: usize = 25 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Text {
        content: String,
        size: u64,
    },
    Binary {
        size: u64,
    },
    /// File exceeds MAX_READ_BYTES. UI decides whether to offer "open anyway".
    TooLarge {
        size: u64,
        limit: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatKind {
    File,
    Dir,
    Symlink,
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
    pub kind: StatKind,
}

#[tauri::command]
pub fn fs_read_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<ReadResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let size = meta.len();
    if size > MAX_READ_BYTES {
        return Ok(ReadResult::TooLarge {
            size,
            limit: MAX_READ_BYTES,
        });
    }

    let bytes = std::fs::read(&p).map_err(|e| {
        log::debug!("fs_read_file read({}) failed: {e}", p.display());
        e.to_string()
    })?;

    // Null-byte sniff on the first chunk. Not perfect (misses UTF-16 BOM
    // cases) but catches the common "this is a PNG" mistake cheaply.
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Ok(ReadResult::Binary { size });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(ReadResult::Text { content, size }),
        Err(_) => Ok(ReadResult::Binary { size }),
    }
}

#[derive(Serialize, Clone)]
struct FileWrittenEvent {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

/// Atomic write via O_EXCL tempfile in the target's parent, then rename.
/// The random suffix is what blocks pre-staged symlink attacks.
fn write_atomic(target: &Path, content: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    let mut tmp = NamedTempFile::new_in(parent)?;
    tmp.as_file_mut().write_all(content)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(target).map_err(|e| e.error)?;
    Ok(())
}

#[tauri::command]
pub fn fs_write_file(
    path: String,
    content: String,
    workspace: Option<WorkspaceEnv>,
    source: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let target = resolve_path(&path, &workspace);
    let original_permissions = fs::metadata(&target).ok().map(|m| m.permissions());
    write_atomic(&target, content.as_bytes()).map_err(|e| {
        log::warn!("fs_write_file({}) failed: {e}", target.display());
        e.to_string()
    })?;

    if let Some(perms) = original_permissions {
        let _ = fs::set_permissions(&target, perms);
    }
    let _ = app.emit(
        "fs:file-written",
        FileWrittenEvent {
            path: path.clone(),
            source,
        },
    );

    Ok(())
}

#[tauri::command]
pub fn fs_canonicalize(path: String, workspace: Option<WorkspaceEnv>) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let canon = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
    Ok(super::to_canon(&canon))
}

#[tauri::command]
pub fn fs_read_binary_file(
    path: String,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<u8>, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = fs::metadata(&p).map_err(|e| {
        log::debug!("fs_read_binary_file stat({}) failed: {e}", p.display());
        e.to_string()
    })?;
    if !meta.is_file() {
        return Err(format!("not a file: {}", p.display()));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(format!(
            "file is too large: {} bytes exceeds {} bytes",
            meta.len(),
            MAX_READ_BYTES
        ));
    }
    fs::read(&p).map_err(|e| {
        log::debug!("fs_read_binary_file read({}) failed: {e}", p.display());
        e.to_string()
    })
}

#[tauri::command]
pub fn fs_write_binary_file(
    destination_dir: String,
    file_name: String,
    bytes: Vec<u8>,
    workspace: Option<WorkspaceEnv>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let destination = resolve_path(&destination_dir, &workspace);
    let path = write_binary_file_to_dir(&destination, &file_name, &bytes)?;
    let _ = app.emit(
        "fs:file-written",
        FileWrittenEvent {
            path: path.clone(),
            source: Some("clipboard".to_string()),
        },
    );
    Ok(path)
}

fn write_binary_file_to_dir(
    destination: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<String, String> {
    if bytes.len() > MAX_BINARY_WRITE_BYTES {
        return Err(format!(
            "file is too large: {} bytes exceeds {} bytes",
            bytes.len(),
            MAX_BINARY_WRITE_BYTES
        ));
    }

    let destination_meta = fs::metadata(destination).map_err(|e| {
        log::debug!(
            "fs_write_binary_file destination({}) failed: {e}",
            destination.display()
        );
        e.to_string()
    })?;
    if !destination_meta.is_dir() {
        return Err(format!(
            "destination is not a directory: {}",
            destination.display()
        ));
    }

    let child_name = validate_child_file_name(file_name)?;
    let destination_canonical = fs::canonicalize(destination).map_err(|e| e.to_string())?;
    let target = super::conflict_free_child_path(&destination_canonical, &child_name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| {
            log::warn!(
                "fs_write_binary_file create({}) failed: {e}",
                target.display()
            );
            e.to_string()
        })?;
    file.write_all(bytes).map_err(|e| {
        log::warn!(
            "fs_write_binary_file write({}) failed: {e}",
            target.display()
        );
        e.to_string()
    })?;
    file.sync_all().map_err(|e| {
        log::warn!(
            "fs_write_binary_file sync({}) failed: {e}",
            target.display()
        );
        e.to_string()
    })?;

    Ok(super::to_canon(&target))
}

fn validate_child_file_name(file_name: &str) -> Result<OsString, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("file name is empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err(format!("invalid file name: {trimmed}"));
    }
    Ok(OsString::from(trimmed))
}

#[tauri::command]
pub fn fs_stat(path: String, workspace: Option<WorkspaceEnv>) -> Result<FileStat, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
    let kind = if meta.file_type().is_symlink() {
        StatKind::Symlink
    } else if meta.is_dir() {
        StatKind::Dir
    } else {
        StatKind::File
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileStat {
        size: meta.len(),
        mtime,
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_classifies_utf8_as_text() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"hello world").unwrap();
        match fs_read_file(f.to_string_lossy().into_owned(), None).unwrap() {
            ReadResult::Text { content, size } => {
                assert_eq!(content, "hello world");
                assert_eq!(size, 11);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn read_file_detects_binary_via_null_byte() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        std::fs::write(&f, b"PNG\0\x89image").unwrap();
        assert!(matches!(
            fs_read_file(f.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_file_detects_binary_via_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.bin");
        // Invalid UTF-8 with no null byte: must still classify as binary.
        std::fs::write(&f, [0xff, 0xfe, 0xfd, 0xfc]).unwrap();
        assert!(matches!(
            fs_read_file(f.to_string_lossy().into_owned(), None).unwrap(),
            ReadResult::Binary { .. }
        ));
    }

    #[test]
    fn read_binary_file_returns_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("image.png");
        std::fs::write(&f, [0x89, b'P', b'N', b'G']).unwrap();

        let bytes = fs_read_binary_file(f.to_string_lossy().into_owned(), None).unwrap();

        assert_eq!(bytes, vec![0x89, b'P', b'N', b'G']);
    }

    #[test]
    fn overwrites_existing_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("note.txt");
        std::fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn binary_write_creates_conflict_free_name() {
        let dir = tempfile::tempdir().unwrap();
        let occupied = dir.path().join("image.png");
        std::fs::write(&occupied, b"keep").unwrap();

        let written = write_binary_file_to_dir(dir.path(), "image.png", b"png").unwrap();
        let copy = dir.path().join("image copy.png");

        assert_eq!(written, crate::modules::fs::to_canon(&copy));
        assert_eq!(std::fs::read(&copy).unwrap(), b"png");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
    }

    #[test]
    fn binary_write_rejects_invalid_child_name() {
        let dir = tempfile::tempdir().unwrap();

        let err = write_binary_file_to_dir(dir.path(), "../escape.png", b"x").unwrap_err();

        assert!(err.contains("invalid file name"), "got: {err}");
        assert!(!dir.path().join("escape.png").exists());
    }

    #[test]
    fn binary_write_rejects_oversize_payload() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = vec![0; MAX_BINARY_WRITE_BYTES + 1];

        let err = write_binary_file_to_dir(dir.path(), "big.png", &bytes).unwrap_err();

        assert!(err.contains("file is too large"), "got: {err}");
        assert!(!dir.path().join("big.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_legacy_staging_symlink() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.txt");
        std::fs::write(&outside, b"untouched").unwrap();

        let target = dir.path().join("note.txt");
        // Pre-stage a symlink at the legacy deterministic staging path.
        let legacy = dir.path().join(".note.txt.terax.tmp");
        symlink(&outside, &legacy).unwrap();

        write_atomic(&target, b"payload").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"payload");
        // The pre-staged symlink target must not have been written through.
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
    }
}
