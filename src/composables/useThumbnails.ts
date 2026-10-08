import { reactive } from "vue";
import { api } from "../services/api";

const BATCH = 24;
const PREVIEW_CACHE = 30;

const thumbs = reactive(new Map<string, string | null>());
const previews = reactive(new Map<string, string | null>());
const queue = new Set<string>();
let running = false;

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.size) {
      const batch = [...queue].slice(0, BATCH);
      batch.forEach((p) => queue.delete(p));
      try {
        const result = await api.getThumbnails(batch, false);
        const got = new Map(result.map((t) => [t.path, t.dataUrl]));
        for (const p of batch) thumbs.set(p, got.get(p) ?? null);
      } catch {
        for (const p of batch) thumbs.set(p, null);
      }
    }
  } finally {
    running = false;
  }
}

export function requestThumbnail(path: string) {
  if (thumbs.has(path) || queue.has(path)) return;
  queue.add(path);
  void drain();
}

export function thumbnailOf(path: string): string | null | undefined {
  return thumbs.get(path);
}

export async function loadPreview(path: string): Promise<string | null> {
  if (previews.has(path)) return previews.get(path) ?? null;
  try {
    const [result] = await api.getThumbnails([path], true);
    const url = result?.dataUrl ?? null;
    previews.set(path, url);
    if (previews.size > PREVIEW_CACHE) previews.delete(previews.keys().next().value as string);
    return url;
  } catch {
    return null;
  }
}

export function forgetThumbnails(paths: string[]) {
  for (const p of paths) {
    thumbs.delete(p);
    previews.delete(p);
  }
}
