<script setup lang="ts">
import L from "leaflet";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useTheme } from "../composables/useTheme";
import { useProject } from "../stores/project";
import { STATUS } from "../ui/status";
import { shortOffset } from "../ui/offsets";
import AppIcon from "./AppIcon.vue";

interface Place {
  name: string;
  lat: number;
  lon: number;
}

const TRACK_COLORS = ["#0f766e", "#4f46e5", "#be185d", "#b45309", "#0369a1", "#4d7c0f", "#7e22ce"];
const SEGMENT_GAP_MS = 15 * 60 * 1000;

const project = useProject();
const el = ref<HTMLDivElement>();
const map = shallowRef<L.Map>();
const { isDark } = useTheme();

let tiles: L.TileLayer | undefined;
const trackLayer = L.layerGroup();
const photoLayer = L.layerGroup();
const ghostLayer = L.layerGroup();
const editLayer = L.layerGroup();
const searchLayer = L.layerGroup();
const renderer = L.canvas({ padding: 0.3 });
let fittedOnce = false;
let resizeObserver: ResizeObserver | undefined;

const query = ref("");
const places = ref<Place[]>([]);
const searching = ref(false);
const searchError = ref<string | null>(null);
const pinned = ref<Place | null>(null);

const selectedCount = computed(() => project.selected.value.length);

const BASEMAPS = {
  map: {
    label: "地圖",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    label: "衛星",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 19,
    attribution: "Imagery &copy; Esri",
  },
} as const;
type BasemapKey = keyof typeof BASEMAPS;
const basemap = ref<BasemapKey>("map");

function setTiles() {
  if (!map.value) return;
  tiles?.remove();
  const b = BASEMAPS[basemap.value];
  tiles = L.tileLayer(b.url, { maxZoom: 20, maxNativeZoom: b.maxNativeZoom, attribution: b.attribution }).addTo(map.value);
  el.value?.classList.toggle("map-dark", isDark.value && basemap.value === "map");
}

function drawTracks() {
  trackLayer.clearLayers();
  project.tracks.value.forEach((track, i) => {
    const color = TRACK_COLORS[i % TRACK_COLORS.length];
    let segment: L.LatLngExpression[] = [];
    let last = -Infinity;
    const flush = () => {
      if (segment.length > 1) L.polyline(segment, { color, weight: 3, opacity: 0.55, renderer, interactive: false }).addTo(trackLayer);
      segment = [];
    };
    for (const [t, lat, lon] of track.points) {
      if (t - last > SEGMENT_GAP_MS) flush();
      segment.push([lat, lon]);
      last = t;
    }
    flush();
  });
}

