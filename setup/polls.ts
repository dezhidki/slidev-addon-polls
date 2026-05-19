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

// ==================== Shared presenter-side reactive state ===================
export const connected = ref(false);
export const polls = ref<any[]>([]);
export const activeBySlide = ref<Record<string, string>>({});
export const audienceCount = ref(0);

// ==================== presenter WS (module-level singleton) =================
let presenterWs: WebSocket | null = null;
let presenterInited = false;
let presenterToken = "";
let pendingPolls: any[] = [];

function onPresenterMsg(evt: MessageEvent) {
  try {
    const msg = JSON.parse(evt.data as string);
    handlePresenterMsg(msg);
  } catch {}
}

function handlePresenterMsg(msg: any) {
  switch (msg.type) {
    case "presenter_authenticated":
      polls.value = msg.polls || [];
      if (msg.activePolls) activeBySlide.value = { ...msg.activePolls };
      connected.value = true;
      // Send pending poll definitions after auth completes
      if (presenterWs && pendingPolls.length) {
        presenterWs.send(
          JSON.stringify({
            type: "polls_define",
            polls: pendingPolls.map((p: any) => ({
              ...p,
              votes: new Array((p.options || []).length).fill(0),
              state: "idle",
              revealed: false,
            })),
          }),
        );
        pendingPolls = [];
      }
      break;

    case "poll_state":
      polls.value = msg.polls || [];
      if (msg.activePolls) activeBySlide.value = { ...msg.activePolls };
      connected.value = true;
      break;

    case "slide_change":
      polls.value = msg.polls || [];
      if (msg.activePolls) activeBySlide.value = { ...msg.activePolls };
      connected.value = true;
      break;

    case "audience_state":
      audienceCount.value = msg.audienceCount || 0;
      break;
  }
}

/**
 * Initialize presenter WebSocket connection (singleton).
 * Safe to call multiple times — only connects once.
 */
export function ensurePresenterWs(token: string, pollsToDefine: any[] = []) {
  presenterToken = token;
  pendingPolls = pollsToDefine;

  // Pre-populate polls from headmatter immediately so UI renders before WS auth
  if (pollsToDefine.length && !polls.value.length) {
    polls.value = pollsToDefine.map((p: any) => ({
      ...p,
      votes: new Array((p.options || []).length).fill(0),
      state: "idle",
      revealed: false,
      wordCounts: {},
    }));
  }

  if (presenterInited) {
    // Already connected — send polls immediately if socket is open
    if (presenterWs?.readyState === WebSocket.OPEN && pendingPolls.length) {
      presenterWs.send(
        JSON.stringify({
          type: "polls_define",
          polls: pendingPolls.map((p: any) => ({
            ...p,
            votes: new Array((p.options || []).length).fill(0),
            state: "idle",
            revealed: false,
          })),
        }),
      );
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
 * Send a message through the presenter WS.
 */
export function sendToServer(msg: any) {
  if (presenterWs?.readyState === WebSocket.OPEN) {
    presenterWs.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  } else {
    console.warn("[polls] presenter WS not ready, dropping:", msg.type);
  }
}

// ==================== audience WS (per-viewer) ===================

export function createAudienceWs(onMsg: (msg: any) => void): WebSocket {
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof location !== "undefined" ? location.host : "localhost:3031";
  const ws = new WebSocket(`${proto}//${host}/polls`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "audience_join" }));
  };
  ws.onmessage = (evt) => {
    try {
      onMsg(JSON.parse(evt.data));
    } catch {}
  };
  ws.onclose = () => {
    // Auto-reconnect with backoff
    setTimeout(() => createAudienceWs(onMsg), 3000);
  };
  return ws;
}
