/**
 * Puts the poll backend on Slidev's own dev server: same port, same tunnel, and the
 * presenter password is whatever was passed to `slidev --remote=<password>`. Also serves
 * the voting page, and ships it with `slidev build`.
 *
 * @author Written by Claude (Anthropic) under human review.
 */
import { readFileSync } from "node:fs";
import type { ResolvedSlidevOptions } from "@slidev/types";
import type { Plugin } from "vite";
import { attachPolls } from "../server/polls.ts";

const votePage = new URL("../dist/vote.html", import.meta.url);

/** Read afresh every time, so rebuilding the page shows up without restarting Slidev. */
function votePageHtml(): Buffer {
  try {
    return readFileSync(votePage);
  } catch {
    throw new Error("slidev-addon-polls: dist/vote.html is missing — run `npm run build`");
  }
}

export default (options: ResolvedSlidevOptions): Plugin => ({
  name: "slidev-addon-polls",

  configureServer(server) {
    if (!server.httpServer) {
      return;
    }
    attachPolls(server.httpServer, {
      token: options.remote || undefined,
      joinUrl: () => {
        const lan = server.resolvedUrls?.network[0];
        return lan && `${lan}vote`;
      },
    });
    server.middlewares.use((req, res, next) => {
      if (!/\/vote\/?$/.test(req.url?.split("?")[0] ?? "")) {
        return next();
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(votePageHtml());
    });
  },

  // `slidev build`: ship the voting page too. As vote/index.html, so that every static
  // host serves it at /vote.
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "vote/index.html", source: votePageHtml() });
  },
});
