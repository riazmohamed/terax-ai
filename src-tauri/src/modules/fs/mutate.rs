use std::fs;
use std::path::{Path, PathBuf};

use crate::modules::workspace::{resolve_path, WorkspaceEnv};

/// Creates a new empty file. Fails if the file already exists.
#[tauri::command]
pub fn fs_create_file(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::write(&p, "").map_err(|e| {
        log::debug!("fs_create_file({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Creates a new directory. Fails if the directory already exists.
/// Parents are created as needed — matches the common "new folder" UX
/// where typing "a/b/c" creates the full chain.
#[tauri::command]
pub fn fs_create_dir(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    if p.exists() {
        return Err(format!("already exists: {}", p.display()));
    }
    std::fs::create_dir_all(&p).map_err(|e| {
        log::debug!("fs_create_dir({}) failed: {e}", p.display());
        e.to_string()
    })
}

/// Renames (or moves) a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn fs_rename(from: String, to: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let from_p = resolve_path(&from, &workspace);
    let to_p = resolve_path(&to, &workspace);
    if !from_p.exists() {
        return Err(format!("not found: {}", from_p.display()));
    }
    if to_p.exists() {
        return Err(format!("already exists: {}", to_p.display()));
    }
    std::fs::rename(&from_p, &to_p).map_err(|e| {
        log::debug!(
            "fs_rename({} -> {}) failed: {e}",
            from_p.display(),
            to_p.display()
        );
        e.to_string()
    })
}

/// Deletes a file or directory (recursively for dirs). Callers are
/// responsible for confirming destructive operations with the user.
#[tauri::command]
pub fn fs_delete(path: String, workspace: Option<WorkspaceEnv>) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| {
        log::debug!("fs_delete stat({}) failed: {e}", p.display());
        e.to_string()
    })?;

    let result = if meta.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    };

    result.map_err(|e| {
        log::warn!("fs_delete({}) failed: {e}", p.display());
        e.to_string()
    })
}

