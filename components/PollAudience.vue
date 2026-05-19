<template>
  <div class="poll-audience-root">
    <div class="poll-header">
      <span class="poll-title">📊 {{ activeQuestion }}</span>
      <div class="poll-meta">
        <span class="slide-num">Slide {{ currentSlide + 1 }}</span>
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
          @click="castVote(i)"
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
import { ref, computed, onMounted, onUnmounted } from "vue"
import { useNav } from "@slidev/client"
import { createAudienceWs } from "../setup/polls"

const { currentPage: currentSlide } = useNav()

// Audience-reactive state (local + from WS)
const polls = ref<any[]>([])
const activeBySlide = ref<Record<string, string>>({})
const localAudience = ref(0)
const connected = ref(false)
let audienceWs: WebSocket | null = null

// Active poll for this viewer's current slide
const active = computed(() => {
  const ps = polls.value.filter((p: any) => Number(p.slideIndex) === currentSlide.value)
  if (!ps.length) return null
  const aid = activeBySlide.value[String(currentSlide.value)]
  if (aid) {
    const found = ps.find((p: any) => p.id === aid)
    if (found) return found
  }
  return ps[0]
})

const activeQuestion = computed(() => active.value?.question ?? "Waiting…")
const votes = computed(() => active.value?.votes ?? [])
const totalVotes = computed(() => votes.value.reduce((a: number, b: number) => a + b, 0))
const showReveal = computed(() => active.value?.type === "quiz" && active.value?.revealed)

// Word cloud
const wcWords = computed(() => {
  if (!active.value) return []
  const wc = active.value.wordCounts || {}
  return Object.entries(wc)
    .map(([word, count]) => ({ word, count: count as number }))
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 30)
})
const wcMax = computed(() => {
  let m = 1
  wcWords.value.forEach((w: any) => { if (w.count > m) m = w.count })
  return m
})

function pct(i: number) {
  return totalVotes.value ? Math.round(((votes.value[i] || 0) / totalVotes.value) * 100) : 0
}
function isLead(i: number) {
  if (!votes.value.length) return false
  const mx = Math.max(...votes.value)
  return mx > 0 && votes.value[i] === mx
}
function optText(opt: any) {
  return typeof opt === "string" ? opt : opt.text ?? opt
}
function wcSz(c: number) { return 14 + (c / wcMax.value) * 28 }
function wcOp(c: number) { return 0.4 + (c / wcMax.value) * 0.6 }

// Cast vote via WebSocket
function castVote(i: number) {
  if (!active.value || audienceWs?.readyState !== WebSocket.OPEN) return
  audienceWs.send(JSON.stringify({
    type: "audience_vote",
    pollId: active.value.id,
    optionIndex: i,
  }))
}

// Handle messages from server
function handleMsg(msg: any) {
  switch (msg.type) {
    case "audience_welcomed":
    case "poll_state":
      polls.value = msg.polls ?? []
      if (msg.activePolls) activeBySlide.value = { ...msg.activePolls }
      connected.value = true
      break
    case "slide_change":
      polls.value = msg.polls ?? []
      if (msg.activePolls) activeBySlide.value = { ...msg.activePolls }
      connected.value = true
      break
    case "audience_state":
      localAudience.value = msg.audienceCount ?? 0
      break
  }
}

// Lifecycle
onMounted(() => {
  audienceWs = createAudienceWs(handleMsg)
})
onUnmounted(() => {
  if (audienceWs) {
    audienceWs.onclose = null // prevent auto-reconnect
    audienceWs.close()
    audienceWs = null
  }
})
</script>