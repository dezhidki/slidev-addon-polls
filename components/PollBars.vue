<template>
  <div class="options">
    <div
      v-for="(opt, i) in options"
      :key="i"
      class="opt-row"
      :class="{
        leading: isLead(i) && totalVotes > 0,
        correct: revealed && correctAnswer === i,
      }"
    >
      <div class="opt-label">
        <span class="opt-text">{{ optText(opt) }}</span>
        <span v-if="revealed && correctAnswer === i" class="correct-chip">✓ Correct</span>
      </div>
      <div class="opt-bar-wrap">
        <div
          class="opt-bar"
          :style="{ width: pct(i) + '%' }"
          :class="{
            'bar-leading': isLead(i) && totalVotes > 0,
            'bar-correct': revealed && correctAnswer === i,
            'bar-empty': totalVotes === 0,
          }"
        />
      </div>
      <div class="opt-stat">
        <span class="stat-count">{{ votes[i] || 0 }}</span>
        <span class="stat-pct">{{ pct(i) }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PollOption } from "../types";

const props = defineProps({
  options: { type: Array as () => PollOption[], required: true },
  votes: { type: Array as () => number[], default: () => [] },
  correctAnswer: { type: Number, default: undefined },
  revealed: { type: Boolean, default: false },
});

const totalVotes = computed(() => props.votes.reduce((a, b) => a + b, 0));

function pct(i: number): number {
  return totalVotes.value ? Math.round(((props.votes[i] ?? 0) / totalVotes.value) * 100) : 0;
}
function isLead(i: number): boolean {
  const mx = Math.max(...props.votes);
  return mx > 0 && props.votes[i] === mx;
}
function optText(opt: PollOption): string {
  return typeof opt === "string" ? opt : opt.text;
}
</script>

<style scoped>
.options { display: flex; flex-direction: column; gap: 0.45rem; }
.opt-row { display: flex; align-items: center; gap: 0.6rem; cursor: default; border-radius: 6px; padding: 0.2rem 0.3rem; }

.opt-label { flex: 0 0 140px; font-size: 0.88rem; color: #d2d0cc; display: flex; align-items: center; gap: 0.3rem; }
.opt-row.leading .opt-label { color: #e8c87a; font-weight: 700; }
.opt-row.correct .opt-label { color: #92e0a8; font-weight: 700; }
.opt-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.correct-chip { font-size: 0.65rem; background: #166534; color: #92e0a8; padding: 0.1rem 0.35rem; border-radius: 4px; font-weight: 700; flex-shrink: 0; }

.opt-bar-wrap { flex: 1; height: 22px; background: rgba(15,25,35,0.6); border-radius: 5px; overflow: hidden; }
.opt-bar { height: 100%; background: linear-gradient(90deg, #c29a5b, #d4b47a); border-radius: 5px; transition: width 0.5s ease; min-width: 0; }
.opt-bar.bar-leading { background: linear-gradient(90deg, #e8c87a, #f0ddb0); }
.opt-bar.bar-correct { background: linear-gradient(90deg, #22c55e, #16a34a) !important; }
.opt-bar.bar-empty   { background: transparent; }

.opt-stat { display: flex; gap: 0.3rem; min-width: 60px; justify-content: flex-end; }
.stat-count { font-weight: 700; font-size: 0.85rem; color: #f8f6f0; }
.stat-pct   { font-size: 0.78rem; color: #c29a5b; }
</style>
