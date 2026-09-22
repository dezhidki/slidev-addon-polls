/**
 * Slidev generates `#slidev/configs` per deck, so there is nothing for the compiler to
 * resolve in this repo on its own. Not shipped: a deck has Slidev's own declaration.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
declare module "#slidev/configs" {
  import type { SlidevConfig } from "@slidev/types";

  const configs: SlidevConfig;
  export default configs;
}
