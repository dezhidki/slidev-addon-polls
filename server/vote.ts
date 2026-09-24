/**
 * The phones' side of the poll protocol: the page the audience opens at `<base>/vote`.
 *
 * Alpine drives the DOM from `vote.html`, so everything here is state and messages. The
 * page is built into one self-contained file by `scripts/build-vote.mjs` — no CDN, no
 * second request — because the phones are on the venue's wifi, not necessarily on the
 * internet.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import Alpine from "alpinejs";
import {
  type ClientMessage,
  DEFAULT_COOLDOWN,
  type PollView,
  parseServerMessage,
  type ServerMessage,
  type WordCount,
} from "../protocol.ts";

type StateMessage = Extract<ServerMessage, { type: "state" }>;

/** Milliseconds before a lost connection is tried again. */
const RETRY_MS = 2000;

/** What this phone has answered, so a reload still marks it. */
interface Answer {
  /** The poll's round when it was answered; a reset bumps the round and frees the phone. */
  round: number;
  answer: number | string;
}

// localStorage can throw (private mode, blocked cookies). Everything kept in it is read
// once at startup and held in memory after that, so a phone that cannot use it simply
// forgets on reload.
function load<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do about it, and nothing depends on it.
  }
}

/** This phone's id. The server counts one answer per id per round, not per connection. */
function voterId(): string {
  const saved = load<string>("poll-voter");
  if (saved) {
    return saved;
  }
  const fresh = Math.random().toString(36).slice(2) + Date.now().toString(36);
  save("poll-voter", fresh);
  return fresh;
}

function emptyState(): StateMessage {
  return {
    type: "state",
    slide: 0,
    visible: [],
    reactions: [],
    cooldown: DEFAULT_COOLDOWN * 1000,
    tally: {},
    audience: 0,
    polls: [],
  };
}

const voter = voterId();
/** The word being typed for each poll, so a classmate's vote arriving doesn't wipe it. */
const drafts: Record<string, string> = {};
let socket: WebSocket | undefined;
let coolTimer: ReturnType<typeof setTimeout> | undefined;

/** Sends one message, and says whether it went. Nothing is queued while offline. */
function send(msg: ClientMessage): boolean {
  if (socket?.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(msg));
  return true;
}

Alpine.data("votePage", () => ({
  online: false,
  /** Whether we were ever connected: "Connecting…" reads differently from "lost". */
  everConnected: false,
  state: emptyState(),
  answers: load<Record<string, Answer>>("poll-answers") ?? {},
  drafts,
  /** The emoji whose pop animation is running. */
  sent: "",
  /** When this phone may react again. Remembered, because the server remembers it too. */
  coolUntil: load<number>("poll-cool-until") ?? 0,
  /** Read by `cooling` and `wait`; moved on only when a cooldown starts or runs out. */
  now: Date.now(),

  init(): void {
    this.connect();
    this.tick();
  },

  // ---- what is on screen -------------------------------------------------------------

  /** What the presenter shows now, plus anything still open from an earlier slide. */
  get visible(): PollView[] {
    return this.state.polls.filter(
      (poll) => this.state.visible.includes(poll.id) || poll.state === "open",
    );
  },

  get reactions(): string[] {
    return this.state.reactions;
  },

  get cooling(): boolean {
    return this.now < this.coolUntil;
  },

  /** Milliseconds left of the cooldown, which the bar along the top runs out over. */
  get wait(): number {
    return Math.max(this.coolUntil - this.now, 0);
  },

  /** This phone's answer to a poll, or `undefined` if it has not answered this round. */
  answered(poll: PollView): number | string | undefined {
    const mine = this.answers[poll.id];
    return mine?.round === poll.round ? mine.answer : undefined;
  },

  hint(poll: PollView): string {
    const answer = this.answered(poll);
    if (poll.revealed) {
      if (answer === undefined) {
        return "The right answer is marked.";
      }
      return answer === poll.correct ? "Correct!" : "Not quite. The right answer is marked.";
    }
    if (poll.state === "idle") {
      return "Voting hasn't opened yet.";
    }
    if (poll.state === "closed") {
      return answer === undefined ? "Voting is closed." : "Voting is closed. Your answer is in.";
    }
    if (answer !== undefined) {
      return "Your answer is in. You can change it while voting is open.";
    }
    return poll.options ? "Pick one." : "Send one word or a short phrase.";
  },

  /** The distribution is shown once voting is closed, or once this phone has answered. */
  showResults(poll: PollView): boolean {
    return poll.votes !== null && (poll.state === "closed" || this.answered(poll) !== undefined);
  },

  share(poll: PollView, index: number): number {
    return poll.total ? Math.round(((poll.votes?.[index] ?? 0) / poll.total) * 100) : 0;
  },

  /** Alphabetical, so words stay put while the counts change under them. */
  cloud(poll: PollView): WordCount[] {
    return [...poll.words].sort(([a], [b]) => a.localeCompare(b));
  },

  wordSize(poll: PollView, count: number): string {
    const most = Math.max(1, ...poll.words.map(([, n]) => n));
    return `${0.9 + (1.6 * count) / most}rem`;
  },

  // ---- answering ---------------------------------------------------------------------

  vote(poll: PollView, option: number): void {
    if (send({ type: "vote", id: poll.id, option })) {
      this.record(poll, option);
    }
  },

  sendWord(poll: PollView): void {
    const text = (this.drafts[poll.id] ?? "").trim();
    if (text && send({ type: "word", id: poll.id, text })) {
      this.drafts[poll.id] = "";
      this.record(poll, text);
    }
  },

  react(emoji: string): void {
    if (this.cooling || !send({ type: "react", emoji })) {
      return;
    }
    this.coolUntil = Date.now() + this.state.cooldown;
    save("poll-cool-until", this.coolUntil);
    this.sent = emoji;
    this.tick();
  },

  record(poll: PollView, answer: number | string): void {
    this.answers[poll.id] = { round: poll.round, answer };
    save("poll-answers", this.answers);
  },

  /** Moves `now` on, now and again when the cooldown runs out. */
  tick(): void {
    clearTimeout(coolTimer);
    this.now = Date.now();
    if (this.cooling) {
      coolTimer = setTimeout(() => this.tick(), this.wait);
    }
  },

  // ---- the connection ----------------------------------------------------------------

  connect(): void {
    // The page lives at <base>/vote (dev) or <base>/vote/ (static hosts); the socket at
    // <base>/polls.
    const base = location.href
      .replace(/^http/, "ws")
      .replace(/vote\/?(index\.html)?([?#].*)?$/, "");
    socket = new WebSocket(`${base}polls`);
    socket.onopen = () => {
      this.online = true;
      this.everConnected = true;
      send({ type: "hello", role: "audience", voter });
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      const msg = parseServerMessage(event.data);
      if (msg?.type === "state") {
        this.state = msg;
      }
    };
    socket.onclose = () => {
      this.online = false;
      setTimeout(() => this.connect(), RETRY_MS);
    };
  },
}));

Alpine.start();
