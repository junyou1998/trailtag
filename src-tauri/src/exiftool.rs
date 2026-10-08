use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager};

static ARGFILE_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct ExifTool {
    program: PathBuf,
    prefix: Vec<OsString>,
}

pub struct RunOutput {
    pub stdout: String,
    pub stderr: String,
}

impl ExifTool {
    pub fn locate(app: &AppHandle) -> Result<Self, String> {
        let mut dirs = Vec::new();
        if let Ok(res) = app.path().resource_dir() {
            dirs.push(res.join("exiftool"));
            dirs.push(res.join("resources").join("exiftool"));
        }
        dirs.push(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("exiftool"),
        );

        for dir in dirs {
            if let Some(tool) = Self::from_dir(&dir) {
                return Ok(tool);
            }
        }

        let fallback = if cfg!(windows) {
            "exiftool.exe"
        } else {
            "exiftool"
        };
        let tool = ExifTool {
            program: PathBuf::from(fallback),
            prefix: Vec::new(),
        };
        if tool.version().is_ok() {
            return Ok(tool);
        }
        Err("找不到 exiftool，請先執行 pnpm fetch:exiftool".into())
    }

    pub fn from_dir(dir: &Path) -> Option<Self> {
        if cfg!(windows) {
            let exe = dir.join("exiftool.exe");
            exe.is_file().then(|| ExifTool {
                program: exe,
                prefix: Vec::new(),
            })
        } else {
            let script = dir.join("exiftool");
            script.is_file().then(|| ExifTool {
                program: PathBuf::from("/usr/bin/perl"),
                prefix: vec![script.into_os_string()],
            })
        }
    }

    pub fn version(&self) -> Result<String, String> {
        let mut cmd = self.command();
        cmd.arg("-ver");
        let out = cmd
            .output()
            .map_err(|e| format!("無法執行 exiftool：{e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    pub fn run(&self, args: &[String]) -> Result<RunOutput, String> {
        let seq = ARGFILE_SEQ.fetch_add(1, Ordering::Relaxed);
        let argfile =
            std::env::temp_dir().join(format!("trailtag-{}-{seq}.args", std::process::id()));
        let mut content = String::new();
        for a in args {
            if a.contains('\n') || a.contains('\r') {
                return Err(format!("參數包含換行字元：{a}"));
            }
            content.push_str(a);
            content.push('\n');
        }
        fs::write(&argfile, content).map_err(|e| format!("無法建立參數檔：{e}"))?;

        let mut cmd = self.command();
        cmd.arg("-charset")
            .arg("filename=utf8")
            .arg("-@")
            .arg(&argfile);
        let result = cmd.output();
        let _ = fs::remove_file(&argfile);
        let out = result.map_err(|e| format!("無法執行 exiftool：{e}"))?;

        Ok(RunOutput {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }

    fn command(&self) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.args(&self.prefix);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd
    }

    pub fn run_json(&self, args: &[String]) -> Result<Vec<serde_json::Value>, String> {
        let out = self.run(args)?;
        let text = out.stdout.trim();
        if text.is_empty() {
            if out.stderr.trim().is_empty() {
                return Ok(Vec::new());
            }
            return Err(out.stderr.trim().to_string());
        }
        serde_json::from_str(text).map_err(|e| format!("無法解析 exiftool 輸出：{e}"))
    }
}
