<template>
  <div class="poll-display-root" :class="{ compact: compact }">
    <!-- ── Header ─────────────────────────────────────────────── -->
    <div class="poll-header">
      <span class="poll-title">{{ active?.question ?? (readonly ? "Ladataan…" : "Select a poll") }}</span>
      <div class="poll-meta">
        <span v-if="active && !readonly" class="poll-state-tag">{{ stateLabel }}</span>
        <span v-if="!readonly" class="poll-count">{{ totalVotes }} votes &middot; {{ audienceCount }} viewers</span>
        <span v-else class="poll-count">{{ audienceCount }} viewers</span>
        <span class="poll-dot" :class="connected ? 'on' : 'off'" />
      </div>
    </div>

    <!-- ── Offline banner ─────────────────────────────────────── -->
    <div v-if="!connected && !readonly" class="poll-offline">⚠️ Offline — waiting for server</div>

    <!-- ── Tab selector (multi-poll per slide) ────────────────── -->
    <div v-if="slidePolls.length > 1" class="poll-selector">
      <button
        v-for="(p, i) in slidePolls"
        :key="p.id"
        class="poll-tab"
        :class="{ active: activeId === p.id }"
        :disabled="readonly"
        @click="!readonly && selectPoll(p.id)"
      >
        <span class="tab-icon">{{ typeIcon(p.type) }}</span>
        <span class="tab-q">Q{{ i + 1 }}</span>
        <span v-if="!readonly" class="tab-badge" :class="'state-' + (p.state || 'idle')">{{ p.state ?? "idle" }}</span>
      </button>
    </div>
    <div v-else-if="slidePolls.length === 1" class="poll-single-label">
      <span class="tab-icon">{{ typeIcon(slidePolls[0].type) }}</span>
      {{ slidePolls[0].question }}
    </div>

    <!-- ── Body: results / empty ──────────────────────────────── -->
    <div v-if="active" class="poll-body">
      <PollCloud v-if="active.type === 'wordcloud'" :word-counts="active.wordCounts ?? {}" />
      <PollBars
        v-else
        :options="active.options ?? []"
        :votes="active.votes ?? []"
        :correct-answer="active.correctAnswer"
        :revealed="active.revealed"
      />
    </div>
    <div v-else class="empty-state">
      {{ readonly ? "Odotetaan äänestyksen käynnistystä…" : "No active poll on this slide" }}
    </div>

    <!-- ── Controls (presenter only) ─────────────────────────── -->
    <div v-if="!readonly && connected" class="controls">
      <button class="ctrl-btn" :class="isVoting ? 'danger' : 'success'" @click="toggleVote">
        {{ isVoting ? "⏹ Close" : "▶ Start" }}
      </button>
      <button v-if="isQuiz && !quizRevealed" class="ctrl-btn reveal" @click="doReveal">
        {{ isVoting ? "📊 Show Results" : "🎯 Reveal" }}
      </button>
      <button class="ctrl-btn ghost" @click="resetPoll">↩ Reset</button>
      <button v-if="slidePolls.length > 1" class="ctrl-btn ghost" @click="prevPoll">◀ Prev</button>
      <button v-if="slidePolls.length > 1" class="ctrl-btn ghost" @click="nextPoll">Next ▶</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  activeBySlide,
  audienceCount,
  connected,
  createAudienceWs,
  polls,
  registeredPollsRef,
  sendToServer,
} from "../setup/polls";
import type { ActivePollMap, Poll, PollType, ServerMessage } from "../types";
import PollBars from "./PollBars.vue";
import PollCloud from "./PollCloud.vue";

const props = defineProps({
  slideIndex: { type: Number, required: true },
  pollIds: { type: Array as () => string[], default: () => [] },
  /** Audience (readonly) mode — no controls, questions shown immediately */
  readonly: { type: Boolean, default: false },
  /** Compact layout hint — reduces padding for tight slides */
  compact: { type: Boolean, default: false },
});

// ── Audience-only local state (separate WS, does not touch shared module refs) ──
const localPolls = ref<Poll[]>([]);
const localActive = ref<ActivePollMap>({});
const audienceWs = ref<WebSocket | null>(null);

function handleAudienceMsg(msg: ServerMessage) {
  switch (msg.type) {
    case "audience_welcomed":
    case "poll_state":
    case "slide_change":
      localPolls.value = msg.polls;
      localActive.value = { ...msg.activePolls };
      break;
    case "audience_state":
      audienceCount.value = msg.audienceCount;
      break;
    case "presenter_authenticated":
      break;
  }
}

onMounted(() => {
  if (props.readonly) {
    audienceWs.value = createAudienceWs(handleAudienceMsg);
  }
});
onUnmounted(() => {
  if (audienceWs.value) {
    audienceWs.value.onclose = null;
    audienceWs.value.close();
    audienceWs.value = null;
  }
});

// ── Which poll list to use depends on mode ──
// Presenter: uses shared module-level `polls` (always in sync)
// Audience:  uses localPolls when server has responded; falls back to registeredPollsRef
//            so questions appear immediately even before the presenter connects.
const effectivePolls = computed<Poll[]>(() =>
  props.readonly
    ? localPolls.value.length > 0
      ? localPolls.value
      : registeredPollsRef.value
    : polls.value,
);

const effectiveActive = computed<ActivePollMap>(() =>
  props.readonly ? localActive.value : activeBySlide.value,
);

// ── Slide-specific computed helpers ──
const slidePolls = computed(() =>
  effectivePolls.value.filter((p) => Number(p.slideIndex) === props.slideIndex),
);

const activeId = computed(() => {
  if (!slidePolls.value.length) return null;
  const mapped = effectiveActive.value[String(props.slideIndex)];
  if (mapped) return mapped;
  return props.pollIds[0] ?? slidePolls.value[0]?.id ?? null;
});

