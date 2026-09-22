/**
 * For decks built with `slidev build` and hosted statically: run this next to the static
 * host and proxy `<deck url>/polls` to it. `slidev` dev servers don't need it.
 *
 *     PORT=3031 TOKEN=your-remote-password node server/standalone.ts
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
attachPolls(server, { token: process.env.TOKEN });
server.listen(port, () => console.log(`[polls] ws://localhost:${port}/polls`));
