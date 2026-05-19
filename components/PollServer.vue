<template>
  <div v-show="false">
    <!-- PollServer — declarative config, resets on slide change -->
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue"
import { useNav } from "@slidev/client"
import {
  ensurePresenterWs,
  polls,
  sendToServer,
  connected,
} from "../setup/polls"

const props = defineProps({
  /** Enable presenter mode (connects WS as presenter) */
  presenter: { type: Boolean, default: false },
  /** Presenter authentication token */
  token: { type: String, default: "changeme" },
  /** Array of poll definitions */
  polls: {
    type: Array,
    default: () => [],
  },
})

const { currentPage: slideNo } = useNav()

// Track which polls belong to which slides
const pollsBySlide: Record<number, string[]> = {}
props.polls.forEach((p: any) => {
  const si = p.slideIndex ?? -1
  if (!pollsBySlide[si]) pollsBySlide[si] = []
  pollsBySlide[si].push(p.id)
})

function getActivePollIdForSlide(slideNo: number): string | undefined {
  const ids = pollsBySlide[slideNo]
  if (!ids?.length) return undefined
  return ids[0]
}

// Define all polls on mount (presenter side)
onMounted(() => {
  if (props.presenter && props.polls.length) {
    ensurePresenterWs(props.token, props.polls)
  }
})

// Announce slide navigation to server
let lastNav = -1
const stop = () => {
  if (slideNo.value === lastNav) return
  lastNav = slideNo.value
  const pollId = getActivePollIdForSlide(slideNo.value)
  sendToServer({
    type: "presenter_navigate",
    slideIndex: slideNo.value,
    activePollId: pollId,
  })
}
watch(slideNo, stop)
onMounted(stop)
</script>