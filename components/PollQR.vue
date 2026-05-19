<template>
  <div class="poll-qr">
    <div class="qr-card">
      <div class="qr-icon">📡</div>
      <div class="qr-title">Join the poll</div>
      <div class="qr-url" @click="copy">{{ url }}</div>
      <img v-if="image" :src="image" alt="QR Code" class="qr-img" />
      <div class="qr-hint">
        Open this link on your phone — no app needed
        <span v-if="copied" class="copy-toast">Copied!</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  url?: string
  image?: string
}>()

const copied = ref(false)

const url = props.url || (typeof window !== 'undefined' ? `${window.location.origin}/vote.html` : '/vote.html')

function copy() {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => copied.value = false, 1500)
  }
}
</script>

<style scoped>
.poll-qr { display: flex; justify-content: center; align-items: center; }
.qr-card {
  background: rgba(0, 41, 87, 0.88);
  border-radius: 16px;
  padding: 1.5rem 2rem;
  text-align: center;
  border: 1px solid rgba(194, 154, 91, 0.25);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  max-width: 400px;
  width: 100%;
}
.qr-icon { font-size: 2.2rem; margin-bottom: 0.4rem; }
.qr-title {
  font-family: 'Aleo', serif;
  font-size: 1.3rem;
  font-weight: 700;
  color: #e8c87a;
  margin-bottom: 0.6rem;
}
.qr-url {
  font-family: 'Fira Code', 'Courier New', monospace;
  font-size: 1rem;
  color: #f8f6f0;
  background: rgba(15, 25, 35, 0.5);
  padding: 0.5rem 1rem;
  border-radius: 8px;
  word-break: break-all;
  cursor: pointer;
  transition: background 0.2s;
  margin-bottom: 0.8rem;
  display: inline-block;
}
.qr-url:hover { background: rgba(15, 25, 35, 0.8); }
.qr-img {
  width: 180px; height: 180px;
  border-radius: 8px;
  background: #fff;
  padding: 8px;
  margin: 0 auto 0.6rem;
  display: block;
}
.qr-hint {
  font-size: 0.82rem;
  color: #8fa4b6;
  position: relative;
}
.copy-toast {
  position: absolute;
  left: 50%; top: -1.6rem; transform: translateX(-50%);
  background: #16a34a; color: #fff;
  font-size: 0.72rem; font-weight: 700;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
}
</style>
