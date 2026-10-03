/**
 * The whole poll backend: one WebSocket endpoint at `<base>/polls`, all state in memory.
 * It runs both inside Slidev's dev server (`setup/vite-plugins.ts`) and on its own
 * (`standalone.ts`), where several decks can share it: each is a room of its own, named by
 * `pollDeck` in its headmatter, and keeps its results apart for each run (`pollRun`).
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
import { JsonFile, type Saved, type SavedPoll, type SavedRound } from "./store.ts";

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
  /** A JSON file to keep everything in across restarts; unset = memory only. */
  dataFile?: string;
}

/** A running poll server. */
export interface PollServer {
  wss: WebSocketServer;
  /** Writes pending changes to the data file now. Call it before the process exits. */
  flush(): void;
}

/** What the server remembers about one connected socket, once it has said hello. */
interface Client {
  socket: WebSocket;
  role: Role;
  /** The phone's own id, out of its localStorage; empty for a deck. */
  voter: string;
  room: Room;
}

/** An option's index, or a word as the cloud keeps it. */
type Answer = number | string;

/** One poll and everything answered into it. */
interface Poll {
  id: string;
  slide: number;
  question: string;
  options: string[] | null;
  correct: number | null;
  /** Keeps the distribution from the room while voting is open. Every quiz is blind. */
  blind: boolean;
  state: Phase;
  revealed: boolean;
  round: number;
  votes: number[] | null;
  words: Map<string, number>;
  /** Words the presenter removed. They stay out, however often they are sent again. */
  banned: Set<string>;
  /** Voter id to their answer this round. */
  answers: Map<string, Answer>;
  /** Earlier rounds that had answers: a reset starts a new round, it deletes nothing. */
  history: SavedRound[];
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
    answers: new Map<string, Answer>(),
  };
}

/** The round a poll is in, as its history keeps it; `undefined` if nobody has answered. */
function finished(poll: Poll): SavedRound | undefined {
  if (!poll.answers.size) {
    return undefined;
  }
  const { round, question, options, correct, votes, words } = poll;
  return { round, question, options, correct, total: poll.answers.size, votes, words: [...words] };
}

/** Ends a poll's round, into its history, and starts the next one. */
function nextRound(poll: Poll): void {
  const done = finished(poll);
  Object.assign(poll, freshRound(poll.options, poll.round));
  if (done) {
    poll.history.push(done);
  }
}

/** One giving of a talk: the polls answered in it, and the reactions on each slide. */
interface Run {
  /** Polls are never deleted: a poll's answers outlive edits to the slide it is on. */
  polls: Map<string, Poll>;
  /** Slide number to the reactions counted on it. */
  tally: Map<number, Tally>;
}

/** Everything one deck has collected, by run label, and the run it is giving now. */
interface Deck {
  run: string;
  runs: Map<string, Run>;
}

/**
 * The live half of one deck: who is connected, and what its presenter's screen shows right
 * now. Phones follow `visible`, not the run's polls, so a poll that was renamed, removed or
 * registered by a stale tab can never reach them. Gone when its last socket is.
 */
