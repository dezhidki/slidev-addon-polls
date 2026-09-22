<script setup lang="ts">
/**
 * QR code and address of the voting page. `<Poll>` shows one; use it on its own for a
 * "join now" slide:
 *
 *     <PollQr class="w-60" />
 *
 * Address, first match wins: the `url` prop, `pollUrl` in the headmatter, the page's own
 * origin — or the dev server's LAN address while you are browsing on localhost.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import QRCode from "qrcode";
import { computed, ref, watchEffect } from "vue";
import { pollConfig, polls } from "../client";

const props = defineProps<{
  /** Where the phones should go. Overrides everything else. */
  url?: string;
}>();

const onLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const url = computed(
  () =>
    props.url ??
    pollConfig.pollUrl ??
    ((onLocalhost && polls.state.joinUrl) ||
      new URL(`${import.meta.env.BASE_URL}vote`, location.href).href),
);

const shown = computed(() => new URL(url.value));

const svg = ref("");
watchEffect(async () => {
  // On a projector nothing is torn or smudged, so the lowest error correction will do. It
  // means fewer, larger modules, which is what makes a code readable from the back row.
  // Scheme and host don't care about case, and in capitals they fit the QR alphabet's
  // denser mode: a long hostname drops a whole size (29 → 25 modules).
  const { protocol, host, pathname, search } = new URL(url.value);
  const dense = `${protocol.toUpperCase()}//${host.toUpperCase()}${pathname}${search}`;
  svg.value = await QRCode.toString(dense, {
    type: "svg",
    margin: 2,
    errorCorrectionLevel: "L",
  });
});
</script>

<template>
  <figure class="poll-qr">
    <!-- Always black on white, whatever the slide's colours: that is what phones scan best. -->
    <div class="poll-qr-code" role="img" :aria-label="`QR code for ${url}`" v-html="svg" />
    <!-- <wbr>: if the address has to wrap, wrap it before the path, not mid-word. -->
    <figcaption>{{ shown.host }}<wbr />{{ shown.pathname }}</figcaption>
  </figure>
</template>

<style scoped>
.poll-qr {
  margin: 0;
}
.poll-qr-code {
  aspect-ratio: 1;
  background: #fff;
}
figcaption {
  margin-top: 0.5em;
  text-align: center; /* on the code's axis */
  font-size: 0.6em;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
</style>
