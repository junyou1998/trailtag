mod exiftool;
mod gpx;
mod scan;
mod thumb;
mod write;

#[cfg(test)]
mod integration_tests;

use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use exiftool::ExifTool;

#[derive(Serialize, Clone)]
struct Progress {
    done: usize,
    total: usize,
}

static TOOL: OnceLock<ExifTool> = OnceLock::new();

fn tool(app: &AppHandle) -> Result<ExifTool, String> {
    if let Some(t) = TOOL.get() {
        return Ok(t.clone());
    }
    let t = ExifTool::locate(app)?;
    Ok(TOOL.get_or_init(|| t).clone())
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn exiftool_version(app: AppHandle) -> Result<String, String> {
    blocking(move || tool(&app)?.version()).await
}

#[tauri::command]
async fn scan_paths(app: AppHandle, paths: Vec<String>) -> Result<scan::ScanResult, String> {
    blocking(move || Ok(scan::scan(&tool(&app)?, &paths))).await
}

#[tauri::command]
async fn get_thumbnails(
    app: AppHandle,
    paths: Vec<String>,
    large: bool,
) -> Result<Vec<thumb::Thumbnail>, String> {
    blocking(move || thumb::extract(&tool(&app)?, &paths, large)).await
}

#[tauri::command]
async fn write_gps(
    app: AppHandle,
    items: Vec<write::WriteItem>,
    options: write::WriteOptions,
) -> Result<write::WriteSummary, String> {
    blocking(move || {
        let t = tool(&app)?;
        Ok(write::write_all(&t, items, options, |done, total| {
            let _ = app.emit("write-progress", Progress { done, total });
        }))
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            exiftool_version,
            scan_paths,
            get_thumbnails,
            write_gps
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
