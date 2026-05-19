<template>
  <!-- Invisible persistent component — survives slide navigation -->
  <div style="display:none" />

  <!-- Floating QR badge — shown on every slide when qrUrl is set -->
  <Teleport v-if="qrUrl" to="body">
    <div class="poll-qr-float" :class="{ minimized: minimized }">
      <button class="qr-toggle" @click="minimized = !minimized" :title="minimized ? 'Show QR' : 'Minimize'">
        {{ minimized ? '📱' : '✕' }}
      </button>
      <div v-show="!minimized" class="qr-inner">
        <div class="qr-label">{{ qrLabel }}</div>
        <img :src="qrImgUrl" alt="Join poll" width="120" height="120" />
        <div class="qr-link">{{ shortUrl }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue"
import { useNav } from "@slidev/client"
import { ensurePresenterWs, sendToServer } from "./setup/polls"
import { globalPollConfig } from "./setup/globalConfig"

const { currentPage: slideNo, isPresenter } = useNav()
const minimized = ref(false)

const qrUrl = computed(() => globalPollConfig.value?.qrUrl ?? "")
const qrLabel = computed(() => "Join the poll")
const shortUrl = computed(() => {
  try {
    return new URL(qrUrl.value).host + new URL(qrUrl.value).pathname
  } catch {
    return qrUrl.value
  }
})
const qrImgUrl = computed(() => {
  if (!qrUrl.value) return ""
  const sz = 120
  return `https://api.apiqr.cc/qrcode?data=${encodeURIComponent(qrUrl.value)}&size=${sz}x${sz}&color=002957&bgcolor=EDE1CE&ecc=M`
})

function announce() {
  if (!isPresenter.value) return
  const cfg = globalPollConfig.value
  if (!cfg) return
  ensurePresenterWs(cfg.token, cfg.polls)
  sendToServer({
    type: "presenter_navigate",
    slideIndex: slideNo.value,
    activePollId: cfg.pollsBySlide?.[slideNo.value]?.[0],
  })
}

watch(slideNo, announce)
onMounted(announce)
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
.qr-inner img {
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
