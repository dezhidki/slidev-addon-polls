<template>
  <div v-show="false" />
</template>

<script setup lang="ts">
import { watch } from "vue";
import { slides } from "#slidev/slides";
import { globalPollConfig } from "../setup/globalConfig";
import { ensurePresenterWs } from "../setup/polls";
import type { Poll } from "../types";

const props = defineProps({
  presenter: { type: Boolean, default: false },
  token: { type: String, default: "" },
  polls: { type: Array as () => Poll[], default: () => [] },
  qrUrl: { type: String, default: "" },
});

function applyConfig() {
  // Prefer headmatter config (slide 1 frontmatter) over props
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headmatter = (slides.value?.[0]?.meta?.slide?.frontmatter as Record<string, unknown>)
    ?.polls as Record<string, unknown> | null | undefined;

  const rawPolls: Poll[] = (headmatter?.questions as Poll[] | undefined) ?? props.polls;
  const token: string = (headmatter?.token as string | undefined) ?? props.token ?? "changeme";
  const qrUrl: string = (headmatter?.qrUrl as string | undefined) ?? props.qrUrl ?? "";

  if (!rawPolls.length) return;

  const pollsBySlide: Record<number, string[]> = {};
  for (const p of rawPolls) {
    const si = Number(p.slideIndex ?? -1);
    if (!pollsBySlide[si]) pollsBySlide[si] = [];
    pollsBySlide[si].push(p.id);
  }

  globalPollConfig.value = { token, polls: rawPolls, pollsBySlide, qrUrl: qrUrl || undefined };

  if (props.presenter) {
    ensurePresenterWs(token, rawPolls);
  }
}

// Run immediately AND watch for slides data to load
applyConfig();
watch(slides, applyConfig, { deep: false });
</script>
