import type { GpxTrack, MatchResult, MatchSettings } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export class TrackIndex {
  readonly t: Float64Array;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  readonly ele: Float64Array;

  constructor(tracks: GpxTrack[]) {
    const all = tracks.flatMap((tr) => tr.points).sort((a, b) => a[0] - b[0]);
    const merged = all.filter((p, i) => i === 0 || p[0] !== all[i - 1][0]);
    const n = merged.length;
    this.t = new Float64Array(n);
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    this.ele = new Float64Array(n);
    merged.forEach(([t, lat, lon, ele], i) => {
      this.t[i] = t;
      this.lat[i] = lat;
      this.lon[i] = lon;
      this.ele[i] = ele ?? Number.NaN;
    });
  }

  get size(): number {
    return this.t.length;
  }

  get start(): number | null {
    return this.size ? this.t[0] : null;
  }

  get end(): number | null {
    return this.size ? this.t[this.size - 1] : null;
  }

  private lowerBound(utc: number): number {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.t[mid] < utc) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private pointResult(i: number, utc: number, kind: MatchResult["kind"]): MatchResult {
    const ele = this.ele[i];
    const offsetSec = Math.abs(this.t[i] - utc) / 1000;
    return {
      lat: this.lat[i],
      lon: this.lon[i],
      ele: Number.isNaN(ele) ? null : ele,
      kind,
      gapSec: offsetSec,
      nearestSec: offsetSec,
      speedKmh: null,
    };
  }

  locate(utc: number, s: MatchSettings): MatchResult | null {
    const n = this.size;
    if (!n) return null;
    const i = this.lowerBound(utc);

    if (i === 0 && this.t[0] === utc) return this.pointResult(0, utc, "interpolated");
    if (i === 0) return this.t[0] - utc <= s.maxExtrapSec * 1000 ? this.pointResult(0, utc, "extrapolated") : null;
    if (i === n) return utc - this.t[n - 1] <= s.maxExtrapSec * 1000 ? this.pointResult(n - 1, utc, "extrapolated") : null;

    const exact = i < n && this.t[i] === utc;
    const a = i - 1;
    const b = i;
    const gapSec = (this.t[b] - this.t[a]) / 1000;
    const dist = distanceM(this.lat[a], this.lon[a], this.lat[b], this.lon[b]);
    const nearestSec = Math.min(utc - this.t[a], this.t[b] - utc) / 1000;
    const usable = gapSec <= s.maxGapSec || (gapSec <= s.stationaryGapSec && dist <= s.stationaryRadiusM);

    if (!usable) {
      if (exact) return this.pointResult(b, utc, "interpolated");
      if (nearestSec > s.maxExtrapSec) return null;
      return this.pointResult(utc - this.t[a] <= this.t[b] - utc ? a : b, utc, "extrapolated");
    }

    const f = (utc - this.t[a]) / (this.t[b] - this.t[a]);
    const ea = this.ele[a];
    const eb = this.ele[b];
    const ele = Number.isNaN(ea) ? (Number.isNaN(eb) ? null : eb) : Number.isNaN(eb) ? ea : ea + (eb - ea) * f;
    return {
      lat: this.lat[a] + (this.lat[b] - this.lat[a]) * f,
      lon: this.lon[a] + (this.lon[b] - this.lon[a]) * f,
      ele,
      kind: "interpolated",
      gapSec,
      nearestSec,
      speedKmh: gapSec > 0 ? (dist / gapSec) * 3.6 : 0,
    };
  }
}