interface Room {
  deck: string;
  sockets: Set<WebSocket>;
  slide: number;
  visible: string[];
  reactions: string[];
  cooldown: number;
  /** Voter id (or socket, for a phone that gave none) to when it last reacted. */
  lastReaction: Map<string | WebSocket, number>;
  burst: Tally;
  stateTimer?: ReturnType<typeof setTimeout>;
  burstTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Serves the poll protocol on `httpServer` at `<base>/polls`.
 *
 * @throws if `dataFile` exists but is not a results file: better than overwriting it.
 */
export function attachPolls(httpServer: UpgradableServer, options: PollOptions = {}): PollServer {
  const { token, joinUrl, dataFile } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  /** Sockets that have said hello. Anything not in here is ignored and never sent to. */
  const clients = new Map<WebSocket, Client>();
  /** Deck id to what it has collected. Only a presenter creates one. */
  const decks = new Map<string, Deck>();
  /** Deck id to its live room. Anyone's hello opens one; the last to leave closes it. */
  const rooms = new Map<string, Room>();
  const store = dataFile ? new JsonFile(dataFile) : undefined;
  restore(decks, store?.load());
  const changed = () => store?.schedule(() => snapshot(decks));

  function send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  /** The run a deck is giving now, if a presenter has ever started one. */
  function runOf(deck: string): Run | undefined {
    const known = decks.get(deck);
    return known?.runs.get(known.run);
  }

  /** Makes `label` the deck's current run: a new one, or an earlier one picked up again. */
  function startRun(deck: string, label: string): void {
    const known = decks.get(deck) ?? { run: label, runs: new Map<string, Run>() };
    decks.set(deck, known);
    known.run = label;
    if (!known.runs.has(label)) {
      known.runs.set(label, { polls: new Map(), tally: new Map() });
    }
  }

  function hello(socket: WebSocket, msg: Message<"hello">): Room {
    let role = msg.role;
    if (role === "presenter" && token && msg.token !== token) {
      send(socket, { type: "denied" });
      role = "display";
    }
    const deck = msg.deck ?? "";
    if (clients.get(socket)?.room.deck !== deck) {
      leave(socket);
    }
    let room = rooms.get(deck);
    if (!room) {
      room = {
        deck,
        sockets: new Set(),
        slide: 0,
        visible: [],
        reactions: [],
        cooldown: DEFAULT_COOLDOWN * 1000,
        lastReaction: new Map(),
        burst: {},
      };
      rooms.set(deck, room);
    }
    room.sockets.add(socket);
    clients.set(socket, { socket, role, voter: msg.voter ?? "", room });
    if (role === "presenter") {
      startRun(deck, msg.run ?? "");
    }
    return room;
  }

  function leave(socket: WebSocket): void {
    const room = clients.get(socket)?.room;
    clients.delete(socket);
    if (!room) {
      return;
    }
    room.sockets.delete(socket);
    if (room.sockets.size) {
      broadcast(room);
    } else {
      rooms.delete(room.deck);
    }
  }

  // Re-defining a poll keeps its votes: Slidev re-mounts slides all the time, and an edited
  // question or a fixed typo in an option still counts the same answers. Only a different
  // number of options (or a cloud turned into a choice) starts it afresh. Polls that were
  // renamed or removed stay in the map, harmlessly: phones only show what `visible` lists.
  // ponytail: kept even in the data file; evict if decks get huge.
  function define(run: Run, defs: PollDef[]): void {
    for (const def of defs) {
      const options = def.options ?? null;
      const old = run.polls.get(def.id);
      const text = {
        slide: def.slide,
        question: def.question,
        options,
        correct: def.correct ?? null,
        blind: def.blind === true || def.correct !== undefined,
      };
      if (old && old.options?.length === options?.length) {
        Object.assign(old, text);
        continue;
      }
      const history = old?.history ?? [];
      const done = old && finished(old);
      if (done) {
        history.push(done);
      }
      run.polls.set(def.id, {
        id: def.id,
        ...text,
        // Starts from the clock, so a restarted server never reuses a round phones remember.
        ...freshRound(options, old?.round ?? Date.now()),
        history,
      });
    }
  }

  function showSlide(room: Room, msg: Message<"slide">): void {
    room.slide = msg.slide;
    room.visible = msg.ids;
    room.reactions = msg.reactions;
    room.cooldown = (msg.cooldown ?? DEFAULT_COOLDOWN) * 1000;
  }

  function control(poll: Poll, msg: ControlMessage): void {
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
        nextRound(poll);
        break;
    }
  }

  /** Moderation: the word goes and stays gone. Its senders may send another. */
  function remove(poll: Poll, msg: Message<"remove">): void {
    if (poll.words.delete(msg.word)) {
      poll.banned.add(msg.word);
    }
  }

