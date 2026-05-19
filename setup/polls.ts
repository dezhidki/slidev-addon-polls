/**
 * usePolls — Composable for Slidev poll WebSocket
 * Real-time state for presenter + audience view
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

const VOTE_URL = typeof window !== 'undefined'
  ? `${window.location.origin}/vote.html`
  : 'http://localhost:3030/vote.html'

export function usePolls(options = {}) {
  const { token = '', slides = [], urlPath = '/polls', autoConnect = true } = options

  let ws = null
  const connected = ref(false)
  const totalAudience = ref(0)
  const error = ref(null)

  // Normalized poll state
  const polls = ref([])
  const currentId = ref(null)

  // Is this the presenter view?
  const isPresenter = typeof window !== 'undefined' && window.location.pathname.includes('/presenter')

  const activePoll = computed(() => polls.value.find(p => p.id === currentId.value) || null)
  const activeVotes = computed(() => activePoll.value?.votes || [])
  const activeTotal = computed(() => activeVotes.value.reduce((a, b) => a + (b || 0), 0))

  function getPct(i) {
    if (!activeTotal.value) return 0
    return Math.round((activeVotes.value[i] || 0) / activeTotal.value * 100)
  }

  function isLeading(i) {
    if (!activeVotes.value.length) return false
    const max = Math.max(...activeVotes.value)
    return max > 0 && activeVotes.value[i] === max
  }

  // WebSocket helpers
  function send(msg) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  function connect() {
    if (!autoConnect) return
    error.value = null
    const url = `${location.protocol === 'https:' ? 'wss://' : 'ws://'}${location.host}${urlPath}`

    try { ws = new WebSocket(url) } catch (e) { ws = null; error.value = e.message; return }

    ws.onopen = () => {
      if (isPresenter && token) {
        ws.send(JSON.stringify({ type: 'presenter_connect', token }))
      } else {
        ws.send(JSON.stringify({ type: 'audience_join' }))
      }
      // Upsert all slide-defined polls
      if (isPresenter && slides.length) {
        setTimeout(() => slides.forEach(p => send({ type: 'upsert_poll', poll: p })), 300)
      }
    }

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'presenter_authenticated') connected.value = true
      if (msg.type === 'audience_welcomed') connected.value = true
      if (msg.type === 'poll_state') {
        connected.value = true
        polls.value = msg.polls || []
        if (!currentId.value && polls.value.length) currentId.value = polls.value[0].id
      }
      if (msg.type === 'audience_state') {
        polls.value = msg.polls || []
        totalAudience.value = msg.audienceCount || 0
      }
    }

    ws.onclose = () => { connected.value = false; setTimeout(connect, 3000) }
    ws.onerror = () => { ws?.close() }
  }

  // Presenter actions
  function selectPoll(id) { currentId.value = id }
  function toggleVoting() {
    if (!activePoll.value) return
    const isOpen = activePoll.value.state === 'voting'
    send({ type: isOpen ? 'close_poll' : 'start_poll', pollId: activePoll.value.id })
  }
  function revealAnswer() {
    if (activePoll.value?.type === 'quiz')
      send({ type: 'reveal_answer', pollId: activePoll.value.id })
  }
  function resetPolls() {
    send({ type: 'reset_polls' })
    currentId.value = null
  }

  onMounted(() => connect())
  onUnmounted(() => { if (ws) { ws.close(); ws = null } })

  return {
    connected, totalAudience, error,
    polls, currentId, activePoll,
    activeVotes, activeTotal,
    isPresenter,
    getPct, isLeading,
    selectPoll, toggleVoting, revealAnswer, resetPolls,
    voteUrl: VOTE_URL,
  }
}
