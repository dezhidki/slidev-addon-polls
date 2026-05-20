/**
 * Poll Server — WebSocket backend for live polls
 * Supports per-slide polls with slide-change sync
 */
const http = require("node:http");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = parseInt(process.env.PORT || "3031", 10);
const PRESENTER_TOKEN = process.env.PRESENTER_TOKEN || "changeme";

const server = http.createServer();
const wss = new WebSocketServer({ server });

let presenterWs = null;
const audienceSockets = new Set();
let allPolls = [];
let currentSlide = 0;
const activePolls = {};

console.log(`[poll-server] Starting on port ${PORT}`);
console.log(`[poll-server] Presenter token: ${PRESENTER_TOKEN}`);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[poll-server] Listening on ws://0.0.0.0:${PORT}/polls`);
});

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[poll-server] New connection from ${ip}`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case "presenter_connect": {
        if (msg.token === PRESENTER_TOKEN) {
          presenterWs = ws;
          ws.isPresenter = true;
          console.log(`[poll-server] Presenter authenticated from ${ip}`);
          ws.send(
            JSON.stringify({
              type: "presenter_authenticated",
              polls: allPolls,
              currentSlide,
              activePolls,
            }),
          );
        } else {
          console.log(`[poll-server] Invalid presenter token from ${ip}`);
          ws.send(JSON.stringify({ type: "auth_failed", reason: "Invalid token" }));
          ws.close();
        }
        break;
      }

      case "audience_join": {
        ws.isPresenter = false;
        audienceSockets.add(ws);
        console.log(`[poll-server] Audience joined (${audienceSockets.size} total)`);
        ws.send(
          JSON.stringify({
            type: "audience_welcomed",
            polls: allPolls,
            currentSlide,
            activePolls,
          }),
        );
        broadcast({ type: "audience_state", audienceCount: audienceSockets.size });
        break;
      }

      case "audience_vote": {
        const poll = allPolls.find((p) => p.id === msg.pollId);
        if (
          poll &&
          poll.state === "voting" &&
          msg.optionIndex >= 0 &&
          msg.optionIndex < (poll.options || []).length &&
          !poll.voters.has(ws)
        ) {
          if (!poll.votes) poll.votes = new Array((poll.options || []).length).fill(0);
          poll.voters.add(ws);
          poll.votes[msg.optionIndex]++;
          syncAll();
        }
        break;
      }

      case "audience_word": {
        const poll = allPolls.find((p) => p.id === msg.pollId);
        if (
          poll &&
          poll.type === "wordcloud" &&
          poll.state === "voting" &&
          msg.text &&
          !poll.voters.has(ws)
        ) {
          if (!poll.wordCounts) poll.wordCounts = {};
          const word = String(msg.text).trim().toLowerCase().slice(0, 32);
          if (word) {
            poll.voters.add(ws);
            poll.wordCounts[word] = (poll.wordCounts[word] || 0) + 1;
            syncAll();
          }
        }
        break;
      }

      case "polls_define": {
        allPolls = (msg.polls || []).map((p) => ({
          ...p,
          votes: new Array((p.options || []).length).fill(0),
          state: "idle",
          revealed: false,
          voters: new Set(),
        }));
        console.log(`[poll-server] Defined ${allPolls.length} polls`);
        syncAll();
        break;
      }

      case "poll_start": {
        const poll = allPolls.find((p) => p.id === msg.pollId);
        if (poll) {
          poll.state = "voting";
          syncAll();
        }
        break;
      }

      case "poll_stop": {
        const poll = allPolls.find((p) => p.id === msg.pollId);
        if (poll) {
          poll.state = "closed";
          syncAll();
        }
        break;
      }

      case "poll_reset": {
        const poll = allPolls.find((p) => p.id === msg.pollId);
        if (poll) {
          poll.state = "idle";
          poll.votes = new Array((poll.options || []).length).fill(0);
          poll.revealed = false;
          poll.voters = new Set();
          syncAll();
        }
        break;
      }

      case "poll_reveal": {
        const poll = allPolls.find((p) => p.id === msg.pollId);
        if (poll) {
          poll.revealed = true;
          syncAll();
        }
        break;
      }

      case "poll_selected": {
        if (msg.slideIndex !== undefined) {
          activePolls[msg.slideIndex] = msg.pollId;
          const payload = JSON.stringify({
            type: "slide_change",
            slideIndex: currentSlide,
            activePollId: activePolls[currentSlide],
            activePolls,
            polls: allPolls,
          });
          broadcast(payload);
          if (presenterWs && presenterWs.readyState === WebSocket.OPEN) {
            presenterWs.send(
              JSON.stringify({
                type: "slide_change",
                slideIndex: currentSlide,
                activePollId: activePolls[currentSlide],
                activePolls,
                polls: allPolls,
              }),
            );
          }
        }
        break;
      }

      case "presenter_navigate": {
        currentSlide = msg.slideIndex;
        const payload = JSON.stringify({
          type: "slide_change",
          slideIndex: currentSlide,
          activePollId: activePolls[currentSlide],
          activePolls,
          polls: allPolls,
        });
        broadcast(payload);
        if (presenterWs && presenterWs.readyState === WebSocket.OPEN) {
          presenterWs.send(
            JSON.stringify({
              type: "slide_change",
              slideIndex: currentSlide,
              activePollId: activePolls[currentSlide],
              activePolls,
              polls: allPolls,
            }),
          );
        }
        break;
      }

      default:
        console.log(`[poll-server] Unknown: ${msg.type}`);
    }
  });

  ws.on("close", () => {
    if (ws.isPresenter) {
      presenterWs = null;
      console.log("[poll-server] Presenter disconnected");
    } else {
      audienceSockets.delete(ws);
      // Remove disconnected socket from all voter sets
      for (const p of allPolls) p.voters?.delete(ws);
      broadcast({ type: "audience_state", audienceCount: audienceSockets.size });
    }
  });
  ws.on("error", (err) => console.error("[poll-server] WS error:", err.message));
});

function syncAll() {
  const state = { type: "poll_state", polls: allPolls, currentSlide, activePolls };
  broadcast(JSON.stringify(state));
  if (presenterWs && presenterWs.readyState === WebSocket.OPEN) {
    presenterWs.send(JSON.stringify(state));
  }
}

function broadcast(msg) {
  const str = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const c of audienceSockets) {
    if (c.readyState === WebSocket.OPEN) c.send(str);
  }
}