  function vote(client: Client, poll: Poll, msg: Message<"vote">): void {
    if (poll.votes && msg.option < poll.votes.length) {
      answer(client, poll, msg.option);
    }
  }

  function word(client: Client, poll: Poll, msg: Message<"word">): void {
    if (poll.options) {
      return;
    }
    const text = msg.text.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_WORD);
    if (text && (poll.words.has(text) || poll.words.size < MAX_WORDS)) {
      answer(client, poll, text);
    }
  }

  /**
   * Only emoji the presenter's slide allows, so nobody can put text on the big screen.
   * Reactions are the one message that is never followed by a state broadcast: a hall
   * hammering the heart button must not make the server re-send every poll to every phone.
   */
  function react(client: Client, run: Run, msg: Message<"react">): void {
    const { room } = client;
    const now = Date.now();
    const who = client.voter || client.socket;
    const waited = now - (room.lastReaction.get(who) ?? 0);
    const gap = Math.max(room.cooldown - LENIENCY, MIN_GAP);
    if (!room.reactions.includes(msg.emoji) || waited < gap) {
      return;
    }
    room.lastReaction.set(who, now);
    const counts = run.tally.get(room.slide) ?? {};
    counts[msg.emoji] = (counts[msg.emoji] ?? 0) + 1;
    run.tally.set(room.slide, counts);
    room.burst[msg.emoji] = (room.burst[msg.emoji] ?? 0) + 1;
    room.burstTimer ??= setTimeout(() => {
      room.burstTimer = undefined;
      const flush: ServerMessage = {
        type: "reactions",
        burst: room.burst,
        tally: runOf(room.deck)?.tally.get(room.slide) ?? {},
      };
      room.burst = {};
      for (const screen of room.sockets) {
        if (clients.get(screen)?.role !== "audience") {
          send(screen, flush);
        }
      }
    }, REACTION_FLUSH);
  }

  /**
   * One answer per voter id per round, which they may change while voting is open. The id
   * lives in the phone's localStorage.
   */
  function answer(client: Client, poll: Poll, value: Answer): void {
    const { voter } = client;
    if (poll.state !== "open" || !voter) {
      return;
    }
    const previous = poll.answers.get(voter);
    if (previous === value) {
      return;
    }
    if (previous !== undefined) {
      count(poll, previous, -1);
    }
    poll.answers.set(voter, value);
    count(poll, value, 1);
  }
  /** Adds an answer to the poll's counts, or (`by` = -1) takes it back out. */
  function count(poll: Poll, value: Answer, by: number): void {
    if (typeof value === "number") {
      if (poll.votes) {
        poll.votes[value] = (poll.votes[value] ?? 0) + by;
      }
      return;
    }
    if (poll.banned.has(value)) {
      return;
    }
    const n = (poll.words.get(value) ?? 0) + by;
    if (n > 0) {
      poll.words.set(value, n);
    } else {
      poll.words.delete(value);
    }
  }

  /**
   * A poll as one client may see it. While voting is open only presenters get a blind
   * poll's distribution (every quiz is blind) and a cloud's words — so they can weed it
   * before the room sees it — and only they ever get the answer key before it is revealed.
   */
  function view(poll: Poll, full: boolean): PollView {
    const quiz = poll.correct !== null;
    return {
      id: poll.id,
      slide: poll.slide,
      question: poll.question,
      options: poll.options,
      quiz,
      blind: poll.blind,
      state: poll.state,
      revealed: poll.revealed,
      round: poll.round,
      total: poll.answers.size,
      votes: full || !(poll.blind && poll.state === "open") ? poll.votes : null,
      words: full || poll.state !== "open" ? [...poll.words] : [],
      correct: full || poll.revealed ? poll.correct : null,
    };
  }

  /** Coalesced: a burst of 300 votes becomes a handful of broadcasts, not 300 × 300. */
  function broadcast(room: Room): void {
    room.stateTimer ??= setTimeout(() => {
      room.stateTimer = undefined;
      const run = runOf(room.deck);
      const audience = [...room.sockets].filter((s) => clients.get(s)?.role === "audience");
      const base = {
        type: "state",
        slide: room.slide,
        visible: room.visible,
        reactions: room.reactions,
        cooldown: room.cooldown,
        tally: run?.tally.get(room.slide) ?? {},
        audience: audience.length,
        joinUrl: joinUrl?.(),
      } as const;
      const list = [...(run?.polls.values() ?? [])];
      const full = JSON.stringify({ ...base, polls: list.map((poll) => view(poll, true)) });
      const open = JSON.stringify({ ...base, polls: list.map((poll) => view(poll, false)) });
      for (const socket of room.sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(clients.get(socket)?.role === "presenter" ? full : open);
        }
      }
    }, BROADCAST_COALESCE);
  }

  /** Runs one message, other than hello, that has been parsed and cleared for this sender. */
  function handle(client: Client, msg: Exclude<ClientMessage, { type: "hello" }>): void {
    if (msg.type === "slide") {
      showSlide(client.room, msg);
      return;
    }
    const run = runOf(client.room.deck);
    if (!run) {
      return;
    }
    if (msg.type === "define") {
      define(run, msg.polls);
      return;
    }
    if (msg.type === "react") {
      react(client, run, msg);
      return;
    }
    const poll = run.polls.get(msg.id);
    if (!poll) {
      return;
    }
    switch (msg.type) {
      case "open":
      case "close":
      case "reveal":
      case "reset":
        control(poll, msg);
        break;
      case "remove":
        remove(poll, msg);
        break;
      case "vote":
        vote(client, poll, msg);
        break;
      case "word":
        word(client, poll, msg);
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
    socket.on("close", () => leave(socket));
    socket.on("message", (raw: Buffer) => {
      const msg = parseClientMessage(raw.toString());
      if (!msg) {
        return;
      }
      if (msg.type === "hello") {
        broadcast(hello(socket, msg));
        if (msg.role === "presenter") {
          changed(); // a new run, perhaps
        }
        return;
      }
      const client = clients.get(socket);
      if (!client || (PRESENTER_ONLY.has(msg.type) && client.role !== "presenter")) {
        return;
      }
      handle(client, msg);
      changed();
      if (msg.type !== "react") {
        broadcast(client.room);
      }
    });
  });

  return { wss, flush: () => store?.flush() };
}

