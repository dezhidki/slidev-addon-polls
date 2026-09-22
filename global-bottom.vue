<script setup lang="ts">
/**
 * Renders nothing: keeps the poll connection alive across slides and tells the audience's
 * phones which slide the presenter is on and which reactions it accepts.
 *
 * `reactions:` in a slide's frontmatter beats the headmatter, which beats the default.
 * `false` turns them off, a list replaces the emoji, anything else means the default set.
 * `reactionCooldown:` — seconds one person waits between reactions — works the same way.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { useNav } from "@slidev/client";
import { watchEffect } from "vue";
import { type PollConfig, pollConfig, polls } from "./client";

const DEFAULT_REACTIONS = ["👍", "👎", "🤔", "❤️"];

const { isPresenter, currentPage, currentSlideRoute } = useNav();

/** The emoji a slide accepts, out of its own frontmatter or the deck's headmatter. */
function reactionsFor(setting: unknown): string[] {
  if (setting === false) {
    return [];
  }
  return Array.isArray(setting) ? setting.map(String) : DEFAULT_REACTIONS;
}

watchEffect(() => {
  // Slidev leaves `route.meta.slide` untyped here. A slide's frontmatter takes the same
  // keys as the deck's headmatter.
  const info = currentSlideRoute.value?.meta.slide as { frontmatter?: PollConfig } | undefined;
  const slide = info?.frontmatter ?? {};
  polls.sync(
    isPresenter.value,
    currentPage.value,
    reactionsFor(slide.reactions ?? pollConfig.reactions),
    slide.reactionCooldown ?? pollConfig.reactionCooldown,
  );
});
</script>

<template>
  <span hidden />
</template>
