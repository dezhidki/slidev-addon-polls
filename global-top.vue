<script setup lang="ts">
/**
 * Reactions: emoji the audience taps on their phones float up the side of the slide.
 * Each emoji rises from its own spot, so a hall of hearts reads as one stream of hearts.
 * In presenter mode the corner also counts them for the current slide.
 *
 * Headmatter, or any slide's frontmatter:
 *
 *     reactions: false                 # off
 *     reactions: ["👏", "😮", "❓"]     # your own set
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { useNav } from "@slidev/client";
import { ref, watch } from "vue";
import { polls } from "./client";
import type { Tally } from "./protocol.ts";

const { isPresenter, isPrintMode } = useNav();

/** One emoji on its way up the side of the slide. */
interface Floater {
  id: number;
  emoji: string;
  /** The custom properties the `rise` animation is built from. */
  style: Record<string, string>;
}

const MAX_ON_SCREEN = 60; // a flood thins out instead of grinding the projector's laptop
const MAX_PER_BURST = 6;
const LANES = 4;

const floaters = ref<Floater[]>([]);
let nextId = 0;
/** Emoji to its spot, in order of first appearance. */
const lanes = new Map<string, number>();

const calm = matchMedia("(prefers-reduced-motion: reduce)");

/** Sends one burst of reactions up the side of the slide. */
function float(counts: Tally): void {
  if (calm.matches) {
    return; // the presenter's count still moves
  }
  for (const [emoji, count] of Object.entries(counts)) {
    if (!lanes.has(emoji)) {
      lanes.set(emoji, lanes.size);
    }
    const lane = lanes.get(emoji) ?? 0;
    for (let i = 0; i < Math.min(count, MAX_PER_BURST); i++) {
      if (floaters.value.length >= MAX_ON_SCREEN) {
        return;
      }
      floaters.value.push({
        id: nextId++,
        emoji,
        style: {
          "--lane": String(lane % LANES),
          "--sway": `${Math.random() * 56 - 28}px`,
          "--size": `${0.85 + Math.random() * 0.5}`,
          "--time": `${2.6 + Math.random() * 1.2}s`,
          "--delay": `${i * 90}ms`,
        },
      });
    }
  }
}

// A fresh object per burst, so this fires again even when the same emoji arrives twice.
watch(() => polls.state.burst, float);

const land = (id: number) => {
  floaters.value = floaters.value.filter((floater) => floater.id !== id);
};
</script>

<template>
  <div v-if="!isPrintMode" class="reactions" aria-hidden="true">
    <span v-for="f in floaters" :key="f.id" class="floater" :style="f.style" @animationend="land(f.id)">
      {{ f.emoji }}
    </span>

    <p v-if="isPresenter && Object.keys(polls.state.tally).length" class="tally">
      <span v-for="(count, emoji) in polls.state.tally" :key="emoji">{{ emoji }} {{ count }}</span>
    </p>
  </div>
</template>

<style scoped>
.reactions {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.floater {
  position: absolute;
  /* Hugs the right edge, where slides keep their margin, so content stays readable. */
  right: calc(12px + var(--lane) * 24px);
  bottom: 40px;
  font-size: calc(26px * var(--size));
  line-height: 1;
  opacity: 0;
  animation: rise var(--time) cubic-bezier(0.2, 0.7, 0.3, 1) var(--delay) forwards;
}
/* Pops in, drifts sideways on the way up, lets go a little above half height: the top
   right corner belongs to the poll's QR code, which an emoji must not cover. */
@keyframes rise {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.4);
  }
  12% {
    opacity: 1;
    transform: translate(0, -30px) scale(1);
  }
  60% {
    opacity: 1;
    transform: translate(var(--sway), -170px) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(calc(var(--sway) * -0.6), -290px) scale(0.9);
  }
}

.tally {
  position: absolute;
  top: 10px;
  right: 14px;
  display: flex;
  gap: 10px;
  margin: 0;
  padding: 3px 9px;
  background: rgb(0 0 0 / 0.72);
  color: #fff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
</style>
