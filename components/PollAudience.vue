<template>
  <div class="poll-audience-root">
    <div class="poll-header">
      <span class="poll-title">📊 {{ activeQuestion }}</span>
      <div class="poll-meta">
        <span class="slide-num">Slide {{ slideIndex }}</span>
        <span class="poll-count">👥 {{ localAudience }}</span>
        <span class="poll-dot" :class="connected ? 'on' : 'off'" />
      </div>
    </div>

    <div v-if="!connected" class="poll-offline">🔄 Connecting to poll server…</div>

    <div v-if="active && connected" class="poll-body">
      <!-- Word cloud -->
      <div v-if="active.type === 'wordcloud'" class="wc-area">
        <div v-if="!wcWords.length" class="empty">Waiting for responses…</div>
        <div class="cloud-wrap">
          <span
            v-for="(w, i) in wcWords"
            :key="i"
            class="cloud-word"
            :style="{ fontSize: wcSz(w.count) + 'px', opacity: wcOp(w.count) }"
          >{{ w.word }}</span>
        </div>
      </div>

      <!-- Multiple choice / quiz -->
      <div v-else-if="active.options && active.options.length" class="options">
        <div
          v-for="(opt, i) in active.options"
          :key="i"
          class="opt-row"
          :class="{
            leading: isLead(i) && totalVotes > 0,
            correct: showReveal && active.correctAnswer === i,
          }"
        >
          <div class="opt-label">
            <span class="opt-text">{{ optText(opt) }}</span>
            <span v-if="showReveal && active.correctAnswer === i" class="correct-chip">✓</span>
          </div>
          <div class="opt-bar-wrap">
            <div
              class="opt-bar"
              :style="{ width: pct(i) + '%' }"
              :class="{
                'bar-leading': isLead(i) && totalVotes > 0,
                'bar-correct': showReveal && active.correctAnswer === i,
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

      <div v-else class="empty-state">Waiting for poll to start…</div>
    </div>

    <div v-if="!active && connected" class="empty-state">No active poll on this slide</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { createAudienceWs } from "../setup/polls";
import type { ActivePollMap, Poll, PollOption, ServerMessage } from "../types";

const props = defineProps({
  /** 1-based slide index (passed from Poll.vue via useSlideContext().$page) */
  slideIndex: { type: Number, required: true },
});

const localPolls = ref<Poll[]>([]);
const activeBySlide = ref<ActivePollMap>({});
const localAudience = ref(0);
const connected = ref(false);
let audienceWs: WebSocket | null = null;

const active = computed<Poll | null>(() => {
  const ps = localPolls.value.filter((p) => Number(p.slideIndex) === props.slideIndex);
  if (!ps.length) return null;
  const aid = activeBySlide.value[String(props.slideIndex)];
  if (aid) {
    const found = ps.find((p) => p.id === aid);
    if (found) return found;
  }
  return ps[0] ?? null;
});

const activeQuestion = computed(() => active.value?.question ?? "Waiting…");
const votes = computed(() => active.value?.votes ?? []);
const totalVotes = computed(() => votes.value.reduce((a, b) => a + b, 0));
const showReveal = computed(() => active.value?.type === "quiz" && active.value?.revealed === true);

const wcWords = computed(() => {
  if (!active.value) return [];
  const wc = active.value.wordCounts ?? {};
  return Object.entries(wc)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
});
const wcMax = computed(() => Math.max(...wcWords.value.map((w) => w.count), 1));

function pct(i: number): number {
  return totalVotes.value ? Math.round(((votes.value[i] ?? 0) / totalVotes.value) * 100) : 0;
}
function isLead(i: number): boolean {
  if (!votes.value.length) return false;
  const mx = Math.max(...votes.value);
  return mx > 0 && votes.value[i] === mx;
}
function optText(opt: PollOption): string {
  return typeof opt === "string" ? opt : opt.text;
}
function wcSz(c: number): number {
  return 14 + (c / wcMax.value) * 28;
}
function wcOp(c: number): number {
  return 0.4 + (c / wcMax.value) * 0.6;
}

function handleMsg(msg: ServerMessage) {
  switch (msg.type) {
    case "audience_welcomed":
    case "poll_state":
      localPolls.value = msg.polls;
      activeBySlide.value = { ...msg.activePolls };
      connected.value = true;
      break;
    case "slide_change":
      localPolls.value = msg.polls;
      activeBySlide.value = { ...msg.activePolls };
      connected.value = true;
      break;
    case "audience_state":
      localAudience.value = msg.audienceCount;
      break;
    case "presenter_authenticated":
      // Not expected on audience socket
      break;
  }
}

onMounted(() => {
  audienceWs = createAudienceWs(handleMsg);
});
onUnmounted(() => {
  if (audienceWs) {
    audienceWs.onclose = null;
    audienceWs.close();
    audienceWs = null;
  }
});
</script>

<style scoped>
.poll-audience-root {
  font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif;
  background: rgba(0, 29, 61, 0.95);
  border-radius: 12px;
  color: #e2e0dc;
  border: 1px solid rgba(194, 154, 91, 0.25);
  overflow: hidden;
  max-width: 700px;
  margin: 0 auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}

.poll-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.7rem 1.1rem;
  background: rgba(194, 154, 91, 0.12);
  border-bottom: 1px solid rgba(194, 154, 91, 0.18);
  font-size: 0.92rem; font-weight: 700;
}
.poll-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; color: #f8f6f0; }
.poll-meta { display: flex; align-items: center; gap: 0.6rem; }
.slide-num { font-size: 0.75rem; color: #a8bdd0; }
.poll-count { font-size: 0.82rem; color: #a8bdd0; font-weight: 400; }
.poll-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.poll-dot.on { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.poll-dot.off { background: #f1563f; }

.poll-offline { padding: 0.6rem 1rem; font-size: 0.82rem; color: #e8c87a; background: rgba(232, 200, 122, 0.08); }

.poll-body { padding: 0.9rem 1.1rem; }

/* Word cloud */
.wc-area { min-height: 60px; }
.cloud-wrap { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0.4rem 0.7rem; padding: 0.4rem; }
.cloud-word { font-weight: 600; color: #c29a5b; text-shadow: 0 0 10px rgba(194,154,91,0.3); transition: font-size 0.4s ease; user-select: none; }

/* Options */
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
.opt-bar.bar-empty { background: transparent; }

.opt-stat { display: flex; gap: 0.3rem; min-width: 60px; justify-content: flex-end; }
.stat-count { font-weight: 700; font-size: 0.85rem; color: #f8f6f0; }
.stat-pct { font-size: 0.78rem; color: #c29a5b; }

.empty { text-align: center; color: #6b7f97; font-size: 0.85rem; padding: 1rem; }
.empty-state { padding: 1.5rem; text-align: center; color: #6b7f97; font-size: 0.9rem; }
</style>
