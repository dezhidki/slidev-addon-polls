import { ref } from "vue"

export interface PollConfig {
  token: string
  polls: any[]
  pollsBySlide: Record<number, string[]>
  qrUrl?: string
}

/** Shared config set by <PollServer> and read by the global bottom component */
export const globalPollConfig = ref<PollConfig | null>(null)
