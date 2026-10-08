import { describe, expect, it } from "vitest";
import { buildWriteItem, resolvePhoto, type PhotoState, type ResolveContext } from "./resolve";
import { parseCameraTime } from "./time";
import { TrackIndex } from "./track";
import type { PhotoMeta } from "./types";

const T0 = Date.UTC(2024, 4, 1, 0, 0, 0);
const index = new TrackIndex([
  {
    path: "t",
    name: "t",
    points: [
      [T0, 25, 121, 10],
      [T0 + 60_000, 25.001, 121, 20],
    ],
  },
]);

function meta(over: Partial<PhotoMeta> = {}): PhotoMeta {
  return {
    path: "/p/a.jpg",
    name: "a.jpg",
    dir: "/p",
    cameraTime: "2024:05:01 08:00:30",
    subSec: null,
    offset: null,
    model: null,
    gpsLat: null,
    gpsLon: null,
    gpsValid: false,
    gpsAltPlaceholder: true,
    hasDjiXmp: true,
    ...over,
  };
}

function state(m: PhotoMeta, over: Partial<PhotoState> = {}): PhotoState {
  return { meta: m, naive: parseCameraTime(m.cameraTime), manual: null, include: true, ...over };
}

const ctx: ResolveContext = {
  groupOffsetMin: 480,
  adjustSec: 0,
  index,
  settings: { maxGapSec: 300, stationaryGapSec: 3600, stationaryRadiusM: 150, maxExtrapSec: 120 },
  overwriteExisting: false,
};

describe("resolvePhoto", () => {
  it("interpolates using the group offset", () => {
    const r = resolvePhoto(state(meta()), ctx);
    expect(r.status).toBe("interpolated");
    expect(r.lat).toBeCloseTo(25.0005, 6);
    expect(r.ele).toBeCloseTo(15, 6);
  });

  it("prefers the EXIF offset over the group offset", () => {
    const r = resolvePhoto(state(meta({ offset: "+09:00", cameraTime: "2024:05:01 09:00:30" })), ctx);
    expect(r.offsetFromExif).toBe(true);
    expect(r.status).toBe("interpolated");
  });

  it("applies the drift adjustment", () => {
    const r = resolvePhoto(state(meta({ cameraTime: "2024:05:01 08:05:00" })), { ...ctx, adjustSec: -270 });
    expect(r.status).toBe("interpolated");
  });

  it("keeps existing GPS unless overwrite is enabled", () => {
    const m = meta({ gpsValid: true, gpsLat: 1, gpsLon: 2 });
    expect(resolvePhoto(state(m), ctx).status).toBe("existing");
    expect(resolvePhoto(state(m), { ...ctx, overwriteExisting: true }).status).toBe("interpolated");
  });

  it("reports unmatched, no-time and manual", () => {
    expect(resolvePhoto(state(meta({ cameraTime: "2024:05:01 12:00:00" })), ctx).status).toBe("unmatched");
    expect(resolvePhoto(state(meta({ cameraTime: null })), ctx).status).toBe("no-time");
    const manual = resolvePhoto(state(meta({ cameraTime: null }), { manual: { lat: 24.15, lon: 120.68 } }), ctx);
    expect(manual.status).toBe("manual");
    expect(manual.utc).toBeNull();
  });
});

describe("buildWriteItem", () => {
  it("builds items with optional offset", () => {
    const p = state(meta());
    const item = buildWriteItem(p, resolvePhoto(p, ctx), true)!;
    expect(item.offset).toBe("+08:00");
    expect(item.gpsUtcMs).toBe(T0 + 30_000);
    expect(item.alt).toBeCloseTo(15);
    expect(item.clearAltPlaceholder).toBe(false);
    expect(buildWriteItem(p, resolvePhoto(p, ctx), false)!.offset).toBeNull();
  });

  it("clears placeholder altitude for manual items", () => {
    const p = state(meta(), { manual: { lat: 24.15, lon: 120.68 } });
    const item = buildWriteItem(p, resolvePhoto(p, ctx), false)!;
    expect(item.alt).toBeNull();
    expect(item.clearAltPlaceholder).toBe(true);
  });

  it("skips excluded and non-writable photos", () => {
    const p = state(meta(), { include: false });
    expect(buildWriteItem(p, resolvePhoto(p, ctx), false)).toBeNull();
    const q = state(meta({ cameraTime: "2024:05:01 12:00:00" }));
    expect(buildWriteItem(q, resolvePhoto(q, ctx), false)).toBeNull();
  });
});
