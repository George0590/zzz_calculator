// SPDX-License-Identifier: AGPL-3.0-only
// Machine protocol for the independently executed zzz-drive-exporter.
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::{fs, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, Instant, SystemTime}};
use zzz_drive_exporter::{ExporterFailure, ExporterOutcome, capture_until_current_equip_controlled, process_exporter_capture};

struct Reporter { directory: PathBuf, task_id: String, seq: u64, round: u8 }

// Covers a late UAC approval and simultaneous instances from another local server.
#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateMutexW(attributes: *const std::ffi::c_void, owned: i32, name: *const u16) -> *mut std::ffi::c_void;
    fn GetLastError() -> u32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
}
struct CaptureMutex(*mut std::ffi::c_void);
impl CaptureMutex {
    fn acquire() -> Result<Self> {
        let name: Vec<u16> = "Local\\ZZZDriveExporterCapture\0".encode_utf16().collect();
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() { return Err(ExporterFailure("CAPTURE_MUTEX_FAILED").into()); }
        if unsafe { GetLastError() } == 183 {
            unsafe { CloseHandle(handle); }
            return Err(ExporterFailure("CAPTURE_BUSY").into());
        }
        Ok(Self(handle))
    }
}
impl Drop for CaptureMutex { fn drop(&mut self) { unsafe { CloseHandle(self.0); } } }
impl Reporter {
    fn emit(&mut self, phase: &str, extra: Value) -> Result<()> {
        self.seq += 1;
        let mut status = json!({ "protocolVersion": 1, "taskId": self.task_id,
            "seq": self.seq, "phase": phase, "round": self.round });
        status.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        atomic_json(&self.directory.join("status.json"), &status)
    }
}

fn atomic_json(path: &Path, value: &Value) -> Result<()> {
    let temporary = path.with_extension("tmp");
    let mut file = fs::File::create(&temporary)?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec(value)?)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    Ok(())
}

fn control_error(directory: &Path, started: Instant) -> Option<&'static str> {
    if directory.join("cancel").exists() { return Some("CANCELLED"); }
    if started.elapsed() > Duration::from_secs(600) { return Some("TASK_TIMEOUT"); }
    let age = fs::metadata(directory.join("lease")).and_then(|file| file.modified()).ok()
        .and_then(|time| SystemTime::now().duration_since(time).ok());
    if age.is_none_or(|age| age > Duration::from_secs(15)) { return Some("SERVICE_LOST"); }
    None
}

async fn interrupted(directory: &Path, started: Instant) -> &'static str {
    loop {
        if let Some(code) = control_error(directory, started) { return code; }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn capture(directory: &Path, started: Instant, reporter: Arc<Mutex<Reporter>>) -> Result<PathBuf> {
    if let Some(code) = control_error(directory, started) { return Err(ExporterFailure(code).into()); }
    let captures = directory.join("captures");
    let stop = async {
        tokio::select! {
            code = interrupted(directory, started) => code,
            _ = tokio::time::sleep(Duration::from_secs(180)) => "RESPONSE_TIMEOUT",
        }
    };
    capture_until_current_equip_controlled(&captures, |phase| {
        reporter.lock().unwrap().emit(phase, json!({}))
    }, stop).await.map_err(|error| if error.downcast_ref::<ExporterFailure>().is_some() { error }
        else { error.context(ExporterFailure("CAPTURE_FAILED")) })
}

async fn process(directory: &Path, run_dir: PathBuf, baseline: Option<PathBuf>, started: Instant) -> Result<ExporterOutcome> {
    let directory_owned = directory.to_owned();
    // Recovery is CPU bound. A separate thread lets the control loop respond to
    // cancel/lease expiry. The executable exits after reporting a terminal state.
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let result = process_exporter_capture(&run_dir, &directory_owned.join("captures"), baseline.as_deref(),
            &directory_owned.join("zood.pending.json"), &directory_owned.join("calculator.pending.json"), false, false);
        let _ = tx.send(result);
    });
    tokio::select! {
        result = rx => result.context(ExporterFailure("PROCESS_EXITED"))?,
        code = interrupted(directory, started) => Err(ExporterFailure(code).into()),
        _ = tokio::time::sleep(Duration::from_secs(120)) => Err(ExporterFailure("DECODE_TIMEOUT").into()),
    }
}

