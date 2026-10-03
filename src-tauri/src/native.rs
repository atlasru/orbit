use orbit_core::{Action, MonitorPolicy, SystemAction};
use std::path::Path;

pub fn expand_environment(input: &str) -> String {
    let mut output = String::new();
    let mut rest = input;
    while let Some(start) = rest.find('%') {
        output.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        if let Some(end) = tail.find('%') {
            let name = &tail[..end];
            match std::env::var(name) {
                Ok(value) => output.push_str(&value),
                Err(_) => output.push_str(&rest[start..start + end + 2]),
            }
            rest = &tail[end + 1..];
        } else {
            output.push_str(&rest[start..]);
            rest = "";
        }
    }
    output.push_str(rest);
    output
}

pub fn execute(action: &Action) -> Result<(), String> {
    action.validate()?;
    match action {
        Action::Application {
            executable,
            args,
            working_directory,
        }
        | Action::Command {
            executable,
            args,
            working_directory,
        } => spawn(executable, args, working_directory.as_deref()),
        Action::File { path } => shell_open(&expand_environment(path)),
        Action::Folder { path } => {
            let path = expand_environment(path);
            if !Path::new(&path).is_dir() {
                return Err("Folder does not exist".into());
            }
            shell_open(&path)
        }
        Action::Url { url } => shell_open(url),
        Action::Submenu => Err("Submenu is not an action".into()),
        Action::System { action } => match action {
            SystemAction::WindowsSettings => shell_open("ms-settings:"),
            SystemAction::TaskManager => spawn("%WINDIR%\\System32\\Taskmgr.exe", &[], None),
            SystemAction::Explorer => spawn("%WINDIR%\\explorer.exe", &[], None),
            SystemAction::Terminal => spawn("wt.exe", &[], None)
                .map_err(|e| format!("Windows Terminal must be installed. {e}")),
            SystemAction::Lock => lock(),
        },
    }
}

pub fn spawn(
    executable: &str,
    args: &[String],
    working_directory: Option<&str>,
) -> Result<(), String> {
    let executable = expand_environment(executable);
    let mut command = std::process::Command::new(&executable);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Some(wd) = working_directory {
        command.current_dir(expand_environment(wd));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; ignored by GUI applications.
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start {executable}: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(windows)]
mod win {
    use super::*;
    use orbit_core::geometry::Rect;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::{HWND, POINT},
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO,
            MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
        },
        UI::{
            HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
            Shell::ShellExecuteW,
            WindowsAndMessaging::{
                GetCursorPos, GetForegroundWindow, GetWindowThreadProcessId, IsWindow,
                SetForegroundWindow, SW_SHOWNORMAL,
            },
        },
    };

    pub fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    pub fn shell_open(value: &str) -> Result<(), String> {
        let operation = wide("open");
        let value = wide(value);
        let result = unsafe {
            ShellExecuteW(
                null_mut(),
                operation.as_ptr(),
                value.as_ptr(),
                null(),
                null(),
                SW_SHOWNORMAL,
            )
        } as isize;
        if result <= 32 {
            Err(format!(
                "Windows default handler failed (ShellExecute code {result})"
            ))
        } else {
            Ok(())
        }
    }

    pub fn lock() -> Result<(), String> {
        if unsafe { windows_sys::Win32::System::Shutdown::LockWorkStation() } == 0 {
            Err(std::io::Error::last_os_error().to_string())
        } else {
            Ok(())
        }
    }

    pub fn foreground() -> usize {
        unsafe { GetForegroundWindow() as usize }
    }

    pub fn restore_foreground(handle: usize) {
        if handle == 0 {
            return;
        }
        unsafe {
            let hwnd = handle as HWND;
            if IsWindow(hwnd) != 0 {
                SetForegroundWindow(hwnd);
            }
        }
    }

    pub fn monitor(policy: &MonitorPolicy) -> Option<(Rect, f64)> {
        unsafe {
            let mut cursor = POINT { x: 0, y: 0 };
            GetCursorPos(&mut cursor);
            let mut monitor = null_mut();
            if *policy == MonitorPolicy::Foreground {
                let hwnd = GetForegroundWindow();
                let mut pid = 0;
                GetWindowThreadProcessId(hwnd, &mut pid);
                if !hwnd.is_null() && pid != std::process::id() {
                    monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                }
            }
            if monitor.is_null() {
                monitor = if *policy == MonitorPolicy::Primary {
                    MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY)
                } else {
                    MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST)
                };
            }
            let mut info: MONITORINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
            if GetMonitorInfoW(monitor, &mut info) == 0 {
                return None;
            }
            let mut dpi_x = 96;
            let mut dpi_y = 96;
            if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) < 0 {
                dpi_x = 96;
            }
            let r = info.rcWork;
            Some((
                Rect {
                    x: r.left,
                    y: r.top,
                    width: (r.right - r.left) as u32,
                    height: (r.bottom - r.top) as u32,
                },
                dpi_x as f64 / 96.0,
            ))
        }
    }

    pub fn set_autostart(enabled: bool) -> Result<(), String> {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
            .map_err(|e| e.to_string())?
            .0;
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            key.set_value("Orbit", &format!("\"{}\" --background", exe.display()))
                .map_err(|e| e.to_string())
        } else {
            match key.delete_value("Orbit") {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        }
    }
}

#[cfg(windows)]
pub use win::{foreground, lock, monitor, restore_foreground, set_autostart, shell_open, wide};

#[cfg(not(windows))]
pub fn shell_open(_: &str) -> Result<(), String> {
    Err("Native actions require Windows 10/11".into())
}
#[cfg(not(windows))]
pub fn lock() -> Result<(), String> {
    Err("Lock requires Windows".into())
}
#[cfg(not(windows))]
pub fn foreground() -> usize {
    0
}
#[cfg(not(windows))]
pub fn restore_foreground(_: usize) {}
#[cfg(not(windows))]
pub fn monitor(_: &MonitorPolicy) -> Option<(orbit_core::geometry::Rect, f64)> {
    None
}
#[cfg(not(windows))]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    if enabled {
        Err("Startup integration requires Windows".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expands_paths_without_evaluating_shell_syntax() {
        std::env::set_var("ORBIT_TEST_ENV", "C:\\space dir");
        assert_eq!(
            expand_environment("%ORBIT_TEST_ENV%\\a.exe"),
            "C:\\space dir\\a.exe"
        );
        assert_eq!(
            expand_environment("$(evil) & %ORBIT_MISSING_ENV%"),
            "$(evil) & %ORBIT_MISSING_ENV%"
        );
    }
    #[test]
    fn missing_executable_returns_useful_error() {
        assert!(spawn(
            "orbit-nonexistent-fixture-82013.exe",
            &["& no shell".into()],
            None
        )
        .unwrap_err()
        .contains("Cannot start"));
    }
}
