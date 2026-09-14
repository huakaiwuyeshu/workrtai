#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
pub(super) fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::UI::Shell::{DragQueryFileW, HDROP};

    const CF_HDROP: u32 = 15;

    // Do not confuse a temporarily locked clipboard with an empty one.
    let mut opened = false;
    for _ in 0..5 {
        if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
            opened = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    if !opened {
        return Err("clipboard_busy".into());
    }

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }
    let _guard = ClipboardGuard;

    let handle = unsafe { GetClipboardData(CF_HDROP) };
    if handle.is_null() {
        return Ok(Vec::new());
    }

    // DragQueryFileW expects the HDROP handle, not a GlobalLock data pointer.
    let hdrop = handle as HDROP;

    let count = unsafe { DragQueryFileW(hdrop, u32::MAX, std::ptr::null_mut(), 0) };
    if count > 4096 {
        return Err("clipboard_too_many_files".into());
    }
    let mut paths = Vec::with_capacity(count as usize);
    for index in 0..count {
        // 先查长度（不含结尾 NUL），再按长度 + 1 取内容。
        let len = unsafe { DragQueryFileW(hdrop, index, std::ptr::null_mut(), 0) };
        if len == 0 {
            continue;
        }
        let mut buffer = vec![0u16; len as usize + 1];
        let copied =
            unsafe { DragQueryFileW(hdrop, index, buffer.as_mut_ptr(), buffer.len() as u32) };
        if copied == 0 {
            continue;
        }
        let path = std::ffi::OsString::from_wide(&buffer[..copied as usize]);
        paths.push(path.to_string_lossy().into_owned());
    }

    Ok(paths)
}

#[cfg(not(target_os = "windows"))]
pub(super) fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}
