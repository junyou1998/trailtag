import { describe, expect, it } from "vitest";
import { formatOffset, parseCameraTime, parseOffset, toUtc } from "./time";
import { TrackIndex, distanceM } from "./track";
import { detectOffset, evaluateOffset, shouldSuggest } from "./timezone";
import type { GpxTrack, MatchSettings, TrackPoint } from "./types";

const settings: MatchSettings = { maxGapSec: 300, stationaryGapSec: 3600, stationaryRadiusM: 100, maxExtrapSec: 60 };
const T0 = Date.UTC(2024, 4, 1, 0, 0, 0);
const A = [25.0, 121.5] as const;
const B = [25.1, 121.6] as const;

function synthetic(): GpxTrack {
  const pts: TrackPoint[] = [];
  for (let s = 0; s <= 3 * 3600; s += 60) {
    let lat: number, lon: number;
    if (s <= 3600) [lat, lon] = A;
    else if (s <= 5400) {
      const f = (s - 3600) / 1800;
      lat = A[0] + (B[0] - A[0]) * f;
      lon = A[1] + (B[1] - A[1]) * f;
    } else [lat, lon] = B;
    pts.push([T0 + s * 1000, lat, lon, 10]);
  }
  return { path: "x.gpx", name: "x.gpx", points: pts };
}

describe("time", () => {
  it("parses camera time as naive ms", () => {
    expect(parseCameraTime("2024:05:01 11:20:15")).toBe(Date.UTC(2024, 4, 1, 11, 20, 15));
    expect(parseCameraTime("2024:05:01 11:20:15", "5")).toBe(Date.UTC(2024, 4, 1, 11, 20, 15, 500));
    expect(parseCameraTime("0000:00:00 00:00:00")).not.toBeNull();
    expect(parseCameraTime(null)).toBeNull();
    expect(parseCameraTime("garbage")).toBeNull();
  });

  it("round-trips offsets", () => {
    expect(parseOffset("+08:00")).toBe(480);
    expect(parseOffset("-05:30")).toBe(-330);
    expect(parseOffset("+0545")).toBe(345);
    expect(formatOffset(480)).toBe("+08:00");
    expect(formatOffset(-330)).toBe("-05:30");
  });

  it("converts camera time to utc", () => {
    const naive = parseCameraTime("2024:05:01 11:20:15")!;
    expect(new Date(toUtc(naive, 480)).toISOString()).toBe("2024-05-01T03:20:15.000Z");
    expect(new Date(toUtc(naive, 540, 5)).toISOString()).toBe("2024-05-01T02:20:20.000Z");
  });
});

describe("TrackIndex", () => {
  const index = new TrackIndex([synthetic()]);

  it("interpolates between points", () => {
    const r = index.locate(T0 + 4500_000, settings)!;
    expect(r.kind).toBe("interpolated");
    expect(r.lat).toBeCloseTo((A[0] + B[0]) / 2, 6);
    expect(r.speedKmh).toBeGreaterThan(20);
  });

  it("extrapolates only within the limit", () => {
    expect(index.locate(T0 - 30_000, settings)?.kind).toBe("extrapolated");
    expect(index.locate(T0 - 120_000, settings)).toBeNull();
    expect(index.locate(T0 + 3 * 3600_000 + 59_000, settings)?.kind).toBe("extrapolated");
  });

  it("allows long gaps only when stationary", () => {
    const gap: GpxTrack = {
      path: "g",
      name: "g",
      points: [
        [T0, 25, 121, null],
        [T0 + 1800_000, 25.0001, 121, null],
        [T0 + 3600_000, 25.5, 121.5, null],
      ],
    };
    const idx = new TrackIndex([gap]);
    expect(idx.locate(T0 + 900_000, settings)?.kind).toBe("interpolated");
    expect(idx.locate(T0 + 2700_000, settings)).toBeNull();
  });

  it("merges and dedupes multiple tracks", () => {
    const t = synthetic();
    const idx = new TrackIndex([t, { ...t, points: t.points.slice(0, 10) }]);
    expect(idx.size).toBe(t.points.length);
  });

  it("measures distance", () => {
    expect(distanceM(0, 0, 0, 1)).toBeCloseTo(111_195, -2);
  });
});

describe("timezone detection", () => {
  const index = new TrackIndex([synthetic()]);
  const naive = ["2024:05:01 08:10:00", "2024:05:01 08:20:00", "2024:05:01 09:40:00"].map((s) => parseCameraTime(s)!);

  it("recommends the offset that lands photos on stationary track", () => {
    const d = detectOffset(naive, index, settings, 480);
    expect(d.recommended?.offsetMin).toBe(480);
    expect(d.recommended?.coverage).toBe(1);
  });

  it("suggests a change when the preferred offset does not fit", () => {
    const d = detectOffset(naive, index, settings, 540);
    expect(d.recommended?.offsetMin).toBe(480);
    const current = evaluateOffset(naive, index, 540, settings);
    expect(current.coverage).toBeLessThan(1);
    expect(shouldSuggest(current, d.recommended)).toBe(true);
  });

  it("penalises offsets that place photos while moving fast", () => {
    const moving = evaluateOffset(naive, index, 480 - 60, settings);
    const still = evaluateOffset(naive, index, 480, settings);
    expect(still.score).toBeGreaterThan(moving.score);
  });

  it("flags ambiguity and keeps the preferred offset when everything fits", () => {
    const flat: GpxTrack = {
      path: "f",
      name: "f",
      points: Array.from({ length: 24 * 60 }, (_, i) => [T0 - 12 * 3600_000 + i * 60_000, 25, 121, null] as TrackPoint),
    };
    const d = detectOffset(naive, new TrackIndex([flat]), settings, 480);
    expect(d.recommended?.offsetMin).toBe(480);
    expect(d.ambiguous).toBe(true);
  });

  it("returns nothing without track data", () => {
    expect(detectOffset(naive, new TrackIndex([]), settings, 480).recommended).toBeNull();
  });
});
