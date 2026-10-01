//! Win32 wrappers for the screen recorder (docs/record-spec.md §5). Windows
//! only. The stop method is a console Ctrl+Break to the recorder's own
//! process group; it was proven on real hardware (docs/record-spec.md §14.1).

use core::ffi::c_void;
use std::sync::{Mutex, MutexGuard};

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Console::{
    AttachConsole, FreeConsole, GenerateConsoleCtrlEvent, GetConsoleWindow, GetStdHandle,
    SetStdHandle, ATTACH_PARENT_PROCESS, CTRL_BREAK_EVENT, STD_ERROR_HANDLE, STD_HANDLE,
    STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
};
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

use crate::record::LocalTime;

/// Serializes the console calls: the console attachment is process-wide, so
/// two stops must not interleave their attach and detach.
static CONSOLE_LOCK: Mutex<()> = Mutex::new(());

pub fn console_lock() -> MutexGuard<'static, ()> {
    CONSOLE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// A GUI process starts with its three std handles null. `AttachConsole` fills
/// them with console handles, and `FreeConsole` closes the console but does
/// not reset them. They would stay stale: later files reuse the values,
/// `std::process::Command` inherits them and fails with os error 6, and panic
/// text lands in random files. This guard puts the saved values back when it
/// drops, so no exit path can skip it.
struct StdHandleGuard {
    saved: [(STD_HANDLE, isize); 3],
    restore: bool,
}

impl StdHandleGuard {
    fn save() -> Self {
        // `GetStdHandle` gives an error for a null handle, which is the GUI
        // case: that is saved as 0.
        let read = |id: STD_HANDLE| {
            // SAFETY: a plain Win32 query.
            unsafe { GetStdHandle(id) }.map_or(0, |h| h.0 as isize)
        };
        Self {
            saved: [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE].map(|id| (id, read(id))),
            restore: true,
        }
    }
}

impl Drop for StdHandleGuard {
    fn drop(&mut self) {
        if !self.restore {
            return;
        }
        for (id, value) in self.saved {
            // SAFETY: the value is what `GetStdHandle` returned before.
            let _ = unsafe { SetStdHandle(id, HANDLE(value as *mut c_void)) };
        }
    }
}

/// Sends CTRL_BREAK_EVENT to the process group of `pid`, which must be a
/// group leader (spawned with `CREATE_NEW_PROCESS_GROUP`; the group id then
/// equals the pid). Takes `console_lock` itself.
pub fn send_ctrl_break(pid: u32) -> Result<(), String> {
    let _guard = console_lock();
    // Declared after the lock, so it drops (restores) first, after every
    // `FreeConsole` and the debug re-attach below.
    let mut std_handles = StdHandleGuard::save();
    // SAFETY: plain Win32 console calls; no pointers cross the boundary.
    unsafe {
        // Debug builds have a console, release builds do not (`main.rs`).
        let had_console = !GetConsoleWindow().is_invalid();
        // With a console, the saved handles are console handles that
        // `FreeConsole` closes, and the re-attach below sets fresh ones.
        // Restoring the old values would break them, so only the GUI case
        // (null handles) is restored.
        std_handles.restore = !had_console;
        // A GUI process has no console, so a failure here is fine.
        let _ = FreeConsole();
        let result = match AttachConsole(pid) {
            Err(err) => Err(format!("AttachConsole({pid}) failed: {err}")),
            Ok(()) => {
                // The recorder is its own group leader, so only it (and the
                // adb clients it started) receives the event. Cowbell is in
                // another group, so it needs no ignore flag
                // (docs/record-spec.md §14.1).
                let sent = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid)
                    .map_err(|err| format!("GenerateConsoleCtrlEvent failed: {err}"));
                let _ = FreeConsole();
                sent
            }
        };
        if had_console {
            // Debug builds only; best effort, unverified.
            let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        }
        result
    }
}

pub fn local_time() -> LocalTime {
    // SAFETY: `GetLocalTime` takes no arguments and returns a plain struct.
    let t = unsafe { GetLocalTime() };
    LocalTime {
        year: t.wYear,
        month: t.wMonth as u8,
        day: t.wDay as u8,
        hour: t.wHour as u8,
        minute: t.wMinute as u8,
        second: t.wSecond as u8,
    }
}

/// The process-wide job (as `isize`: `HANDLE` is not `Send`). Created on first
/// use and never closed: Windows closes it when Cowbell's process ends, and
/// the job then kills any recorder still alive.
static JOB: std::sync::OnceLock<Result<isize, String>> = std::sync::OnceLock::new();

fn create_job() -> Result<isize, String> {
    // SAFETY: `info` outlives the call, and its size is passed with it.
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null())
            .map_err(|err| format!("CreateJobObjectW failed: {err}"))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // SILENT_BREAKAWAY_OK: an adb server started by the recorder's adb
        // client does not join the job, so it is not killed when Cowbell
        // exits (that would drop the mirror and any `flutter run` session).
        // An adb client started before the job assignment escapes the job
        // anyway; that is harmless.
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|err| format!("SetInformationJobObject failed: {err}"))?;
        Ok(job.0 as isize)
    }
}

