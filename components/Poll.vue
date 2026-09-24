<script setup lang="ts">
/**
 * One live poll on a slide: a choice poll, a quiz, or a word cloud.
 *
 *     <Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" />              choice
 *     <Poll question="What is 2 + 2?" :options="['3', '4', '5']" :correct="1" />     quiz
 *     <Poll question="One word for this lecture?" />                                 cloud
 *
 * Draws with the slide's own text colour and font, plus `--slidev-theme-primary` for the
 * bars, so it looks at home in any theme. The controls only exist in presenter mode.
 *
 * The QR code sits in the slide's top right corner, beside the title, as large as the
 * space above the slide's content allows — so it never reaches into the content. The
 * `qrSize` prop (or `--poll-qr-size`) is its full size; `--poll-qr-top` / `--poll-qr-right`
 * move it. In PDF export only the question and its options are printed.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { useNav, useSlideContext } from "@slidev/client";
import { computed, onMounted, onUnmounted, ref, watchEffect } from "vue";
import { polls } from "../client";
import type { PollView } from "../protocol.ts";
import PollQr from "./PollQr.vue";

const props = defineProps<{
  /** Keeps the poll's answers when its slide moves or its question is edited. Unique in the deck. */
  id?: string;
  question: string;
  /** Absent for a word cloud. */
  options?: string[];
  /** Index into `options`: makes this a quiz, with a right answer to reveal. */
  correct?: number;
  /** How wide the QR code may be, any CSS length. Default 140px. */
  qrSize?: string;
  /** Set by `<PollSet>`: [position, of], shown as "2 / 3". */
  step?: [number, number];
  /** Set by `<PollSet>` on the members that are not showing: keeps its place, invisibly. */
  hidden?: boolean;
}>();

const { $page, $renderContext } = useSlideContext();
const { isPresenter, isPrintMode } = useNav();

const id = props.id ?? `${$page.value}:${props.question}`;
polls.define({
  id,
  slide: $page.value,
  question: props.question,
  options: props.options,
  correct: props.correct,
});

// Phones show the polls that are on the presenter's screen: not the ones in the next-slide
// preview or the overview, and not the hidden members of a <PollSet>.
const inMainView = ["slide", "presenter"].includes($renderContext.value);
let leaveScreen: (() => void) | undefined;
watchEffect(() => {
  leaveScreen?.();
  leaveScreen = inMainView && !props.hidden ? polls.show(id) : undefined;
});
onUnmounted(() => leaveScreen?.());

/** What to draw before the server has said anything about this poll. */
const idle: PollView = {
  id,
  slide: $page.value,
  question: props.question,
  options: props.options ?? null,
  quiz: props.correct != null,
  state: "idle",
  revealed: false,
  round: 0,
  total: 0,
  votes: props.options?.map(() => 0) ?? null,
  words: [],
  correct: null,
};
const poll = computed(() => polls.state.byId[id] ?? idle);

const percent = (i: number) =>
  poll.value.total ? Math.round(((poll.value.votes?.[i] ?? 0) / poll.value.total) * 100) : 0;

// Alphabetical, so words stay put while the counts change under them.
const words = computed(() => [...poll.value.words].sort(([a], [b]) => a.localeCompare(b)));
const mostCommon = computed(() => Math.max(1, ...poll.value.words.map(([, n]) => n)));

const status = computed(() => {
  if (!polls.state.connected) {
    return "Poll server offline";
  }
  const n = poll.value.total;
  const answers = `${n} ${n === 1 ? "answer" : "answers"}`;
  const joined = isPresenter.value ? ` · ${polls.state.audience} joined` : "";
  const text = {
    idle: `Voting opens soon${joined}`,
    open: `Voting open · ${answers}${joined}`,
    closed: `Voting closed · ${answers}${joined}`,
  }[poll.value.state];
  return props.step ? `${props.step.join(" / ")} · ${text}` : text;
});

