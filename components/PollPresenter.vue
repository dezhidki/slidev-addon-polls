<template>
  <!-- PollPresenter — slide-embedded presenter controls -->
  <div class="slidev-poll-presenter" :class="size">
    <!-- Status bar -->
    <div class="poll-header">
      <span class="poll-title">{{ activePoll ? activePoll.question : 'No active poll' }}</span>
      <div class="poll-meta">
        <span v-if="activePoll" class="poll-count">👥 {{ activeTotal }}</span>
        <span class="poll-dot" :class="connected ? 'on' : 'off'" :title="connected ? 'Connected' : 'Offline'" />
      </div>
    </div>

    <!-- Offline warning -->
    <div v-if="!connected && isPresenter" class="poll-offline">
      ⚠️ Poll server offline — start with <code>cd poll-server && node server.js</code>
    </div>

    <!-- Poll selector (presenter only) -->
    <div v-if="isPresenter && allPolls.length > 1" class="poll-selector">
      <button
        v-for="p in allPolls"
        :key="p.id"
        class="poll-tab"
        :class="{ active: currentId === p.id }"
        @click="selectPoll(p.id)"
      >
        <span class="tab-q">{{ p.question.slice(0, 30) }}</span>
        <span class="tab-badge" :class="'state-' + (p.state || 'idle')">{{ badge(p) }}</span>
      </button>
    </div>

    <!-- Results body -->
    <div v-if="activePoll" class="poll-body">
      <!-- Word cloud -->
      <div v-if="activePoll.type === 'wordcloud'" class="wordcloud">
        <div v-if="sortedWords.length === 0" class="empty">Waiting for responses...</div>
        <div class="cloud-wrap">
          <span
            v-for="(item, i) in sortedWords"
            :key="i"
            class="cloud-word"
            :style="{ fontSize: cloudSize(item.count) + 'px', opacity: cloudOp(item.count) }"
          >{{ item.word }}</span>
        </div>
      </div>

      <!-- Choice / Quiz bars -->
      <div v-else class="options">
        <div
          v-for="(opt, i) in activePoll.options"
          :key="i"
          class="opt-row"
          :class="{
            leading: isLeading(i) && activeTotal > 0,
            correct: activePoll.type === 'quiz' && activePoll.revealed && i === activePoll.correctAnswer
          }"
        >
          <div class="opt-label">
            <span class="opt-text">{{ typeof opt === 'string' ? opt : opt.text }}</span>
            <span v-if="activePoll.type === 'quiz' && activePoll.revealed && i === activePoll.correctAnswer" class="correct-chip">✓ Correct</span>
          </div>
          <div class="opt-bar-wrap">
            <div
              class="opt-bar"
              :style="{ width: getPct(i) + '%' }"
              :class="{
                'bar-leading': isLeading(i) && activeTotal > 0,
                'bar-correct': activePoll.type === 'quiz' && activePoll.revealed && i === activePoll.correctAnswer,
                'bar-empty': activeTotal === 0
              }"
            />
          </div>
          <div class="opt-stat">
            <span class="stat-count">{{ activeVotes[i] || 0 }}</span>
            <span class="stat-pct">{{ getPct(i) }}%</span>
          </div>
        </div>
      </div>

      <!-- Presenter controls -->
      <div v-if="isPresenter" class="controls">
        <button class="ctrl-btn" :class="isVoting ? 'danger' : 'success'" @click="toggleVoting">
          {{ isVoting ? '⏹ Close' : '▶ Start' }}
        </button>
        <button
          v-if="isQuiz && !isVoting && !isRevealed"
          class="ctrl-btn reveal"
          @click="revealAnswer"
        >🎯 Reveal</button>
        <button class="ctrl-btn ghost" title="Reset" @click="resetPolls">⟲</button>
      </div>
    </div>

    <div v-else class="empty-state">No polls defined on this slide.</div>
  </div>
</template>

<script setup lang="ts">
import { usePolls } from 'slidev-addon-polls';
import { computed } from 'vue'

const props = defineProps<{
  polls?: Array<any>
  token?: string
  size?: 'compact' | 'normal'
}>()

