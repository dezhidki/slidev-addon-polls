/**
 * The wire protocol, shared by the three sides of this addon: the deck (`client.ts`), the
 * poll server (`server/polls.ts`) and the phones (`server/vote.ts`).
 *
 * Messages are parsed, never trusted. {@link parseClientMessage} and
 * {@link parseServerMessage} turn a JSON string into one of the unions below, or into
 * `undefined`. What comes out is the shape it claims to be, cut to the limits named here,
 * so neither side has to re-check fields as it goes.
 *
 * @author Written by Claude (Anthropic) under human review.
 */

/** Who is on the other end of a socket. Only a presenter may command the server. */
export type Role = "presenter" | "display" | "audience";

/** Where a poll is in its life: not open yet, taking answers, or finished. */
export type Phase = "idle" | "open" | "closed";

/** One word of a cloud and how many people sent it. */
export type WordCount = [word: string, count: number];

/** Emoji to how many times it was sent, e.g. `{ "👍": 12 }`. */
export type Tally = Record<string, number>;

/** A poll as the deck declares it: what `<Poll>` was written with. */
export interface PollDef {
  /** Unique within the deck; `<Poll>` builds it from the slide number and the question. */
  id: string;
  /** 1-based slide number the poll is written on. */
  slide: number;
  question: string;
  /** Absent for a word cloud, present for a choice poll or a quiz. */
  options?: string[];
  /** Index into `options` — present only for a quiz, which has a right answer. */
  correct?: number;
}

/**
 * A poll as the server shows it to one client. Presenters get everything; phones and the
 * slide view get a redacted copy while voting is open, so the room cannot see a quiz's
 * distribution, its answer key, or an unmoderated word cloud before the presenter does.
 */
export interface PollView {
  id: string;
  slide: number;
  question: string;
  /** `null` for a word cloud. */
  options: string[] | null;
  /** Whether this poll has a right answer. True even while `correct` is withheld. */
  quiz: boolean;
  state: Phase;
  /** Whether the presenter has shown the right answer. */
  revealed: boolean;
  /** Bumped on every reset, so a phone can tell that the answer it remembers is stale. */
  round: number;
  /** People who have answered this round. */
  total: number;
  /** Votes per option, or `null` for a word cloud and for a quiz still being voted on. */
  votes: number[] | null;
  /** Empty while a cloud is still being voted on and the presenter is still weeding it. */
  words: WordCount[];
  /** The right answer, or `null` when there is none or it is still withheld. */
  correct: number | null;
}

/** The presenter's four controls for one poll: they differ only in which one it is. */
export type ControlMessage = { type: "open" | "close" | "reveal" | "reset"; id: string };

/** Everything a deck or a phone may say to the poll server. */
export type ClientMessage =
  /** First message on every socket: who is connecting, and with what password. */
  | { type: "hello"; role: Role; token?: string; voter?: string }
  /** The presenter's screen declaring the polls it knows about. */
  | { type: "define"; polls: PollDef[] }
  /** The presenter's screen saying what it shows now, and which reactions it takes. */
  | { type: "slide"; slide: number; ids: string[]; reactions: string[]; cooldown?: number }
  /** Presenter controls for one poll. */
  | ControlMessage
  /** Presenter moderation: drop a word from a cloud and keep it out. */
  | { type: "remove"; id: string; word: string }
  /** A phone answering a choice poll or a quiz. */
  | { type: "vote"; id: string; option: number }
  /** A phone answering a word cloud. */
  | { type: "word"; id: string; text: string }
  /** A phone tapping an emoji. */
  | { type: "react"; emoji: string };

/** Everything the poll server says back. */
export type ServerMessage =
  /** The presenter password was wrong; this socket stays a plain display. */
  | { type: "denied" }
  /** The whole picture, re-sent (coalesced) whenever anything changes. */
  | {
      type: "state";
      slide: number;
      /** Poll ids on the presenter's screen right now. */
      visible: string[];
      reactions: string[];
      /** Milliseconds one person waits between two reactions. */
      cooldown: number;
      tally: Tally;
      /** Phones connected right now. */
      audience: number;
      /** Where phones should go to vote, if the server can work it out. */
      joinUrl?: string;
      polls: PollView[];
    }
  /** Reactions since the last burst, for the emoji that float up the slide. */
  | { type: "reactions"; burst: Tally; tally: Tally };

