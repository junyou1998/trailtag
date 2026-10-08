<script setup lang="ts">
import { computed, ref } from "vue";
import type { PhotoStatus } from "../core/resolve";
import { formatNaive } from "../core/time";
import { useProject, type PhotoGroup } from "../stores/project";
import { offsetLabel } from "../ui/offsets";
import { STATUS, STATUS_ORDER } from "../ui/status";
import AppIcon from "./AppIcon.vue";
import OffsetSelect from "./OffsetSelect.vue";
import PhotoRow from "./PhotoRow.vue";

const props = defineProps<{ group: PhotoGroup }>();
const project = useProject();
const open = ref(true);

const analysis = computed(() => project.analyses.value.get(props.group.id));

const offset = computed({
  get: () => props.group.settings.offsetMin,
  set: (v: number) => project.setGroupOffset(props.group.id, v),
});

const adjust = computed({
  get: () => props.group.settings.adjustSec,
  set: (v: number) => project.setGroupAdjust(props.group.id, Number(v)),
});

const counts = computed(() => {
  const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<PhotoStatus, number>;
  for (const p of props.group.photos) {
    const r = project.resolved.value.get(p.meta.path);
    if (r) c[r.status]++;
  }
  return c;
});

const exifOffsetCount = computed(() => props.group.photos.filter((p) => p.meta.offset).length);

const range = computed(() => {
  const times = props.group.photos.map((p) => p.naive).filter((t): t is number => t !== null);
  if (!times.length) return null;
  const [a, b] = [Math.min(...times), Math.max(...times)];
  const sameDay = formatNaive(a).slice(0, 10) === formatNaive(b).slice(0, 10);
  return `${formatNaive(a)} → ${sameDay ? formatNaive(b, false) : formatNaive(b)}`;
});

const pct = (x: number) => `${Math.round(x * 100)}%`;
const rec = computed(() => analysis.value?.detection.recommended ?? null);

function applySuggestion() {
  if (rec.value) project.setGroupOffset(props.group.id, rec.value.offsetMin);
}

function dismiss() {
  if (rec.value) project.dismissSuggestion(props.group.id, rec.value.offsetMin);
}

function selectAll() {
  project.selected.value = props.group.photos.map((p) => p.meta.path);
}
</script>

<template>
  <section class="panel overflow-hidden">
    <header class="flex items-start gap-2 p-3 pb-2">
      <button class="mt-0.5 text-ink-3 transition-transform hover:text-ink" :class="open ? 'rotate-90' : ''" @click="open = !open">
        <AppIcon name="chevron" />
      </button>
      <div class="min-w-0 flex-1">
        <h2 class="flex items-center gap-1.5 truncate text-sm font-semibold" :title="group.dir">
          <AppIcon name="folder" class="shrink-0 text-ink-3" />{{ group.name }}
          <span class="font-normal text-ink-3">· {{ group.photos.length }} 張</span>
        </h2>
        <p v-if="range" class="mt-0.5 font-mono text-[11px] text-ink-3">相機時間 {{ range }}</p>
      </div>
      <button class="btn btn-ghost btn-sm" title="全選此資料夾" @click="selectAll">全選</button>
      <button class="btn btn-ghost btn-sm" title="移除此資料夾" @click="project.removeGroup(group.id)">
        <AppIcon name="x" :size="14" />
      </button>
    </header>

    <div class="space-y-2 px-3 pb-3">
      <div class="grid grid-cols-[1fr_auto] items-end gap-2">
        <label class="block min-w-0">
          <span class="label flex items-center gap-1"><AppIcon name="clock" :size="12" />相機時鐘時區</span>
          <OffsetSelect v-model="offset" class="mt-1" />
        </label>
        <label class="block w-24">
          <span class="label">微調（秒）</span>
          <input v-model.number="adjust" type="number" step="1" class="field mt-1 w-full font-mono" title="修正相機時鐘誤差，正數代表相機走得慢" />
        </label>
      </div>

      <p v-if="exifOffsetCount" class="text-[11px] text-ink-3">{{ exifOffsetCount }} 張照片本身帶有時區資訊，會優先使用照片內的時區。</p>

      <div v-if="analysis?.suggest && rec && analysis.current" class="rounded-lg border border-warn/40 bg-warn-soft p-2.5 text-xs">
        <div class="flex gap-1.5 font-medium text-warn"><AppIcon name="alert" :size="14" class="mt-px shrink-0" />時區可能不對</div>
        <p class="mt-1 text-ink-2">
          目前設定只有 {{ pct(analysis.current.coverage) }} 的照片對得上軌跡；改成
          <b class="text-ink">{{ offsetLabel(rec.offsetMin).split("　")[0] }}</b>
          可對上 {{ pct(rec.coverage) }}，且拍攝時多為靜止狀態（{{ pct(rec.stationaryRatio) }}）。
        </p>
        <div class="mt-2 flex gap-2">
          <button class="btn btn-sm btn-primary" @click="applySuggestion">套用</button>
          <button class="btn btn-sm" @click="dismiss">維持目前設定</button>
        </div>
      </div>
      <p v-else-if="analysis?.detection.ambiguous && analysis.current && analysis.current.coverage > 0" class="text-[11px] leading-relaxed text-ink-3">
        軌跡無法單獨判斷時區（多個時區都對得上）。點選照片後，地圖上的虛線標記會顯示其他時區下的位置，可對照照片內容確認。
      </p>

      <div class="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          v-for="s in STATUS_ORDER"
          :key="s"
          :style="{ width: `${(counts[s] / group.photos.length) * 100}%`, background: STATUS[s].color }"
          :title="`${STATUS[s].label}：${counts[s]}`"
        />
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
        <template v-for="s in STATUS_ORDER" :key="s">
          <span v-if="counts[s]" class="flex items-center gap-1">
            <span class="size-2 rounded-full" :style="{ background: STATUS[s].color }" />{{ STATUS[s].label }} {{ counts[s] }}
          </span>
        </template>
      </div>
    </div>

    <div v-if="open" class="max-h-[420px] overflow-y-auto border-t border-line p-1.5">
      <PhotoRow
        v-for="p in group.photos"
        :key="p.meta.path"
        :photo="p"
        :resolved="project.resolved.value.get(p.meta.path)"
        :selected="project.selected.value.includes(p.meta.path)"
        @select="(mode) => project.select(p.meta.path, mode)"
      />
    </div>
  </section>
</template>
