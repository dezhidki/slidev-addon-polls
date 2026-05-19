<template>
  <div class="slidev-poll-qr" :class="size" :style="{ width: qrSize + 'px' }">
    <canvas ref="canvasRef" :width="qrSize" :height="qrSize" class="qr-canvas" />
    <div v-if="label" class="poll-qr-label">{{ label }}</div>
    <a v-if="showLink" :href="url" target="_blank" rel="noopener" class="poll-qr-link">{{ url }}</a>
  </div>
</template>

<script setup lang="ts">
import QRCode from "qrcode";
import { computed, onMounted, ref, watch } from "vue";

const props = defineProps<{
  url: string;
  label?: string;
  size?: "compact" | "normal" | "large";
  showLink?: boolean;
}>();

const QR_SIZES = { compact: 160, normal: 220, large: 300 };
const qrSize = computed(() => QR_SIZES[props.size || "normal"] || 220);
const canvasRef = ref<HTMLCanvasElement | null>(null);

async function renderQR() {
  if (!canvasRef.value || !props.url) return;
  try {
    await QRCode.toCanvas(canvasRef.value, props.url, {
      width: qrSize.value,
      margin: 2,
      color: { dark: "#002957", light: "#EDE1CE" },
      errorCorrectionLevel: "M",
    });
  } catch (e) {
    console.error("[PollQR] Failed to render QR:", e);
  }
}

onMounted(renderQR);
watch(() => props.url, renderQR);
watch(qrSize, renderQR);
</script>

<style scoped>
.slidev-poll-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  border: 1px solid rgba(194, 154, 91, 0.2);
}
.qr-canvas {
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
.slidev-poll-qr.compact { gap: 0.3rem; padding: 0.6rem; }
.slidev-poll-qr.large { gap: 0.8rem; padding: 1.5rem; }
.poll-qr-label {
  font-family: 'Aleo', 'Lato', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  color: #f8f6f0;
  text-align: center;
}
.slidev-poll-qr.compact .poll-qr-label { font-size: 0.82rem; }
.slidev-poll-qr.large .poll-qr-label { font-size: 1.1rem; }
.poll-qr-link {
  font-size: 0.75rem;
  color: #c29a5b;
  text-decoration: none;
  word-break: break-all;
  text-align: center;
  max-width: 100%;
}
.poll-qr-link:hover { color: #d4b47a; text-decoration: underline; }
</style>
