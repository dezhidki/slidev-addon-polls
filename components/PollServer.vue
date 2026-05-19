<template>
  <div v-show="false" />
</template>

<script setup lang="ts">
import { watch } from "vue"
import { ensurePresenterWs } from "../setup/polls"
import { globalPollConfig } from "../setup/globalConfig"
import { slides } from "#slidev/slides"

const props = defineProps({
  presenter: { type: Boolean, default: false },
  token: { type: String, default: "" },
  polls: { type: Array, default: () => [] },
  /** URL to generate a floating QR code on every slide */
  qrUrl: { type: String, default: "" },
})

function applyConfig() {
  // Prefer headmatter config (slide 1 frontmatter) over props
  const headmatter = slides.value?.[0]?.meta?.slide?.frontmatter?.polls ?? null
  const rawPolls: any[] = headmatter?.questions ?? (props.polls as any[])
  const token: string = headmatter?.token ?? props.token ?? "changeme"
  const qrUrl: string = headmatter?.qrUrl ?? props.qrUrl ?? ""

  if (!rawPolls.length) return

  const pollsBySlide: Record<number, string[]> = {}
  rawPolls.forEach((p: any) => {
    const si = Number(p.slideIndex ?? -1)
    if (!pollsBySlide[si]) pollsBySlide[si] = []
    pollsBySlide[si].push(p.id)
  })

  globalPollConfig.value = { token, polls: rawPolls, pollsBySlide, qrUrl: qrUrl || undefined }

  if (props.presenter) {
    ensurePresenterWs(token, rawPolls)
  }
}

// Run immediately AND watch for slides data to load
applyConfig()
watch(slides, applyConfig, { deep: false })
</script>