#[tauri::command]
pub fn fs_copy_into(
    destination_dir: String,
    sources: Vec<String>,
    workspace: Option<WorkspaceEnv>,
) -> Result<Vec<String>, String> {
    if sources.is_empty() {
        return Ok(Vec::new());
    }

    let workspace = WorkspaceEnv::from_option(workspace);
    let destination = resolve_path(&destination_dir, &workspace);
    let destination_meta = fs::metadata(&destination).map_err(|e| {
        log::debug!(
            "fs_copy_into destination({}) failed: {e}",
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
    let destination_canonical = fs::canonicalize(&destination).map_err(|e| e.to_string())?;

    let mut source_plans = Vec::with_capacity(sources.len());
    for source in sources {
        let resolved = resolve_path(&source, &workspace);
        let meta = fs::symlink_metadata(&resolved).map_err(|e| {
            log::debug!("fs_copy_into source({}) failed: {e}", resolved.display());
            format!("not found: {} ({e})", resolved.display())
        })?;
        if meta.file_type().is_symlink() {
            return Err(format!("cannot copy symlink: {}", resolved.display()));
        }
        if !meta.is_file() && !meta.is_dir() {
            return Err(format!("unsupported file type: {}", resolved.display()));
        }
        let canonical = fs::canonicalize(&resolved).map_err(|e| e.to_string())?;
        if meta.is_dir() && destination_canonical.starts_with(&canonical) {
            return Err(format!(
                "cannot copy a directory into itself: {}",
                resolved.display()
            ));
        }
        if meta.is_dir() {
            validate_tree_can_copy(&canonical)?;
        }
        source_plans.push((canonical, meta));
    }

    let mut copied = Vec::with_capacity(source_plans.len());
    for (source, meta) in source_plans {
        let target = copy_one_into(&source, &meta, &destination_canonical)?;
        copied.push(super::to_canon(target));
    }
    Ok(copied)
}

fn copy_one_into(
    source: &Path,
    meta: &fs::Metadata,
    destination: &Path,
) -> Result<PathBuf, String> {
    let name = source
        .file_name()
        .ok_or_else(|| format!("path has no file name: {}", source.display()))?;
    let target = super::conflict_free_child_path(destination, name);
    if meta.is_dir() {
        copy_dir_recursively(source, &target)?;
    } else {
        fs::copy(source, &target).map_err(|e| {
            log::warn!(
                "fs_copy_into file({} -> {}) failed: {e}",
                source.display(),
                target.display()
            );
            e.to_string()
        })?;
    }
    Ok(target)
}

fn validate_tree_can_copy(path: &Path) -> Result<(), String> {
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let child = entry.path();
        let meta = fs::symlink_metadata(&child).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            return Err(format!("cannot copy symlink: {}", child.display()));
        }
        if meta.is_dir() {
            validate_tree_can_copy(&child)?;
        } else if !meta.is_file() {
            return Err(format!("unsupported file type: {}", child.display()));
        }
    }
    Ok(())
}

fn copy_dir_recursively(source: &Path, target: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err(format!("cannot copy symlink: {}", source.display()));
    }
    fs::create_dir(target).map_err(|e| {
        log::warn!(
            "fs_copy_into mkdir({} -> {}) failed: {e}",
            source.display(),
            target.display()
        );
        e.to_string()
    })?;

    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let child_source = entry.path();
        let child_target = target.join(entry.file_name());
        let child_meta = fs::symlink_metadata(&child_source).map_err(|e| e.to_string())?;
        if child_meta.file_type().is_symlink() {
            return Err(format!("cannot copy symlink: {}", child_source.display()));
        }
        if child_meta.is_dir() {
            copy_dir_recursively(&child_source, &child_target)?;
        } else if child_meta.is_file() {
            fs::copy(&child_source, &child_target).map_err(|e| {
                log::warn!(
                    "fs_copy_into file({} -> {}) failed: {e}",
                    child_source.display(),
                    child_target.display()
                );
                e.to_string()
            })?;
        } else {
            return Err(format!("unsupported file type: {}", child_source.display()));
        }
    }

    let _ = fs::set_permissions(target, meta.permissions());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(p: std::path::PathBuf) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn create_file_makes_empty_and_refuses_to_clobber() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("new.txt");
        fs_create_file(s(f.clone()), None).expect("create");
        assert!(f.exists());
        assert_eq!(std::fs::read(&f).unwrap(), b"");

        // A second create must error, not truncate existing content.
        std::fs::write(&f, b"data").unwrap();
        let err = fs_create_file(s(f.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&f).unwrap(), b"data");
    }

    #[test]
    fn create_dir_builds_nested_chain_and_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a/b/c");
        fs_create_dir(s(nested.clone()), None).expect("create dir");
        assert!(nested.is_dir());
        let err = fs_create_dir(s(nested), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn rename_moves_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        std::fs::write(&from, b"payload").unwrap();

        fs_rename(s(from.clone()), s(to.clone()), None).expect("rename");
        assert!(!from.exists());
        assert_eq!(std::fs::read(&to).unwrap(), b"payload");

        // Missing source is reported, not silently ignored.
        let err = fs_rename(s(from), s(dir.path().join("c.txt")), None).unwrap_err();
        assert!(err.contains("not found"), "got: {err}");

        // Refusing to overwrite an existing target is the data-loss guard.
        let occupied = dir.path().join("keep.txt");
        std::fs::write(&occupied, b"keep").unwrap();
        let err = fs_rename(s(to.clone()), s(occupied.clone()), None).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
        assert!(to.exists());
    }

    #[test]
    fn delete_removes_file_then_dir_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.txt");
        std::fs::write(&f, b"x").unwrap();
        fs_delete(s(f.clone()), None).expect("delete file");
        assert!(!f.exists());

        let sub = dir.path().join("sub");
        std::fs::create_dir_all(sub.join("inner")).unwrap();
        std::fs::write(sub.join("inner/y.txt"), b"y").unwrap();
        fs_delete(s(sub.clone()), None).expect("delete dir");
        assert!(!sub.exists());

        let err = fs_delete(s(dir.path().join("missing")), None).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn copy_file_uses_conflict_name_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let destination = dir.path().join("destination");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&destination).unwrap();
        let source = source_dir.join("note.txt");
        std::fs::write(&source, b"new").unwrap();
        let occupied = destination.join("note.txt");
        std::fs::write(&occupied, b"keep").unwrap();

        let copied = fs_copy_into(s(destination.clone()), vec![s(source)], None).unwrap();
        let copy = destination.join("note copy.txt");

        assert_eq!(copied, vec![crate::modules::fs::to_canon(&copy)]);
        assert_eq!(std::fs::read(&copy).unwrap(), b"new");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"keep");
    }

    #[test]
    fn copy_directory_recursively() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("folder");
        let destination = dir.path().join("destination");
        std::fs::create_dir_all(source.join("inner")).unwrap();
        std::fs::create_dir_all(&destination).unwrap();
        std::fs::write(source.join("inner/a.txt"), b"a").unwrap();

        let copied = fs_copy_into(s(destination.clone()), vec![s(source)], None).unwrap();
        let copy = destination.join("folder");

        assert_eq!(copied, vec![crate::modules::fs::to_canon(&copy)]);
        assert_eq!(std::fs::read(copy.join("inner/a.txt")).unwrap(), b"a");
    }

    #[test]
    fn copy_missing_source_errors_without_creating_files() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("destination");
        std::fs::create_dir_all(&destination).unwrap();

        let err = fs_copy_into(
            s(destination.clone()),
            vec![s(dir.path().join("missing.txt"))],
            None,
        )
        .unwrap_err();

        assert!(err.contains("not found"), "got: {err}");
        assert_eq!(std::fs::read_dir(destination).unwrap().count(), 0);
    }

    #[test]
    fn copy_refuses_directory_into_itself_or_descendant() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("folder");
        let child = source.join("child");
        std::fs::create_dir_all(&child).unwrap();

        let err = fs_copy_into(s(child), vec![s(source.clone())], None).unwrap_err();

        assert!(err.contains("cannot copy a directory into itself"), "got: {err}");
        assert!(!source.join("child/folder").exists());
    }

    // Deleting a symlink that points at a directory must remove only the link,
    // never recurse through it and wipe the target's contents.
    #[cfg(unix)]
    #[test]
    fn delete_does_not_follow_symlink_into_target() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir(&real).unwrap();
        std::fs::write(real.join("keep.txt"), b"keep").unwrap();

        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        fs_delete(s(link.clone()), None).expect("delete symlink");
        assert!(!link.exists(), "symlink itself should be gone");
        assert!(real.is_dir(), "target dir must survive");
        assert_eq!(std::fs::read(real.join("keep.txt")).unwrap(), b"keep");
    }
}
