export type TrackPoint = [t: number, lat: number, lon: number, ele: number | null];

export interface GpxTrack {
  path: string;
  name: string;
  points: TrackPoint[];
}

export interface PhotoMeta {
  path: string;
  name: string;
  dir: string;
  cameraTime: string | null;
  subSec: string | null;
  offset: string | null;
  model: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
  gpsValid: boolean;
  gpsAltPlaceholder: boolean;
  hasDjiXmp: boolean;
}

export interface ScanResult {
  photos: PhotoMeta[];
  tracks: GpxTrack[];
  errors: string[];
}

export interface MatchSettings {
  maxGapSec: number;
  stationaryGapSec: number;
  stationaryRadiusM: number;
  maxExtrapSec: number;
}

export type MatchKind = "interpolated" | "extrapolated";

export interface MatchResult {
  lat: number;
  lon: number;
  ele: number | null;
  kind: MatchKind;
  gapSec: number;
  nearestSec: number;
  speedKmh: number | null;
}

export interface WriteItem {
  path: string;
  lat: number;
  lon: number;
  alt: number | null;
  gpsUtcMs: number | null;
  offset: string | null;
  clearAltPlaceholder: boolean;
  hasDjiXmp: boolean;
}

export interface WriteResult {
  path: string;
  ok: boolean;
  message: string | null;
}

export interface WriteSummary {
  results: WriteResult[];
  backupDirs: string[];
}

export interface Thumbnail {
  path: string;
  dataUrl: string | null;
}
