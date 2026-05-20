<template>
  <PollDisplay
    :slide-index="slideIndex"
    :poll-ids="pollIds"
    :readonly="!isPresenter"
    :compact="compact"
  />
</template>

<script setup lang="ts">
import { useNav, useSlideContext } from "@slidev/client";
import { onMounted } from "vue";
import { registerPoll } from "../setup/polls";
import type { RawQuestion } from "../types";
import PollDisplay from "./PollDisplay.vue";

const props = defineProps({
  questions: { type: Array as () => RawQuestion[], required: true },
  /** Compact layout — reduces internal padding, use when poll shares a slide with code */
  compact: { type: Boolean, default: false },
});

const { $page } = useSlideContext();
const { isPresenter } = useNav();

const slideIndex = $page.value;
const pollIds: string[] = props.questions.map((_, i) => `slide-${slideIndex}-q${i}`);

function registerAll() {
  for (let i = 0; i < props.questions.length; i++) {
    const q = props.questions[i];
    registerPoll({
      id: pollIds[i],
      slideIndex,
      type: q.type,
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
      votes: new Array((q.options ?? []).length).fill(0) as number[],
      state: "idle",
      revealed: false,
      wordCounts: {},
    });
  }
}

// Register immediately (for SSR/static render) and again on mount (for hydration)
registerAll();
onMounted(registerAll);
</script>
