import { computed, markRaw, reactive, ref, shallowRef } from "vue";
import { buildWriteItem, effectiveOffset, resolvePhoto, type LatLon, type PhotoState, type PhotoStatus, type Resolved } from "../core/resolve";
import { parseCameraTime, toUtc } from "../core/time";
import { detectOffset, evaluateOffset, shouldSuggest, type OffsetCandidate, type OffsetDetection } from "../core/timezone";
import { TrackIndex } from "../core/track";
import type { GpxTrack, PhotoMeta, WriteItem, WriteSummary } from "../core/types";
import { usePreferences } from "../composables/usePreferences";
import { api, onWriteProgress } from "../services/api";

export interface GroupSettings {
  offsetMin: number;
  adjustSec: number;
  dismissedSuggestion: number | null;
}

export interface PhotoGroup {
  id: string;
  name: string;
  dir: string;
  photos: PhotoState[];
  settings: GroupSettings;
}

export interface GroupAnalysis {
  detection: OffsetDetection;
  current: OffsetCandidate | null;
  suggest: boolean;
  sampleSize: number;
}

export interface GhostCandidate {
  offsetMin: number;
  lat: number;
  lon: number;
}

const prefs = usePreferences();

const tracks = shallowRef<GpxTrack[]>([]);
const photos = ref<PhotoState[]>([]);
const groupSettings = reactive<Record<string, GroupSettings>>({});
const errors = ref<string[]>([]);
const busy = ref<string | null>(null);
const selected = ref<string[]>([]);
const placing = ref(false);
const progress = ref<{ done: number; total: number } | null>(null);

const index = computed(() => markRaw(new TrackIndex(tracks.value)));