async fn execute(directory: &Path, reporter: Arc<Mutex<Reporter>>) -> Result<()> {
    let started = Instant::now();
    if let Some(code) = control_error(directory, started) { return Err(ExporterFailure(code).into()); }
    let _exclusive = CaptureMutex::acquire()?;
    reporter.lock().unwrap().emit("preparing", json!({}))?;
    let first = capture(directory, started, reporter.clone()).await?;
    reporter.lock().unwrap().emit("parsing", json!({}))?;
    let outcome = process(directory, first.clone(), None, started).await?;
    let outcome = if matches!(outcome, ExporterOutcome::NeedsSecondSession { .. }) {
        reporter.lock().unwrap().emit("needs_second_login", json!({}))?;
        let confirmed = async {
            while !directory.join("continue-second").exists() {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        };
        tokio::select! {
            _ = confirmed => {},
            code = interrupted(directory, started) => return Err(ExporterFailure(code).into()),
            _ = tokio::time::sleep(Duration::from_secs(180)) => return Err(ExporterFailure("CONFIRM_TIMEOUT").into()),
        }
        reporter.lock().unwrap().round = 2;
        let second = capture(directory, started, reporter.clone()).await?;
        reporter.lock().unwrap().emit("parsing", json!({}))?;
        process(directory, second, Some(first), started).await?
    } else { outcome };
    let count = match outcome {
        ExporterOutcome::ExportedSingleSession { disc_count, .. }
        | ExporterOutcome::ExportedPaired { disc_count, .. } => disc_count,
        ExporterOutcome::NeedsSecondSession { .. } => return Err(ExporterFailure("PAIRING_FAILED").into()),
    };
    if let Some(code) = control_error(directory, started) { return Err(ExporterFailure(code).into()); }
    // Commit both complete files, then publish success. Neither rename alone is a success marker.
    fs::rename(directory.join("zood.pending.json"), directory.join("zood.json")).context(ExporterFailure("RESULT_WRITE"))?;
    fs::rename(directory.join("calculator.pending.json"), directory.join("calculator.json")).context(ExporterFailure("RESULT_WRITE"))?;
    reporter.lock().unwrap().emit("succeeded", json!({ "discCount": count, "resultFile": "calculator.json" }))?;
    Ok(())
}

fn error_code(error: &anyhow::Error) -> &'static str {
    let io_code = error.chain().find_map(|cause| cause.downcast_ref::<std::io::Error>().and_then(|error| error.raw_os_error()));
    // windows 0.48 converts HRESULT directly into io::Error; unwrap only the
    // documented HRESULT_FROM_WIN32 facility, without parsing diagnostic text.
    let win32 = io_code.map(|code| if (code as u32) & 0xffff0000 == 0x80070000 { code & 0xffff } else { code });
    match win32 {
        Some(170) => "CAPTURE_BUSY",
        Some(5) => "CAPTURE_PERMISSION",
        _ => error.downcast_ref::<ExporterFailure>().map(|failure| failure.0).unwrap_or("DECODE_FAILED"),
    }
}

pub async fn run(directory: PathBuf, task_id: String) -> i32 {
    if task_id.len() != 36 || !task_id.chars().all(|ch| ch.is_ascii_hexdigit() || ch == '-')
        || directory.file_name().and_then(|name| name.to_str()) != Some(task_id.as_str()) { return 2; }
    let reporter = Arc::new(Mutex::new(Reporter { directory: directory.clone(), task_id, seq: 0, round: 1 }));
    match execute(&directory, reporter.clone()).await {
        Ok(()) => 0,
        Err(error) => {
            let code = error_code(&error);
            let phase = if code == "CANCELLED" { "cancelled" } else if code.ends_with("TIMEOUT") { "timed_out" } else { "failed" };
            let _ = reporter.lock().unwrap().emit(phase, json!({ "errorCode": code, "detail": format!("{error:#}") }));
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_permission_and_busy_errors_keep_their_categories() {
        for (raw, expected) in [(170, "CAPTURE_BUSY"), (0x800700aa_u32 as i32, "CAPTURE_BUSY"),
            (5, "CAPTURE_PERMISSION"), (0x80070005_u32 as i32, "CAPTURE_PERMISSION")] {
            let error = anyhow::Error::new(std::io::Error::from_raw_os_error(raw)).context(ExporterFailure("CAPTURE_FAILED"));
            assert_eq!(error_code(&error), expected);
        }
        assert_eq!(error_code(&ExporterFailure("RESULT_WRITE").into()), "RESULT_WRITE");
    }
    #[test]
    fn success_requires_explicit_report_and_atomic_status() {
        let dir = std::env::temp_dir().join(format!("zzz-machine-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let mut reporter = Reporter { directory: dir.clone(), task_id: "test".into(), seq: 0, round: 1 };
        reporter.emit("needs_second_login", json!({})).unwrap();
        let value: Value = serde_json::from_slice(&fs::read(dir.join("status.json")).unwrap()).unwrap();
        assert_eq!(value["phase"], "needs_second_login");
        assert!(value.get("resultFile").is_none());
        assert_eq!(control_error(&dir, Instant::now()), Some("SERVICE_LOST"));
        fs::write(dir.join("lease"), b"1").unwrap();
        assert_eq!(control_error(&dir, Instant::now()), None);
        fs::write(dir.join("cancel"), b"1").unwrap();
        assert_eq!(control_error(&dir, Instant::now()), Some("CANCELLED"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
