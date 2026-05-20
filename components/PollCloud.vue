<template>
  <div class="wc-area">
    <div v-if="!words.length" class="empty">Waiting for responses…</div>
    <div class="cloud-wrap">
      <span
        v-for="(w, i) in words"
        :key="i"
        class="cloud-word"
        :style="{ fontSize: sz(w.count) + 'px', opacity: op(w.count) }"
      >{{ w.word }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { WordEntry } from "../types";

const props = defineProps({
  wordCounts: { type: Object as () => Record<string, number>, default: () => ({}) },
});

const words = computed<WordEntry[]>(() =>
  Object.entries(props.wordCounts)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30),
);
const max = computed(() => Math.max(...words.value.map((w) => w.count), 1));

function sz(c: number): number {
  return 14 + (c / max.value) * 28;
}
function op(c: number): number {
  return 0.4 + (c / max.value) * 0.6;
}
</script>

<style scoped>
.wc-area { min-height: 60px; }
.cloud-wrap { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0.4rem 0.7rem; padding: 0.4rem; }
.cloud-word { font-weight: 600; color: #c29a5b; text-shadow: 0 0 10px rgba(194,154,91,0.3); transition: font-size 0.4s ease; user-select: none; }
.empty { text-align: center; color: #6b7f97; font-size: 0.85rem; padding: 1rem; }
</style>
