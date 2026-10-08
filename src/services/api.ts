import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ScanResult, Thumbnail, WriteItem, WriteSummary } from "../core/types";

const PHOTO_EXTENSIONS = ["jpg", "jpeg", "heic", "heif", "dng", "tif", "tiff", "arw", "nef", "cr2", "cr3", "raf", "orf", "rw2"];

const mock = import.meta.env.DEV && !isTauri() ? (await import("./devMock")).devMock : null;

export const api = mock
  ? { ...mock, reveal: async (path: string) => void path }
  : {
      exiftoolVersion: () => invoke<string>("exiftool_version"),
      scanPaths: (paths: string[]) => invoke<ScanResult>("scan_paths", { paths }),
      getThumbnails: (paths: string[], large: boolean) => invoke<Thumbnail[]>("get_thumbnails", { paths, large }),
      writeGps: (items: WriteItem[], options: { backup: boolean }) => invoke<WriteSummary>("write_gps", { items, options }),
      reveal: (path: string) => revealItemInDir(path),
    };

export async function pickFiles(): Promise<string[]> {
  if (mock) return ["fixture"];
  const result = await open({
    multiple: true,
    filters: [
      { name: "照片與 GPX", extensions: [...PHOTO_EXTENSIONS, "gpx"] },
      { name: "GPX", extensions: ["gpx"] },
    ],
  });
  return result ?? [];
}

export async function pickFolders(): Promise<string[]> {
  if (mock) return ["fixture"];
  const result = await open({ directory: true, multiple: true });
  return result ?? [];
}

export type DragState = "enter" | "leave" | "drop";

export function onFileDrop(handler: (state: DragState, paths: string[]) => void): Promise<UnlistenFn> {
  if (mock) return Promise.resolve(() => undefined);
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    if (p.type === "enter") handler("enter", p.paths);
    else if (p.type === "drop") handler("drop", p.paths);
    else if (p.type === "leave") handler("leave", []);
  });
}

export function onWriteProgress(handler: (done: number, total: number) => void): Promise<UnlistenFn> {
  if (mock) return Promise.resolve(mock.onWriteProgress(handler));
  return listen<{ done: number; total: number }>("write-progress", (e) => handler(e.payload.done, e.payload.total));
}
