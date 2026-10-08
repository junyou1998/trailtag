<script setup lang="ts">
import { DEFAULT_MATCH } from "../composables/usePreferences";
import { systemOffsetAt } from "../core/time";
import { THEME_LABEL, useTheme } from "../composables/useTheme";
import type { ThemeMode } from "../composables/usePreferences";
import { useProject } from "../stores/project";
import { offsetLabel } from "../ui/offsets";
import ModalShell from "./ModalShell.vue";
import OffsetSelect from "./OffsetSelect.vue";

const emit = defineEmits<{ close: [] }>();
const project = useProject();
const prefs = project.prefs;
const system = systemOffsetAt(Date.now());
const theme = useTheme();
const THEMES: ThemeMode[] = ["system", "light", "dark"];

function resetMatch() {
  Object.assign(prefs.match, DEFAULT_MATCH);
}

function applyToAll() {
  for (const g of project.groups.value) project.setGroupOffset(g.id, prefs.defaultOffsetMin);
}
</script>

<template>
  <ModalShell title="設定" @close="emit('close')">
    <section>
      <h3 class="text-sm font-semibold">外觀</h3>
      <div class="mt-2 inline-flex rounded-lg border border-line p-0.5 text-sm">
        <button
          v-for="t in THEMES"
          :key="t"
          class="rounded-md px-3 py-1"
          :class="theme.mode.value === t ? 'bg-accent text-white' : 'text-ink-2 hover:bg-surface-2'"
          @click="theme.mode.value = t"
        >
          {{ THEME_LABEL[t] }}
        </button>
      </div>
    </section>

    <section class="mt-6">
      <h3 class="text-sm font-semibold">預設相機時區</h3>
      <p class="mt-1 text-xs leading-relaxed text-ink-3">
        新加入的資料夾會使用這個時區。DJI Pocket 等相機的時鐘通常停在最後一次跟手機同步時的時區，出國時若沒有重新同步，就維持家裡的時區。電腦目前的時區是 {{ offsetLabel(system).split("　")[0] }}。
      </p>
      <OffsetSelect v-model="prefs.defaultOffsetMin" class="mt-2" />
      <button v-if="project.groups.value.length" class="btn btn-sm mt-2" @click="applyToAll">套用到目前所有資料夾</button>
    </section>

    <section class="mt-6">
      <h3 class="text-sm font-semibold">寫入規則</h3>
      <label class="mt-2 flex items-start gap-2 text-sm">
        <input v-model="prefs.overwriteExisting" type="checkbox" class="mt-1 accent-[var(--color-accent)]" />
        <span>覆蓋已有有效 GPS 的照片<br /><span class="text-xs text-ink-3">預設會略過手機等本來就有定位的照片</span></span>
      </label>
    </section>

    <section class="mt-6">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">軌跡比對參數</h3>
        <button class="btn btn-ghost btn-sm" @click="resetMatch">恢復預設</button>
      </div>
      <div class="mt-2 grid grid-cols-2 gap-3 text-sm">
        <label>
          <span class="label">內插最大間隔（秒）</span>
          <input v-model.number="prefs.match.maxGapSec" type="number" min="1" class="field mt-1 w-full font-mono" />
        </label>
        <label>
          <span class="label">鄰近點最大距離（秒）</span>
          <input v-model.number="prefs.match.maxExtrapSec" type="number" min="0" class="field mt-1 w-full font-mono" />
        </label>
        <label>
          <span class="label">靜止時允許間隔（秒）</span>
          <input v-model.number="prefs.match.stationaryGapSec" type="number" min="1" class="field mt-1 w-full font-mono" />
        </label>
        <label>
          <span class="label">靜止判定半徑（公尺）</span>
          <input v-model.number="prefs.match.stationaryRadiusM" type="number" min="1" class="field mt-1 w-full font-mono" />
        </label>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-ink-3">
        照片前後兩個軌跡點的間隔在「內插最大間隔」內就內插位置；若兩點距離小於「靜止判定半徑」，間隔可放寬到「靜止時允許間隔」。不在兩點之間的照片，若離最近的點不超過「鄰近點最大距離」，就採用該點。
      </p>
    </section>
  </ModalShell>
</template>
