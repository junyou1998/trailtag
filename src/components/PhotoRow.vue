<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { PhotoState, Resolved } from "../core/resolve";
import { formatAtOffset, formatNaive } from "../core/time";
import { requestThumbnail, thumbnailOf } from "../composables/useThumbnails";
import { STATUS } from "../ui/status";

const props = defineProps<{ photo: PhotoState; resolved: Resolved | undefined; selected: boolean }>();
const emit = defineEmits<{ select: [mode: "replace" | "toggle" | "range"] }>();

const root = ref<HTMLElement>();
const thumb = computed(() => thumbnailOf(props.photo.meta.path));
const status = computed(() => (props.resolved ? STATUS[props.resolved.status] : null));

const timeText = computed(() => (props.photo.naive === null ? "沒有拍攝時間" : formatNaive(props.photo.naive, false)));

const detail = computed(() => {
  const r = props.resolved;
  if (!r) return "";
  if (r.match) {
    const near = Math.round(r.match.nearestSec);
    return r.match.kind === "extrapolated" ? `距最近軌跡點 ${near} 秒` : `前後點間隔 ${Math.round(r.match.gapSec)} 秒`;
  }
  if (r.status === "unmatched" && r.utc !== null && r.offsetMin !== null) return `當地 ${formatAtOffset(r.utc, r.offsetMin, false)}`;
  return "";
});

let observer: IntersectionObserver | undefined;
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      requestThumbnail(props.photo.meta.path);
      observer?.disconnect();
    }
  });
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

function onClick(e: MouseEvent) {
  emit("select", e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace");
}

defineExpose({ root });
</script>

<template>
  <div
    ref="root"
    :data-path="photo.meta.path"
    class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors"
    :class="[selected ? 'bg-accent-soft' : 'hover:bg-surface-2', photo.include ? '' : 'opacity-50']"
    @click="onClick"
  >
    <div class="relative size-11 shrink-0 overflow-hidden rounded-md bg-surface-2">
      <img v-if="thumb" :src="thumb" class="size-full object-cover" alt="" draggable="false" />
      <span class="absolute bottom-0.5 right-0.5 size-2.5 rounded-full ring-2 ring-surface" :style="{ background: status?.color }" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="truncate text-[13px] font-medium text-ink">{{ photo.meta.name }}</div>
      <div class="flex items-center gap-2 text-[11px] text-ink-3">
        <span class="font-mono">{{ timeText }}</span>
        <span class="truncate">{{ status?.label }}<template v-if="detail"> · {{ detail }}</template></span>
      </div>
    </div>
  </div>
</template>
