<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

const props = withDefaults(defineProps<{ title: string; dismissable?: boolean }>(), { dismissable: true });
const emit = defineEmits<{ close: [] }>();

function close() {
  if (props.dismissable) emit("close");
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopImmediatePropagation();
    close();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div class="fixed inset-0 z-[1000] grid place-items-center bg-black/40 p-4" @click.self="close">
    <div class="panel flex max-h-[90vh] w-full max-w-lg flex-col shadow-2xl" role="dialog" aria-modal="true" :aria-label="title">
      <header class="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 class="text-base font-semibold">{{ title }}</h2>
        <button v-if="dismissable" class="btn btn-ghost btn-sm" title="關閉" @click="close">✕</button>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="flex justify-end gap-2 border-t border-line px-4 py-3">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>
