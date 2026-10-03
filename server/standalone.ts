/**
 * For decks built with `slidev build` and hosted statically: run this next to the static
 * host and proxy `<deck url>/polls` to it. `slidev` dev servers don't need it.
 *
 *     PORT=3031 TOKEN=your-remote-password DATA_FILE=polls.json node server/standalone.ts
 *
 * With `DATA_FILE`, answers survive restarts, and the file is the results export.
 *
 * Node runs the TypeScript directly (v22.18+ or v23.6+); on older versions add
 * `--experimental-strip-types`.
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import { createServer } from "node:http";
import { attachPolls } from "./polls.ts";

const port = Number(process.env.PORT) || 3031;
const server = createServer((_req, res) => res.writeHead(426).end("WebSocket only"));
const polls = attachPolls(server, { token: process.env.TOKEN, dataFile: process.env.DATA_FILE });
server.listen(port, () => console.log(`[polls] ws://localhost:${port}/polls`));

// `docker stop` sends SIGTERM: write the last second's answers before going.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    polls.flush();
    process.exit(0);
  });
}
