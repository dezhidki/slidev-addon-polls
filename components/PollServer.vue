<template>
  <div v-show="false" />
</template>

<script setup lang="ts">
import { onMounted } from "vue"
import { ensurePresenterWs } from "../setup/polls"
import { globalPollConfig } from "../setup/globalConfig"

const props = defineProps({
  presenter: { type: Boolean, default: false },
  token: { type: String, default: "changeme" },
  polls: { type: Array, default: () => [] },
  /** URL to generate a floating QR code on every slide */
  qrUrl: { type: String, default: "" },
})

onMounted(() => {
  // Build pollsBySlide map
  const pollsBySlide: Record<number, string[]> = {}
  ;(props.polls as any[]).forEach((p: any) => {
    const si = Number(p.slideIndex ?? -1)
    if (!pollsBySlide[si]) pollsBySlide[si] = []
    pollsBySlide[si].push(p.id)
  })

  // Publish to global config (consumed by global-bottom.vue for nav sync + QR)
  globalPollConfig.value = {
    token: props.token,
    polls: props.polls as any[],
    pollsBySlide,
    qrUrl: props.qrUrl || undefined,
  }

  if (props.presenter && (props.polls as any[]).length) {
    ensurePresenterWs(props.token, props.polls as any[])
  }
})
</script>
