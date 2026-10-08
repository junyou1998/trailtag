<script setup lang="ts">
import { computed, ref } from "vue";
import type { WriteSummary } from "../core/types";
import { api } from "../services/api";
import { forgetThumbnails } from "../composables/useThumbnails";
import { useProject } from "../stores/project";
import { STATUS } from "../ui/status";
import ModalShell from "./ModalShell.vue";

const emit = defineEmits<{ close: [] }>();
const project = useProject();
const stage = ref<"confirm" | "writing" | "done">("confirm");
const summary = ref<WriteSummary | null>(null);
const fatal = ref<string | null>(null);

const plan = computed(() => {
  const byStatus = { interpolated: 0, extrapolated: 0, manual: 0 };
  const writable = new Set(project.writeItems.value.map((i) => i.path));
  for (const p of project.photos.value) {
    if (!writable.has(p.meta.path)) continue;
    const s = project.resolved.value.get(p.meta.path)?.status;
    if (s === "interpolated" || s === "extrapolated" || s === "manual") byStatus[s]++;
  }
  const excluded = project.photos.value.filter((p) => !p.include).length;
  return { byStatus, total: writable.size, excluded };
});

const skipped = computed(() => {
  const c = project.counts.value;
  return [
    { label: STATUS.existing.label, n: c.existing },
    { label: STATUS.unmatched.label, n: c.unmatched },
    { label: STATUS["no-time"].label, n: c["no-time"] },
    { label: "手動排除", n: plan.value.excluded },
  ].filter((x) => x.n);
});

const ok = computed(() => summary.value?.results.filter((r) => r.ok).length ?? 0);
const failed = computed(() => summary.value?.results.filter((r) => !r.ok) ?? []);
const pct = computed(() => {
  const p = project.progress.value;
  return p && p.total ? Math.round((p.done / p.total) * 100) : 0;
});

async function run() {
  stage.value = "writing";
  fatal.value = null;
  const paths = project.writeItems.value.map((i) => i.path);
  try {
    summary.value = await project.write();
    forgetThumbnails(paths);
  } catch (e) {
    fatal.value = String(e);
  }
  stage.value = "done";
}

const name = (path: string) => path.split(/[\\/]/).pop();
</script>

<template>
  <ModalShell :title="stage === 'done' ? '寫入結果' : '寫入地理資訊'" :dismissable="stage !== 'writing'" @close="emit('close')">
    <template v-if="stage === 'confirm'">
      <p class="text-sm text-ink-2">即將把 GPS 座標寫入 <b class="text-ink">{{ plan.total }}</b> 張照片的 EXIF，不會重新壓縮影像：</p>
      <ul class="mt-3 space-y-1 text-sm">
        <li v-for="(n, s) in plan.byStatus" v-show="n" :key="s" class="flex items-center gap-2">
          <span class="size-2.5 rounded-full" :style="{ background: STATUS[s].color }" />{{ STATUS[s].label }}
          <span class="ml-auto font-mono">{{ n }}</span>
        </li>
      </ul>
      <p v-if="plan.byStatus.extrapolated" class="mt-2 rounded-md bg-warn-soft p-2 text-xs text-warn">
        「鄰近點」照片不在兩個軌跡點之間，位置取自最近的軌跡點，請確認是否合理。
      </p>
      <div v-if="skipped.length" class="mt-3 text-xs text-ink-3">
        不會寫入：<span v-for="(s, i) in skipped" :key="s.label">{{ i ? "、" : "" }}{{ s.label }} {{ s.n }} 張</span>
      </div>
      <div class="mt-4 space-y-2 rounded-lg bg-surface-2 p-3 text-sm">
        <label class="flex items-start gap-2">
          <input v-model="project.prefs.backup" type="checkbox" class="mt-1 accent-[var(--color-accent)]" />
          <span>寫入前備份原檔<br /><span class="text-xs text-ink-3">複製到各資料夾內的 _geotag_backup_日期時間/ 資料夾</span></span>
        </label>
        <label class="flex items-start gap-2">
          <input v-model="project.prefs.writeOffset" type="checkbox" class="mt-1 accent-[var(--color-accent)]" />
          <span>同時寫入時區（OffsetTimeOriginal）<br /><span class="text-xs text-ink-3">讓相簿 App 在任何時區都能正確顯示拍攝時間</span></span>
        </label>
      </div>
      <p v-if="!project.prefs.backup" class="mt-2 text-xs text-danger">未備份時，寫入後無法還原原始檔案。</p>
      <p class="mt-3 text-xs text-ink-3">每張照片寫入前後都會比對影像資料雜湊，並讀回座標驗證；不一致時會自動從備份還原。</p>
    </template>

    <template v-else-if="stage === 'writing'">
      <p class="text-sm">寫入中，請勿關閉程式…</p>
      <div class="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <div class="h-full bg-accent transition-all" :style="{ width: `${pct}%` }" />
      </div>
      <p class="mt-2 text-right font-mono text-xs text-ink-3">{{ project.progress.value?.done ?? 0 }} / {{ project.progress.value?.total ?? 0 }}</p>
    </template>

    <template v-else>
      <p v-if="fatal" class="rounded-md bg-danger-soft p-2 text-sm text-danger">{{ fatal }}</p>
      <template v-else-if="summary">
        <p class="text-sm">
          成功 <b class="text-[var(--color-st-interpolated)]">{{ ok }}</b> 張<template v-if="failed.length">，失敗 <b class="text-danger">{{ failed.length }}</b> 張</template>。
        </p>
        <ul v-if="failed.length" class="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-md bg-danger-soft p-2 text-xs">
          <li v-for="f in failed" :key="f.path"><b>{{ name(f.path) }}</b>：{{ f.message }}</li>
        </ul>
        <div v-if="summary.backupDirs.length" class="mt-4">
          <div class="label mb-1">備份位置</div>
          <ul class="space-y-1">
            <li v-for="d in summary.backupDirs" :key="d" class="flex items-center gap-2 text-xs">
              <span class="min-w-0 flex-1 truncate font-mono text-ink-2" :title="d">{{ d }}</span>
              <button class="btn btn-sm" @click="api.reveal(d)">顯示</button>
            </li>
          </ul>
          <p class="mt-2 text-xs text-ink-3">在相簿 App 確認位置無誤後，可自行刪除備份資料夾。</p>
        </div>
      </template>
    </template>

    <template #footer>
      <template v-if="stage === 'confirm'">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="!plan.total" @click="run">寫入 {{ plan.total }} 張</button>
      </template>
      <button v-else-if="stage === 'done'" class="btn btn-primary" @click="emit('close')">完成</button>
    </template>
  </ModalShell>
</template>
