<script setup lang="ts">
/**
 * Renders nothing: keeps the poll connection alive across slides and tells the audience's
 * phones which slide the presenter is on and which reactions it accepts.
 *
 * `reactions:` in a slide's frontmatter beats the headmatter, which beats the default.
 * `false` turns them off, a list replaces the emoji, anything else means the default set.
 * `reactionCooldown:` — seconds one person waits between reactions — works the same way.
 *
 * @author Written by Claude (Anthropic) under human review.
 */
import { useNav } from "@slidev/client";
import { watchEffect } from "vue";
import { pollConfig, polls } from "./client";

const DEFAULT_REACTIONS = ["👍", "👎", "🤔", "❤️"];

/** The two frontmatter keys this addon reads off a single slide. */
interface SlideFrontmatter {
  reactions?: unknown;
  reactionCooldown?: number;
}

/** Slidev leaves `route.meta.slide` untyped, so this names the one corner we read. */
interface SlideMeta {
  slide?: { frontmatter?: SlideFrontmatter };
}

const { isPresenter, currentPage, currentSlideRoute } = useNav();

/** The emoji a slide accepts, out of its own frontmatter or the deck's headmatter. */
function reactionsFor(setting: unknown): string[] {
  if (setting === false) {
    return [];
  }
  return Array.isArray(setting) ? setting.map(String) : DEFAULT_REACTIONS;
}

watchEffect(() => {
  const meta = currentSlideRoute.value?.meta as SlideMeta | undefined;
  const slide = meta?.slide?.frontmatter ?? {};
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
