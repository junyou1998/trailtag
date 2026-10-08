use std::fs;
use std::path::Path;

use chrono::{DateTime, NaiveDateTime};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;

pub type TrackPoint = (i64, f64, f64, Option<f64>);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GpxTrack {
    pub path: String,
    pub name: String,
    pub points: Vec<TrackPoint>,
}

#[derive(Default)]
struct PendingPoint {
    lat: f64,
    lon: f64,
    ele: Option<f64>,
    time: Option<i64>,
}

#[derive(PartialEq)]
enum Field {
    None,
    Ele,
    Time,
}

pub fn parse_file(path: &Path) -> Result<GpxTrack, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{}：{e}", path.display()))?;
    let points = parse_str(&text).map_err(|e| format!("{}：{e}", path.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(GpxTrack {
        path: path.to_string_lossy().into_owned(),
        name,
        points,
    })
}

pub fn parse_str(text: &str) -> Result<Vec<TrackPoint>, String> {
    let mut reader = Reader::from_str(text);
    let mut points = Vec::new();
    let mut current: Option<PendingPoint> = None;
    let mut field = Field::None;

    loop {
        match reader
            .read_event()
            .map_err(|e| format!("XML 解析錯誤：{e}"))?
        {
            Event::Start(e) => match e.local_name().as_ref() {
                "trkpt" | "rtept" => current = Some(start_point(&e)?),
                "ele" if current.is_some() => field = Field::Ele,
                "time" if current.is_some() => field = Field::Time,
                _ => {}
            },
            Event::Empty(e) => {
                if matches!(e.local_name().as_ref(), "trkpt" | "rtept") {
                    start_point(&e)?;
                }
            }
            Event::Text(t) => {
                if field != Field::None {
                    if let Some(p) = current.as_mut() {
                        let raw = t.as_ref().trim().to_string();
                        match field {
                            Field::Ele => p.ele = raw.parse().ok(),
                            Field::Time => p.time = parse_time(&raw),
                            Field::None => {}
                        }
                    }
                }
            }
            Event::End(e) => match e.local_name().as_ref() {
                "trkpt" | "rtept" => {
                    if let Some(p) = current.take() {
                        if let Some(t) = p.time {
                            points.push((t, p.lat, p.lon, p.ele));
                        }
                    }
                    field = Field::None;
                }
                "ele" | "time" => field = Field::None,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }

    points.sort_by_key(|p| p.0);
    Ok(points)
}

fn start_point(e: &BytesStart) -> Result<PendingPoint, String> {
    let mut lat = None;
    let mut lon = None;
    for attr in e.attributes().flatten() {
        let value = attr.value.to_string();
        match attr.key.local_name().as_ref() {
            "lat" => lat = value.trim().parse::<f64>().ok(),
            "lon" => lon = value.trim().parse::<f64>().ok(),
            _ => {}
        }
    }
    match (lat, lon) {
        (Some(lat), Some(lon)) if lat.abs() <= 90.0 && lon.abs() <= 180.0 => Ok(PendingPoint {
            lat,
            lon,
            ..Default::default()
        }),
        _ => Err("軌跡點缺少有效的 lat/lon".into()),
    }
}

fn parse_time(raw: &str) -> Option<i64> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Some(dt.timestamp_millis());
    }
    NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .map(|n| n.and_utc().timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gpslogger_style() {
        let xml = r#"<?xml version="1.0"?><gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0"><trk><trkseg>
<trkpt lat="25.05" lon="121.55"><ele>61.4</ele><time>2024-05-01T03:20:15.250Z</time><src>gps</src></trkpt>
<trkpt lat="25.04" lon="121.54"><time>2024-05-01T03:18:00Z</time></trkpt>
<trkpt lat="25.03" lon="121.53"><ele>10</ele></trkpt>
</trkseg></trk></gpx>"#;
        let pts = parse_str(xml).unwrap();
        assert_eq!(pts.len(), 2);
        assert_eq!(pts[0].1, 25.04);
        assert_eq!(pts[0].3, None);
        assert_eq!(pts[1].0, 1714533615250);
        assert_eq!(pts[1].3, Some(61.4));
    }

    #[test]
    fn parses_time_without_zone_as_utc() {
        assert_eq!(parse_time("2024-05-01T03:18:00"), Some(1714533480000));
        assert_eq!(parse_time("2024-05-01T11:18:00+08:00"), Some(1714533480000));
    }
}
