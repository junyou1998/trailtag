<script setup lang="ts">
import { formatUtc } from "../core/time";
import { useProject } from "../stores/project";
import AppIcon from "./AppIcon.vue";

const project = useProject();
</script>

<template>
  <section v-if="project.tracks.value.length" class="panel p-3">
    <div class="mb-2 flex items-center justify-between">
      <h2 class="flex items-center gap-1.5 text-sm font-semibold"><AppIcon name="route" />GPX 軌跡</h2>
      <span class="text-xs text-ink-3">{{ project.index.value.size.toLocaleString() }} 個點</span>
    </div>
    <ul class="space-y-1">
      <li v-for="t in project.tracks.value" :key="t.path" class="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
        <div class="min-w-0 flex-1">
          <div class="truncate text-[13px]" :title="t.path">{{ t.name }}</div>
          <div class="font-mono text-[11px] text-ink-3">
            {{ formatUtc(t.points[0][0]) }} → {{ formatUtc(t.points[t.points.length - 1][0], false) }} · {{ t.points.length }} 點
          </div>
        </div>
        <button class="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100" title="移除" @click="project.removeTrack(t.path)">
          <AppIcon name="x" :size="14" />
        </button>
      </li>
    </ul>
  </section>
</template>
