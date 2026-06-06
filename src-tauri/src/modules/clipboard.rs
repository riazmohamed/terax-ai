#[tauri::command]
pub fn clipboard_read_file_paths() -> Result<Vec<String>, String> {
    platform::read_file_paths()
}

#[cfg(target_os = "windows")]
mod platform {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;
    use std::ptr;

    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::UI::Shell::{DragQueryFileW, HDROP};

    const CF_HDROP: u32 = 15;
    const DRAG_QUERY_ALL_FILES: u32 = u32::MAX;

    struct ClipboardGuard;

    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    pub fn read_file_paths() -> Result<Vec<String>, String> {
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP) == 0 {
                return Ok(Vec::new());
            }

            if OpenClipboard(ptr::null_mut()) == 0 {
                return Err("clipboard is busy".to_string());
            }
            let _guard = ClipboardGuard;

            let handle = GetClipboardData(CF_HDROP);
            if handle.is_null() {
                return Ok(Vec::new());
            }

            let hdrop = handle as HDROP;
            let count = DragQueryFileW(hdrop, DRAG_QUERY_ALL_FILES, ptr::null_mut(), 0);
            let mut paths = Vec::with_capacity(count as usize);
            for index in 0..count {
                let len = DragQueryFileW(hdrop, index, ptr::null_mut(), 0);
                if len == 0 {
                    continue;
                }

                let mut buffer = vec![0u16; len as usize + 1];
                let written = DragQueryFileW(hdrop, index, buffer.as_mut_ptr(), buffer.len() as u32);
                if written == 0 {
                    continue;
                }

                buffer.truncate(written as usize);
                paths.push(crate::modules::fs::to_canon(PathBuf::from(
                    OsString::from_wide(&buffer),
                )));
            }

            Ok(paths)
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn read_file_paths() -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }
}
