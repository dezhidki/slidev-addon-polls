/**
 * The deck's side of the poll protocol: one WebSocket per browser tab, shared by every
 * `<Poll>` on every slide, plus the reactive state they all render from.
 *
 * Only the presenter's screen commands the server. Every other view — the slide view, the
 * next-slide preview, a second laptop — connects as a `display` and only listens.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { reactive } from "vue";
import configs from "#slidev/configs";
import {
  type ClientMessage,
  type PollDef,
  type PollView,
  parseServerMessage,
  type Tally,
} from "./protocol.ts";

/** Milliseconds before a lost or refused connection is tried again. */
const RETRY_MS = 2000;

/** Headmatter this addon reads, which Slidev's own config type does not know about. */
export interface PollConfig {
  /** Address of the voting page to put in the QR code, for a deck hosted somewhere public. */
  pollUrl?: string;
  /** `false` for no reactions, a list of emoji for your own set, anything else = default. */
  reactions?: unknown;
  /** Seconds one person waits between two reactions. */
  reactionCooldown?: number;
}

/** The deck's headmatter, including this addon's own keys. */
export const pollConfig = configs as typeof configs & PollConfig;

/** A poll this deck declares, and how many copies of it are on screen right now. */
interface MountedPoll {
  def: PollDef;
  onScreen: number;
}

/** What the deck knows about the poll server. Every component renders from this. */
export interface PollsState {
  /** Whether the poll server has answered this tab. */
  connected: boolean;
  /** Whether it refused this tab as a presenter (wrong `slidev --remote=<password>`). */
  denied: boolean;
  /** Phones connected right now. */
  audience: number;
  /** Where the phones should go to vote; empty until the server names an address. */
  joinUrl: string;
  /** Every poll the server knows, by id. */
  byId: Record<string, PollView>;
  /** Reactions on the presenter's current slide so far, e.g. `{ "👍": 12 }`. */
  tally: Tally;
  /** The latest burst, for the emoji that float up the side of the slide. A fresh object
   * every time, so a watcher fires even when the same emoji arrives twice. */
  burst: Tally;
}

/**
 * The deck's connection to the poll server. There is one of these per tab, exported below
 * as {@link polls}; the components never build their own.
 */
class PollsClient {
  /** Reactive, and the only part of this class the components touch. */
  readonly state: PollsState = reactive<PollsState>({
    connected: false,
    denied: false,
    audience: 0,
    joinUrl: "",
    byId: {},
    tally: {},
    burst: {},
  });

  #socket: WebSocket | undefined;
  /** Every `<Poll>` this deck has set up, by id. Polls are never forgotten, only hidden. */
  #polls = new Map<string, MountedPoll>();
  #presenter = false;
  #slide = 0;
  #reactions: string[] = [];
  #cooldown: number | undefined;
  #announcing = false;
  /** Earliest time another connection attempt may be made, so failures don't spin. */
  #nextAttempt = 0;

  /**
   * Says one thing to the server, opening the connection first if it is not up. Nothing is
   * queued while it opens: {@link #greet} tells the server everything again anyway.
   */
  send(msg: ClientMessage): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(msg));
    } else {
      this.#connect();
    }
  }

  /** Called by global-bottom.vue whenever the mode, the slide or its reactions change. */
  sync(presenter: boolean, slide: number, reactions: string[], cooldown?: number): void {
    const roleChanged = presenter !== this.#presenter;
    this.#presenter = presenter;
    this.#slide = slide;
    this.#reactions = reactions;
    this.#cooldown = cooldown;
    // A display has nothing to announce, so it greets the server to get itself a socket.
    if (roleChanged || !this.#socket) {
      this.#greet();
    } else {
      this.#announce();
    }
  }

  /** Called by each `<Poll>` as it is set up; only a presenter's definitions are sent on. */
  define(def: PollDef): void {
    const mounted = this.#polls.get(def.id);
    if (mounted) {
      mounted.def = def;
    } else {
      this.#polls.set(def.id, { def, onScreen: 0 });
    }
    this.#announce();
  }

  /**
   * A poll has come on screen, so the phones should show it. Returns the function to call
   * when it leaves again (slide unmounted, or a `<PollSet>` moved on to its next question).
   */
  show(id: string): () => void {
    const mounted = this.#polls.get(id);
    if (!mounted) {
      return () => {};
    }
    mounted.onScreen++;
    this.#announce();
    return () => {
      mounted.onScreen--;
      this.#announce();
    };
  }

  #connect(): void {
    const now = Date.now();
    if (this.#socket && this.#socket.readyState !== WebSocket.CLOSED) {
      return;
    }
    if (now < this.#nextAttempt) {
      return;
    }
    this.#nextAttempt = now + RETRY_MS;
    const url = new URL(`${import.meta.env.BASE_URL}polls`, location.href.replace(/^http/, "ws"));
    const socket = new WebSocket(url);
    this.#socket = socket;
    socket.onopen = () => this.#greet();
    socket.onmessage = (event: MessageEvent<string>) => this.#receive(event.data);
    socket.onclose = () => {
      this.state.connected = false;
      setTimeout(() => this.#connect(), RETRY_MS);
    };
  }

  /** First thing said on a new socket: who we are, then what our screen shows. */
  #greet(): void {
    const token = typeof pollConfig.remote === "string" ? pollConfig.remote : undefined;
    this.send({ type: "hello", role: this.#presenter ? "presenter" : "display", token });
    this.#announce();
  }

  /**
   * Tells the phones what this screen shows: the polls the deck declares, which of them are
   * on the presenter's current slide, and the reactions that slide accepts. Queued, so a
   * slide mounting three polls says it once.
   */
  #announce(): void {
    if (this.#announcing || !this.#presenter) {
      return;
    }
    this.#announcing = true;
    queueMicrotask(() => {
      this.#announcing = false;
      const mounted = [...this.#polls.values()];
      const onThisSlide = (poll: MountedPoll) =>
        poll.onScreen > 0 && poll.def.slide === this.#slide;
      this.send({ type: "define", polls: mounted.map((poll) => poll.def) });
      this.send({
        type: "slide",
        slide: this.#slide,
        ids: mounted.filter(onThisSlide).map((poll) => poll.def.id),
        reactions: this.#reactions,
        cooldown: this.#cooldown,
      });
    });
  }

  #receive(data: string): void {
    const msg = parseServerMessage(data);
    if (!msg) {
      return;
    }
    if (msg.type === "denied") {
      this.state.denied = true;
      return;
    }
    if (msg.type === "reactions") {
      this.state.tally = msg.tally;
      this.state.burst = msg.burst;
      return;
    }
    this.state.connected = true;
    this.state.audience = msg.audience;
    this.state.joinUrl = msg.joinUrl ?? "";
    this.state.tally = msg.tally;
    this.state.byId = Object.fromEntries(msg.polls.map((poll) => [poll.id, poll]));
  }
}

/** This tab's connection to the poll server. */
export const polls = new PollsClient();
