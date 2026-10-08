import type { PhotoStatus } from "../core/resolve";

export interface StatusMeta {
  label: string;
  color: string;
  hint: string;
}

export const STATUS: Record<PhotoStatus, StatusMeta> = {
  interpolated: { label: "已對上軌跡", color: "var(--color-st-interpolated)", hint: "依前後軌跡點內插位置" },
  extrapolated: { label: "鄰近點", color: "var(--color-st-extrapolated)", hint: "不在兩個軌跡點之間，採用最近的軌跡點" },
  manual: { label: "手動位置", color: "var(--color-st-manual)", hint: "在地圖上手動指定" },
  existing: { label: "已有 GPS", color: "var(--color-st-existing)", hint: "照片原本就有有效的 GPS，預設不覆蓋" },
  unmatched: { label: "對不到軌跡", color: "var(--color-st-unmatched)", hint: "拍攝時間附近沒有軌跡資料，可手動放置" },
  "no-time": { label: "沒有拍攝時間", color: "var(--color-st-notime)", hint: "EXIF 缺少拍攝時間，只能手動放置" },
};

export const STATUS_ORDER: PhotoStatus[] = ["interpolated", "extrapolated", "manual", "existing", "unmatched", "no-time"];
