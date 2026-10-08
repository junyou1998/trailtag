use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use walkdir::WalkDir;

use crate::exiftool::ExifTool;
use crate::gpx::{self, GpxTrack};

const PHOTO_EXTS: &[&str] = &[
    "jpg", "jpeg", "heic", "heif", "dng", "tif", "tiff", "arw", "nef", "cr2", "cr3", "raf", "orf",
    "rw2",
];
const CHUNK: usize = 200;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PhotoMeta {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub camera_time: Option<String>,
    pub sub_sec: Option<String>,
    pub offset: Option<String>,
    pub model: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub gps_valid: bool,
    pub gps_alt_placeholder: bool,
    pub has_dji_xmp: bool,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub photos: Vec<PhotoMeta>,
    pub tracks: Vec<GpxTrack>,
    pub errors: Vec<String>,
}

pub fn is_backup_dir(name: &str) -> bool {
    name.starts_with("_geotag_backup") || name.ends_with("_backup_original")
}

pub fn in_backup_dir(path: &Path) -> bool {
    path.components()
        .any(|c| is_backup_dir(&c.as_os_str().to_string_lossy()))
}

struct Collected {
    photos: BTreeSet<PathBuf>,
    gpx: BTreeSet<PathBuf>,
    skipped: Vec<String>,
}

fn collect(paths: &[String]) -> Collected {
    let mut photos = BTreeSet::new();
    let mut gpx = BTreeSet::new();
    let mut skipped = Vec::new();
    for p in paths {
        if in_backup_dir(Path::new(p)) {
            skipped.push(p.clone());
            continue;
        }
        let walker = WalkDir::new(p)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                e.depth() == 0
                    || !(name.starts_with('.') || (e.file_type().is_dir() && is_backup_dir(&name)))
            });
        for entry in walker.flatten() {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.into_path();
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if ext == "gpx" {
                gpx.insert(path);
            } else if PHOTO_EXTS.contains(&ext.as_str()) {
                photos.insert(path);
            }
        }
    }
    Collected {
        photos,
        gpx,
        skipped,
    }
}

pub fn scan(tool: &ExifTool, paths: &[String]) -> ScanResult {
    let Collected {
        photos: photo_paths,
        gpx: gpx_paths,
        skipped,
    } = collect(paths);
    let mut result = ScanResult::default();
    for p in skipped {
        result.errors.push(format!(
            "已略過備份資料夾內的項目：{p}（為保護原檔，不處理 _geotag_backup_* 與 *_backup_original；如需處理請先把檔案移出備份資料夾）"
        ));
    }

    for path in &gpx_paths {
        match gpx::parse_file(path) {
            Ok(track) if track.points.is_empty() => result
                .errors
                .push(format!("{}：沒有含時間的軌跡點", track.name)),
            Ok(track) => result.tracks.push(track),
            Err(e) => result.errors.push(e),
        }
    }

    let list: Vec<PathBuf> = photo_paths.into_iter().collect();
    for chunk in list.chunks(CHUNK) {
        match read_meta(tool, chunk) {
            Ok(mut metas) => result.photos.append(&mut metas),
            Err(e) => result.errors.push(e),
        }
    }
    result
}

