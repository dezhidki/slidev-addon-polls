// The whole poll backend: one WebSocket endpoint at <base>/polls, all state in memory.
// Plain ESM so it runs both inside Slidev's dev server (setup/vite-plugins.ts) and on
// its own (standalone.js).
import { WebSocketServer } from "ws";

const PRESENTER_ONLY = new Set(["define", "slide", "open", "close", "reveal", "reset", "remove"]);
const MAX_WORDS = 500; // distinct words per cloud
const DEFAULT_COOLDOWN = 3; // seconds between two reactions from one person
const MIN_GAP = 200; // ms: the floor, however low a deck sets its cooldown
const LENIENCY = 300; // ms: a phone that waited out its cooldown must not lose to network jitter
const REACTION_FLUSH = 150; // ms: reactions reach the screens in bursts, not one by one

/**
 * @param {import("node:http").Server} httpServer
 * @param {{ token?: string, joinUrl?: () => string | undefined }} [options]
 *   token: presenters must send it (Slidev's --remote password); unset = anyone may present
 */
export function attachPolls(httpServer, { token, joinUrl } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const polls = new Map(); // id → poll, never deleted: a poll's answers outlive edits
  // What the presenter's screen shows right now. Phones follow this, not `polls`, so a
  // poll that was renamed, removed or registered by a stale tab can never reach them.
  let slide = 0;
  let visible = []; // poll ids mounted on that slide
  let reactions = []; // emoji the audience may send on that slide
  let cooldown = DEFAULT_COOLDOWN * 1000; // ms between two reactions from one person
  const lastReaction = new Map(); // voter id → time: reloading the page doesn't reset it
  const tally = new Map(); // slide → { emoji: count }
  let burst = {};
  let timer = null;
  let burstTimer = null;

  httpServer.on("upgrade", (req, socket, head) => {
    // Anything else (Vite's HMR socket) is someone else's.
    if (!new URL(req.url, "http://x").pathname.endsWith("/polls")) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  const handlers = {
    hello(ws, { role, token: given, voter }) {
      if (role === "presenter" && token && given !== token) {
        ws.send(JSON.stringify({ type: "denied" }));
        role = "display";
      }
      ws.role = role === "presenter" || role === "display" ? role : "audience";
      ws.voter = typeof voter === "string" ? voter.slice(0, 64) : "";
    },

    // Re-defining an unchanged poll keeps its votes: Slidev re-mounts slides all the time.
    // Polls that were renamed or removed stay in the map, harmlessly: phones only show
    // what `visible` lists. ponytail: they are freed on restart; evict if decks get huge.
    define(_ws, { poll: d }) {
      if (typeof d?.id !== "string" || typeof d.question !== "string") return;
      const options = Array.isArray(d.options) ? d.options.map(String) : null;
      const correct = options && Number.isInteger(d.correct) ? d.correct : null;
      const def = JSON.stringify([d.question, options, correct]);
      const onSlide = Number(d.slide) || 0;
      const old = polls.get(d.id);
      if (old?.def === def) {
        old.slide = onSlide;
        return;
      }
      // Keep counting rounds so phones drop the answer they remember for the old version.
      const { id, question } = d;
      polls.set(id, { id, slide: onSlide, def, question, options, correct, round: old?.round });
      handlers.reset(null, { id });
    },

    slide(_ws, msg) {
      const strings = (list, max) =>
        (Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && x.length <= max);
      slide = Number(msg.slide) || 0;
      visible = strings(msg.ids, 300).slice(0, 50);
      reactions = strings(msg.reactions, 16).slice(0, 8);
      const seconds = Number(msg.cooldown ?? DEFAULT_COOLDOWN);
      cooldown =
        (Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), 3600) : DEFAULT_COOLDOWN) * 1000;
    },
    open: (_ws, { id }) => set(id, { state: "open", revealed: false }),
    close: (_ws, { id }) => set(id, { state: "closed" }),
    reveal: (_ws, { id }) => set(id, { state: "closed", revealed: true }),
    reset: (_ws, { id }) =>
      set(id, {
        state: "idle",
        revealed: false,
        // Starts from the clock so a restarted server never reuses a round that phones remember.
        round: (polls.get(id)?.round ?? Date.now()) + 1,
        votes: polls.get(id)?.options?.map(() => 0) ?? null,
        words: new Map(),
        banned: new Set(),
        voters: new Set(),
      }),

    // Moderation: the word goes, stays gone, and its senders don't get another try.
    remove(_ws, { id, word }) {
      const p = polls.get(id);
      if (p?.words.delete(word)) p.banned.add(word);
    },

    vote(ws, { id, option }) {
      const p = polls.get(id);
      if (!p?.options || !Number.isInteger(option) || option < 0 || option >= p.options.length)
        return;
      if (claim(ws, p)) p.votes[option]++;
    },

    // Only emoji the presenter's slide allows, so nobody can put text on the big screen.
    // Deliberately not followed by a state broadcast (returns false): a hall hammering
    // the heart button must not make the server re-send every poll to every phone.
    react(ws, { emoji }) {
      const now = Date.now();
      const who = ws.voter || ws;
      const tooSoon = now - (lastReaction.get(who) ?? 0) < Math.max(cooldown - LENIENCY, MIN_GAP);
      if (!reactions.includes(emoji) || tooSoon) return false;
      lastReaction.set(who, now);
      const counts = tally.get(slide) ?? {};
      counts[emoji] = (counts[emoji] ?? 0) + 1;
      tally.set(slide, counts);
      burst[emoji] = (burst[emoji] ?? 0) + 1;
      burstTimer ??= setTimeout(() => {
        burstTimer = null;
        const msg = JSON.stringify({ type: "reactions", burst, tally: tally.get(slide) });
        burst = {};
        for (const c of wss.clients)
          if (c.readyState === c.OPEN && (c.role === "presenter" || c.role === "display"))
            c.send(msg);
      }, REACTION_FLUSH);
      return false;
    },

    word(ws, { id, text }) {
      const p = polls.get(id);
      if (!p || p.options || typeof text !== "string") return;
      const word = text.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 40);
      if (!word || (!p.words.has(word) && p.words.size >= MAX_WORDS)) return;
      if (claim(ws, p) && !p.banned.has(word)) p.words.set(word, (p.words.get(word) ?? 0) + 1);
    },
  };

  function set(id, patch) {
    const p = polls.get(id);
    if (p) Object.assign(p, patch);
  }

  // One answer per voter id per round. The id lives in the phone's localStorage.
  function claim(ws, p) {
    if (p.state !== "open" || !ws.voter || p.voters.has(ws.voter)) return false;
    p.voters.add(ws.voter);
    return true;
  }

  // While voting is open only presenters see a quiz's distribution and a cloud's words
  // (so they can weed it before the room sees it), and only they ever get the answer key
  // before it is revealed.
  function view(p, full) {
    const quiz = p.correct !== null;
    return {
      id: p.id,
      slide: p.slide,
      question: p.question,
      options: p.options,
      quiz,
      state: p.state,
      revealed: p.revealed,
      round: p.round,
      total: p.voters.size,
      votes: full || !(quiz && p.state === "open") ? p.votes : null,
      words: full || p.state !== "open" ? [...p.words] : [],
      correct: full || p.revealed ? p.correct : null,
    };
  }

  // Coalesced: a burst of 300 votes becomes a handful of broadcasts, not 300 × 300 messages.
  function broadcast() {
    timer ??= setTimeout(() => {
      timer = null;
      const clients = [...wss.clients].filter((ws) => ws.role && ws.readyState === ws.OPEN);
      const base = {
        type: "state",
        slide,
        visible,
        reactions,
        cooldown,
        tally: tally.get(slide) ?? {},
        audience: clients.filter((ws) => ws.role === "audience").length,
        joinUrl: joinUrl?.(),
      };
      const list = [...polls.values()];
      const full = JSON.stringify({ ...base, polls: list.map((p) => view(p, true)) });
      const pub = JSON.stringify({ ...base, polls: list.map((p) => view(p, false)) });
      for (const ws of clients) ws.send(ws.role === "presenter" ? full : pub);
    }, 50);
  }

  wss.on("connection", (ws) => {
    ws.on("error", () => {}); // a dropped phone is not an emergency
    ws.on("close", broadcast);
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const handler = Object.hasOwn(handlers, msg?.type) && handlers[msg.type];
      if (!handler || (msg.type !== "hello" && !ws.role)) return;
      if (PRESENTER_ONLY.has(msg.type) && ws.role !== "presenter") return;
      if (handler(ws, msg) !== false) broadcast();
    });
  });

  return wss;
}