/** Everything the server has collected, as the data file keeps it. */
function snapshot(decks: Map<string, Deck>): Saved {
  const savePoll = (poll: Poll): SavedPoll => ({
    ...poll,
    words: [...poll.words],
    banned: [...poll.banned],
    answers: [...poll.answers],
  });
  return {
    version: 1,
    decks: [...decks].map(([id, deck]) => [
      id,
      {
        run: deck.run,
        runs: [...deck.runs].map(([label, run]) => [
          label,
          { polls: [...run.polls.values()].map(savePoll), tally: [...run.tally] },
        ]),
      },
    ]),
  };
}

/** Fills `decks` from what the data file kept. */
function restore(decks: Map<string, Deck>, saved: Saved | undefined): void {
  const loadPoll = (poll: SavedPoll): [string, Poll] => [
    poll.id,
    {
      ...poll,
      words: new Map(poll.words),
      banned: new Set(poll.banned),
      answers: new Map(poll.answers),
    },
  ];
  for (const [id, deck] of saved?.decks ?? []) {
    const runs = deck.runs.map(([label, run]): [string, Run] => [
      label,
      { polls: new Map(run.polls.map(loadPoll)), tally: new Map(run.tally) },
    ]);
    decks.set(id, { run: deck.run, runs: new Map(runs) });
  }
}
