import { formatOffset, parseOffset, toUtc } from "./time";
import type { TrackIndex } from "./track";
import type { MatchResult, MatchSettings, PhotoMeta, WriteItem } from "./types";

export type PhotoStatus = "interpolated" | "extrapolated" | "manual" | "existing" | "unmatched" | "no-time";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface PhotoState {
  meta: PhotoMeta;
  naive: number | null;
  manual: LatLon | null;
  include: boolean;
}

export interface ResolveContext {
  groupOffsetMin: number;
  adjustSec: number;
  index: TrackIndex;
  settings: MatchSettings;
  overwriteExisting: boolean;
}

export interface Resolved {
  status: PhotoStatus;
  lat: number | null;
  lon: number | null;
  ele: number | null;
  utc: number | null;
  offsetMin: number | null;
  offsetFromExif: boolean;
  match: MatchResult | null;
}

export const WRITABLE: ReadonlySet<PhotoStatus> = new Set(["interpolated", "extrapolated", "manual"]);

export function effectiveOffset(meta: PhotoMeta, groupOffsetMin: number): { offsetMin: number; fromExif: boolean } {
  const exif = parseOffset(meta.offset);
  return exif === null ? { offsetMin: groupOffsetMin, fromExif: false } : { offsetMin: exif, fromExif: true };
}

export function resolvePhoto(p: PhotoState, ctx: ResolveContext): Resolved {
  const { offsetMin, fromExif } = effectiveOffset(p.meta, ctx.groupOffsetMin);
  const utc = p.naive === null ? null : toUtc(p.naive, offsetMin, ctx.adjustSec);
  const base = { utc, offsetMin: p.naive === null ? null : offsetMin, offsetFromExif: fromExif, match: null, ele: null };

  if (p.manual) return { ...base, status: "manual", lat: p.manual.lat, lon: p.manual.lon };
  if (p.meta.gpsValid && !ctx.overwriteExisting) {
    return { ...base, status: "existing", lat: p.meta.gpsLat, lon: p.meta.gpsLon };
  }
  if (utc === null) return { ...base, status: "no-time", lat: null, lon: null };

  const match = ctx.index.locate(utc, ctx.settings);
  if (!match) return { ...base, status: "unmatched", lat: null, lon: null };
  return { ...base, status: match.kind, lat: match.lat, lon: match.lon, ele: match.ele, match };
}

export function buildWriteItem(p: PhotoState, r: Resolved, writeOffset: boolean): WriteItem | null {
  if (!p.include || !WRITABLE.has(r.status) || r.lat === null || r.lon === null) return null;
  const alt = r.status === "manual" ? null : r.ele;
  return {
    path: p.meta.path,
    lat: r.lat,
    lon: r.lon,
    alt,
    gpsUtcMs: r.utc,
    offset: writeOffset && !r.offsetFromExif && r.offsetMin !== null ? formatOffset(r.offsetMin) : null,
    clearAltPlaceholder: p.meta.gpsAltPlaceholder && alt === null,
    hasDjiXmp: p.meta.hasDjiXmp,
  };
}
