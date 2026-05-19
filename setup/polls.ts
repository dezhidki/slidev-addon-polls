/**
 * Poll State Module — module-level singleton for Slidev poll system
 *
 * Architecture:
 * - WebSocket connection lives at module level (survives component mount/unmount)
 * - Shared reactive refs are module-level
 * - PollServer.vue is just a declarative config wrapper (presenter side)
 * - PollPresenter.vue reads from module-level state directly
 * - PollAudience.vue creates its own independent WS (audience side)
 */
import { ref } from "vue";
import type { ActivePollMap, ClientMessage, Poll, ServerMessage } from "../types";

// ==================== Shared presenter-side reactive state ===================
export const connected = ref(false);
export const polls = ref<Poll[]>([]);
export const activeBySlide = ref<ActivePollMap>({});
export const audienceCount = ref(0);

// ==================== presenter WS (module-level singleton) =================
let presenterWs: WebSocket | null = null;
let presenterInited = false;
let presenterToken = "";
let pendingPolls: Poll[] = [];

function onPresenterMsg(evt: MessageEvent<string>) {
  try {
    const msg = JSON.parse(evt.data) as ServerMessage;
    handlePresenterMsg(msg);
  } catch {}
}

function handlePresenterMsg(msg: ServerMessage) {
  switch (msg.type) {
    case "presenter_authenticated":
      polls.value = msg.polls;
      activeBySlide.value = { ...msg.activePolls };
      connected.value = true;
      // Send pending poll definitions after auth completes
      if (presenterWs && pendingPolls.length) {
        sendToServer({
          type: "polls_define",
          polls: pendingPolls.map((p) => ({
            ...p,
            votes: new Array((p.options ?? []).length).fill(0) as number[],
            state: "idle" as const,
            revealed: false,
          })),
        });
        pendingPolls = [];
      }
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
      // Not expected on presenter socket but handled gracefully
      break;
  }
}

/**
 * Initialize presenter WebSocket connection (singleton).
 * Safe to call multiple times — only connects once.
 */
export function ensurePresenterWs(token: string, pollsToDefine: Poll[] = []) {
  presenterToken = token;
  pendingPolls = pollsToDefine;

  // Pre-populate polls from headmatter immediately so UI renders before WS auth
  if (pollsToDefine.length && !polls.value.length) {
    polls.value = pollsToDefine.map((p) => ({
      ...p,
      votes: new Array((p.options ?? []).length).fill(0) as number[],
      state: "idle" as const,
      revealed: false,
      wordCounts: {},
    }));
  }

  if (presenterInited) {
    // Already connected — send polls immediately if socket is open
    if (presenterWs?.readyState === WebSocket.OPEN && pendingPolls.length) {
      sendToServer({
        type: "polls_define",
        polls: pendingPolls.map((p) => ({
          ...p,
          votes: new Array((p.options ?? []).length).fill(0) as number[],
          state: "idle" as const,
          revealed: false,
        })),
      });
      pendingPolls = [];
    }
    return;
  }
  presenterInited = true;
  connectPresenter();
}

function connectPresenter() {
  const safeToken = presenterToken || "changeme";
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof location !== "undefined" ? location.host : "localhost:3031";
  presenterWs = new WebSocket(`${proto}//${host}/polls`);

  presenterWs.onopen = () => {
    presenterWs?.send(JSON.stringify({ type: "presenter_connect", token: safeToken }));
  };
  presenterWs.onmessage = onPresenterMsg;
  presenterWs.onclose = () => {
    connected.value = false;
    setTimeout(connectPresenter, 3000);
  };
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

// ==================== audience WS (per-viewer) ===================

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
