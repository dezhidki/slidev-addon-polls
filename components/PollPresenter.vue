<template>
  <div v-if="isPresenter && hasPolls" class="poll-presenter-root">
    <div class="poll-header">
      <span class="poll-title">{{ activeQuestion }}</span>
      <div class="poll-meta">
        <span v-if="active" class="poll-state-tag">{{ stateLabel }}</span>
        <span class="poll-count">{{ totalVotes }} votes &middot; {{ audienceCount }} viewers</span>
        <span class="poll-dot" :class="connected ? 'on' : 'off'" />
      </div>
    </div>

    <div v-if="!connected" class="poll-offline">⚠️ Offline — waiting for server</div>

    <!-- Multi-poll tab selector -->
    <div v-if="slidePolls.length > 1" class="poll-selector">
      <button
        v-for="p in slidePolls"
        :key="p.id"
        class="poll-tab"
        :class="{ active: activeId === p.id }"
        @click="selectPoll(p.id)"
      >
        <span class="tab-icon">{{ tabIcon(p) }}</span>
        <span class="tab-q">{{ tabTrunc(p.question, 26) }}</span>
        <span class="tab-badge" :class="'state-' + (p.state || 'idle')">{{ tabState(p) }}</span>
      </button>
    </div>

    <div v-else-if="slidePolls.length === 1" class="poll-single-label">
      <span class="tab-icon">{{ tabIcon(slidePolls[0]) }}</span>
      {{ slidePolls[0].question }}
    </div>

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

      <!-- Multiple choice / quiz options -->
      <div v-else-if="active.options && active.options.length" class="options">
        <div
          v-for="(opt, i) in active.options"
          :key="i"
          class="opt-row"
          :class="{
            leading: isLead(i) && totalVotes > 0,
            correct: quizRevealed && active.correctAnswer === i,
          }"
          @click="castVote(i)"
        >
          <div class="opt-label">
            <span class="opt-text">{{ optText(opt) }}</span>
            <span v-if="quizRevealed && active.correctAnswer === i" class="correct-chip">✓ Correct</span>
          </div>
          <div class="opt-bar-wrap">
            <div
              class="opt-bar"
              :style="{ width: pctOf(i) + '%' }"
              :class="{
                'bar-leading': isLead(i) && totalVotes > 0,
                'bar-correct': quizRevealed && active.correctAnswer === i,
                'bar-empty': totalVotes === 0,
              }"
            />
          </div>
          <div class="opt-stat">
            <span class="stat-count">{{ votesArr[i] || 0 }}</span>
            <span class="stat-pct">{{ pctOf(i) }}%</span>
          </div>
        </div>
      </div>

      <div v-else class="empty-state">No options — waiting for poll to start</div>
    </div>

    <div v-if="hasPolls && !active && connected" class="empty-state">No active poll on this slide</div>

    <!-- Controls (presenter only) -->
    <div v-if="connected" class="controls">
      <button class="ctrl-btn" :class="isVoting ? 'danger' : 'success'" @click="toggleVote">
        {{ isVoting ? '⏹ Close' : '▶ Start' }}
      </button>
      <button v-if="isQuiz && !isVoting && !quizRevealed" class="ctrl-btn reveal" @click="doReveal">
        🎯 Reveal
      </button>
      <button v-if="isQuiz && isVoting" class="ctrl-btn reveal" @click="doReveal">
        📊 Show Results
      </button>
      <button class="ctrl-btn ghost" @click="resetPoll">↩ Reset</button>
      <button v-if="slidePolls.length > 1" class="ctrl-btn ghost" @click="prevPoll">◀ Prev</button>
      <button v-if="slidePolls.length > 1" class="ctrl-btn ghost" @click="nextPoll">Next ▶</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useNav } from "@slidev/client";
import { computed } from "vue";
import { activeBySlide, polls, sendToServer } from "../setup/polls";

// Only render in presenter mode
const _isPresenter = computed(() => {
  if (typeof window === "undefined") return false;
  return window.location.pathname.includes("/presenter");
});

// Props
const _props = defineProps({ token: { type: String, default: "changeme" } });

// Current slide from router
const { currentPage: currentSlide } = useNav();

// Polls belonging to current slide
const slidePolls = computed(() =>
  polls.value.filter((p) => Number(p.slideIndex) === currentSlide.value),
);
const hasPolls = computed(() => slidePolls.value.length > 0);

// Active poll: use activeBySlide mapping or fall back to first
const activeId = computed(() => {
  if (!hasPolls.value) return null;
  const mapped = activeBySlide.value[String(currentSlide.value)];
  if (mapped) return mapped;
  return slidePolls.value[0]?.id ?? null;
});
const active = computed(() => {
  if (!activeId.value) return null;
  return polls.value.find((p) => p.id === activeId.value) ?? null;
});

// Derived state
const isVoting = computed(() => active.value?.state === "voting");
const _isQuiz = computed(() => active.value?.type === "quiz");
const _quizRevealed = computed(() => active.value?.revealed);
const votesArr = computed(() => active.value?.votes ?? []);
const totalVotes = computed(() => votesArr.value.reduce((a, b) => a + b, 0));
const _activeQuestion = computed(() => active.value?.question ?? "Select a poll");