/** Message types only a presenter may send; everyone else's are dropped. */
export const PRESENTER_ONLY: ReadonlySet<ClientMessage["type"]> = new Set([
  "define",
  "slide",
  "open",
  "close",
  "reveal",
  "reset",
  "remove",
]);

/** Seconds between two reactions from one person, unless the deck says otherwise. */
export const DEFAULT_COOLDOWN = 3;

const ROLES: readonly Role[] = ["presenter", "display", "audience"];
const PHASES: readonly Phase[] = ["idle", "open", "closed"];

const MAX_ID = 300;
const MAX_QUESTION = 300;
const MAX_OPTION = 200;
const MAX_OPTIONS = 12;
/** Longest word a cloud keeps; the server trims and cuts what it is sent to this. */
export const MAX_WORD = 40;
const MAX_EMOJI = 16;
const MAX_REACTIONS = 8;
const MAX_VISIBLE = 50;
const MAX_VOTER = 64;
const MAX_TOKEN = 200;
const MAX_URL = 2048;
const MAX_SLIDE = 10_000;
const MAX_DEFINES = 200;
const MAX_COOLDOWN = 3600;
const COUNT = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------------------
// The handful of checks everything above is built from. Each one answers the same way: the
// value as the type it claims to be, or `undefined`.
// ---------------------------------------------------------------------------------------

/** A non-empty string of at most `max` characters. */
function text(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

/** A whole number within `[min, max]`. */
function whole(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return undefined;
  }
  return value >= min && value <= max ? value : undefined;
}

/** One of `allowed`. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** The strings in a list that fit, at most `count` of them. Anything else drops out. */
function texts(value: unknown, max: number, count: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const fits = (item: unknown): item is string => typeof item === "string" && item.length <= max;
  return value.filter(fits).slice(0, count);
}

/** A plain object whose fields can be read one by one. Arrays and `null` are not. */
function fields(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function json(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** `Object.fromEntries`, so that a key like `__proto__` lands as an ordinary field. */
function parseTally(value: unknown): Tally {
  const raw = fields(value);
  if (!raw) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw).flatMap(([emoji, count]) => {
      const n = whole(count, 0, COUNT);
      return emoji.length <= MAX_EMOJI && n !== undefined ? [[emoji, n] as const] : [];
    }),
  );
}

function parseWords(value: unknown): WordCount[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!Array.isArray(entry)) {
      return [];
    }
    const word = text(entry[0], MAX_WORD);
    const count = whole(entry[1], 0, COUNT);
    return word !== undefined && count !== undefined ? [[word, count] as WordCount] : [];
  });
}

/** A poll the deck declared. Without an id and a question there is nothing to poll. */
export function parsePollDef(value: unknown): PollDef | undefined {
  const raw = fields(value);
  if (!raw) {
    return undefined;
  }
  const id = text(raw.id, MAX_ID);
  const question = text(raw.question, MAX_QUESTION);
  if (id === undefined || question === undefined) {
    return undefined;
  }
  const listed = Array.isArray(raw.options) ? texts(raw.options, MAX_OPTION, MAX_OPTIONS) : [];
  const options = listed.length > 0 ? listed : undefined;
  return {
    id,
    slide: whole(raw.slide, 0, MAX_SLIDE) ?? 0,
    question,
    options,
    correct: options && whole(raw.correct, 0, options.length - 1),
  };
}

