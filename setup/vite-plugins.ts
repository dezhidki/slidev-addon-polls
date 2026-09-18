import { readFileSync } from "node:fs";
import type { ResolvedSlidevOptions } from "@slidev/types";
import type { Plugin } from "vite";
import { attachPolls } from "../server/polls.js";

const votePage = new URL("../server/vote.html", import.meta.url);

// The poll backend rides on Slidev's own dev server: same port, same tunnel, and the
// presenter password is whatever was passed to `slidev --remote=<password>`.
export default (options: ResolvedSlidevOptions): Plugin => ({
  name: "slidev-addon-polls",

  configureServer(server) {
    if (!server.httpServer) return;
    attachPolls(server.httpServer, {
      token: options.remote || undefined,
      joinUrl: () => {
        const lan = server.resolvedUrls?.network[0];
        return lan && `${lan}vote`;
      },
    });
    server.middlewares.use((req, res, next) => {
      if (!/\/vote\/?$/.test(req.url?.split("?")[0] ?? "")) return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(readFileSync(votePage));
    });
  },

  // `slidev build`: ship the voting page too. As vote/index.html, so that every static
  // host serves it at /vote.
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "vote/index.html", source: readFileSync(votePage) });
  },
});
