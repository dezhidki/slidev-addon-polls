/**
 * Shared types for slidev-addon-polls — client and server both reference these shapes.
 */

// ── Poll domain types ────────────────────────────────────────────────────────

export type PollType = "choice" | "quiz" | "wordcloud";
export type PollState = "idle" | "voting" | "closed";

/** An option can be a plain string or an object with a text property. */
export type PollOption = string | { text: string };

export interface Poll {
  id: string;
  slideIndex: number;
  type: PollType;
  question: string;
  /** Multiple-choice / quiz options */
  options?: PollOption[];
  /** Vote counts per option index */
  votes?: number[];
  /** Word cloud submission counts */
  wordCounts?: Record<string, number>;
  state?: PollState;
  revealed?: boolean;
  /** Index into options[] of the correct answer (quiz only) */
  correctAnswer?: number;
}

/**
 * Input shape for <Poll :questions="[...]">.
 * id and slideIndex are computed automatically — do not set them.
 */
export interface RawQuestion {
  type: PollType;
  question: string;
  /** Required for type='choice' and type='quiz' */
  options?: PollOption[];
  /** Index into options[] of the correct answer (quiz only) */
  correctAnswer?: number;
}

export interface WordEntry {
  word: string;
  count: number;
}

/** slideIndex (as string key) → active pollId */
export type ActivePollMap = Record<string, string>;

// ── WebSocket message types ───────────────────────────────────────────────────

// Server → Client
export type ServerMessage =
  | {
      type: "presenter_authenticated";
      polls: Poll[];
      activePolls: ActivePollMap;
      currentSlide: number;
    }
  | {
      type: "poll_state";
      polls: Poll[];
      activePolls: ActivePollMap;
      currentSlide: number;
    }
  | {
      type: "slide_change";
      polls: Poll[];
      activePolls: ActivePollMap;
      slideIndex: number;
      activePollId?: string;
    }
  | {
      type: "audience_welcomed";
      polls: Poll[];
      activePolls: ActivePollMap;
      currentSlide: number;
    }
  | { type: "audience_state"; audienceCount: number };

// Client → Server
export type ClientMessage =
  | { type: "presenter_connect"; token: string }
  | { type: "audience_join" }
  | { type: "audience_vote"; pollId: string; optionIndex: number }
  | { type: "audience_word"; pollId: string; text: string }
  | { type: "polls_define"; polls: Poll[] }
  | { type: "poll_start"; pollId: string }
  | { type: "poll_stop"; pollId: string }
  | { type: "poll_reset"; pollId: string }
  | { type: "poll_reveal"; pollId: string }
  | { type: "poll_selected"; slideIndex: number; pollId: string }
  | { type: "presenter_navigate"; slideIndex: number; activePollId?: string };
