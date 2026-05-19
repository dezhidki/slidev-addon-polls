<template>
  <div class="poll-inline">
    <div class="poll-q">{{ question }}</div>

    <!-- Word cloud view -->
    <div v-if="type === 'wordcloud'" class="cloud">
      <div v-if="sortedWords.length === 0" class="empty">Waiting for responses...</div>
      <div class="cloud-wrap">
        <span
          v-for="(item, i) in sortedWords"
          :key="i"
          class="cloud-word"
          :style="{ fontSize: wcSize(item.count) + 'px', opacity: wcOp(item.count) }"
        >{{ item.word }}</span>
      </div>
    </div>

    <!-- Choice / Quiz bars -->
    <div v-else class="options">
      <div
        v-for="(opt, i) in options"
        :key="i"
        class="opt"
        :class="{
          'opt-leading': isLeading(i) && total > 0,
          'opt-correct': type === 'quiz' && revealed && i === correctAnswer
        }"
      >
        <div class="opt-info">
          <span class="opt-text">{{ typeof opt === 'string' ? opt : opt.text }}</span>
          <span v-if="type === 'quiz' && revealed && i === correctAnswer" class="chip-correct">✓ Correct</span>
        </div>
        <div class="opt-bar-wrap">
          <div class="opt-bar" :style="{ width: total ? pct(i) + '%' : '0%' }" :class="{
            'bar-leading': isLeading(i) && total > 0,
            'bar-correct': type === 'quiz' && revealed && i === correctAnswer
          }" />
        </div>
        <div class="opt-num">{{ votes[i] || 0 }} · {{ total ? pct(i) : 0 }}%</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  question: string;
  type?: "choice" | "quiz" | "wordcloud";
  options?: Array<string | { text: string }>;
  votes?: number[];
  wordCounts?: Record<string, number>;
  correctAnswer?: number;
  revealed?: boolean;
}>();

const _type = computed(() => props.type || "choice");
const total = computed(() => (props.votes || []).reduce((a, b) => a + b, 0) || 0);
const _pct = (i: number) =>
  total.value ? Math.round(((props.votes[i] || 0) / total.value) * 100) : 0;
const _isLeading = (i: number) => {
  const max = Math.max(...(props.votes || []), 0);
  return max > 0 && props.votes[i] === max;
};

const sortedWords = computed(() => {
  return Object.entries(props.wordCounts || {})
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
});
const maxCount = computed(() => Math.max(...sortedWords.value.map((w) => w.count), 1));
const _wcSize = (c: number) => 12 + (c / maxCount.value) * 26;
const _wcOp = (c: number) => 0.35 + (c / maxCount.value) * 0.65;
</script>

<style scoped>
.poll-inline {
  background: rgba(0, 41, 87, 0.85);
  border-radius: 12px;
  padding: 1.1rem 1.3rem;
  border: 1px solid rgba(194, 154, 91, 0.2);
  max-width: 720px;
  margin: 0 auto;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.15);
}
.poll-q {
  font-size: 1.05rem;
  font-weight: 700;
  color: #f8f6f0;
  margin-bottom: 0.9rem;
  line-height: 1.3;
}

/* Word cloud */
.cloud-wrap {
  display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
  gap: 0.4rem 0.7rem; padding: 0.3rem;
}
.cloud-word { font-weight: 600; color: #e8c87a; text-shadow: 0 0 8px rgba(194,154,91,0.35); transition: font-size 0.4s ease; }

/* Options */
.options { display: flex; flex-direction: column; gap: 0.4rem; }
.opt { display: flex; align-items: center; gap: 0.5rem; }
.opt-info { flex: 0 0 130px; display: flex; align-items: center; gap: 0.25rem; }
.opt-text { font-size: 0.88rem; color: #d2d0cc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip-correct { font-size: 0.62rem; background: #166534; color: #92e0a8; padding: 0.08rem 0.3rem; border-radius: 4px; font-weight: 700; flex-shrink: 0; }
.opt-bar-wrap { flex: 2; height: 20px; background: rgba(15,25,35,0.6); border-radius: 4px; overflow: hidden; }
.opt-bar { height: 100%; background: linear-gradient(90deg, #c29a5b, #d4b47a); border-radius: 4px; transition: width 0.5s ease; }
.opt-bar.bar-leading { background: linear-gradient(90deg, #e8c87a, #f0ddb0); }
.opt-bar.bar-correct { background: linear-gradient(90deg, #22c55e, #16a34a) !important; }
.opt-leading .opt-text { color: #e8c87a; font-weight: 700; }
.opt-num { min-width: 70px; text-align: right; font-size: 0.8rem; color: #8fa4b6; }
.empty { text-align: center; color: #6b7f97; font-size: 0.85rem; padding: 1rem; }
</style>
