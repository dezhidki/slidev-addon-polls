<template>
  <PollPresenter v-if="isPresenter" :slide-index="slideIndex" :poll-ids="pollIds" />
  <PollAudience v-else :slide-index="slideIndex" />
</template>

<script setup lang="ts">
import { useNav, useSlideContext } from "@slidev/client";
import { onMounted } from "vue";
import { registerPoll } from "../setup/polls";
import type { RawQuestion } from "../types";
import PollAudience from "./PollAudience.vue";
import PollPresenter from "./PollPresenter.vue";

const props = defineProps({
  questions: { type: Array as () => RawQuestion[], required: true },
});

const { $page } = useSlideContext();
const { isPresenter } = useNav();

// 1-based slide index matching Slidev's page numbering
const slideIndex = $page;

// Compute stable IDs from slide + question index, and register all polls
const pollIds: string[] = [];

for (let i = 0; i < props.questions.length; i++) {
  const q = props.questions[i];
  const id = `slide-${slideIndex.value}-q${i}`;
  pollIds.push(id);
  registerPoll({
    id,
    slideIndex: slideIndex.value,
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

// Re-register on mount in case the component is re-created after hot-reload
onMounted(() => {
  for (let i = 0; i < props.questions.length; i++) {
    const q = props.questions[i];
    const id = `slide-${slideIndex.value}-q${i}`;
    registerPoll({
      id,
      slideIndex: slideIndex.value,
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
});
</script>
