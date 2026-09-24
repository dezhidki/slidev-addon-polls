/**
 * The wire protocol, shared by the three sides of this addon: the deck (`client.ts`), the
 * poll server (`server/polls.ts`) and the phones (`server/vote.ts`).
 *
 * Messages are parsed, never trusted. {@link parseClientMessage} and
 * {@link parseServerMessage} turn a JSON string into one of the unions below, or into
 * `undefined`. What comes out is the shape it claims to be, so neither side has to
 * re-check fields as it goes.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import * as v from "valibot";

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
  /** A choice poll whose distribution the room sees only once voting closes, like a quiz. */
  blind?: boolean;
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
  /** Votes per option, or `null` for a word cloud and for a quiz or blind poll still open. */
  votes: number[] | null;
  /** Empty while a cloud is still being voted on and the presenter is still weeding it. */
  words: WordCount[];
  /** The right answer, or `null` when there is none or it is still withheld. */
  correct: number | null;
}

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

/** Longest word a cloud keeps; the server trims and cuts what it is sent to this. */
export const MAX_WORD = 40;
/** Longest voter id, which the server keeps one of per person who has answered. */
const MAX_VOTER = 64;
/** Longest emoji, which the server counts one of per reaction on a slide. */
const MAX_EMOJI = 16;
/** Most seconds a deck may ask people to wait between reactions. */
const MAX_COOLDOWN = 3600;

/**
 * A string. The default cap is generous because only the three limits above are held in
 * memory per person or per word — the rest is the presenter's own text, and the socket's
 * 16 kB payload limit already bounds a message as a whole.
 *
 * Empty is allowed on purpose: an empty option label is an authoring slip, and refusing
 * the message over one would take every other poll on the slide down with it.
 */
const text = (max = 2048) => v.pipe(v.string(), v.maxLength(max));

/** A poll id. Empty is the one string that would collide with every other empty one. */
const pollId = v.pipe(v.string(), v.nonEmpty(), v.maxLength(2048));

/** A count or an index: a whole number, never negative. */
const count = v.pipe(v.number(), v.integer(), v.minValue(0));

const PhaseSchema = v.picklist(["idle", "open", "closed"] satisfies Phase[]);
const TallySchema = v.record(text(MAX_EMOJI), count);

// The schemas below describe the two types above. A drift between them is a compile
// error where the parsed output meets them: `define()` in server/polls.ts, `byId` in
// client.ts.
const PollDefSchema = v.object({
  id: pollId,
  slide: v.optional(count, 0),
  question: text(),
  options: v.optional(v.array(text())),
  correct: v.optional(count),
  blind: v.optional(v.boolean()),
});

const PollViewSchema = v.object({
  id: pollId,
  slide: count,
  question: text(),
  options: v.nullable(v.array(text())),
  quiz: v.boolean(),
  state: PhaseSchema,
  revealed: v.boolean(),
  round: count,
  total: count,
  votes: v.nullable(v.array(count)),
  words: v.array(v.tuple([text(MAX_WORD), count])),
  correct: v.nullable(count),
});

/** The presenter's four controls for one poll: they differ only in which one it is. */
const ControlMessageSchema = v.object({
  type: v.picklist(["open", "close", "reveal", "reset"]),
  id: pollId,
});

const ClientMessageSchema = v.variant("type", [
  /** First message on every socket: who is connecting, and with what password. */
  v.object({
    type: v.literal("hello"),
    role: v.optional(v.picklist(["presenter", "display", "audience"] satisfies Role[]), "audience"),
    token: v.optional(text()),
    voter: v.optional(text(MAX_VOTER)),
  }),
  /** The presenter's screen declaring every poll it knows about. */
  v.object({ type: v.literal("define"), polls: v.array(PollDefSchema) }),
  /** The presenter's screen saying what it shows now, and which reactions it takes. */
  v.object({
    type: v.literal("slide"),
    slide: count,
    ids: v.array(pollId),
    reactions: v.array(text(MAX_EMOJI)),
    /** Seconds. Out of range is pulled into range rather than dropping the message. */
    cooldown: v.optional(
      v.pipe(
        v.number(),
        v.transform((seconds) => Math.min(Math.max(seconds, 0), MAX_COOLDOWN)),
      ),
    ),
  }),
  ControlMessageSchema,
  /** Presenter moderation: drop a word from a cloud and keep it out. */
  v.object({ type: v.literal("remove"), id: pollId, word: text(MAX_WORD) }),
  /** A phone answering a choice poll or a quiz. */
  v.object({ type: v.literal("vote"), id: pollId, option: count }),
  /** A phone answering a word cloud; the server trims and cuts it down to size. */
  v.object({ type: v.literal("word"), id: pollId, text: text(MAX_WORD * 4) }),
  /** A phone tapping an emoji. */
  v.object({ type: v.literal("react"), emoji: text(MAX_EMOJI) }),
]);

const ServerMessageSchema = v.variant("type", [
  /** The presenter password was wrong; this socket stays a plain display. */
  v.object({ type: v.literal("denied") }),
  /** The whole picture, re-sent (coalesced) whenever anything changes. */
  v.object({
    type: v.literal("state"),
    slide: count,
    /** Poll ids on the presenter's screen right now. */
    visible: v.array(pollId),
    reactions: v.array(text(MAX_EMOJI)),
    /** Milliseconds one person waits between two reactions. */
    cooldown: count,
    tally: TallySchema,
    /** Phones connected right now. */
    audience: count,
    /** Where phones should go to vote, if the server can work it out. */
    joinUrl: v.optional(text()),
    polls: v.array(PollViewSchema),
  }),
  /** Reactions since the last burst, for the emoji that float up the slide. */
  v.object({ type: v.literal("reactions"), burst: TallySchema, tally: TallySchema }),
]);

export type ControlMessage = v.InferOutput<typeof ControlMessageSchema>;

/** Everything a deck or a phone may say to the poll server. */
export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;

/** Everything the poll server says back. */
export type ServerMessage = v.InferOutput<typeof ServerMessageSchema>;

const ClientWire = v.pipe(v.string(), v.parseJson(), ClientMessageSchema);
const ServerWire = v.pipe(v.string(), v.parseJson(), ServerMessageSchema);

/** Parses one message from a deck or a phone. Anything unrecognised is `undefined`. */
export function parseClientMessage(raw: string): ClientMessage | undefined {
  const result = v.safeParse(ClientWire, raw);
  return result.success ? result.output : undefined;
}

/** Parses one message from the poll server. Anything unrecognised is `undefined`. */
export function parseServerMessage(raw: string): ServerMessage | undefined {
  const result = v.safeParse(ServerWire, raw);
  return result.success ? result.output : undefined;
}
