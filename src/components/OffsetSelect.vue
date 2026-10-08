<script setup lang="ts">
import { computed } from "vue";
import { OFFSET_OPTIONS, offsetLabel } from "../ui/offsets";

const model = defineModel<number>({ required: true });

const options = computed(() =>
  OFFSET_OPTIONS.some((o) => o.value === model.value) ? OFFSET_OPTIONS : [...OFFSET_OPTIONS, { value: model.value, label: offsetLabel(model.value) }].sort((a, b) => a.value - b.value),
);
</script>

<template>
  <select v-model.number="model" class="field w-full truncate">
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>
