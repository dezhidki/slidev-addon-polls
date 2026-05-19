import { ref } from "vue";
import type { ActivePollMap, Poll } from "../types";

export interface PollConfig {
  token: string;
  polls: Poll[];
  pollsBySlide: Record<number, string[]>;
  qrUrl?: string;
}

/** Shared config set by <PollServer> and read by the global bottom component */
export const globalPollConfig = ref<PollConfig | null>(null);
