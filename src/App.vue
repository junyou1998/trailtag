<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { api, onFileDrop, pickFiles, pickFolders } from "./services/api";
import logo from "./assets/logo.svg";
import { THEME_LABEL, useTheme } from "./composables/useTheme";
import { useProject } from "./stores/project";
import AppIcon from "./components/AppIcon.vue";
import GroupCard from "./components/GroupCard.vue";
import MapView from "./components/MapView.vue";
import PhotoDetail from "./components/PhotoDetail.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import TrackList from "./components/TrackList.vue";
import WriteDialog from "./components/WriteDialog.vue";

const project = useProject();
const theme = useTheme();
const themeIcon = computed(() => ({ system: "monitor", light: "sun", dark: "moon" } as const)[theme.mode.value]);
const dragging = ref(false);
const showWrite = ref(false);
const showSettings = ref(false);
const toolError = ref<string | null>(null);
const toolVersion = ref<string | null>(null);

const hasContent = computed(() => project.photos.value.length > 0 || project.tracks.value.length > 0);
const writeCount = computed(() => project.writeItems.value.length);
const needsTrack = computed(() => project.photos.value.length > 0 && project.tracks.value.length === 0);

let unlisten: UnlistenFn | undefined;

watch(
  () => project.primary.value?.meta.path,
  async (path) => {
    if (!path) return;
    await nextTick();
    document.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },
);

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && !showWrite.value && !showSettings.value) {
    if (project.placing.value) project.placing.value = false;
    else project.clearSelection();
  }
}

onMounted(async () => {
  unlisten = await onFileDrop((state, paths) => {
    if (state === "enter") dragging.value = true;
    else if (state === "leave") dragging.value = false;
    else {
      dragging.value = false;
      void project.addPaths(paths);
    }
  });
  window.addEventListener("keydown", onKey);
  try {
    toolVersion.value = await api.exiftoolVersion();
  } catch (e) {
    toolError.value = String(e);
  }
});

onBeforeUnmount(() => {
  unlisten?.();
  window.removeEventListener("keydown", onKey);
});

async function addFiles() {
  await project.addPaths(await pickFiles());
}

async function addFolders() {
  await project.addPaths(await pickFolders());
}

function dismissError(i: number) {
  project.errors.value = project.errors.value.filter((_, idx) => idx !== i);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
      <div class="mr-2 flex items-center gap-2">
        <img :src="logo" alt="" class="size-9 -m-0.5" draggable="false" />
        <div class="leading-tight">
          <div class="text-sm font-semibold">TrailTag</div>
          <div class="text-[11px] text-ink-3">用 GPX 軌跡回填照片地理資訊</div>
        </div>
      </div>
      <button class="btn" @click="addFiles"><AppIcon name="file" />加入檔案</button>
      <button class="btn" @click="addFolders"><AppIcon name="folder" />加入資料夾</button>
      <button v-if="hasContent" class="btn btn-ghost" @click="project.clearAll()"><AppIcon name="trash" />清除</button>
      <div class="flex-1" />
      <span v-if="project.busy.value" class="text-xs text-ink-3">{{ project.busy.value }}</span>
      <button class="btn btn-ghost" :title="`外觀：${THEME_LABEL[theme.mode.value]}（點擊切換）`" @click="theme.cycle()">
        <AppIcon :name="themeIcon" />
      </button>
      <button class="btn btn-ghost" title="設定" @click="showSettings = true"><AppIcon name="gear" /></button>
      <button class="btn btn-primary" :disabled="!writeCount" @click="showWrite = true">
        <AppIcon name="save" />寫入 {{ writeCount || "" }}
      </button>
    </header>

    <div v-if="toolError" class="bg-danger-soft px-4 py-2 text-sm text-danger">{{ toolError }}</div>

    <main class="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside class="flex max-h-[45vh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-line p-3 lg:max-h-none lg:w-[420px] lg:border-r [&>*]:shrink-0">
        <div
          v-if="!hasContent"
          class="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-line p-8 text-center"
        >
          <div class="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent"><AppIcon name="upload" :size="28" /></div>
          <h2 class="mt-4 text-base font-semibold">把照片、資料夾和 GPX 拖進來</h2>
          <p class="mt-2 max-w-xs text-sm leading-relaxed text-ink-3">
            可以一次拖入多個資料夾與多個 GPX 檔，程式會依照拍攝時間比對軌跡，在地圖上預覽後再寫入。
          </p>
          <div class="mt-5 flex gap-2">
            <button class="btn" @click="addFiles"><AppIcon name="file" />選擇檔案</button>
            <button class="btn" @click="addFolders"><AppIcon name="folder" />選擇資料夾</button>
          </div>
          <p v-if="toolVersion" class="mt-6 text-[11px] text-ink-3">ExifTool {{ toolVersion }}</p>
        </div>

        <template v-else>
          <div v-if="needsTrack" class="rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
            還沒有軌跡資料，請拖入 GPX 檔案。
          </div>
          <TrackList />
          <GroupCard v-for="g in project.groups.value" :key="g.id" :group="g" />
        </template>
      </aside>

      <section class="relative min-h-0 flex-1">
        <MapView />
        <div class="pointer-events-none absolute bottom-12 right-14 top-16 z-[600] flex flex-col justify-end">
          <PhotoDetail class="pointer-events-auto min-h-0" />
        </div>
      </section>
    </main>

    <div v-if="project.errors.value.length" class="fixed bottom-4 left-4 z-[900] flex max-w-md flex-col gap-2">
      <div
        v-for="(err, i) in project.errors.value.slice(-4)"
        :key="i"
        class="panel flex items-start gap-2 border-danger/40 bg-danger-soft p-3 text-xs text-danger shadow-lg"
      >
        <AppIcon name="alert" :size="14" class="mt-px shrink-0" />
        <span class="min-w-0 flex-1 break-all">{{ err }}</span>
        <button class="shrink-0" @click="dismissError(project.errors.value.length - Math.min(4, project.errors.value.length) + i)">
          <AppIcon name="x" :size="14" />
        </button>
      </div>
    </div>

    <div v-if="dragging" class="pointer-events-none fixed inset-0 z-[1100] grid place-items-center bg-accent/15 backdrop-blur-[2px]">
      <div class="panel flex flex-col items-center gap-2 border-2 border-dashed border-accent px-10 py-8 shadow-2xl">
        <AppIcon name="upload" :size="32" class="text-accent" />
        <div class="text-base font-semibold">放開以加入照片與 GPX</div>
        <div class="text-xs text-ink-3">支援資料夾（含子資料夾）、JPG / HEIC / RAW 與 .gpx</div>
      </div>
    </div>

    <WriteDialog v-if="showWrite" @close="showWrite = false" />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
  </div>
</template>