// The QR code is pinned to the slide's top right corner and capped to the empty band
// beside the title: from its own top down to where the slide's content begins, which is
// the bottom of the title's margin. Same band on every slide, so the same size.
const root = ref<HTMLElement>();
const gap = ref({ width: "0px", height: "0px" });
let sizes: ResizeObserver | undefined;
onMounted(() => {
  const box = root.value;
  const code = box?.querySelector<HTMLElement>(".poll-corner");
  const layout = box?.closest<HTMLElement>(".slidev-layout");
  const title = layout?.querySelector<HTMLElement>("h1");
  if (!box || !code) {
    return;
  }
  // On the layout, not on the code: the title's padding is sized from it too.
  if (props.qrSize) {
    layout?.style.setProperty("--poll-qr-size", props.qrSize);
  }

  const CLEARANCE = 8;
  const TOO_SMALL = 64; // below this nobody can scan it: then the band stops capping it
  const measure = () => {
    // Layout offsets throughout, so it holds at any slide scale and canvas size.
    let band = Number.POSITIVE_INFINITY;
    if (title && title.offsetParent === code.offsetParent) {
      const contentTop =
        title.offsetTop +
        title.offsetHeight +
        Number.parseFloat(getComputedStyle(title).marginBottom);
      band = contentTop - code.offsetTop - CLEARANCE;
    }
    if (band >= TOO_SMALL) {
      code.style.setProperty("--poll-qr-band", `${band}px`);
    } else {
      code.style.removeProperty("--poll-qr-band");
    }

    // No title, or hardly any band: the code does reach into the poll. An invisible float
    // of that size keeps the question and the options from running underneath it.
    if (box.offsetParent !== code.offsetParent) {
      return;
    }
    const width = box.offsetLeft + box.offsetWidth - code.offsetLeft + 2 * CLEARANCE;
    const height = code.offsetTop + code.offsetHeight + 2 * CLEARANCE - box.offsetTop;
    const reaches = width > 0 && height > 0;
    gap.value = { width: `${reaches ? width : 0}px`, height: `${reaches ? height : 0}px` };
  };
  sizes = new ResizeObserver(measure);
  for (const el of [box, code, title]) {
    if (el) {
      sizes.observe(el);
    }
  }
  measure();
});
onUnmounted(() => sizes?.disconnect());

// A misclick must not wipe a room's answers: Reset asks once more for three seconds.
const confirmingReset = ref(false);
function act(type: "open" | "close" | "reveal" | "reset", event: MouseEvent) {
  // Drop focus, or the presenter's next Space (= next slide) would press this button again.
  (event.currentTarget as HTMLElement).blur();
  if (type === "reset" && !confirmingReset.value) {
    confirmingReset.value = true;
    setTimeout(() => (confirmingReset.value = false), 3000);
    return;
  }
  confirmingReset.value = false;
  polls.send({ type, id });
}
</script>

<template>
  <!-- On paper there is nothing to vote on: just the question and its options. -->
  <div v-if="isPrintMode" class="poll-print">
    <p class="poll-question">{{ question }}</p>
    <ol v-if="options" type="A">
      <li v-for="option in options" :key="option">{{ option }}</li>
    </ol>
  </div>

  <div
    v-else
    ref="root"
    class="poll"
    :class="{ 'poll-hidden': hidden }"
    :aria-hidden="hidden || undefined"
  >
    <PollQr class="poll-corner" />
    <span class="poll-corner-gap" :style="gap" />
    <p class="poll-question">{{ question }}</p>

    <ol v-if="options" class="poll-options">
      <li
        v-for="(option, i) in options"
        :key="i"
        :class="{
          'poll-correct': poll.revealed && i === correct,
          'poll-wrong': poll.revealed && i !== correct,
        }"
      >
        <span class="poll-label">
          <svg v-if="poll.revealed && i === correct" viewBox="0 0 16 16" aria-label="Correct answer:">
            <path d="M2.5 8.5l3.5 3.5 7.5-8" />
          </svg>
          {{ option }}
        </span>
        <span v-if="poll.votes && poll.total" class="poll-count">
          {{ poll.votes[i] }} · {{ percent(i) }} %
        </span>
        <span class="poll-track">
          <span class="poll-bar" :style="{ transform: `scaleX(${percent(i) / 100})` }" />
        </span>
      </li>
    </ol>

    <!-- While voting is open only the presenter gets the words, to weed them first. -->
    <p v-else class="poll-cloud">
      <component
        :is="isPresenter ? 'button' : 'span'"
        v-for="[word, n] in words"
        :key="word"
        :style="{ fontSize: `${0.8 + (1.8 * n) / mostCommon}em` }"
        :title="isPresenter ? 'Remove this word' : undefined"
        @click="isPresenter && polls.send({ type: 'remove', id, word })"
      >
        {{ word }}
      </component>
      <span v-if="poll.state === 'open' && !isPresenter" class="poll-note">
        The words appear when voting closes.
      </span>
    </p>

    <p class="poll-status" aria-live="polite">{{ status }}</p>

    <div v-if="isPresenter" class="poll-controls">
      <p v-if="polls.state.denied">The poll server rejected the presenter password.</p>
      <template v-else-if="polls.state.connected">
        <button v-if="poll.state !== 'open'" @click="act('open', $event)">
          {{ poll.state === "closed" ? "Reopen voting" : "Open voting" }}
        </button>
        <button v-else @click="act('close', $event)">Close voting</button>
        <button v-if="correct != null && !poll.revealed" :disabled="!poll.total" @click="act('reveal', $event)">
          Reveal answer
        </button>
        <button v-if="poll.total || poll.state !== 'idle'" @click="act('reset', $event)">
          {{ confirmingReset ? "Really reset?" : "Reset" }}
        </button>
        <p v-if="!options && poll.state === 'open'" class="poll-note">
          Only you see the words until you close voting. Click a word to remove it.
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.poll {
  --poll-faint: color-mix(in srgb, currentColor 14%, transparent);
}
.poll-hidden {
  visibility: hidden;
  pointer-events: none;
}
/* Positioned against the slide, not the poll (nothing in between is positioned). In px,
   like the rest of a Slidev canvas, which is scaled to the window as a whole. */