function parsePollView(value: unknown): PollView | undefined {
  const raw = fields(value);
  if (!raw) {
    return undefined;
  }
  const id = text(raw.id, MAX_ID);
  const question = text(raw.question, MAX_QUESTION);
  const state = oneOf(raw.state, PHASES);
  if (id === undefined || question === undefined || state === undefined) {
    return undefined;
  }
  const listed = Array.isArray(raw.options) ? texts(raw.options, MAX_OPTION, MAX_OPTIONS) : [];
  const options = listed.length > 0 ? listed : null;
  return {
    id,
    slide: whole(raw.slide, 0, MAX_SLIDE) ?? 0,
    question,
    options,
    quiz: raw.quiz === true,
    state,
    revealed: raw.revealed === true,
    round: whole(raw.round, 0, COUNT) ?? 0,
    total: whole(raw.total, 0, COUNT) ?? 0,
    votes: Array.isArray(raw.votes) ? raw.votes.map((n) => whole(n, 0, COUNT) ?? 0) : null,
    words: parseWords(raw.words),
    correct: (options && whole(raw.correct, 0, options.length - 1)) ?? null,
  };
}

/** Parses one message from a deck or a phone. Anything unrecognised is `undefined`. */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  const msg = fields(json(raw));
  const type = msg?.type;
  if (!msg || typeof type !== "string") {
    return undefined;
  }
  const id = text(msg.id, MAX_ID);
  switch (type) {
    case "hello":
      return {
        type,
        role: oneOf(msg.role, ROLES) ?? "audience",
        token: text(msg.token, MAX_TOKEN),
        voter: text(msg.voter, MAX_VOTER),
      };
    case "define": {
      const polls = Array.isArray(msg.polls)
        ? msg.polls.flatMap((poll) => parsePollDef(poll) ?? []).slice(0, MAX_DEFINES)
        : [];
      return polls.length > 0 ? { type, polls } : undefined;
    }
    case "slide":
      return {
        type,
        slide: whole(msg.slide, 0, MAX_SLIDE) ?? 0,
        ids: texts(msg.ids, MAX_ID, MAX_VISIBLE),
        reactions: texts(msg.reactions, MAX_EMOJI, MAX_REACTIONS),
        cooldown:
          typeof msg.cooldown === "number" && Number.isFinite(msg.cooldown)
            ? Math.min(Math.max(msg.cooldown, 0), MAX_COOLDOWN)
            : undefined,
      };
    case "open":
    case "close":
    case "reveal":
    case "reset":
      return id === undefined ? undefined : { type, id };
    case "remove": {
      const word = text(msg.word, MAX_WORD);
      return id === undefined || word === undefined ? undefined : { type, id, word };
    }
    case "vote": {
      const option = whole(msg.option, 0, MAX_OPTIONS - 1);
      return id === undefined || option === undefined ? undefined : { type, id, option };
    }
    case "word": {
      // Longer than a word on purpose: the server trims and cuts it down to size itself.
      const spoken = text(msg.text, MAX_WORD * 4);
      return id === undefined || spoken === undefined ? undefined : { type, id, text: spoken };
    }
    case "react": {
      const emoji = text(msg.emoji, MAX_EMOJI);
      return emoji === undefined ? undefined : { type, emoji };
    }
    default:
      return undefined;
  }
}

/** Parses one message from the poll server. Anything unrecognised is `undefined`. */
export function parseServerMessage(raw: string): ServerMessage | undefined {
  const msg = fields(json(raw));
  const type = msg?.type;
  if (!msg || typeof type !== "string") {
    return undefined;
  }
  switch (type) {
    case "denied":
      return { type };
    case "state":
      return {
        type,
        slide: whole(msg.slide, 0, MAX_SLIDE) ?? 0,
        visible: texts(msg.visible, MAX_ID, MAX_VISIBLE),
        reactions: texts(msg.reactions, MAX_EMOJI, MAX_REACTIONS),
        cooldown: whole(msg.cooldown, 0, MAX_COOLDOWN * 1000) ?? DEFAULT_COOLDOWN * 1000,
        tally: parseTally(msg.tally),
        audience: whole(msg.audience, 0, COUNT) ?? 0,
        joinUrl: text(msg.joinUrl, MAX_URL),
        polls: Array.isArray(msg.polls) ? msg.polls.flatMap((p) => parsePollView(p) ?? []) : [],
      };
    case "reactions":
      return { type, burst: parseTally(msg.burst), tally: parseTally(msg.tally) };
    default:
      return undefined;
  }
}