// Word cloud data
const wcWords = computed(() => {
  if (!active.value) return [];
  const wc = active.value.wordCounts || {};
  return Object.entries(wc)
    .map(([word, count]) => ({ word, count: count as number }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
});
const wcMax = computed(() => {
  let m = 1;
  wcWords.value.forEach((w: any) => {
    if (w.count > m) m = w.count;
  });
  return m;
});

// Helpers
function _pctOf(i: number) {
  return totalVotes.value ? Math.round(((votesArr.value[i] || 0) / totalVotes.value) * 100) : 0;
}
function _isLead(i: number) {
  if (!votesArr.value.length) return false;
  const mx = Math.max(...votesArr.value);
  return mx > 0 && votesArr.value[i] === mx;
}
function optText(opt: any) {
  return typeof opt === "string" ? opt : (opt.text ?? opt);
}
function tabIcon(p: any) {
  if (p.type === "quiz") return "🎯";
  if (p.type === "wordcloud") return "☁️";
  return "☑️";
}
function tabState(p: any) {
  if (p.state === "voting") return "Voting";
  if (p.state === "closed") return "Closed";
  return "Idle";
}
function tabTrunc(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
function wcSz(c: number) {
  return 14 + (c / wcMax.value) * 28;
}
function wcOp(c: number) {
  return 0.4 + (c / wcMax.value) * 0.6;
}

// Actions
function selectPoll(id: string) {
  activeBySlide.value[String(currentSlide.value)] = id;
  sendToServer({ type: "poll_selected", slideIndex: currentSlide.value, pollId: id });
}
function _nextPoll() {
  const list = slidePolls.value;
  if (!list.length) return;
  const ci = activeId.value ? list.findIndex((p) => p.id === activeId.value) : -1;
  selectPoll(list[(ci + 1) % list.length].id);
}
function _prevPoll() {
  const list = slidePolls.value;
  if (!list.length) return;
  const ci = activeId.value ? list.findIndex((p) => p.id === activeId.value) : -1;
  selectPoll(list[(ci - 1 + list.length) % list.length].id);
}
function _toggleVote() {
  if (!activeId.value) return;
  sendToServer({
    type: isVoting.value ? "poll_stop" : "poll_start",
    pollId: activeId.value,
  });
}
function _doReveal() {
  if (!activeId.value) return;
  sendToServer({ type: "poll_reveal", pollId: activeId.value });
}
function _resetPoll() {
  if (!activeId.value) return;
  sendToServer({ type: "poll_reset", pollId: activeId.value });
  selectPoll(slidePolls.value[0]?.id ?? "");
}
function _castVote(i: number) {
  if (!activeId.value) return;
  sendToServer({ type: "audience_vote", pollId: activeId.value, optionIndex: i });
}

// (nav sync is handled by global-bottom.vue which persists across slides)
</script>
<style scoped>
.poll-presenter-root {
  font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif;
  background: rgba(0, 29, 61, 0.95);
  border-radius: 12px;
  color: #e2e0dc;
  border: 1px solid rgba(194, 154, 91, 0.25);
  overflow: hidden;
  max-width: 900px;
  margin: 0 auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
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
.poll-count { font-size: 0.82rem; color: #a8bdd0; font-weight: 400; }
.poll-state-tag { font-size: 0.75rem; background: #166534; color: #86efac; padding: 0.1rem 0.4rem; border-radius: 4px; }
.poll-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.poll-dot.on { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.poll-dot.off { background: #f1563f; }

.poll-offline { padding: 0.6rem 1rem; font-size: 0.82rem; color: #e8c87a; background: rgba(232, 200, 122, 0.08); }

.poll-selector { display: flex; gap: 0.3rem; padding: 0.5rem 1rem; overflow-x: auto; border-bottom: 1px solid rgba(194, 154, 91, 0.1); }
.poll-single-label { padding: 0.4rem 1rem; font-size: 0.8rem; color: #a8bdd0; border-bottom: 1px solid rgba(194, 154, 91, 0.1); display: flex; align-items: center; gap: 0.4rem; }
.poll-tab {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.35rem 0.7rem; border: none; border-radius: 6px; cursor: pointer;
  font-size: 0.78rem; background: rgba(255,255,255,0.04); color: #b2bfcd; white-space: nowrap;
}
.poll-tab:hover { background: rgba(194,154,91,0.12); }
.poll-tab.active { background: rgba(194,154,91,0.22); color: #f8f6f0; }
.tab-q { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.tab-badge { font-size: 0.65rem; padding: 0.08rem 0.3rem; border-radius: 4px; }
.state-voting { background: #166534; color: #86efac; }
.state-closed { background: #1e3a5f; color: #a8bdd0; }
.state-idle { background: #2a2320; color: #b2bfcd; }

.poll-body { padding: 0.9rem 1.1rem; }

/* Word cloud */
.wc-area { min-height: 60px; }
.cloud-wrap { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0.4rem 0.7rem; padding: 0.4rem; }
.cloud-word { font-weight: 600; color: #c29a5b; text-shadow: 0 0 10px rgba(194,154,91,0.3); transition: font-size 0.4s ease; user-select: none; }

/* Options */
.options { display: flex; flex-direction: column; gap: 0.45rem; }
.opt-row { display: flex; align-items: center; gap: 0.6rem; cursor: default; }
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

/* Controls */
.controls { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; padding: 0.7rem 1.1rem; border-top: 1px solid rgba(194,154,91,0.12); }
.ctrl-btn { padding: 0.3rem 0.75rem; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 700; white-space: nowrap; transition: opacity 0.2s; }
.ctrl-btn:hover:not(:disabled) { opacity: 0.85; }
.ctrl-btn.success { background: #16a34a; color: #fff; }
.ctrl-btn.danger { background: #dc2626; color: #fff; }
.ctrl-btn.reveal { background: #7c3aed; color: #fff; }
.ctrl-btn.ghost { background: rgba(255,255,255,0.07); color: #a8bdd0; }

.empty { text-align: center; color: #6b7f97; font-size: 0.85rem; padding: 1rem; }
.empty-state { padding: 1.5rem; text-align: center; color: #6b7f97; font-size: 0.9rem; }
</style>
