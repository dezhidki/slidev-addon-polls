/**
 * The whole poll backend: one WebSocket endpoint at `<base>/polls`, all state in memory.
 * It runs both inside Slidev's dev server (`setup/vite-plugins.ts`) and on its own
 * (`standalone.ts`).
 *
 * Nothing here checks the shape of what it is sent: `parseClientMessage` in `../protocol.ts`
 * has already done that, so every handler below is about the game, not about the wire.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import {
  type ClientMessage,
  type ControlMessage,
  DEFAULT_COOLDOWN,
  MAX_WORD,
  type Phase,
  type PollDef,
  type PollView,
  PRESENTER_ONLY,
  parseClientMessage,
  type Role,
  type ServerMessage,
  type Tally,
} from "../protocol.ts";

/** Distinct words one cloud will hold. */
const MAX_WORDS = 500;
/** Milliseconds: the floor between one person's reactions, however low a deck sets it. */
const MIN_GAP = 200;
/** Milliseconds a phone that waited out its cooldown is forgiven for network jitter. */
const LENIENCY = 300;
/** Milliseconds: reactions reach the screens in bursts, not one by one. */
const REACTION_FLUSH = 150;
/** Milliseconds a state broadcast waits, so 300 votes become a handful of messages. */
const BROADCAST_COALESCE = 50;
const MAX_PAYLOAD = 16 * 1024;

/** One member of the {@link ClientMessage} union, picked by its `type`. */
type Message<T extends ClientMessage["type"]> = Extract<ClientMessage, { type: T }>;

/**
 * Anything that emits `upgrade`: a `node:http` server, or whatever Vite's dev server
 * happens to be running on. Nothing else about it is used.
 */
export interface UpgradableServer {
  on(
    event: "upgrade",
    listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
  ): unknown;
}

/** How to attach the poll server to an HTTP server. */
export interface PollOptions {
  /** Presenters must send it (Slidev's `--remote` password); unset = anyone may present. */
  token?: string;
  /** Where phones should go to vote, asked afresh on every broadcast. */
  joinUrl?: () => string | undefined;
}

/** What the server remembers about one connected socket, once it has said hello. */
interface Client {
  role: Role;
  /** The phone's own id, out of its localStorage; empty for a deck. */
  voter: string;
}

/** One poll and everything answered into it. */
interface Poll {
  id: string;
  slide: number;
  question: string;
  options: string[] | null;
  correct: number | null;
  state: Phase;
  revealed: boolean;
  round: number;
  votes: number[] | null;
  words: Map<string, number>;
  /** Words the presenter removed. They stay out, however often they are sent again. */
  banned: Set<string>;
  /** Voter ids that have answered this round. */
  voters: Set<string>;
}

/** The answer-holding half of a poll, emptied. A round is never reused: phones remember. */
function freshRound(options: string[] | null, lastRound: number) {
  return {
    state: "idle" as Phase,
    revealed: false,
    round: lastRound + 1,
    votes: options?.map(() => 0) ?? null,
    words: new Map<string, number>(),
    banned: new Set<string>(),
    voters: new Set<string>(),
  };
}

/**
 * Serves the poll protocol on `httpServer` at `<base>/polls`.
 *
 * @returns the WebSocket server, so a caller can close it.
 */
