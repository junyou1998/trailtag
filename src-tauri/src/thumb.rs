use serde::Serialize;
use serde_json::Value;

use crate::exiftool::ExifTool;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub path: String,
    pub data_url: Option<String>,
}

pub fn extract(tool: &ExifTool, paths: &[String], large: bool) -> Result<Vec<Thumbnail>, String> {
    let order: &[&str] = if large {
        &["PreviewImage", "JpgFromRaw", "ThumbnailImage"]
    } else {
        &["ThumbnailImage", "PreviewImage"]
    };
    let mut args: Vec<String> = vec!["-json".into(), "-b".into()];
    args.extend(order.iter().map(|t| format!("-{t}")));
    args.extend(paths.iter().cloned());

    let rows = tool.run_json(&args)?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let path = row.get("SourceFile")?.as_str()?.to_string();
            let data_url = order.iter().find_map(|t| match row.get(*t) {
                Some(Value::String(s)) => s
                    .strip_prefix("base64:")
                    .map(|b| format!("data:image/jpeg;base64,{b}")),
                _ => None,
            });
            Some(Thumbnail { path, data_url })
        })
        .collect())
}