const {
  connected, activePoll, activeVotes, activeTotal,
  currentId, isPresenter, allPolls,
  getPct, isLeading,
  selectPoll, toggleVoting, revealAnswer, resetPolls,
} = usePolls({ token: props.token, slides: props.polls || [] })

const isVoting = computed(() => activePoll.value?.state === 'voting')
const isRevealed = computed(() => activePoll.value?.revealed)
const isQuiz = computed(() => activePoll.value?.type === 'quiz')

const sortedWords = computed(() => {
  const wc = activePoll.value?.wordCounts || {}
  return Object.entries(wc)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25)
})
const maxCount = computed(() => Math.max(...sortedWords.value.map(w => w.count), 1))
const cloudSize = (c: number) => 13 + (c / maxCount.value) * 28
const cloudOp = (c: number) => 0.35 + (c / maxCount.value) * 0.65

function badge(p: any) {
  if (p.type === 'quiz') return '🎯'
  if (p.type === 'wordcloud') return '☁️'
  return '☑️'
}
</script>

<style scoped>
.slidev-poll-presenter {
  font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif;
  background: rgba(0, 41, 87, 0.92);
  border-radius: 12px;
  color: #e2e0dc;
  border: 1px solid rgba(194, 154, 91, 0.25);
  overflow: hidden;
  max-width: 900px;
  margin: 0 auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}
.slidev-poll-presenter.compact { max-height: 380px; }

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
.poll-dot { width: 9px; height: 9px; border-radius: 50%; }
.poll-dot.on { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.poll-dot.off { background: #f1563f; }

.poll-offline { padding: 0.6rem 1rem; font-size: 0.82rem; color: #e8c87a; background: rgba(232, 200, 122, 0.08); }

.poll-selector { display: flex; gap: 0.3rem; padding: 0.5rem 1rem; overflow-x: auto; border-bottom: 1px solid rgba(194, 154, 91, 0.1); }
.poll-tab {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.35rem 0.7rem; border: none; border-radius: 6px; cursor: pointer;
  font-size: 0.78rem; background: rgba(255,255,255,0.04); color: #b2bfcd; white-space: nowrap;
}
.poll-tab:hover { background: rgba(194,154,91,0.12); }
.poll-tab.active { background: rgba(194,154,91,0.18); color: #f8f6f0; }
.tab-q { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.tab-badge { font-size: 0.65rem; padding: 0.08rem 0.3rem; border-radius: 4px; }
.state-voting { background: #166534; color: #86efac; }
.state-closed { background: #1e3a5f; color: #a8bdd0; }
.state-idle { background: #2a2320; color: #b2bfcd; }

.poll-body { padding: 0.9rem 1.1rem; }

/* Word cloud */
.wordcloud { min-height: 60px; }
.cloud-wrap { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 0.4rem 0.7rem; padding: 0.4rem; }
.cloud-word { font-weight: 600; text-shadow: 0 0 10px rgba(194,154,91,0.3); transition: font-size 0.4s ease; user-select: none; }

/* Options */
.options { display: flex; flex-direction: column; gap: 0.45rem; }
.opt-row { display: flex; align-items: center; gap: 0.6rem; }
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
.controls { display: flex; gap: 0.4rem; align-items: center; padding-top: 0.7rem; margin-top: 0.6rem; border-top: 1px solid rgba(194,154,91,0.12); }
.ctrl-btn { padding: 0.3rem 0.7rem; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8rem; font-weight: 700; white-space: nowrap; transition: opacity 0.2s; }
.ctrl-btn:hover:not(:disabled) { opacity: 0.85; }
.ctrl-btn.success { background: #16a34a; color: #fff; }
.ctrl-btn.danger { background: #dc2626; color: #fff; }
.ctrl-btn.reveal { background: #7c3aed; color: #fff; }
.ctrl-btn.ghost { background: rgba(255,255,255,0.06); color: #a8bdd0; }

.empty { text-align: center; color: #6b7f97; font-size: 0.85rem; padding: 1rem; }
.empty-state { padding: 1.5rem; text-align: center; color: #6b7f97; font-size: 0.9rem; }
</style>