/// Puts `pid` in one process-wide job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
/// If Cowbell crashes or is killed, the job kills the recorder, so an orphan
/// never grows its file until the phone is unplugged. On a normal exit the
/// recorders are stopped first, so the job kills nothing.
pub fn assign_to_kill_on_close_job(pid: u32) -> Result<(), String> {
    let job = JOB.get_or_init(create_job).clone()?;
    // SAFETY: the handle comes from `OpenProcess` and is closed below.
    unsafe {
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
            .map_err(|err| format!("OpenProcess({pid}) failed: {err}"))?;
        let assigned = AssignProcessToJobObject(HANDLE(job as *mut c_void), process)
            .map_err(|err| format!("AssignProcessToJobObject failed: {err}"));
        let _ = CloseHandle(process);
        assigned
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    const PROBE_ENV: &str = "COWBELL_CTRL_BREAK_PROBE";
    const PROBE_TEST: &str = "record_win32::tests::ctrl_break_probe";
    const SLEEPER_ENV: &str = "COWBELL_CTRL_BREAK_SLEEPER";
    const SLEEPER_TEST: &str = "record_win32::tests::ctrl_break_sleeper";
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const DETACHED_PROCESS: u32 = 0x0000_0008;

    fn std_handles() -> [isize; 3] {
        [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE]
            // SAFETY: a plain Win32 query.
            .map(|id| unsafe { GetStdHandle(id) }.map_or(0, |h| h.0 as isize))
    }

    /// The child of the probe: sleeps when started by it, else does nothing.
    #[test]
    fn ctrl_break_sleeper() {
        if std::env::var_os(SLEEPER_ENV).is_some() {
            std::thread::sleep(Duration::from_secs(30));
        }
    }

    /// Runs inside a detached copy of the test binary (see the test below):
    /// the stop changes the process console, which must not happen inside the
    /// test runner. The copy has no console and null std handles, like Cowbell.
    #[test]
    fn ctrl_break_probe() {
        // The copy has null std handles, so a panic text would be lost: it
        // goes to a file named by the variable.
        let Some(report) = std::env::var_os(PROBE_ENV) else {
            return;
        };
        if let Err(cause) = std::panic::catch_unwind(probe_body) {
            let text = cause
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| cause.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_default();
            let _ = std::fs::write(report, text);
            std::process::exit(3);
        }
    }

    fn probe_body() {
        // SAFETY: plain Win32 calls.
        unsafe {
            let _ = FreeConsole();
            for id in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
                let _ = SetStdHandle(id, HANDLE(std::ptr::null_mut()));
            }
        }
        assert_eq!(std_handles(), [0, 0, 0]);

        // This test binary stands in for scrcpy: a console program with no
        // Ctrl+Break handler of its own (so the default action ends it), in
        // its own group with its own hidden console, spawned with the
        // recorder's flags. (Not `ping`: it prints statistics on Ctrl+Break
        // and keeps going. Not PowerShell: it handles the event itself.)
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", SLEEPER_TEST, "--nocapture", "--test-threads=1"])
            .env(SLEEPER_ENV, "1")
            .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn the child");
        std::thread::sleep(Duration::from_millis(500));
        let sent = send_ctrl_break(child.id());
        let deadline = Instant::now() + Duration::from_secs(5);
        let exited = loop {
            if child.try_wait().unwrap().is_some() {
                break true;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        assert!(sent.is_ok(), "send_ctrl_break: {sent:?}");
        assert!(exited, "the child did not exit within 5 s");
        // The stale-handle bug: the console handles stayed in the std table.
        assert_eq!(std_handles(), [0, 0, 0], "std handles after the stop");

        // An error path restores them too.
        assert!(send_ctrl_break(0).is_err());
        assert_eq!(std_handles(), [0, 0, 0], "std handles after a failed stop");

        // The symptom: a later spawn that inherits the std handles failed
        // with os error 6.
        let status = std::process::Command::new("cmd")
            .args(["/c", "exit", "0"])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .expect("a later spawn must work");
        assert!(status.success());
    }

    #[test]
    fn ctrl_break_stops_a_group_leader_and_keeps_the_std_handles() {
        let report = std::env::temp_dir().join(format!("cowbell-probe-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&report);
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", PROBE_TEST, "--nocapture", "--test-threads=1"])
            .env(PROBE_ENV, &report)
            .creation_flags(DETACHED_PROCESS)
            .stdin(Stdio::null())
            .output()
            .expect("run the probe");
        let reason = std::fs::read_to_string(&report).unwrap_or_default();
        let _ = std::fs::remove_file(&report);
        assert!(
            out.status.success(),
            "probe failed ({}): {reason}",
            out.status
        );
    }
}