const groups = computed<PhotoGroup[]>(() => {
  const map = new Map<string, PhotoState[]>();
  for (const p of photos.value) {
    const list = map.get(p.meta.dir) ?? [];
    list.push(p);
    map.set(p.meta.dir, list);
  }
  return [...map.entries()]
    .map(([dir, list]) => ({
      id: dir,
      dir,
      name: dir.split(/[\\/]/).filter(Boolean).pop() ?? dir,
      photos: list.sort((a, b) => (a.naive ?? 0) - (b.naive ?? 0) || a.meta.name.localeCompare(b.meta.name)),
      settings: groupSettings[dir],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

const resolved = computed(() => {
  const map = new Map<string, Resolved>();
  for (const g of groups.value) {
    const ctx = {
      groupOffsetMin: g.settings.offsetMin,
      adjustSec: g.settings.adjustSec,
      index: index.value,
      settings: prefs.match,
      overwriteExisting: prefs.overwriteExisting,
    };
    for (const p of g.photos) map.set(p.meta.path, resolvePhoto(p, ctx));
  }
  return map;
});

function detectionSample(g: PhotoGroup): number[] {
  return g.photos
    .filter((p) => p.naive !== null && !effectiveOffset(p.meta, 0).fromExif && !(p.meta.gpsValid && !prefs.overwriteExisting))
    .map((p) => p.naive as number);
}

const analyses = computed(() => {
  const map = new Map<string, GroupAnalysis>();
  for (const g of groups.value) {
    const sample = detectionSample(g);
    const detection = detectOffset(sample, index.value, prefs.match, g.settings.offsetMin);
    const current = sample.length && index.value.size ? evaluateOffset(sample, index.value, g.settings.offsetMin, prefs.match) : null;
    const suggest =
      !!current &&
      shouldSuggest(current, detection.recommended) &&
      detection.recommended?.offsetMin !== g.settings.dismissedSuggestion;
    map.set(g.id, { detection, current, suggest, sampleSize: sample.length });
  }
  return map;
});

const writeItems = computed<WriteItem[]>(() =>
  photos.value.flatMap((p) => {
    const r = resolved.value.get(p.meta.path);
    const item = r ? buildWriteItem(p, r, prefs.writeOffset) : null;
    return item ? [item] : [];
  }),
);

const counts = computed(() => {
  const c: Record<PhotoStatus, number> = { interpolated: 0, extrapolated: 0, manual: 0, existing: 0, unmatched: 0, "no-time": 0 };
  for (const r of resolved.value.values()) c[r.status]++;
  return c;
});

const primary = computed(() => {
  const path = selected.value[selected.value.length - 1];
  return path ? photos.value.find((p) => p.meta.path === path) ?? null : null;
});

const ghosts = computed<GhostCandidate[]>(() => {
  const p = primary.value;
  if (!p || p.naive === null || effectiveOffset(p.meta, 0).fromExif) return [];
  const g = groupSettings[p.meta.dir];
  if (!g) return [];
  return [-120, -60, 60, 120].flatMap((delta) => {
    const offsetMin = g.offsetMin + delta;
    const m = index.value.locate(toUtc(p.naive as number, offsetMin, g.adjustSec), prefs.match);
    return m ? [{ offsetMin, lat: m.lat, lon: m.lon }] : [];
  });
});

function upsertPhotos(metas: PhotoMeta[]) {
  const byPath = new Map(photos.value.map((p) => [p.meta.path, p]));
  for (const meta of metas) {
    const existing = byPath.get(meta.path);
    const naive = parseCameraTime(meta.cameraTime, meta.subSec);
    if (existing) {
      existing.meta = meta;
      existing.naive = naive;
    } else {
      byPath.set(meta.path, { meta, naive, manual: null, include: true });
    }
    if (!groupSettings[meta.dir]) {
      groupSettings[meta.dir] = { offsetMin: prefs.defaultOffsetMin, adjustSec: 0, dismissedSuggestion: null };
    }
  }
  photos.value = [...byPath.values()];
}

function upsertTracks(incoming: GpxTrack[]) {
  const byPath = new Map(tracks.value.map((t) => [t.path, t]));
  for (const t of incoming) byPath.set(t.path, markRaw(t));
  tracks.value = [...byPath.values()].sort((a, b) => (a.points[0]?.[0] ?? 0) - (b.points[0]?.[0] ?? 0));
}

async function addPaths(paths: string[]) {
  if (!paths.length) return;
  busy.value = "正在讀取檔案…";
  try {
    const result = await api.scanPaths(paths);
    upsertTracks(result.tracks);
    upsertPhotos(result.photos);
    errors.value = [...errors.value, ...result.errors];
    if (!result.photos.length && !result.tracks.length && !result.errors.length) {
      errors.value = [...errors.value, "沒有找到可處理的照片或 GPX 檔案"];
    }
  } catch (e) {
    errors.value = [...errors.value, String(e)];
  } finally {
    busy.value = null;
  }
}

function removeTrack(path: string) {
  tracks.value = tracks.value.filter((t) => t.path !== path);
}

function removeGroup(id: string) {
  photos.value = photos.value.filter((p) => p.meta.dir !== id);
  selected.value = selected.value.filter((s) => photos.value.some((p) => p.meta.path === s));
  delete groupSettings[id];
}

function clearAll() {
  photos.value = [];
  tracks.value = [];
  selected.value = [];
  placing.value = false;
  for (const k of Object.keys(groupSettings)) delete groupSettings[k];
}

function setGroupOffset(id: string, offsetMin: number) {
  const g = groupSettings[id];
  if (g) g.offsetMin = offsetMin;
}

function setGroupAdjust(id: string, adjustSec: number) {
  const g = groupSettings[id];
  if (g) g.adjustSec = Number.isFinite(adjustSec) ? Math.round(adjustSec) : 0;
}

function dismissSuggestion(id: string, offsetMin: number) {
  const g = groupSettings[id];
  if (g) g.dismissedSuggestion = offsetMin;
}

function select(path: string, mode: "replace" | "toggle" | "range" = "replace") {
  if (mode === "toggle") {
    selected.value = selected.value.includes(path) ? selected.value.filter((p) => p !== path) : [...selected.value, path];
    return;
  }
  if (mode === "range" && selected.value.length) {
    const order = groups.value.flatMap((g) => g.photos.map((p) => p.meta.path));
    const from = order.indexOf(selected.value[selected.value.length - 1]);
    const to = order.indexOf(path);
    if (from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      const range = order.slice(a, b + 1).filter((p) => p !== path);
      selected.value = [...new Set([...selected.value, ...range, path])];
      return;
    }
  }
  selected.value = [path];
}

function clearSelection() {
  selected.value = [];
  placing.value = false;
}

function setManual(paths: string[], pos: LatLon) {
  for (const p of photos.value) if (paths.includes(p.meta.path)) p.manual = { ...pos };
  placing.value = false;
}

function clearManual(paths: string[]) {
  for (const p of photos.value) if (paths.includes(p.meta.path)) p.manual = null;
}

function setInclude(paths: string[], include: boolean) {
  for (const p of photos.value) if (paths.includes(p.meta.path)) p.include = include;
}

async function write(): Promise<WriteSummary> {
  const items = writeItems.value;
  progress.value = { done: 0, total: items.length };
  const unlisten = await onWriteProgress((done, total) => (progress.value = { done, total }));
  try {
    const summary = await api.writeGps(items, { backup: prefs.backup });
    const ok = summary.results.filter((r) => r.ok).map((r) => r.path);
    if (ok.length) {
      const refreshed = await api.scanPaths(ok);
      upsertPhotos(refreshed.photos);
      clearManual(ok);
    }
    return summary;
  } finally {
    unlisten();
    progress.value = null;
  }
}

export function useProject() {
  return {
    prefs,
    tracks,
    photos,
    groups,
    resolved,
    analyses,
    writeItems,
    counts,
    errors,
    busy,
    selected,
    primary,
    ghosts,
    placing,
    progress,
    index,
    addPaths,
    removeTrack,
    removeGroup,
    clearAll,
    setGroupOffset,
    setGroupAdjust,
    dismissSuggestion,
    select,
    clearSelection,
    setManual,
    clearManual,
    setInclude,
    write,
  };
}
