use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::exiftool::ExifTool;

const CHUNK: usize = 50;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteItem {
    pub path: String,
    pub lat: f64,
    pub lon: f64,
    pub alt: Option<f64>,
    pub gps_utc_ms: Option<i64>,
    pub offset: Option<String>,
    pub clear_alt_placeholder: bool,
    pub has_dji_xmp: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteOptions {
    pub backup: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteSummary {
    pub results: Vec<WriteResult>,
    pub backup_dirs: Vec<String>,
}

struct Readback {
    hash: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
}

pub fn write_all(
    tool: &ExifTool,
    items: Vec<WriteItem>,
    opts: WriteOptions,
    progress: impl Fn(usize, usize),
) -> WriteSummary {
    let total = items.len();
    let stamp = Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut backup_dirs: HashMap<PathBuf, PathBuf> = HashMap::new();
    let mut results = Vec::with_capacity(total);
    let mut done = 0;
    progress(done, total);

    for chunk in items.chunks(CHUNK) {
        let mut ready = Vec::new();
        for item in chunk {
            match validate(item) {
                Ok(()) => ready.push(item.clone()),
                Err(e) => results.push(fail(&item.path, e)),
            }
        }

        let before = match readback(tool, &ready) {
            Ok(map) => map,
            Err(e) => {
                results.extend(
                    ready
                        .iter()
                        .map(|i| fail(&i.path, format!("讀取原始資料失敗：{e}"))),
                );
                done += chunk.len();
                progress(done, total);
                continue;
            }
        };

        let mut writable = Vec::new();
        let mut backups: HashMap<String, PathBuf> = HashMap::new();
        for item in ready {
            let Some(hash) = before.get(&norm(&item.path)).and_then(|r| r.hash.clone()) else {
                results.push(fail(
                    &item.path,
                    "無法計算影像資料雜湊，為安全起見略過".into(),
                ));
                continue;
            };
            if opts.backup {
                match backup(&item.path, &stamp, &mut backup_dirs) {
                    Ok(p) => {
                        backups.insert(item.path.clone(), p);
                    }
                    Err(e) => {
                        results.push(fail(&item.path, format!("備份失敗：{e}")));
                        continue;
                    }
                }
            }
            writable.push((item, hash));
        }

        let items_only: Vec<WriteItem> = writable.iter().map(|(i, _)| i.clone()).collect();
        let write_err = run_write(tool, &items_only).err();
        let after = readback(tool, &items_only).unwrap_or_default();

        for (item, hash_before) in writable {
            let outcome = verify(
                &item,
                &hash_before,
                after.get(&norm(&item.path)),
                write_err.as_deref(),
            );
            match outcome {
                Ok(()) => results.push(WriteResult {
                    path: item.path.clone(),
                    ok: true,
                    message: None,
                }),
                Err(reason) => {
                    let restored = backups
                        .get(&item.path)
                        .map(|b| fs::copy(b, &item.path).is_ok());
                    let suffix = match restored {
                        Some(true) => "，已從備份還原",
                        Some(false) => "，還原失敗，請手動從備份資料夾復原",
                        None => "",
                    };
                    results.push(fail(&item.path, format!("{reason}{suffix}")));
                }
            }
        }

        done += chunk.len();
        progress(done, total);
    }

    let mut dirs: Vec<String> = backup_dirs
        .into_values()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    dirs.sort();
    WriteSummary {
        results,
        backup_dirs: dirs,
    }
}

fn norm(p: &str) -> String {
    p.replace('\\', "/")
}

fn fail(path: &str, message: String) -> WriteResult {
    WriteResult {
        path: path.to_string(),
        ok: false,
        message: Some(message),
    }
}

fn validate(item: &WriteItem) -> Result<(), String> {
    if !(item.lat.is_finite()
        && item.lon.is_finite()
        && item.lat.abs() <= 90.0
        && item.lon.abs() <= 180.0)
    {
        return Err("座標超出範圍".into());
    }
    if !Path::new(&item.path).is_file() {
        return Err("找不到檔案".into());
    }
    if let Some(o) = &item.offset {
        if !is_offset(o) {
            return Err(format!("時區格式錯誤：{o}"));
        }
    }
    Ok(())
}

fn is_offset(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 6
        && (b[0] == b'+' || b[0] == b'-')
        && b[1].is_ascii_digit()
        && b[2].is_ascii_digit()
        && b[3] == b':'
        && b[4].is_ascii_digit()
        && b[5].is_ascii_digit()
}

fn backup(
    path: &str,
    stamp: &str,
    dirs: &mut HashMap<PathBuf, PathBuf>,
) -> Result<PathBuf, String> {
    let src = Path::new(path);
    let parent = src.parent().ok_or("無法取得上層資料夾")?.to_path_buf();
    let dir = dirs
        .entry(parent.clone())
        .or_insert_with(|| parent.join(format!("_geotag_backup_{stamp}")));
    fs::create_dir_all(&*dir).map_err(|e| e.to_string())?;
    let dest = dir.join(src.file_name().ok_or("無效的檔名")?);
    if dest.exists() {
        return Err("備份檔已存在".into());
    }
    fs::copy(src, &dest).map_err(|e| e.to_string())?;
    let (a, b) = (
        fs::metadata(src).map_err(|e| e.to_string())?,
        fs::metadata(&dest).map_err(|e| e.to_string())?,
    );
    if a.len() != b.len() {
        return Err("備份檔大小不一致".into());
    }
    Ok(dest)
}

pub fn build_args(item: &WriteItem) -> Vec<String> {
    let mut a = vec![
        "-P".to_string(),
        "-overwrite_original".into(),
        format!("-GPSLatitude={:.8}", item.lat.abs()),
        format!("-GPSLatitudeRef={}", if item.lat < 0.0 { "S" } else { "N" }),
        format!("-GPSLongitude={:.8}", item.lon.abs()),
        format!(
            "-GPSLongitudeRef={}",
            if item.lon < 0.0 { "W" } else { "E" }
        ),
        "-GPSStatus#=A".into(),
        "-GPSMapDatum=WGS-84".into(),
    ];
    if let Some(dt) = item
        .gps_utc_ms
        .and_then(DateTime::<Utc>::from_timestamp_millis)
    {
        a.push(format!("-GPSDateStamp={}", dt.format("%Y:%m:%d")));
        a.push(format!("-GPSTimeStamp={}", dt.format("%H:%M:%S")));
    }
    match item.alt {
        Some(alt) if alt.is_finite() => {
            a.push(format!("-GPSAltitude={:.2}", alt.abs()));
            a.push(format!(
                "-GPSAltitudeRef#={}",
                if alt < 0.0 { 1 } else { 0 }
            ));
        }
        _ if item.clear_alt_placeholder => {
            a.push("-GPSAltitude=".into());
            a.push("-GPSAltitudeRef=".into());
        }
        _ => {}
    }
    if item.has_dji_xmp {
        a.push(format!("-XMP-drone-dji:GPSLatitude={:.8}", item.lat));
        a.push(format!("-XMP-drone-dji:GPSLongitude={:.8}", item.lon));
    }
    if let Some(o) = &item.offset {
        a.push(format!("-OffsetTimeOriginal={o}"));
    }
    a.push(item.path.clone());
    a
}

fn run_write(tool: &ExifTool, items: &[WriteItem]) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let mut args = Vec::new();
    for (i, item) in items.iter().enumerate() {
        args.extend(build_args(item));
        if i + 1 < items.len() {
            args.push("-execute".into());
        }
    }
    let out = tool.run(&args)?;
    let errors: Vec<&str> = out
        .stderr
        .lines()
        .filter(|l| l.starts_with("Error"))
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

fn readback(tool: &ExifTool, items: &[WriteItem]) -> Result<HashMap<String, Readback>, String> {
    if items.is_empty() {
        return Ok(HashMap::new());
    }
    let mut args: Vec<String> = [
        "-json",
        "-n",
        "-api",
        "ImageHashType=SHA256",
        "-ImageDataHash",
        "-Composite:GPSLatitude",
        "-Composite:GPSLongitude",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.extend(items.iter().map(|i| i.path.clone()));
    let rows = tool.run_json(&args)?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            let path = norm(r.get("SourceFile")?.as_str()?);
            let f = |k: &str| r.get(k).and_then(Value::as_f64);
            Some((
                path,
                Readback {
                    hash: r
                        .get("ImageDataHash")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    lat: f("GPSLatitude"),
                    lon: f("GPSLongitude"),
                },
            ))
        })
        .collect())
}

