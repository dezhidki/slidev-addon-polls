/**
 * The poll server's memory on disk: one JSON file, which is also the results export.
 *
 * Written at most once a second, to a temporary file that is then renamed over the old
 * one, so a crash mid-write leaves the previous version whole. Maps are stored as lists of
 * entries, not objects: a voter id comes from a phone, and `__proto__` is a valid one.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import * as v from "valibot";

const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const answer = v.union([count, v.string()]);
const words = v.array(v.tuple([v.string(), count]));

/** One finished round of a poll, as it stood when it was reset or its options changed. */
const RoundSchema = v.object({
  round: count,
  question: v.string(),
  options: v.nullable(v.array(v.string())),
  correct: v.nullable(count),
  total: count,
  votes: v.nullable(v.array(count)),
  words,
});

const PollSchema = v.object({
  id: v.string(),
  slide: count,
  question: v.string(),
  options: v.nullable(v.array(v.string())),
  correct: v.nullable(count),
  blind: v.boolean(),
  state: v.picklist(["idle", "open", "closed"]),
  revealed: v.boolean(),
  round: count,
  votes: v.nullable(v.array(count)),
  words,
  banned: v.array(v.string()),
  /** Voter id to answer: who answered this round, so nobody answers twice after a restart. */
  answers: v.array(v.tuple([v.string(), answer])),
  history: v.array(RoundSchema),
});

const RunSchema = v.object({
  polls: v.array(PollSchema),
  /** Slide number to the reactions counted on it. */
  tally: v.array(v.tuple([count, v.record(v.string(), count)])),
});

const SavedSchema = v.object({
  version: v.literal(1),
  /** Deck id to the run it is giving now, and every run it has given. */
  decks: v.array(
    v.tuple([
      v.string(),
      v.object({ run: v.string(), runs: v.array(v.tuple([v.string(), RunSchema])) }),
    ]),
  ),
});

export type SavedRound = v.InferOutput<typeof RoundSchema>;
export type SavedPoll = v.InferOutput<typeof PollSchema>;
export type SavedRun = v.InferOutput<typeof RunSchema>;
export type Saved = v.InferOutput<typeof SavedSchema>;

/** Milliseconds between two writes, however busy the room. */
const WRITE_EVERY = 1000;

/** The file the poll server keeps its memory in. */
export class JsonFile {
  readonly path: string;
  #snapshot: (() => Saved) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #written = 0;

  constructor(path: string) {
    this.path = path;
  }

  /**
   * What the file holds, or `undefined` if there is no file yet. Throws on a file it cannot
   * read, rather than start empty and overwrite someone's results with nothing.
   */
  load(): Saved | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    const result = v.safeParse(SavedSchema, JSON.parse(raw));
    if (!result.success) {
      throw new Error(`${this.path} is not a poll results file: ${v.summarize(result.issues)}`);
    }
    return result.output;
  }

  /** Something changed: write `snapshot()` out within a second. */
  schedule(snapshot: () => Saved): void {
    this.#snapshot = snapshot;
    this.#timer ??= setTimeout(
      () => this.flush(),
      Math.max(this.#written + WRITE_EVERY - Date.now(), 0),
    );
  }

  /** Writes any pending change now. Call it before the process exits. */
  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const snapshot = this.#snapshot;
    if (!snapshot) {
      return;
    }
    this.#snapshot = undefined;
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(snapshot())}\n`);
    renameSync(temp, this.path);
    this.#written = Date.now();
  }
}
