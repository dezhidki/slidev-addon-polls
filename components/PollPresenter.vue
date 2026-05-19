<template>
  <div v-show="hasPolls" class="poll-presenter-root">
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
import { computed, onMounted } from "vue"
import { useNav } from "@slidev/client"
import {
  connected,
  polls,
  activeBySlide,
  audienceCount,
  sendToServer,
} from "../setup/polls"

// Props
const props = defineProps({ token: { type: String, default: "changeme" } })

// Current slide from router
const { currentPage: currentSlide } = useNav()

// Polls belonging to current slide
const slidePolls = computed(() =>
  polls.value.filter((p) => Number(p.slideIndex) === currentSlide.value),
)
const hasPolls = computed(() => slidePolls.value.length > 0)

// Active poll: use activeBySlide mapping or fall back to first
const activeId = computed(() => {
  if (!hasPolls.value) return null
  const mapped = activeBySlide.value[String(currentSlide.value)]
  if (mapped) return mapped
  return slidePolls.value[0]?.id ?? null
})
const active = computed(() => {
  if (!activeId.value) return null
  return polls.value.find((p) => p.id === activeId.value) ?? null
})

// Derived state
const isVoting = computed(() => active.value?.state === "voting")
const isQuiz = computed(() => active.value?.type === "quiz")
const quizRevealed = computed(() => active.value?.revealed)
const votesArr = computed(() => active.value?.votes ?? [])
const totalVotes = computed(() => votesArr.value.reduce((a, b) => a + b, 0))
const activeQuestion = computed(() => active.value?.question ?? "Select a poll")

// Word cloud data
const wcWords = computed(() => {
  if (!active.value) return []
  const wc = active.value.wordCounts || {}
  return Object.entries(wc)
    .map(([word, count]) => ({ word, count: count as number }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)
})
const wcMax = computed(() => {
  let m = 1
  wcWords.value.forEach((w: any) => { if (w.count > m) m = w.count })
  return m
})

// Helpers
function pctOf(i: number) {
  return totalVotes.value ? Math.round(((votesArr.value[i] || 0) / totalVotes.value) * 100) : 0
}
function isLead(i: number) {
  if (!votesArr.value.length) return false
  const mx = Math.max(...votesArr.value)
  return mx > 0 && votesArr.value[i] === mx
}
function optText(opt: any) {
  return typeof opt === "string" ? opt : opt.text ?? opt
}
function tabIcon(p: any) {
  if (p.type === "quiz") return "🎯"
  if (p.type === "wordcloud") return "☁️"
  return "☑️"
}
function tabState(p: any) {
  if (p.state === "voting") return "Voting"
  if (p.state === "closed") return "Closed"
  return "Idle"
}
function tabTrunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s
}
function wcSz(c: number) {
  return 14 + (c / wcMax.value) * 28
}
function wcOp(c: number) {
  return 0.4 + (c / wcMax.value) * 0.6
}

// Actions
function selectPoll(id: string) {
  activeBySlide.value[String(currentSlide.value)] = id
  sendToServer({ type: "poll_selected", slideIndex: currentSlide.value, pollId: id })
}
function nextPoll() {
  const list = slidePolls.value
  if (!list.length) return
  const ci = activeId.value ? list.findIndex((p) => p.id === activeId.value) : -1
  selectPoll(list[(ci + 1) % list.length].id)
}
function prevPoll() {
  const list = slidePolls.value
  if (!list.length) return
  const ci = activeId.value ? list.findIndex((p) => p.id === activeId.value) : -1
  selectPoll(list[(ci - 1 + list.length) % list.length].id)
}
function toggleVote() {
  if (!activeId.value) return
  sendToServer({
    type: isVoting.value ? "poll_stop" : "poll_start",
    pollId: activeId.value,
  })
}
function doReveal() {
  if (!activeId.value) return
  sendToServer({ type: "poll_reveal", pollId: activeId.value })
}
function resetPoll() {
  if (!activeId.value) return
  sendToServer({ type: "poll_reset", pollId: activeId.value })
  selectPoll(slidePolls.value[0]?.id ?? "")
}
function castVote(i: number) {
  if (!activeId.value) return
  sendToServer({ type: "audience_vote", pollId: activeId.value, optionIndex: i })
}

// Announce initial slide position to server on mount
onMounted(() => {
  if (props.presenter) {
    const pollId = getActivePollIdForSlide(currentSlide.value)
    sendToServer({
      type: "presenter_navigate",
      slideIndex: currentSlide.value,
      activePollId: pollId,
    })
  }
})

function getActivePollIdForSlide(slideNo: number): string | undefined {
  const ids = Object.entries(polls.value)
    .filter(([, p]: [any, any]) => Number(p.slideIndex) === slideNo)
    .map(([id]: [string, any]) => id)
  return ids[0]
}
</script>