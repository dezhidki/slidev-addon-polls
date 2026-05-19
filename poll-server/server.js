/**
 * Slidev Poll Server — WebSocket backend for live polls
 *
 * Usage: node server.js [PORT] [TOKEN]
 * Default port: PORT env or 3031
 * Default token: 'changeme' (override with TOKEN env)
 */
const { WebSocketServer, WebSocket } = require('ws')

const PORT = parseInt(process.argv[2] || process.env.PORT || '3031')
const PRESENTER_TOKEN = process.env.TOKEN || 'changeme'

// Minimal hash for obscuring audience WS path per session
const SESSION_HASH = Math.random().toString(36).slice(2, 8)
console.log(`[Info] Poll server session hash: ${SESSION_HASH}`)

// State
const polls = new Map()        // id -> poll object
let currentPollId = null
const presenterClients = new Set()
const audienceClients = new Set()

const wss = new WebSocketServer({ port: PORT, path: '/polls' })

function serializePoll(p) {
  return {
    id: p.id,
    question: p.question,
    type: p.type || 'choice',
    options: p.options,
    state: p.state,
    votes: p.votes,
    totalVotes: p.votes.reduce((a, b) => a + b, 0),
    wordCounts: p.wordCounts || {},
    correctAnswer: p.correctAnswer,
    revealed: p.revealed || false
  }
}

function broadcast(data, targets = null) {
  const msg = JSON.stringify(data)
  ;(targets || wss.clients).forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg)
  })
}

function broadcastPollState() {
  broadcast({
    type: 'poll_state',
    polls: Array.from(polls.values()).map(serializePoll)
  })
}

function broadcastAudience(all = true) {
  // Only visible polls to audience (skip idle pre-defined polls)
  const visible = Array.from(polls.values()).filter(p => p.state !== 'idle')
  const data = {
    type: 'audience_state',
    polls: visible.map(serializePoll),
    audienceCount: audienceClients.size,
    sessionHash: SESSION_HASH
  }
  broadcast(data, audienceClients)
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
  console.log(`[WS] Connected ${ip}`)

  ws.isPresenter = false
  ws.hasVoted = new Set()

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    // ── Presenter auth ────────────────────
    if (msg.type === 'presenter_connect') {
      if (msg.token !== PRESENTER_TOKEN) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }))
        ws.close(1008)
        return
      }
      ws.isPresenter = true
      presenterClients.add(ws)
      ws.send(JSON.stringify({ type: 'presenter_authenticated' }))
      broadcastPollState()
      console.log('[WS] Presenter authenticated')
      return
    }

    // ── Upsert (pre-defined from slides) ──
    if (msg.type === 'upsert_poll' && ws.isPresenter) {
      const p = msg.poll
      if (!p?.id) return
      const existing = polls.get(p.id)
      if (!existing) {
        polls.set(p.id, {
          id: p.id,
          question: p.question || 'Untitled',
          type: p.type || 'choice',
          options: p.options || [],
          state: 'idle',
          votes: (p.type === 'wordcloud') ? [] : (p.options || []).map(() => 0),
          wordCounts: {},
          correctAnswer: p.correctAnswer,
          revealed: false
        })
        if (!currentPollId) currentPollId = p.id
      } else {
        existing.question = p.question ?? existing.question
        existing.type = p.type ?? existing.type
        existing.options = p.options ?? existing.options
        existing.correctAnswer = p.correctAnswer !== undefined ? p.correctAnswer : existing.correctAnswer
      }
      broadcastPollState()
      broadcastAudience()
      console.log(`[WS] Upserted ${p.id} (${p.type})`)
      return
    }

    // ── Start / Close ─────────────────────
    if (msg.type === 'start_poll' && ws.isPresenter) {
      const p = polls.get(msg.pollId)
      if (p) { p.state = 'voting'; currentPollId = msg.pollId; broadcastPollState(); broadcastAudience(); }
      return
    }
    if (msg.type === 'close_poll' && ws.isPresenter) {
      const p = polls.get(msg.pollId)
      if (p) { p.state = 'closed'; broadcastPollState(); broadcastAudience(); }
      return
    }

    // ── Reveal answer (quiz) ──────────────
    if (msg.type === 'reveal_answer' && ws.isPresenter) {
      const p = polls.get(msg.pollId)
      if (p && p.type === 'quiz') { p.revealed = true; broadcastPollState(); broadcastAudience(); }
      return
    }

    // ── Reset ─────────────────────────────
    if (msg.type === 'reset_polls' && ws.isPresenter) {
      polls.clear()
      currentPollId = null
      audienceClients.forEach(c => c.hasVoted = new Set())
      broadcastPollState()
      broadcastAudience()
      return
    }

    // ── Audience join ─────────────────────
    if (msg.type === 'audience_join') {
      audienceClients.add(ws)
      broadcastAudience()
      ws.send(JSON.stringify({
        type: 'audience_welcomed',
        polls: Array.from(polls.values())
          .filter(p => p.state !== 'idle')
          .map(serializePoll)
      }))
      return
    }

    // ── Audience vote ─────────────────────
    if (msg.type === 'audience_vote') {
      const { pollId, optionIndex } = msg
      const p = polls.get(pollId)
      if (!p || !['choice','quiz'].includes(p.type)) return
      if (p.state !== 'voting') { ws.send(JSON.stringify({ type: 'error', message: 'Not voting' })); return }
      if (ws.hasVoted.has(pollId)) { ws.send(JSON.stringify({ type: 'error', message: 'Already voted' })); return }
      if (optionIndex < 0 || optionIndex >= p.options.length) return
      ws.hasVoted.add(pollId)
      p.votes[optionIndex]++
      broadcastPollState()
      broadcastAudience()
      ws.send(JSON.stringify({ type: 'vote_acknowledged' }))
      return
    }

    // ── Audience word cloud ───────────────
    if (msg.type === 'audience_word') {
      const { pollId, text } = msg
      const p = polls.get(pollId)
      if (!p || p.type !== 'wordcloud') return
      if (p.state !== 'voting') return
      const word = (text || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40)
      if (!word) return
      p.wordCounts[word] = (p.wordCounts[word] || 0) + 1
      ws.hasVoted.add(pollId)
      broadcastPollState()
      broadcastAudience()
      ws.send(JSON.stringify({ type: 'vote_acknowledged' }))
      return
    }
  })

  ws.on('close', () => {
    if (ws.isPresenter) presenterClients.delete(ws)
    audienceClients.delete(ws)
    broadcastAudience()
    console.log('[WS] Disconnected')
  })
})

console.log(`Poll server running on ws://localhost:${PORT}/polls`)
console.log(`Presenter token: ${PRESENTER_TOKEN.slice(0,3)}***`)