export function attachPolls(
  httpServer: UpgradableServer,
  options: PollOptions = {},
): WebSocketServer {
  const { token, joinUrl } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  /** Sockets that have said hello. Anything not in here is ignored and never sent to. */
  const clients = new Map<WebSocket, Client>();
  /** Polls are never deleted: a poll's answers outlive edits to the slide it is on. */
  const polls = new Map<string, Poll>();

  // What the presenter's screen shows right now. Phones follow this, not `polls`, so a poll
  // that was renamed, removed or registered by a stale tab can never reach them.
  let slide = 0;
  let visible: string[] = [];
  let reactions: string[] = [];
  let cooldown = DEFAULT_COOLDOWN * 1000;

  /** Voter id (or socket, for a phone that gave none) to when it last reacted. */
  const lastReaction = new Map<string | WebSocket, number>();
  /** Slide number to the reactions counted on it. */
  const tally = new Map<number, Tally>();
  let burst: Tally = {};
  let stateTimer: ReturnType<typeof setTimeout> | undefined;
  let burstTimer: ReturnType<typeof setTimeout> | undefined;

  function send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  function hello(socket: WebSocket, msg: Message<"hello">): void {
    let role = msg.role;
    if (role === "presenter" && token && msg.token !== token) {
      send(socket, { type: "denied" });
      role = "display";
    }
    clients.set(socket, { role, voter: msg.voter ?? "" });
  }

  // Re-defining a poll keeps its votes: Slidev re-mounts slides all the time, and an edited
  // question or a fixed typo in an option still counts the same answers. Only a different
  // number of options (or a cloud turned into a choice) starts it afresh. Polls that were
  // renamed or removed stay in the map, harmlessly: phones only show what `visible` lists.
  // ponytail: they are freed on restart; evict if decks get huge.
  function define(defs: PollDef[]): void {
    for (const def of defs) {
      const options = def.options ?? null;
      const old = polls.get(def.id);
      const text = {
        slide: def.slide,
        question: def.question,
        options,
        correct: def.correct ?? null,
      };
      if (old && old.options?.length === options?.length) {
        Object.assign(old, text);
        continue;
      }
      polls.set(def.id, {
        id: def.id,
        ...text,
        // Starts from the clock, so a restarted server never reuses a round phones remember.
        ...freshRound(options, old?.round ?? Date.now()),
      });
    }
  }

  function showSlide(msg: Message<"slide">): void {
    slide = msg.slide;
    visible = msg.ids;
    reactions = msg.reactions;
    cooldown = (msg.cooldown ?? DEFAULT_COOLDOWN) * 1000;
  }

  function control(msg: ControlMessage): void {
    const poll = polls.get(msg.id);
    if (!poll) {
      return;
    }
    switch (msg.type) {
      case "open":
        poll.state = "open";
        poll.revealed = false;
        break;
      case "close":
        poll.state = "closed";
        break;
      case "reveal":
        poll.state = "closed";
        poll.revealed = true;
        break;
      case "reset":
        Object.assign(poll, freshRound(poll.options, poll.round));
        break;
    }
  }

  /** Moderation: the word goes, stays gone, and its senders don't get another try. */
  function remove(msg: Message<"remove">): void {
    const poll = polls.get(msg.id);
    if (poll?.words.delete(msg.word)) {
      poll.banned.add(msg.word);
    }
  }

  function vote(socket: WebSocket, msg: Message<"vote">): void {
    const poll = polls.get(msg.id);
    const votes = poll?.votes;
    if (!poll || !votes || msg.option >= votes.length) {
      return;
    }
    if (claim(socket, poll)) {
      votes[msg.option] = (votes[msg.option] ?? 0) + 1;
    }
  }

  function word(socket: WebSocket, msg: Message<"word">): void {
    const poll = polls.get(msg.id);
    if (!poll || poll.options) {
      return;
    }
    const text = msg.text.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_WORD);
    if (!text || (!poll.words.has(text) && poll.words.size >= MAX_WORDS)) {
      return;
    }
    if (claim(socket, poll) && !poll.banned.has(text)) {
      poll.words.set(text, (poll.words.get(text) ?? 0) + 1);
    }
  }

  /**
   * Only emoji the presenter's slide allows, so nobody can put text on the big screen.
   * Reactions are the one message that is never followed by a state broadcast: a hall
   * hammering the heart button must not make the server re-send every poll to every phone.
   */
  function react(socket: WebSocket, msg: Message<"react">): void {
    const now = Date.now();
    const who = clients.get(socket)?.voter || socket;
    const waited = now - (lastReaction.get(who) ?? 0);
    if (!reactions.includes(msg.emoji) || waited < Math.max(cooldown - LENIENCY, MIN_GAP)) {
      return;
    }
    lastReaction.set(who, now);
    const counts = tally.get(slide) ?? {};
    counts[msg.emoji] = (counts[msg.emoji] ?? 0) + 1;
    tally.set(slide, counts);
    burst[msg.emoji] = (burst[msg.emoji] ?? 0) + 1;
    burstTimer ??= setTimeout(() => {
      burstTimer = undefined;
      const flush: ServerMessage = { type: "reactions", burst, tally: tally.get(slide) ?? {} };
      burst = {};
      for (const [screen, client] of clients) {
        if (client.role !== "audience") {
          send(screen, flush);
        }
      }
    }, REACTION_FLUSH);
  }

  /** One answer per voter id per round. The id lives in the phone's localStorage. */
  function claim(socket: WebSocket, poll: Poll): boolean {
    const voter = clients.get(socket)?.voter;
    if (poll.state !== "open" || !voter || poll.voters.has(voter)) {
      return false;
    }
    poll.voters.add(voter);
    return true;
  }

  /**
   * A poll as one client may see it. While voting is open only presenters get a quiz's
   * distribution and a cloud's words — so they can weed it before the room sees it — and
   * only they ever get the answer key before it is revealed.
   */
  function view(poll: Poll, full: boolean): PollView {
    const quiz = poll.correct !== null;
    return {
      id: poll.id,
      slide: poll.slide,
      question: poll.question,
      options: poll.options,
      quiz,
      state: poll.state,
      revealed: poll.revealed,
      round: poll.round,
      total: poll.voters.size,
      votes: full || !(quiz && poll.state === "open") ? poll.votes : null,
      words: full || poll.state !== "open" ? [...poll.words] : [],
      correct: full || poll.revealed ? poll.correct : null,
    };
  }

  /** Coalesced: a burst of 300 votes becomes a handful of broadcasts, not 300 × 300. */
  function broadcast(): void {
    stateTimer ??= setTimeout(() => {
      stateTimer = undefined;
      const base = {
        type: "state",
        slide,
        visible,
        reactions,
        cooldown,
        tally: tally.get(slide) ?? {},
        audience: [...clients.values()].filter((client) => client.role === "audience").length,
        joinUrl: joinUrl?.(),
      } as const;
      const list = [...polls.values()];
      const full = JSON.stringify({ ...base, polls: list.map((poll) => view(poll, true)) });
      const open = JSON.stringify({ ...base, polls: list.map((poll) => view(poll, false)) });
      for (const [socket, client] of clients) {
        if (socket.readyState === socket.OPEN) {
          socket.send(client.role === "presenter" ? full : open);
        }
      }
    }, BROADCAST_COALESCE);
  }

  /** Runs one message that has already been parsed and cleared for this sender. */
  function handle(socket: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case "hello":
        hello(socket, msg);
        break;
      case "define":
        define(msg.polls);
        break;
      case "slide":
        showSlide(msg);
        break;
      case "open":
      case "close":
      case "reveal":
      case "reset":
        control(msg);
        break;
      case "remove":
        remove(msg);
        break;
      case "vote":
        vote(socket, msg);
        break;
      case "word":
        word(socket, msg);
        break;
      case "react":
        react(socket, msg);
        break;
    }
  }

  httpServer.on("upgrade", (req, socket, head) => {
    // Anything else (Vite's HMR socket) is someone else's.
    if (!new URL(req.url ?? "/", "http://x").pathname.endsWith("/polls")) {
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (socket: WebSocket) => {
    socket.on("error", () => {}); // a dropped phone is not an emergency
    socket.on("close", () => {
      clients.delete(socket);
      broadcast();
    });
    socket.on("message", (raw: Buffer) => {
      const msg = parseClientMessage(raw.toString());
      if (!msg) {
        return;
      }
      const client = clients.get(socket);
      if (msg.type !== "hello" && !client) {
        return;
      }
      if (PRESENTER_ONLY.has(msg.type) && client?.role !== "presenter") {
        return;
      }
      handle(socket, msg);
      if (msg.type !== "react") {
        broadcast();
      }
    });
  });

  return wss;
}
