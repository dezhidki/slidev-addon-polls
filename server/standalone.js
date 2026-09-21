// For decks built with `slidev build` and hosted statically: run this next to the static
// host and proxy <deck url>/polls to it. `slidev` dev servers don't need it.
//   PORT=3031 TOKEN=your-remote-password node server/standalone.js
import { createServer } from "node:http";
import { attachPolls } from "./polls.js";

const port = Number(process.env.PORT) || 3031;
const server = createServer((_req, res) => res.writeHead(426).end("WebSocket only"));
attachPolls(server, { token: process.env.TOKEN });
server.listen(port, () => console.log(`[polls] ws://localhost:${port}/polls`));
