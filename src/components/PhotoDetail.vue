<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { formatAtOffset, formatDuration, formatNaive, formatOffset, formatUtc } from "../core/time";
import { loadPreview } from "../composables/useThumbnails";
import { useProject } from "../stores/project";
import { STATUS } from "../ui/status";
import AppIcon from "./AppIcon.vue";

const project = useProject();
const preview = ref<string | null>(null);
const loading = ref(false);

const photo = computed(() => project.primary.value);
const count = computed(() => project.selected.value.length);
const resolved = computed(() => (photo.value ? project.resolved.value.get(photo.value.meta.path) : undefined));
const status = computed(() => (resolved.value ? STATUS[resolved.value.status] : null));
const selectedPhotos = computed(() => project.photos.value.filter((p) => project.selected.value.includes(p.meta.path)));
const anyManual = computed(() => selectedPhotos.value.some((p) => p.manual));
const allIncluded = computed(() => selectedPhotos.value.every((p) => p.include));

watch(
  () => photo.value?.meta.path,
  async (path) => {
    preview.value = null;
    if (!path) return;
    loading.value = true;
    const url = await loadPreview(path);
    if (photo.value?.meta.path === path) preview.value = url;
    loading.value = false;
  },
  { immediate: true },
);

const rows = computed(() => {
  const p = photo.value;
  const r = resolved.value;
  if (!p || !r) return [];
  const out: [string, string][] = [];
  out.push(["相機時間", p.naive === null ? "—" : formatNaive(p.naive)]);
  if (r.offsetMin !== null && r.utc !== null) {
    out.push(["時區", `UTC${formatOffset(r.offsetMin)}${r.offsetFromExif ? "（照片內建）" : ""}`]);
    out.push(["UTC 時間", formatUtc(r.utc)]);
    if (!r.offsetFromExif && r.offsetMin !== project.prefs.defaultOffsetMin) {
      out.push(["預設時區下", formatAtOffset(r.utc, project.prefs.defaultOffsetMin)]);
    }
  }
  if (r.lat !== null && r.lon !== null) out.push(["座標", `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`]);
  if (r.ele !== null) out.push(["高度", `${r.ele.toFixed(1)} m`]);
  if (r.match) {
    out.push(["軌跡間隔", formatDuration(r.match.gapSec)]);
    out.push(["最近軌跡點", formatDuration(r.match.nearestSec)]);
    if (r.match.speedKmh !== null) out.push(["當時速度", `${r.match.speedKmh.toFixed(1)} km/h`]);
  }
  if (p.meta.model) out.push(["相機", p.meta.model]);
  return out;
});

function startPlacing() {
  project.placing.value = true;
}
</script>

<template>
  <aside v-if="count" class="panel flex max-h-full w-80 flex-col overflow-hidden shadow-xl">
    <template v-if="count === 1 && photo">
      <div class="relative h-56 max-h-[28vh] shrink-0 bg-surface-2">
        <img v-if="preview" :src="preview" class="size-full object-contain" alt="" draggable="false" />
        <div v-else class="grid size-full place-items-center text-xs text-ink-3">{{ loading ? "載入預覽…" : "沒有可用的預覽" }}</div>
        <button class="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70" title="關閉" @click="project.clearSelection()">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <div class="truncate text-sm font-semibold" :title="photo.meta.path">{{ photo.meta.name }}</div>
        <div v-if="status" class="mt-1 flex items-start gap-1.5 text-xs text-ink-2">
          <span class="mt-1 size-2 shrink-0 rounded-full" :style="{ background: status.color }" />
          <span><b class="font-medium text-ink">{{ status.label }}</b> · {{ status.hint }}</span>
        </div>
        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <template v-for="[k, v] in rows" :key="k">
            <dt class="text-ink-3">{{ k }}</dt>
            <dd class="break-all font-mono text-ink">{{ v }}</dd>
          </template>
        </dl>
        <p v-if="project.ghosts.value.length" class="mt-3 rounded-lg bg-surface-2 p-2 text-[11px] leading-relaxed text-ink-2">
          地圖上的虛線標記是同一張照片在其他時區下的位置。若照片內容顯示的地點跟虛線標記吻合，點擊該標記即可把整個資料夾改成那個時區。
        </p>
      </div>
    </template>
    <div v-else class="flex items-center justify-between p-3">
      <div class="text-sm font-semibold">已選取 {{ count }} 張照片</div>
      <button class="btn btn-ghost btn-sm" @click="project.clearSelection()"><AppIcon name="x" :size="14" /></button>
    </div>

    <div class="flex flex-wrap gap-2 border-t border-line p-3">
      <button class="btn btn-sm" @click="startPlacing"><AppIcon name="pin" :size="14" />{{ anyManual ? "重新放置" : "在地圖上放置" }}</button>
      <button v-if="anyManual" class="btn btn-sm" @click="project.clearManual([...project.selected.value])">清除手動位置</button>
      <button class="btn btn-sm" @click="project.setInclude([...project.selected.value], !allIncluded)">
        {{ allIncluded ? "排除不寫入" : "納入寫入" }}
      </button>
    </div>
  </aside>
</template>
