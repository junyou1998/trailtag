import type { ScanResult, Thumbnail, WriteItem, WriteSummary } from "../core/types";

let scan: Promise<ScanResult> | undefined;
let thumbs: Promise<Record<string, string>> | undefined;
let progressHandler: ((done: number, total: number) => void) | undefined;

const loadScan = () => (scan ??= fetch("/dev-fixture/scan.json").then((r) => r.json() as Promise<ScanResult>));
const loadThumbs = () => (thumbs ??= fetch("/dev-fixture/thumbs.json").then((r) => r.json()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const devMock = {
  exiftoolVersion: async () => "mock",
  scanPaths: async (paths: string[]): Promise<ScanResult> => {
    const data = await loadScan();
    if (paths[0] === "fixture") return structuredClone(data);
    const set = new Set(paths);
    return { photos: data.photos.filter((p) => set.has(p.path)).map((p) => ({ ...p, gpsValid: true })), tracks: [], errors: [] };
  },
  getThumbnails: async (paths: string[]): Promise<Thumbnail[]> => {
    const t = await loadThumbs();
    return paths.map((path) => ({ path, dataUrl: t[path] ?? null }));
  },
  writeGps: async (items: WriteItem[]): Promise<WriteSummary> => {
    for (let i = 0; i <= items.length; i += 10) {
      progressHandler?.(Math.min(i, items.length), items.length);
      await sleep(40);
    }
    return { results: items.map((i) => ({ path: i.path, ok: true, message: null })), backupDirs: ["/mock/_geotag_backup_mock"] };
  },
  onWriteProgress: (h: (done: number, total: number) => void) => {
    progressHandler = h;
    return () => (progressHandler = undefined);
  },
};
