<template>
  <div class="slidev-poll-qr" :class="size" :style="{ width: qrSize + 'px' }">
    <img
      :src="qrUrl"
      :alt="altText"
      :width="qrSize"
      :height="qrSize"
      loading="lazy"
    />
    <div v-if="label" class="poll-qr-label">{{ label }}</div>
    <a v-if="showLink" :href="url" target="_blank" rel="noopener" class="poll-qr-link">{{ url }}</a>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  url: string
  label?: string
  altText?: string
  size?: 'compact' | 'normal' | 'large'
  showLink?: boolean
  service?: string // 'qrserver' | 'goqr' | 'apiqr'
}>()

const QR_SIZES = {
  compact: 160,
  normal: 220,
  large: 300,
}

const qrSize = computed(() => QR_SIZES[props.size || 'normal'] || 220)

// Generate QR code URL using apiqr.cc
const qrUrl = computed(() => {
  const size = qrSize.value
  return `https://api.apiqr.cc/qrcode?data=${encodeURIComponent(props.url)}&size=${size}x${size}&color=002957&bgcolor=EDE1CE&ecc=M`
})

const altText = computed(() => props.altText || `QR code linking to ${props.url}`)
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
.slidev-poll-qr img {
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
.slidev-poll-qr.compact {
  gap: 0.3rem;
  padding: 0.6rem;
}
.slidev-poll-qr.large {
  gap: 0.8rem;
  padding: 1.5rem;
}
.poll-qr-label {
  font-family: 'Aleo', 'Lato', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  color: #f8f6f0;
  text-align: center;
}
.slidev-poll-qr.compact .poll-qr-label {
  font-size: 0.82rem;
}
.slidev-poll-qr.large .poll-qr-label {
  font-size: 1.1rem;
}
.poll-qr-link {
  font-size: 0.75rem;
  color: #c29a5b;
  text-decoration: none;
  word-break: break-all;
  text-align: center;
  max-width: 100%;
}
.poll-qr-link:hover {
  color: #d4b47a;
  text-decoration: underline;
}
</style>