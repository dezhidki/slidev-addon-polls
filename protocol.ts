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

/** Most bytes one message from a phone or a display may hold. */
export const MAX_PAYLOAD = 16 * 1024;
/** Most bytes one message from an authenticated presenter may hold. */
export const PRESENTER_MAX_PAYLOAD = 256 * 1024;

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
  /** Whether the room sees the distribution only once voting closes. Every quiz is blind. */
  blind: boolean;
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
  "sync",
]);

/** Seconds between two reactions from one person, unless the deck says otherwise. */
export const DEFAULT_COOLDOWN = 3;

/** The emoji phones offer when the deck does not say otherwise. */
export const DEFAULT_REACTIONS = ["👍", "👎", "🤔", "❤️"];

/** The deck's `polls:` headmatter. A slide's own `polls:` may set only the reaction keys. */
export interface PollSettings {
  /** Address of the voting page to put in the QR code, for a deck hosted somewhere public. */
  url?: string;
  /** `false` for no reactions, a list of emoji for your own set, anything else = default. */
  reactions?: unknown;
  /** Seconds one person waits between two reactions. */
  reactionCooldown?: number;
  showSlides?: boolean;
  showDrawings?: boolean;
}

/** The reactions and cooldown a slide has: its own `polls:` beats the deck's, key by key. */
export function slideReactions(
  deck: PollSettings,
  slide: PollSettings | undefined,
): { reactions: string[]; cooldown: number | undefined } {
  const setting = slide?.reactions ?? deck.reactions;
  return {
    reactions:
      setting === false ? [] : Array.isArray(setting) ? setting.map(String) : DEFAULT_REACTIONS,
    cooldown: slide?.reactionCooldown ?? deck.reactionCooldown,
  };
}

const IMAGE = /\.(png|apng|gif|webp|avif|svg|jpe?g)(\?.*)?$/i;

/** Whether a reaction is an image file rather than an emoji. */
export function isImage(reaction: string): boolean {
  return IMAGE.test(reaction);
}

/** Where an image reaction is served: full URLs as they are, paths under the deck's base. */
export function reactionUrl(reaction: string, base: string): string {
  return /^(https?:)?\/\//.test(reaction)
    ? reaction
    : `${base.replace(/\/$/, "")}/${reaction.replace(/^\//, "")}`;
}

/** What a screen reader says for a reaction: an image's file name, else the emoji. */
export function reactionLabel(reaction: string): string {
  return isImage(reaction)
    ? (
        reaction
          .replace(/[?#].*$/, "")
          .split("/")
          .pop() ?? reaction
      ).replace(/\.[^.]+$/, "")
    : reaction;
}

/** Longest word a cloud keeps; the server trims and cuts what it is sent to this. */
export const MAX_WORD = 40;
/** Longest voter id, which the server keeps one of per person who has answered. */
const MAX_VOTER = 64;
/** Longest reaction: an emoji, or the path or URL of an image. One is counted per slide. */
export const MAX_REACTION = 512;
/** Most seconds a deck may ask people to wait between reactions. */
const MAX_COOLDOWN = 3600;

/**
 * A string. The default cap is generous because only the three limits above are held in
 * memory per person or per word — the rest is the presenter's own text, and the socket's
 * payload limit already bounds a message as a whole.
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
const TallySchema = v.record(text(MAX_REACTION), count);

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
  blind: v.boolean(),
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

/** The presenter's slide state. Keys it does not know (Slidev also sends `timer`) are dropped. */
const SharedSyncSchema = v.object({
  page: v.optional(count),
  clicks: v.optional(count),
  clicksTotal: v.optional(count),
  cursor: v.optional(
    v.nullable(
      v.object({
        x: v.number(),
        y: v.number(),
        style: v.optional(v.picklist(["cursor", "laser"])),
      }),
    ),
  ),
  lastUpdate: v.optional(
    v.nullable(
      v.object({ id: text(), type: v.picklist(["presenter", "viewer"]), time: v.number() }),
    ),
  ),
});

/**
 * Drawings are SVG markup keyed by page number. A plain string: a drawing outgrows the
 * default cap, and the socket's payload limit already bounds it.
 */
const DrawingsSchema = v.record(v.pipe(v.string(), v.regex(/^\d+$/)), v.string());

/** What the presenter's deck mirrors to the screens, one message per channel. */
const SyncMessageSchema = v.variant("channel", [
  v.object({ type: v.literal("sync"), channel: v.literal("shared"), data: SharedSyncSchema }),
  v.object({ type: v.literal("sync"), channel: v.literal("drawings"), data: DrawingsSchema }),
]);

const ClientMessageSchema = v.variant("type", [
  /** First message on every socket: who is connecting. A presenter proves itself on the socket address instead. */
  v.object({
    type: v.literal("hello"),
    role: v.optional(v.picklist(["presenter", "display", "audience"] satisfies Role[]), "audience"),
    voter: v.optional(text(MAX_VOTER)),
  }),
  /** The presenter's screen declaring every poll it knows about. */
  v.object({ type: v.literal("define"), polls: v.array(PollDefSchema) }),
  /** The presenter's screen saying what it shows now, and which reactions it takes. */
  v.object({
    type: v.literal("slide"),
    slide: count,
    ids: v.array(pollId),
    reactions: v.array(text(MAX_REACTION)),
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
  v.object({ type: v.literal("react"), emoji: text(MAX_REACTION) }),
  SyncMessageSchema,
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
    reactions: v.array(text(MAX_REACTION)),
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
  /** The presenter's slide state, passed on to the screens unchanged. */
  SyncMessageSchema,
]);

export type SyncMessage = v.InferOutput<typeof SyncMessageSchema>;

/** The `shared` channel's data. */
export type SharedSync = v.InferOutput<typeof SharedSyncSchema>;

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
