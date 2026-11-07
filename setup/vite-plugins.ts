/**
 * Puts the poll backend on Slidev's own dev server: same port, same tunnel, and the
 * presenter password is whatever was passed to `slidev --remote=<password>`. Also serves
 * the voting page, and ships it with `slidev build`.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { readFileSync } from "node:fs";
import type { ResolvedSlidevOptions } from "@slidev/types";
import type { Plugin } from "vite";
import type { PollSettings } from "../protocol.ts";
import { attachPolls } from "../server/polls.ts";

const votePage = new URL("../dist/vote.html", import.meta.url);

/**
 * Read afresh every time, so rebuilding the page shows up without restarting Slidev.
 * A deck that sets `polls.showSlides` gets its aspect ratio on `<html>`, which tells the
 * page to embed the slides.
 */
function votePageHtml(options: ResolvedSlidevOptions): string {
  let html: string;
  try {
    html = readFileSync(votePage, "utf8");
  } catch {
    throw new Error("slidev-addon-polls: dist/vote.html is missing — run `npm run build`");
  }
  const config = options.data.config as { polls?: PollSettings; aspectRatio: number };
  if (!config.polls?.showSlides) {
    return html;
  }
  const root = '<html lang="en">';
  if (!html.includes(root)) {
    throw new Error(`slidev-addon-polls: dist/vote.html has no ${root} to mark`);
  }
  return html.replace(root, `<html lang="en" data-slides="${config.aspectRatio}">`);
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
      res.end(votePageHtml(options));
    });
  },

  // `slidev build`: ship the voting page too. As vote/index.html, so that every static
  // host serves it at /vote.
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "vote/index.html", source: votePageHtml(options) });
  },
});