function drawPhotos() {
  photoLayer.clearLayers();
  editLayer.clearLayers();
  const selected = new Set(project.selected.value);
  const later: L.Layer[] = [];
  for (const p of project.photos.value) {
    const r = project.resolved.value.get(p.meta.path);
    if (!r || r.lat === null || r.lon === null) continue;
    const isSelected = selected.has(p.meta.path);
    const marker = L.circleMarker([r.lat, r.lon], {
      renderer,
      radius: isSelected ? 8 : 5,
      color: isSelected ? "#ffffff" : "rgba(255,255,255,0.9)",
      weight: isSelected ? 3 : 1.5,
      fillColor: STATUS[r.status].color.startsWith("var(") ? cssVar(STATUS[r.status].color) : STATUS[r.status].color,
      fillOpacity: p.include ? 0.95 : 0.35,
    });
    marker.bindTooltip(p.meta.name, { direction: "top", offset: [0, -6] });
    marker.on("click", (e) => {
      const ev = e.originalEvent as MouseEvent;
      project.select(p.meta.path, ev.shiftKey ? "range" : ev.metaKey || ev.ctrlKey ? "toggle" : "replace");
      L.DomEvent.stopPropagation(e);
    });
    if (isSelected) later.push(marker);
    else marker.addTo(photoLayer);

    if (isSelected && r.status === "manual" && selected.size === 1) {
      const handle = L.divIcon({
        className: "ghost-label",
        html: '<div class="size-6 cursor-grab rounded-full border-[3px] border-[var(--color-st-manual)] bg-white/40 shadow-md"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      const drag = L.marker([r.lat, r.lon], { draggable: true, icon: handle, keyboard: false, title: "拖曳以調整位置" });
      drag.on("dragend", () => {
        const ll = drag.getLatLng();
        project.setManual([p.meta.path], { lat: ll.lat, lon: ll.lng });
      });
      drag.addTo(editLayer);
    }
  }
  later.forEach((m) => m.addTo(photoLayer));
}

function drawGhosts() {
  ghostLayer.clearLayers();
  const p = project.primary.value;
  for (const g of project.ghosts.value) {
    const icon = L.divIcon({
      className: "ghost-label",
      html: `<div class="flex h-6 min-w-8 items-center justify-center rounded-full border-2 border-dashed border-ink-3 bg-surface/90 px-1.5 text-[11px] font-semibold text-ink-2 shadow-sm">${shortOffset(g.offsetMin)}</div>`,
      iconSize: [36, 24],
      iconAnchor: [18, 12],
    });
    const m = L.marker([g.lat, g.lon], { icon, zIndexOffset: -100 });
    m.bindTooltip(`若相機時區為 UTC${shortOffset(g.offsetMin)}，照片會在這裡（點擊套用到整個資料夾）`, { direction: "top" });
    m.on("click", () => p && project.setGroupOffset(p.meta.dir, g.offsetMin));
    m.addTo(ghostLayer);
  }
}

function cssVar(expr: string): string {
  const name = expr.slice(4, -1).trim();
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

function bounds(): L.LatLngBounds | null {
  const pts: L.LatLngExpression[] = [];
  for (const r of project.resolved.value.values()) if (r.lat !== null && r.lon !== null) pts.push([r.lat, r.lon]);
  if (!pts.length) for (const t of project.tracks.value) for (const [, lat, lon] of t.points) pts.push([lat, lon]);
  return pts.length ? L.latLngBounds(pts) : null;
}

function fit() {
  const b = bounds();
  if (b && map.value) map.value.fitBounds(b, { padding: [40, 40], maxZoom: 16 });
}

const DETAIL_WIDTH = 360;

function visibleBounds(m: L.Map): L.LatLngBounds {
  const size = m.getSize();
  const right = Math.max(80, size.x - DETAIL_WIDTH);
  return L.latLngBounds(m.containerPointToLatLng([40, 80]), m.containerPointToLatLng([right, size.y - 60]));
}

function focusPrimary() {
  const p = project.primary.value;
  const m = map.value;
  if (!p || !m) return;
  const r = project.resolved.value.get(p.meta.path);
  const pts: L.LatLngExpression[] = [];
  if (r?.lat != null && r.lon != null) pts.push([r.lat, r.lon]);
  for (const g of project.ghosts.value) pts.push([g.lat, g.lon]);
  if (!pts.length) return;
  const b = L.latLngBounds(pts);
  if (visibleBounds(m).contains(b)) return;
  m.flyToBounds(b, {
    paddingTopLeft: [60, 100],
    paddingBottomRight: [DETAIL_WIDTH + 60, 80],
    maxZoom: Math.max(m.getZoom(), 14),
    duration: 0.6,
  });
}

async function search() {
  const q = query.value.trim();
  if (!q) return;
  searching.value = true;
  searchError.value = null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=zh-TW&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    places.value = rows.map((r) => ({ name: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
    if (!places.value.length) searchError.value = "找不到符合的地點";
  } catch (e) {
    searchError.value = `搜尋失敗：${e}`;
  } finally {
    searching.value = false;
  }
}

function choosePlace(place: Place) {
  places.value = [];
  pinned.value = place;
  searchLayer.clearLayers();
  L.marker([place.lat, place.lon]).bindTooltip(place.name.split(",")[0]).addTo(searchLayer);
  map.value?.flyTo([place.lat, place.lon], Math.max(map.value.getZoom(), 16), { duration: 0.6 });
}

function placeSelectedAtPin() {
  if (!pinned.value || !selectedCount.value) return;
  project.setManual([...project.selected.value], { lat: pinned.value.lat, lon: pinned.value.lon });
}

function clearPin() {
  pinned.value = null;
  searchLayer.clearLayers();
}

onMounted(() => {
  if (!el.value) return;
  const m = L.map(el.value, { zoomControl: false, preferCanvas: true, worldCopyJump: true }).setView([23.7, 121], 7);
  L.control.zoom({ position: "bottomright" }).addTo(m);
  L.control.scale({ position: "bottomleft", imperial: false }).addTo(m);
  [trackLayer, photoLayer, ghostLayer, editLayer, searchLayer].forEach((l) => l.addTo(m));
  m.on("click", (e) => {
    if (project.placing.value && project.selected.value.length) {
      project.setManual([...project.selected.value], { lat: e.latlng.lat, lon: e.latlng.lng });
    }
  });
  map.value = m;
  setTiles();
  resizeObserver = new ResizeObserver(() => m.invalidateSize());
  resizeObserver.observe(el.value);
  drawTracks();
  drawPhotos();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  map.value?.remove();
});

watch(project.tracks, () => {
  drawTracks();
  if (!fittedOnce) {
    fit();
    fittedOnce = !!bounds();
  }
});

watch(() => [project.resolved.value, project.selected.value, project.photos.value.map((p) => p.include)], drawPhotos);
watch(project.ghosts, drawGhosts);
watch([basemap, isDark], setTiles);
watch(
  () => project.photos.value.length,
  (n, old) => {
    if (n > old) fit();
  },
);
watch(
  () => project.primary.value?.meta.path,
  () => focusPrimary(),
);
watch(project.placing, (v) => {
  el.value?.classList.toggle("cursor-crosshair", v);
  if (el.value) el.value.style.cursor = v ? "crosshair" : "";
});

defineExpose({ fit });
</script>

<template>
  <div class="relative h-full w-full overflow-hidden">
    <div ref="el" class="h-full w-full" />

    <div class="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-start gap-2">
      <div class="pointer-events-auto relative w-full max-w-sm">
        <form class="panel flex items-center gap-1.5 px-2 py-1.5 shadow-sm" @submit.prevent="search">
          <AppIcon name="search" class="shrink-0 text-ink-3" />
          <input v-model="query" class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" placeholder="搜尋地點，例如：台中國際機場" />
          <button v-if="searching" type="button" class="text-xs text-ink-3" disabled>搜尋中…</button>
        </form>
        <div v-if="places.length || searchError" class="panel absolute inset-x-0 top-full mt-1 max-h-72 overflow-auto p-1 shadow-lg">
          <p v-if="searchError" class="px-2 py-1.5 text-xs text-ink-3">{{ searchError }}</p>
          <button
            v-for="pl in places"
            :key="`${pl.lat},${pl.lon}`"
            type="button"
            class="block w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2"
            @click="choosePlace(pl)"
          >
            {{ pl.name }}
          </button>
        </div>
      </div>

      <div v-if="pinned" class="pointer-events-auto panel flex items-center gap-2 px-2 py-1.5 text-xs shadow-sm">
        <span class="max-w-48 truncate text-ink-2">{{ pinned.name.split(",")[0] }}</span>
        <button class="btn btn-sm btn-primary" :disabled="!selectedCount" @click="placeSelectedAtPin">
          把選取的 {{ selectedCount }} 張放到這裡
        </button>
        <button class="btn btn-sm btn-ghost" title="移除標記" @click="clearPin"><AppIcon name="x" :size="14" /></button>
      </div>
    </div>

    <div
      v-if="project.placing.value"
      class="absolute left-1/2 top-16 z-[500] -translate-x-1/2 rounded-full bg-[var(--color-st-manual)] px-4 py-1.5 text-sm font-medium text-white shadow-lg"
    >
      點擊地圖放置 {{ selectedCount }} 張照片 ·
      <button class="underline" @click="project.placing.value = false">取消</button>
    </div>

    <div class="absolute right-3 top-3 z-[500] flex flex-col items-end gap-2">
      <div class="panel flex overflow-hidden p-0.5 text-xs shadow-sm">
        <button
          v-for="(b, key) in BASEMAPS"
          :key="key"
          class="rounded-md px-2.5 py-1"
          :class="basemap === key ? 'bg-accent text-white' : 'text-ink-2 hover:bg-surface-2'"
          @click="basemap = key"
        >
          {{ b.label }}
        </button>
      </div>
      <button class="panel grid size-9 place-items-center text-ink-2 shadow-sm hover:text-ink" title="顯示全部" @click="fit">
        <AppIcon name="focus" />
      </button>
    </div>

    <div class="panel absolute bottom-3 left-1/2 z-[500] hidden -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] text-ink-2 shadow-sm md:flex">
      <span v-for="s in (['interpolated', 'extrapolated', 'manual', 'existing'] as const)" :key="s" class="flex items-center gap-1">
        <span class="size-2.5 rounded-full" :style="{ background: STATUS[s].color }" />{{ STATUS[s].label }}
      </span>
      <span class="flex items-center gap-1"><span class="h-3 w-5 rounded-full border-2 border-dashed border-ink-3" />其他時區位置</span>
    </div>
  </div>
</template>