const active = computed<Poll | null>(
  () => effectivePolls.value.find((p) => p.id === activeId.value) ?? null,
);

const isVoting = computed(() => active.value?.state === "voting");
const isQuiz = computed(() => active.value?.type === "quiz");
const quizRevealed = computed(() => active.value?.revealed === true);
const votesArr = computed(() => active.value?.votes ?? []);
const totalVotes = computed(() => votesArr.value.reduce((a, b) => a + b, 0));
const stateLabel = computed(() => {
  const s = active.value?.state;
  if (s === "voting") return "Voting";
  if (s === "closed") return "Closed";
  return "Idle";
});

function typeIcon(type: PollType): string {
  if (type === "quiz") return "🎯";
  if (type === "wordcloud") return "☁️";
  return "☑️";
}
function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// ── Presenter actions ──
function selectPoll(id: string) {
  activeBySlide.value[String(props.slideIndex)] = id;
  sendToServer({ type: "poll_selected", slideIndex: props.slideIndex, pollId: id });
}
function nextPoll() {
  const list = slidePolls.value;
  if (!list.length) return;
  const ci = list.findIndex((p) => p.id === activeId.value);
  selectPoll(list[(ci + 1) % list.length].id);
}
function prevPoll() {
  const list = slidePolls.value;
  if (!list.length) return;
  const ci = list.findIndex((p) => p.id === activeId.value);
  selectPoll(list[(ci - 1 + list.length) % list.length].id);
}
function toggleVote() {
  if (!activeId.value) return;
  sendToServer({ type: isVoting.value ? "poll_stop" : "poll_start", pollId: activeId.value });
}
function doReveal() {
  if (!activeId.value) return;
  sendToServer({ type: "poll_reveal", pollId: activeId.value });
}
function resetPoll() {
  if (!activeId.value) return;
  sendToServer({ type: "poll_reset", pollId: activeId.value });
  const firstId = props.pollIds[0] ?? slidePolls.value[0]?.id;
  if (firstId) selectPoll(firstId);
}
</script>

<style scoped>
.poll-display-root {
  font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif;
  background: rgba(0, 29, 61, 0.95);
  border-radius: 12px;
  color: #e2e0dc;
  border: 1px solid rgba(194, 154, 91, 0.25);
  overflow: hidden;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

/* Compact mode: tighten all spacing for use alongside code blocks etc. */
.poll-display-root.compact .poll-header { padding: 0.45rem 0.8rem; }
.poll-display-root.compact .poll-single-label { padding: 0.3rem 0.8rem; }
.poll-display-root.compact .poll-body { padding: 0.5rem 0.8rem; }
.poll-display-root.compact .controls  { padding: 0.45rem 0.8rem; }

.poll-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.7rem 1.1rem;
  background: rgba(194, 154, 91, 0.12);
  border-bottom: 1px solid rgba(194, 154, 91, 0.18);
  font-size: 0.92rem; font-weight: 700;
}
.poll-title    { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; color: #f8f6f0; }
.poll-meta     { display: flex; align-items: center; gap: 0.6rem; }
.poll-count    { font-size: 0.82rem; color: #a8bdd0; font-weight: 400; }
.poll-state-tag{ font-size: 0.75rem; background: #166534; color: #86efac; padding: 0.1rem 0.4rem; border-radius: 4px; }
.poll-dot      { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.poll-dot.on   { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.poll-dot.off  { background: #f1563f; }

.poll-offline  { padding: 0.6rem 1rem; font-size: 0.82rem; color: #e8c87a; background: rgba(232, 200, 122, 0.08); }

.poll-selector { display: flex; gap: 0.3rem; padding: 0.5rem 1rem; overflow-x: auto; border-bottom: 1px solid rgba(194, 154, 91, 0.1); }
.poll-single-label { padding: 0.4rem 1rem; font-size: 0.8rem; color: #a8bdd0; border-bottom: 1px solid rgba(194, 154, 91, 0.1); display: flex; align-items: center; gap: 0.4rem; }
.poll-tab {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.35rem 0.7rem; border: none; border-radius: 6px; cursor: pointer;
  font-size: 0.78rem; background: rgba(255,255,255,0.04); color: #b2bfcd; white-space: nowrap;
}
.poll-tab:hover:not(:disabled)  { background: rgba(194,154,91,0.12); }
.poll-tab.active { background: rgba(194,154,91,0.22); color: #f8f6f0; }
.poll-tab:disabled { cursor: default; }
.tab-q     { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.tab-badge { font-size: 0.65rem; padding: 0.08rem 0.3rem; border-radius: 4px; }
.state-voting { background: #166534; color: #86efac; }
.state-closed { background: #1e3a5f; color: #a8bdd0; }
.state-idle   { background: #2a2320; color: #b2bfcd; }

.poll-body    { padding: 0.9rem 1.1rem; }
.empty-state  { padding: 1.2rem; text-align: center; color: #6b7f97; font-size: 0.85rem; font-style: italic; }

.controls { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; padding: 0.7rem 1.1rem; border-top: 1px solid rgba(194,154,91,0.12); }
.ctrl-btn { padding: 0.3rem 0.75rem; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 700; white-space: nowrap; transition: opacity 0.2s; }
.ctrl-btn:hover:not(:disabled) { opacity: 0.85; }
.ctrl-btn.success { background: #16a34a; color: #fff; }
.ctrl-btn.danger  { background: #dc2626; color: #fff; }
.ctrl-btn.reveal  { background: #7c3aed; color: #fff; }
.ctrl-btn.ghost   { background: rgba(255,255,255,0.07); color: #a8bdd0; }
</style>
