<!-- Renders nothing: keeps the poll connection alive across slides and tells the
     audience's phones which slide the presenter is on and which reactions it accepts. -->
<script setup lang="ts">
import { useNav } from "@slidev/client";
import { watchEffect } from "vue";
import configs from "#slidev/configs";
import { sync } from "./client";

const DEFAULT_REACTIONS = ["👍", "👎", "🤔", "❤️"];

const { isPresenter, currentPage, currentSlideRoute } = useNav();

// `reactions:` in a slide's frontmatter beats the headmatter, which beats the default.
// false turns them off, a list replaces the emoji, true means the default set.
function reactionsFor(setting: unknown): string[] {
  if (setting === false) return [];
  return Array.isArray(setting) ? setting.map(String) : DEFAULT_REACTIONS;
}

// `reactionCooldown:` — seconds one person waits between reactions (default 3) — likewise.
watchEffect(() => {
  const slide = currentSlideRoute.value?.meta?.slide?.frontmatter ?? {};
  const deck = configs as { reactions?: unknown; reactionCooldown?: number };
  sync(
    isPresenter.value,
    currentPage.value,
    reactionsFor(slide.reactions ?? deck.reactions),
    slide.reactionCooldown ?? deck.reactionCooldown,
  );
});
</script>

<template>
  <span hidden />
</template>