fn verify(
    item: &WriteItem,
    hash_before: &str,
    after: Option<&Readback>,
    write_err: Option<&str>,
) -> Result<(), String> {
    let after = after.ok_or_else(|| {
        write_err
            .map(|e| format!("寫入失敗：{e}"))
            .unwrap_or_else(|| "寫入後無法讀回檔案".into())
    })?;
    if after.hash.as_deref() != Some(hash_before) {
        return Err("影像資料雜湊不一致".into());
    }
    match (after.lat, after.lon) {
        (Some(lat), Some(lon))
            if (lat - item.lat).abs() < 1e-6 && (lon - item.lon).abs() < 1e-6 =>
        {
            Ok(())
        }
        _ => Err(write_err
            .map(|e| format!("寫入失敗：{e}"))
            .unwrap_or_else(|| "讀回的座標與預期不符".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item() -> WriteItem {
        WriteItem {
            path: "/p/a.jpg".into(),
            lat: -33.5,
            lon: 121.25,
            alt: None,
            gps_utc_ms: Some(1714533615000),
            offset: Some("+08:00".into()),
            clear_alt_placeholder: true,
            has_dji_xmp: true,
        }
    }

    #[test]
    fn builds_expected_args() {
        let a = build_args(&item());
        assert!(a.contains(&"-GPSLatitude=33.50000000".to_string()));
        assert!(a.contains(&"-GPSLatitudeRef=S".to_string()));
        assert!(a.contains(&"-GPSLongitudeRef=E".to_string()));
        assert!(a.contains(&"-GPSStatus#=A".to_string()));
        assert!(a.contains(&"-GPSDateStamp=2024:05:01".to_string()));
        assert!(a.contains(&"-GPSTimeStamp=03:20:15".to_string()));
        assert!(a.contains(&"-GPSAltitude=".to_string()));
        assert!(a.contains(&"-XMP-drone-dji:GPSLatitude=-33.50000000".to_string()));
        assert!(a.contains(&"-OffsetTimeOriginal=+08:00".to_string()));
        assert_eq!(a.last().unwrap(), "/p/a.jpg");
    }

    #[test]
    fn altitude_written_when_known() {
        let mut i = item();
        i.alt = Some(-3.2);
        let a = build_args(&i);
        assert!(a.contains(&"-GPSAltitude=3.20".to_string()));
        assert!(a.contains(&"-GPSAltitudeRef#=1".to_string()));
        assert!(!a.contains(&"-GPSAltitude=".to_string()));
    }

    #[test]
    fn gps_time_optional() {
        let mut i = item();
        i.gps_utc_ms = None;
        let a = build_args(&i);
        assert!(!a
            .iter()
            .any(|x| x.starts_with("-GPSDateStamp") || x.starts_with("-GPSTimeStamp")));
    }

    #[test]
    fn offset_format() {
        assert!(is_offset("+08:00"));
        assert!(is_offset("-05:30"));
        assert!(!is_offset("8:00"));
        assert!(!is_offset("+0800"));
    }
}
