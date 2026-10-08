use std::fs;
use std::path::{Path, PathBuf};

use crate::exiftool::ExifTool;
use crate::scan;
use crate::write::{self, WriteItem, WriteOptions};

fn fixture() -> Option<PathBuf> {
    std::env::var_os("GEOTAG_FIXTURE")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
}

fn tool() -> ExifTool {
    ExifTool::from_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("exiftool"),
    )
    .expect("exiftool resource missing")
}

fn workspace(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("geotag-it-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn scan_and_write_real_photo() {
    let Some(src) = fixture() else {
        eprintln!("GEOTAG_FIXTURE not set, skipped");
        return;
    };
    let tool = tool();
    let dir = workspace("write");
    let photo = dir.join(src.file_name().unwrap());
    fs::copy(&src, &photo).unwrap();
    let mtime_before = fs::metadata(&photo).unwrap().modified().unwrap();

    let scanned = scan::scan(&tool, &[dir.to_string_lossy().into_owned()]);
    assert!(scanned.errors.is_empty(), "{:?}", scanned.errors);
    assert_eq!(scanned.photos.len(), 1);
    let meta = &scanned.photos[0];
    assert!(!meta.gps_valid);

    let item = WriteItem {
        path: meta.path.clone(),
        lat: 25.03396,
        lon: 121.56447,
        alt: Some(141.5),
        gps_utc_ms: Some(1714533615000),
        offset: None,
        clear_alt_placeholder: meta.gps_alt_placeholder,
        has_dji_xmp: meta.has_dji_xmp,
    };
    let summary = write::write_all(&tool, vec![item], WriteOptions { backup: true }, |_, _| {});
    assert!(summary.results[0].ok, "{:?}", summary.results[0].message);
    assert_eq!(summary.backup_dirs.len(), 1);
    let backup = Path::new(&summary.backup_dirs[0]).join(photo.file_name().unwrap());
    assert_eq!(fs::read(&backup).unwrap(), fs::read(&src).unwrap());
    let mtime_after = fs::metadata(&photo).unwrap().modified().unwrap();
    let drift = mtime_after
        .duration_since(mtime_before)
        .or_else(|e| Ok::<_, ()>(e.duration()))
        .unwrap();
    assert!(drift.as_secs_f64() < 1.0);

    let rescanned = scan::scan(&tool, &[dir.to_string_lossy().into_owned()]);
    assert_eq!(rescanned.photos.len(), 1, "backup folder must be skipped");
    let after = &rescanned.photos[0];
    assert!(after.gps_valid);
    assert!((after.gps_lat.unwrap() - 25.03396).abs() < 1e-7);
    assert!((after.gps_lon.unwrap() - 121.56447).abs() < 1e-7);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn invalid_items_are_rejected_without_touching_file() {
    let Some(src) = fixture() else { return };
    let tool = tool();
    let dir = workspace("reject");
    let photo = dir.join(src.file_name().unwrap());
    fs::copy(&src, &photo).unwrap();

    let item = WriteItem {
        path: photo.to_string_lossy().into_owned(),
        lat: 123.0,
        lon: 0.0,
        alt: None,
        gps_utc_ms: None,
        offset: None,
        clear_alt_placeholder: false,
        has_dji_xmp: false,
    };
    let summary = write::write_all(&tool, vec![item], WriteOptions { backup: true }, |_, _| {});
    assert!(!summary.results[0].ok);
    assert!(summary.backup_dirs.is_empty());
    assert_eq!(fs::read(&photo).unwrap(), fs::read(&src).unwrap());
    let _ = fs::remove_dir_all(&dir);
}
