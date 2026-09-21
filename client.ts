// One WebSocket per browser tab, shared by every <Poll> on every slide.
import { reactive } from "vue";
import configs from "#slidev/configs";

export interface PollDef {
  id: string;
  slide: number;
  question: string;
  options?: string[];
  correct?: number;
}

export interface PollState {
  state: "idle" | "open" | "closed";
  revealed: boolean;
  total: number;
  /** null while an open quiz keeps its distribution from the room */
  votes: number[] | null;
  words: [word: string, count: number][];
}

export const polls = reactive({
  connected: false,
  denied: false,
  audience: 0,
  joinUrl: "",
  byId: {} as Record<string, PollState>,
  /** reactions on the presenter's current slide so far, e.g. { "👍": 12 } */
  tally: {} as Record<string, number>,
});

/** Set by global-top.vue: called with each burst of reactions, e.g. { "❤️": 3 }. */
export const reactionListener: { on?: (burst: Record<string, number>) => void } = {};

const defs = new Map<string, PollDef>();
const shown = new Map<string, number>(); // poll id → how many instances are on screen
let ws: WebSocket | undefined;
let presenter = false;
let slide = 0;
let reactions: string[] = [];
let cooldown: number | undefined; // seconds between one person's reactions; undefined = server default
let slideQueued = false;

export function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Tells the phones what this screen shows: the slide, the polls mounted on it, and the
// reactions it accepts. Queued, so a slide mounting three polls says it once.
function sendSlide() {
  if (slideQueued || !presenter) return;
  slideQueued = true;
  queueMicrotask(() => {
    slideQueued = false;
    const ids = [...shown.keys()].filter((id) => defs.get(id)?.slide === slide);
    send({ type: "slide", slide, ids, reactions, cooldown });
  });
}

function hello() {
  const token = typeof configs.remote === "string" ? configs.remote : undefined;
  send({ type: "hello", role: presenter ? "presenter" : "display", token });
  if (!presenter) return;
  for (const poll of defs.values()) send({ type: "define", poll });
  sendSlide();
}

function open() {
  const url = new URL(`${import.meta.env.BASE_URL}polls`, location.href.replace(/^http/, "ws"));
  ws = new WebSocket(url);
  ws.onopen = hello;
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "denied") polls.denied = true;
    if (msg.type === "reactions") reactionListener.on?.(msg.burst);
    if (msg.type === "reactions" || msg.type === "state") polls.tally = msg.tally ?? {};
    if (msg.type !== "state") return;
    polls.connected = true;
    polls.audience = msg.audience;
    polls.joinUrl = msg.joinUrl ?? "";
    polls.byId = Object.fromEntries(msg.polls.map((p: PollState & { id: string }) => [p.id, p]));
  };
  ws.onclose = () => {
    polls.connected = false;
    setTimeout(open, 2000);
  };
}

/** Called by global-bottom.vue whenever the mode, the slide or its reactions change. */
export function sync(
  asPresenter: boolean,
  currentSlide: number,
  allowedReactions: string[],
  reactionCooldown?: number,
) {
  const roleChanged = asPresenter !== presenter;
  presenter = asPresenter;
  slide = currentSlide;
  reactions = allowedReactions;
  cooldown = reactionCooldown;
  if (!ws) open();
  else if (roleChanged) hello();
  else sendSlide();
}

/** Called by each <Poll> as it is set up; only a presenter's definitions reach the server. */
export function definePoll(def: PollDef) {
  defs.set(def.id, def);
  if (presenter) send({ type: "define", poll: def });
}

/**
 * A poll has come on screen, so phones should show it. Returns the function to call when
 * it leaves again (slide unmounted, or a <PollSet> moved on to its next question).
 */
export function showPoll(id: string) {
  shown.set(id, (shown.get(id) ?? 0) + 1);
  sendSlide();
  return () => {
    const left = (shown.get(id) ?? 1) - 1;
    if (left) shown.set(id, left);
    else shown.delete(id);
    sendSlide();
  };
}
