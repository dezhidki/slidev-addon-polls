import { ref } from "vue";

export interface PollConfig {
  /** URL to encode in the QR badge shown to the audience */
  qrUrl?: string;
}

/** Set from the first slide's headmatter (pollQr field) */
export const globalPollConfig = ref<PollConfig | null>(null);