fn read_meta(tool: &ExifTool, files: &[PathBuf]) -> Result<Vec<PhotoMeta>, String> {
    let mut args: Vec<String> = [
        "-json",
        "-n",
        "-G1",
        "-fast",
        "-ExifIFD:DateTimeOriginal",
        "-ExifIFD:CreateDate",
        "-ExifIFD:SubSecTimeOriginal",
        "-ExifIFD:OffsetTimeOriginal",
        "-IFD0:Model",
        "-GPS:GPSLatitude",
        "-GPS:GPSLatitudeRef",
        "-GPS:GPSLongitude",
        "-GPS:GPSLongitudeRef",
        "-GPS:GPSStatus",
        "-GPS:GPSAltitude",
        "-XMP-drone-dji:GPSLatitude",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.extend(files.iter().map(|f| f.to_string_lossy().into_owned()));

    let rows = tool.run_json(&args)?;
    Ok(rows.iter().filter_map(parse_row).collect())
}

fn text(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn num(v: &Value, key: &str) -> Option<f64> {
    match v.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn valid_time(s: Option<String>) -> Option<String> {
    s.filter(|t| t.len() >= 19 && !t.starts_with("0000"))
}

fn parse_row(v: &Value) -> Option<PhotoMeta> {
    let path = text(v, "SourceFile")?;
    let p = Path::new(&path);
    let name = p.file_name()?.to_string_lossy().into_owned();
    let dir = p
        .parent()
        .map(|d| d.to_string_lossy().into_owned())
        .unwrap_or_default();

    let camera_time = valid_time(text(v, "ExifIFD:DateTimeOriginal"))
        .or_else(|| valid_time(text(v, "ExifIFD:CreateDate")));

    let lat = num(v, "GPS:GPSLatitude").map(|x| {
        if text(v, "GPS:GPSLatitudeRef").as_deref() == Some("S") {
            -x
        } else {
            x
        }
    });
    let lon = num(v, "GPS:GPSLongitude").map(|x| {
        if text(v, "GPS:GPSLongitudeRef").as_deref() == Some("W") {
            -x
        } else {
            x
        }
    });
    let status_void = text(v, "GPS:GPSStatus").as_deref() == Some("V");
    let non_zero = matches!((lat, lon), (Some(a), Some(b)) if a.abs() > 1e-9 || b.abs() > 1e-9);
    let gps_valid = non_zero && !status_void;
    let gps_alt_placeholder = !gps_valid
        && num(v, "GPS:GPSAltitude")
            .map(|a| a.abs() < 1e-9)
            .unwrap_or(false);

    Some(PhotoMeta {
        path,
        name,
        dir,
        camera_time: camera_time.map(|t| t[..19].to_string()),
        sub_sec: text(v, "ExifIFD:SubSecTimeOriginal"),
        offset: text(v, "ExifIFD:OffsetTimeOriginal"),
        model: text(v, "IFD0:Model"),
        gps_lat: if gps_valid { lat } else { None },
        gps_lon: if gps_valid { lon } else { None },
        gps_valid,
        gps_alt_placeholder,
        has_dji_xmp: v.get("XMP-drone-dji:GPSLatitude").is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dji_placeholder_gps_is_invalid() {
        let row = json!({
            "SourceFile": "/a/b/IMG_0001.JPG",
            "ExifIFD:DateTimeOriginal": "2024:05:01 11:20:15",
            "GPS:GPSLatitude": 0, "GPS:GPSLatitudeRef": "S",
            "GPS:GPSLongitude": 0, "GPS:GPSLongitudeRef": "W",
            "GPS:GPSStatus": "V", "GPS:GPSAltitude": 0,
            "XMP-drone-dji:GPSLatitude": 0
        });
        let m = parse_row(&row).unwrap();
        assert!(!m.gps_valid);
        assert!(m.gps_alt_placeholder);
        assert!(m.has_dji_xmp);
        assert_eq!(m.camera_time.as_deref(), Some("2024:05:01 11:20:15"));
        assert_eq!(m.dir, "/a/b");
    }

    #[test]
    fn real_gps_is_valid_and_signed() {
        let row = json!({
            "SourceFile": "/x/IMG.JPG",
            "GPS:GPSLatitude": 25.3, "GPS:GPSLatitudeRef": "N",
            "GPS:GPSLongitude": 70.1, "GPS:GPSLongitudeRef": "W",
            "GPS:GPSStatus": "A"
        });
        let m = parse_row(&row).unwrap();
        assert!(m.gps_valid);
        assert_eq!(m.gps_lon, Some(-70.1));
        assert!(m.camera_time.is_none());
    }

    #[test]
    fn dropped_backup_paths_are_rejected() {
        let dir = std::env::temp_dir().join(format!("geotag-scan-{}", std::process::id()));
        let backup = dir.join("2024_trip_backup_original");
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::write(backup.join("a.jpg"), b"x").unwrap();
        std::fs::write(dir.join("b.jpg"), b"x").unwrap();
        let c = collect(&[
            backup.to_string_lossy().into_owned(),
            backup.join("a.jpg").to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
        ]);
        assert_eq!(c.skipped.len(), 2);
        assert_eq!(c.photos.len(), 1);
        assert!(c.photos.iter().all(|p| p.ends_with("b.jpg")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_dirs_are_skipped() {
        assert!(is_backup_dir("_geotag_backup_20240501-120000"));
        assert!(is_backup_dir("20240501_backup_original"));
        assert!(!is_backup_dir("20240501"));
    }
}
