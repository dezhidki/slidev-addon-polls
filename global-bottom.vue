<template>
  <!-- Invisible persistent component — survives slide navigation -->
  <div style="display:none" />

  <!-- Floating QR badge — shown only in presenter mode when qrUrl is set -->
  <Teleport v-if="!isPresenter && qrUrl" to="body">
    <div class="poll-qr-float" :class="{ minimized: minimized }">
      <button class="qr-toggle" @click="minimized = !minimized" :title="minimized ? 'Show QR' : 'Minimize'">
        {{ minimized ? '📱' : '✕' }}
      </button>
      <div v-show="!minimized" class="qr-inner">
        <div class="qr-label">Join the poll</div>
        <canvas ref="qrCanvas" width="120" height="120" class="qr-canvas" />
        <div class="qr-link">{{ shortUrl }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from "vue"
import { useNav } from "@slidev/client"
import { slides } from "#slidev/slides"
import QRCode from "qrcode"
import { ensurePresenterWs, sendToServer } from "./setup/polls"
import { globalPollConfig } from "./setup/globalConfig"

const { currentPage: slideNo, isPresenter } = useNav()
const minimized = ref(false)
const qrCanvas = ref<HTMLCanvasElement | null>(null)

const qrUrl = computed(() => globalPollConfig.value?.qrUrl ?? "")
const shortUrl = computed(() => {
  try {
    return new URL(qrUrl.value).host + new URL(qrUrl.value).pathname
  } catch {
    return qrUrl.value
  }
})

async function renderQR() {
  if (!qrCanvas.value || !qrUrl.value) return
  try {
    await QRCode.toCanvas(qrCanvas.value, qrUrl.value, {
      width: 120,
      margin: 2,
      color: { dark: "#002957", light: "#EDE1CE" },
      errorCorrectionLevel: "M",
    })
  } catch (e) {
    console.error("[global-bottom] QR render failed:", e)
  }
}

watch([qrUrl, minimized], async ([url, min]) => {
  if (url && !min) {
    await nextTick()
    renderQR()
  }
})

/** Bootstrap from headmatter if PollServer hasn't run yet */
function bootstrapFromHeadmatter() {
  if (globalPollConfig.value) return // already set by PollServer
  const headmatter = slides.value?.[0]?.meta?.slide?.frontmatter?.polls ?? null
  if (!headmatter) return
  const rawPolls: any[] = headmatter.questions ?? []
  const token: string = headmatter.token ?? "changeme"
  const qrUrl: string = headmatter.qrUrl ?? ""
  if (!rawPolls.length) return
  const pollsBySlide: Record<number, string[]> = {}
  rawPolls.forEach((p: any) => {
    const si = Number(p.slideIndex ?? -1)
    if (!pollsBySlide[si]) pollsBySlide[si] = []
    pollsBySlide[si].push(p.id)
  })
  globalPollConfig.value = { token, polls: rawPolls, pollsBySlide, qrUrl: qrUrl || undefined }
}

function announce() {
  bootstrapFromHeadmatter()
  const cfg = globalPollConfig.value
  if (!cfg) return
  if (isPresenter.value) {
    ensurePresenterWs(cfg.token, cfg.polls)
    sendToServer({
      type: "presenter_navigate",
      slideIndex: slideNo.value,
      activePollId: cfg.pollsBySlide?.[slideNo.value]?.[0],
    })
  }
}

watch(slideNo, announce)
watch(slides, () => { bootstrapFromHeadmatter(); announce() }, { deep: false })
onMounted(async () => {
  announce()
  await nextTick()
  renderQR()
})
</script>

<style>
.poll-qr-float {
  position: fixed;
  bottom: 18px;
  right: 18px;
  z-index: 9999;
  background: rgba(0, 29, 61, 0.96);
  border: 1px solid rgba(194, 154, 91, 0.35);
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
  gap: 0.3rem;
  transition: all 0.25s ease;
  font-family: 'Lato', sans-serif;
}
.poll-qr-float.minimized {
  padding: 0.2rem 0.3rem;
}
.qr-toggle {
  align-self: flex-end;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  color: #c29a5b;
  padding: 0.1rem 0.25rem;
  line-height: 1;
}
.qr-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}
.qr-canvas {
  border-radius: 6px;
}
.qr-label {
  font-size: 0.7rem;
  font-weight: 700;
  color: #e8c87a;
  text-align: center;
  letter-spacing: 0.03em;
}
.qr-link {
  font-size: 0.6rem;
  color: #a8bdd0;
  text-align: center;
  word-break: break-all;
  max-width: 120px;
}
</style>
