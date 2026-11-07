<script lang="ts">
import { TRUST_ORIGINS } from "@slidev/client/constants.ts";

// On localhost Slidev lets any viewer move the presenter, so the slides embedded in the
// voting page would reset it to slide 1. Emptying the list makes the embed receive only.
// Here, not in setup: it must run before the first navigation.
if (window.self !== window.top && new URLSearchParams(location.search).has("embedded")) {
  TRUST_ORIGINS.length = 0;
}
</script>

<script setup lang="ts">
/**
 * Renders nothing: keeps the poll connection alive across slides and tells the audience's
 * phones which slide the presenter is on and which reactions it accepts.
 *
 * `polls: { reactions: … }` in a slide's frontmatter beats the headmatter, which beats the
 * default. `false` turns them off, a list replaces the emoji, anything else means the default
 * set. `polls: { reactionCooldown: … }` — seconds one person waits between reactions — works
 * the same way.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { useNav } from "@slidev/client";
import { watchEffect } from "vue";
import { polls, settings } from "./client";
import { type PollSettings, slideReactions } from "./protocol.ts";

const { isPresenter, currentPage, currentSlideRoute } = useNav();

watchEffect(() => {
  // Slidev leaves `route.meta.slide` untyped here.
  const info = currentSlideRoute.value?.meta.slide as
    | { frontmatter?: { polls?: PollSettings } }
    | undefined;
  const { reactions, cooldown } = slideReactions(settings, info?.frontmatter?.polls);
  polls.sync(isPresenter.value, currentPage.value, reactions, cooldown);
});
</script>

<template>
  <span hidden />
</template>
