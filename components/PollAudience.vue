<template>
  <div class="poll-audience-root">
    <div class="poll-header">
      <span class="poll-title">📊 {{ active?.question ?? "Waiting…" }}</span>
      <div class="poll-meta">
        <span class="slide-num">Slide {{ slideIndex }}</span>
        <span class="poll-count">👥 {{ audienceCount }}</span>
        <span class="poll-dot" :class="connected ? 'on' : 'off'" />
      </div>
    </div>

    <div v-if="!connected" class="poll-offline">🔄 Connecting to poll server…</div>

    <div v-if="active && connected" class="poll-body">
      <PollCloud v-if="active.type === 'wordcloud'" :word-counts="active.wordCounts ?? {}" />
      <PollBars
        v-else
        :options="active.options ?? []"
        :votes="active.votes ?? []"
        :correct-answer="active.correctAnswer"
        :revealed="active.revealed"
      />
    </div>
    <div v-else-if="connected" class="empty-state">No active poll on this slide</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { createAudienceWs } from "../setup/polls";
import type { ActivePollMap, Poll, ServerMessage } from "../types";
import PollBars from "./PollBars.vue";
import PollCloud from "./PollCloud.vue";

const props = defineProps({
  slideIndex: { type: Number, required: true },
});

const localPolls = ref<Poll[]>([]);
const localActiveBySlide = ref<ActivePollMap>({});
const audienceCount = ref(0);
const connected = ref(false);
let ws: WebSocket | null = null;

const active = computed<Poll | null>(() => {
  const ps = localPolls.value.filter((p) => Number(p.slideIndex) === props.slideIndex);
  if (!ps.length) return null;
  const aid = localActiveBySlide.value[String(props.slideIndex)];
  return (aid && ps.find((p) => p.id === aid)) || ps[0] || null;
});

function handleMsg(msg: ServerMessage) {
  switch (msg.type) {
    case "audience_welcomed":
    case "poll_state":
    case "slide_change":
      localPolls.value = msg.polls;
      localActiveBySlide.value = { ...msg.activePolls };
      connected.value = true;
      break;
    case "audience_state":
      audienceCount.value = msg.audienceCount;
      break;
    case "presenter_authenticated":
      break;
  }
}

onMounted(() => {
  ws = createAudienceWs(handleMsg);
});
onUnmounted(() => {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
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
.poll-meta  { display: flex; align-items: center; gap: 0.6rem; }
.slide-num  { font-size: 0.75rem; color: #a8bdd0; }
.poll-count { font-size: 0.82rem; color: #a8bdd0; font-weight: 400; }
.poll-dot   { display: inline-block; width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.poll-dot.on  { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.poll-dot.off { background: #f1563f; }

.poll-offline { padding: 0.6rem 1rem; font-size: 0.82rem; color: #e8c87a; background: rgba(232, 200, 122, 0.08); }
.poll-body    { padding: 0.9rem 1.1rem; }
.empty-state  { padding: 1.5rem; text-align: center; color: #6b7f97; font-size: 0.9rem; }
</style>
