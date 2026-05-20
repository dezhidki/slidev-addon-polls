<template>
  <!-- Invisible persistent component — survives slide navigation -->
  <div style="display:none" />

  <!-- Floating QR badge — shown only in audience mode when pollQr is set in headmatter -->
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
import { useNav } from "@slidev/client";
import QRCode from "qrcode";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { slides } from "#slidev/slides";
import { ensurePresenterWs, sendToServer } from "./setup/polls";

const { currentPage: slideNo, isPresenter } = useNav();
const minimized = ref(false);
const qrCanvas = ref<HTMLCanvasElement | null>(null);

// Read pollQr from the first slide's headmatter — the ONLY config needed in slides
const qrUrl = computed(() => {
  const fm = slides.value?.[0]?.meta?.slide?.frontmatter as Record<string, unknown> | undefined;
  return (fm?.pollQr as string | undefined) ?? "";
});

const shortUrl = computed(() => {
  try {
    const u = new URL(qrUrl.value);
    return u.host + u.pathname;
  } catch {
    return qrUrl.value;
  }
});

async function renderQR() {
  if (!qrCanvas.value || !qrUrl.value) return;
  try {
    await QRCode.toCanvas(qrCanvas.value, qrUrl.value, {
      width: 120,
      margin: 2,
      color: { dark: "#002957", light: "#EDE1CE" },
      errorCorrectionLevel: "M",
    });
  } catch (e) {
    console.error("[global-bottom] QR render failed:", e);
  }
}

watch([qrUrl, minimized], async ([url, min]) => {
  if (url && !min) {
    await nextTick();
    renderQR();
  }
});

function announce() {
  if (!isPresenter.value) return;
  ensurePresenterWs();
  sendToServer({
    type: "presenter_navigate",
    slideIndex: slideNo.value,
  });
}

watch(slideNo, announce);
watch(slides, announce, { deep: false });

onMounted(async () => {
  announce();
  await nextTick();
  renderQR();
});
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
