/**
 * Poll State Module — module-level singleton for Slidev poll system
 *
 * Architecture:
 * - WebSocket connection lives at module level (survives component mount/unmount)
 * - Shared reactive refs are module-level
 * - Token = configs.remote (Slidev --remote=<password>), never passed via slides
 * - <Poll> components self-register at setup time; IDs computed from slide + question index
 * - global-bottom.vue calls ensurePresenterWs() after slides finish rendering
 */
import { ref } from "vue";
import configs from "#slidev/configs";
import type { ActivePollMap, ClientMessage, Poll, ServerMessage } from "../types";

// ==================== Shared reactive state ==================================
export const connected = ref(false);
export const polls = ref<Poll[]>([]);
export const activeBySlide = ref<ActivePollMap>({});
export const audienceCount = ref(0);

// ==================== Poll registry ==========================================

const registeredPolls = new Map<string, Poll>();

/**
 * Reactive ref of locally-registered polls — useful for audience components
 * to display questions immediately before the WS round-trip completes.
 */
export const registeredPollsRef = ref<Poll[]>([]);

/**
 * Register a poll declared by a <Poll> component.
 * Called at component setup time (including during overview where all slides render).
 */
export function registerPoll(poll: Poll): void {
  registeredPolls.set(poll.id, poll);
  // Keep reactive ref in sync so audience can read definitions immediately
  registeredPollsRef.value = getRegisteredPolls();
}

function getRegisteredPolls(): Poll[] {
  return Array.from(registeredPolls.values()).sort((a, b) => {
    if (a.slideIndex !== b.slideIndex) return a.slideIndex - b.slideIndex;
    return a.id.localeCompare(b.id);
  });
}

// ==================== Token ==================================================

function getToken(): string {
  // configs.remote is the Slidev presenter password (--remote=<password>).
  // It's a string when set with a password, true/false/undefined otherwise.
  const r = configs.remote;
  return typeof r === "string" && r.length > 0 ? r : "changeme";
}

// ==================== Presenter WS (module-level singleton) ==================

let presenterWs: WebSocket | null = null;
let presenterInited = false;

function sendPollsDefine() {
  const registered = getRegisteredPolls();
  if (!registered.length) return;
  sendToServer({
    type: "polls_define",
    polls: registered.map((p) => ({
      ...p,
      votes: new Array((p.options ?? []).length).fill(0) as number[],
      state: "idle" as const,
      revealed: false,
      wordCounts: {},
    })),
  });
}

function handlePresenterMsg(msg: ServerMessage) {
  switch (msg.type) {
    case "presenter_authenticated":
      polls.value = msg.polls;
      activeBySlide.value = { ...msg.activePolls };
      connected.value = true;
      // Send our poll definitions now that we're authenticated
      sendPollsDefine();
      break;

    case "poll_state":
    case "slide_change":
      polls.value = msg.polls;
      activeBySlide.value = { ...msg.activePolls };
      connected.value = true;
      break;

    case "audience_state":
      audienceCount.value = msg.audienceCount;
      break;

    case "audience_welcomed":
      // Not expected on presenter socket
      break;
  }
}

function connectPresenter() {
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof location !== "undefined" ? location.host : "localhost:3031";
  presenterWs = new WebSocket(`${proto}//${host}/polls`);

  presenterWs.onopen = () => {
    presenterWs?.send(JSON.stringify({ type: "presenter_connect", token: getToken() }));
    // Pre-populate local state immediately so the UI renders before the WS round-trip
    const registered = getRegisteredPolls();
    if (registered.length && !polls.value.length) {
      polls.value = registered.map((p) => ({
        ...p,
        votes: new Array((p.options ?? []).length).fill(0) as number[],
        state: "idle" as const,
        revealed: false,
        wordCounts: {},
      }));
    }
  };
  presenterWs.onmessage = (evt: MessageEvent<string>) => {
    try {
      handlePresenterMsg(JSON.parse(evt.data) as ServerMessage);
    } catch {}
  };
  presenterWs.onclose = () => {
    connected.value = false;
    setTimeout(connectPresenter, 3000);
  };
}

/**
 * Initialize presenter WebSocket. Safe to call multiple times — only connects once.
 * Call this from global-bottom.vue (presenter mode) after slides have rendered.
 */
export function ensurePresenterWs() {
  if (presenterInited) {
    // Already connected — re-define polls if socket is open (e.g. hot-reload)
    if (presenterWs?.readyState === WebSocket.OPEN) {
      sendPollsDefine();
    }
    return;
  }
  presenterInited = true;
  connectPresenter();
}

/**
 * Send a typed message through the presenter WS.
 */
export function sendToServer(msg: ClientMessage) {
  if (presenterWs?.readyState === WebSocket.OPEN) {
    presenterWs.send(JSON.stringify(msg));
  } else {
    console.warn("[polls] presenter WS not ready, dropping:", msg.type);
  }
}

// ==================== Audience WS (per-viewer instance) =====================

export function createAudienceWs(onMsg: (msg: ServerMessage) => void): WebSocket {
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof location !== "undefined" ? location.host : "localhost:3031";
  const ws = new WebSocket(`${proto}//${host}/polls`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "audience_join" }));
  };
  ws.onmessage = (evt: MessageEvent<string>) => {
    try {
      onMsg(JSON.parse(evt.data) as ServerMessage);
    } catch {}
  };
  ws.onclose = () => {
    setTimeout(() => createAudienceWs(onMsg), 3000);
  };
  return ws;
}
