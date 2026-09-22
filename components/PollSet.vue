<script setup lang="ts">
/**
 * Several polls about the same thing — one code block, say — in the space of one. Move
 * between them like any other click on the slide (→ / ←); the phones follow along.
 *
 *     <PollSet :polls="[
 *       { question: 'What does it print?', options: ['1', '2', 'Nothing'], correct: 1 },
 *       { question: 'And if n is negative?', options: ['Loops forever', 'RecursionError'], correct: 1 },
 *     ]" />
 *
 * In PDF export all of them are printed under each other (with `--with-clicks`: one per
 * page).
 *
 * @author Written by Claude (Anthropic) under human review.
 */
import { useNav, useSlideContext } from "@slidev/client";
import { onMounted, onUnmounted, ref, watchEffect } from "vue";
import Poll from "./Poll.vue";

/** One question of the set. The same three props `<Poll>` takes. */
interface SetMember {
  question: string;
  options?: string[];
  correct?: number;
}

const props = defineProps<{ polls: SetMember[] }>();

const { isPrintMode, isPrintWithClicks } = useNav();
const { $clicksContext } = useSlideContext();

// One click per further question, the way Slidev's own <v-switch> claims its clicks.
const current = ref(0);
const clicksId = `poll-set-${props.polls[0]?.question}`;
onMounted(() => {
  const clicks = $clicksContext.calculateSince("+1", props.polls.length - 1);
  if (!clicks) {
    return;
  }
  $clicksContext.register(clicksId, clicks);
  watchEffect(() => {
    current.value = Math.min(Math.max(clicks.currentOffset.value + 1, 0), props.polls.length - 1);
  });
});
onUnmounted(() => $clicksContext.unregister(clicksId));
</script>

<template>
  <div v-if="isPrintMode && !isPrintWithClicks">
    <Poll v-for="poll in polls" :key="poll.question" v-bind="poll" />
  </div>
  <!-- All members share one grid cell, the hidden ones merely invisible: the set is always
       as tall as its tallest question, so nothing around it moves when you switch. -->
  <div v-else class="poll-set">
    <Poll
      v-for="(poll, i) in polls"
      :key="poll.question"
      v-bind="poll"
      :step="[i + 1, polls.length]"
      :hidden="i !== current"
    />
  </div>
</template>

<style scoped>
.poll-set {
  display: grid;
}
.poll-set > * {
  grid-area: 1 / 1;
}
</style>
