<template>
  <div class="poll-server-badge">
    <span class="badge-dot" :class="status" />
    <span class="badge-text">Poll server {{ statusLabel }}</span>
    <span v-if="count > 0" class="badge-count">{{ count }} online</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePolls } from '../setup/polls'

const { connected, totalAudience: count } = usePolls()

const status = computed(() => connected.value ? 'on' : 'off')
const statusLabel = computed(() => connected.value ? 'connected' : 'offline')
</script>

<style scoped>
.poll-server-badge { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: #8fa4b6; }
.badge-dot { width: 8px; height: 8px; border-radius: 50%; }
.badge-dot.on { background: #22c55e; box-shadow: 0 0 4px #22c55e; }
.badge-dot.off { background: #f1563f; }
.badge-count { font-weight: 700; color: #c29a5b; }
</style>