.poll-corner {
  position: absolute;
  top: var(--poll-qr-top, 12px);
  right: var(--poll-qr-right, 32px);
  display: flex;
  flex-direction: row-reverse; /* the address beside the code, so the code gets the full band */
  align-items: center;
  gap: 10px;
  font-size: 15px;
}
/* Its own size, capped by whatever band is free beside the title. */
.poll-corner :deep(.poll-qr-code) {
  width: var(--poll-qr-size, 140px);
  max-width: var(--poll-qr-band, none);
}
.poll-corner :deep(figcaption) {
  max-width: 110px;
  margin: 0;
  text-align: right;
}
.poll-corner-gap {
  float: right;
}

.poll-print .poll-question {
  margin-bottom: 0.4em;
}
.poll-print ol {
  margin: 0 0 1em;
  padding-left: 1.6em;
  list-style: upper-alpha;
}

.poll-question {
  margin: 0 0 1em;
  font-size: 1.2em;
  font-weight: 700;
  line-height: 1.2;
  text-wrap: balance;
}

.poll-options {
  /* One grid, so it keeps clear of the QR code's corner as a whole: every bar's track has
     the same width, which is what makes the bars comparable. */
  display: grid;
  gap: 0.8em;
  margin: 0;
  padding: 0;
  list-style: none;
}
.poll-options li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.3em 1em;
  margin: 0;
  padding: 0;
  transition: opacity 0.4s;
}
.poll-wrong {
  opacity: 0.45;
}
.poll-correct .poll-label {
  font-weight: 700;
}
.poll-label svg {
  display: inline;
  width: 0.8em;
  margin-right: 0.15em;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
}
.poll-count {
  font-variant-numeric: tabular-nums;
}
.poll-track {
  grid-column: 1 / -1;
  height: 0.6em;
  background: var(--poll-faint);
}
.poll-bar {
  display: block;
  height: 100%;
  background: var(--slidev-theme-primary, currentColor);
  transform-origin: left;
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.poll-cloud {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.2em 0.8em;
  min-height: 6em;
  margin: 0;
  line-height: 1.1;
}
.poll-cloud > * {
  font-weight: 700;
  transition: font-size 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.poll-cloud button {
  cursor: pointer;
}
.poll-cloud button:hover {
  text-decoration: line-through;
}
.poll-cloud button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.poll .poll-note {
  flex-basis: 100%;
  margin: 0;
  font-size: 1em;
  font-weight: 400;
  opacity: 0.7;
}

.poll-status {
  margin: 1.4em 0 0;
  font-size: 0.7em;
  font-variant-numeric: tabular-nums;
}

.poll-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5em;
  margin-top: 0.8em;
  font-size: 0.7em;
}
.poll-controls p {
  margin: 0;
}
.poll-controls button {
  padding: 0.4em 1em;
  border: 1px solid currentColor;
  font-weight: 700;
  cursor: pointer;
}
.poll-controls button:hover:not(:disabled) {
  background: var(--poll-faint);
}
.poll-controls button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.poll-controls button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .poll-bar,
  .poll-cloud > *,
  .poll-options li {
    transition: none;
  }
}
</style>

<style>
/* The slide's top right corner holds the QR code and its address, so a long title wraps
   before them. */
.slidev-layout:has(.poll-corner) h1 {
  padding-right: calc(var(--poll-qr-size, 140px) + 120px);
}
</style>
