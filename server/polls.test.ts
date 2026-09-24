/**
 * One run through a poll's life, over a real WebSocket against a real HTTP server.
 *
 *     npm test
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebSocket } from "ws";
import {
  type ClientMessage,
  type PollView,
  parseServerMessage,
  type Role,
  type ServerMessage,
} from "../protocol.ts";
import { attachPolls } from "./polls.ts";

type StateMessage = Extract<ServerMessage, { type: "state" }>;
type ReactionsMessage = Extract<ServerMessage, { type: "reactions" }>;

/** A connected client that remembers the last message of each kind it was sent. */
interface Peer {
  state?: StateMessage;
  reactions?: ReactionsMessage;
  denied: boolean;
  say(msg: ClientMessage): void;
  close(): void;
}

async function join(url: string, hello: { role?: Role; token?: string; voter?: string }) {
  const socket = new WebSocket(url);
  const peer: Peer = {
    denied: false,
    say: (msg) => socket.send(JSON.stringify(msg)),
    close: () => socket.terminate(),
  };
  socket.on("message", (raw: Buffer) => {
    const msg = parseServerMessage(raw.toString());
    if (msg?.type === "state") {
      peer.state = msg;
    }
    if (msg?.type === "reactions") {
      peer.reactions = msg;
    }
    if (msg?.type === "denied") {
      peer.denied = true;
    }
  });
  await new Promise<void>((resolve) => socket.on("open", () => resolve()));
  peer.say({
    type: "hello",
    role: hello.role ?? "audience",
    token: hello.token,
    voter: hello.voter,
  });
  return peer;
}

/** The state a peer last saw, or a loud failure if it never saw any. */
function seen(peer: Peer): StateMessage {
  assert.ok(peer.state, "peer never received a state message");
  return peer.state;
}

/** The nth poll of that state, or a loud failure if the server left it out. */
function pollAt(peer: Peer, index: number): PollView {
  const poll = seen(peer).polls[index];
  assert.ok(poll, `no poll #${index} in the state this peer was sent`);
  return poll;
}

/** A pause long enough for the server's coalesced broadcast to land. */
const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test("a poll's life: auth, define, one vote each, quiz secrecy, re-define keeps votes, moderation, reactions and their cooldown", async () => {
  const http = createServer();
  attachPolls(http, { token: "secret" });
  await new Promise<void>((resolve) => http.listen(0, () => resolve()));
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const url = `ws://localhost:${address.port}/polls`;

  const settle = () => after(120);
  const poll = (peer: Peer) => pollAt(peer, 0);
  const cloudOf = (peer: Peer) => pollAt(peer, 1);

  const presenter = await join(url, { role: "presenter", token: "secret" });
  const impostor = await join(url, { role: "presenter", token: "nope" });
  const ann = await join(url, { voter: "ann" });
  const bob = await join(url, { voter: "bob" });

  const quiz = { id: "3:2+2?", slide: 3, question: "2+2?", options: ["3", "4"], correct: 1 };
  impostor.say({ type: "define", polls: [{ ...quiz, id: "evil" }] });
  presenter.say({ type: "define", polls: [quiz] });
  ann.say({ type: "vote", id: quiz.id, option: 1 }); // not open yet
  await settle();
  assert.ok(impostor.denied);
  assert.equal(seen(ann).polls.length, 1, "impostor's poll was ignored");
  assert.equal(poll(ann).total, 0, "no votes before opening");
  assert.equal(seen(ann).audience, 2);

  presenter.say({ type: "open", id: quiz.id });
  await settle();
  ann.say({ type: "vote", id: quiz.id, option: 1 });
  ann.say({ type: "vote", id: quiz.id, option: 0 }); // changes her mind…
  ann.say({ type: "vote", id: quiz.id, option: 1 }); // …and back: still one vote
  bob.say({ type: "vote", id: quiz.id, option: 7 }); // out of range
  bob.say({ type: "vote", id: quiz.id, option: 0 });
  presenter.say({ type: "define", polls: [quiz] }); // slide re-mounted
  await settle();
  assert.deepEqual(poll(presenter).votes, [1, 1]);
  assert.equal(poll(presenter).correct, 1);
  assert.equal(poll(ann).total, 2);
  assert.equal(poll(ann).votes, null, "open quiz hides the distribution from the audience");
  assert.equal(poll(ann).correct, null, "and the answer");

  presenter.say({ type: "reveal", id: quiz.id });
  await settle();
  assert.deepEqual(poll(ann).votes, [1, 1]);
  assert.equal(poll(ann).correct, 1);

  // One `define` carries every poll the deck knows, so the cloud arrives beside the quiz.
  const cloud = { id: "4:word?", slide: 4, question: "word?" };
  presenter.say({ type: "define", polls: [quiz, cloud] });
  presenter.say({ type: "open", id: cloud.id });
  await settle();
  assert.equal(seen(presenter).polls.length, 2, "re-defining the quiz did not duplicate it");
  assert.deepEqual(poll(presenter).votes, [1, 1], "nor wipe its votes");
  ann.say({ type: "word", id: cloud.id, text: "  Hello   World " });
  bob.say({ type: "word", id: cloud.id, text: "__proto__" });
  await settle();
  assert.deepEqual(cloudOf(ann).words, [], "the room doesn't see words while voting is open");
  assert.equal(cloudOf(ann).total, 2);
  assert.deepEqual(cloudOf(presenter).words, [
    ["hello world", 1],
    ["__proto__", 1],
  ]);

  // Moderation: removed words stay out, even if someone sends them again.
  const cat = await join(url, { voter: "cat" });
  presenter.say({ type: "remove", id: cloud.id, word: "__proto__" });
  ann.say({ type: "remove", id: cloud.id, word: "hello world" }); // not a presenter
  await settle();
  cat.say({ type: "word", id: cloud.id, text: "__PROTO__" });
  presenter.say({ type: "close", id: cloud.id });
  await settle();
  assert.deepEqual(cloudOf(ann).words, [["hello world", 1]], "closing shows the weeded cloud");
  cat.close();

  // The presenter's screen decides what phones show, and which reactions they may send.
  presenter.say({ type: "slide", slide: 4, ids: [cloud.id], reactions: ["👍", "❤️"] });
  await settle();
  assert.deepEqual(seen(ann).visible, [cloud.id]);
  assert.deepEqual(seen(ann).reactions, ["👍", "❤️"]);

  ann.say({ type: "react", emoji: "❤️" });
  ann.say({ type: "react", emoji: "❤️" }); // too soon after the first
  bob.say({ type: "react", emoji: "❤️" });
  bob.say({ type: "react", emoji: "<script>" }); // not on the slide's list
  await after(300);
  assert.deepEqual(presenter.reactions?.burst, { "❤️": 2 });
  assert.deepEqual(presenter.reactions?.tally, { "❤️": 2 });
  assert.equal(ann.reactions, undefined, "phones got nothing but state: no reaction stream");

  // The cooldown is the deck's to set, and it follows the person, not the connection.
  assert.equal(seen(ann).cooldown, 3000, "three seconds unless the deck says otherwise");
  presenter.say({ type: "slide", slide: 4, ids: [], reactions: ["👍"], cooldown: 0.6 });
  await after(650);
  assert.equal(seen(ann).cooldown, 600);
  ann.say({ type: "react", emoji: "👍" }); // cooled down by now: counts
  const annAgain = await join(url, { voter: "ann" }); // same person, fresh tab
  annAgain.say({ type: "react", emoji: "👍" }); // still cooling: dropped
  await after(300);
  assert.deepEqual(presenter.reactions?.tally, { "❤️": 2, "👍": 1 });
  annAgain.close();

  for (const peer of [presenter, impostor, ann, bob]) {
    peer.close();
  }
  http.close();
});

/** A poll server on a free port, and the address its sockets connect to. */
async function serve(options: Parameters<typeof attachPolls>[1] = {}) {
  const http = createServer();
  attachPolls(http, options);
  await new Promise<void>((resolve) => http.listen(0, () => resolve()));
  const address = http.address();
  assert.ok(address && typeof address === "object");
  return { http, url: `ws://localhost:${address.port}/polls` };
}

test("an edited poll keeps its votes, unless its options change in number", async () => {
  const { http, url } = await serve();
  const presenter = await join(url, { role: "presenter" });
  const ann = await join(url, { voter: "ann" });

  const poll = { id: "tabs", slide: 2, question: "Tabs or spcaes?", options: ["Tabs", "Spcaes"] };
  presenter.say({ type: "define", polls: [poll] });
  presenter.say({ type: "open", id: poll.id });
  await after(120);
  ann.say({ type: "vote", id: poll.id, option: 1 });
  await after(120);

  const fixed = { ...poll, slide: 3, question: "Tabs or spaces?", options: ["Tabs", "Spaces"] };
  presenter.say({ type: "define", polls: [fixed] });
  await after(120);
  assert.deepEqual(pollAt(ann, 0).votes, [0, 1], "a typo fix keeps the votes");
  assert.equal(pollAt(ann, 0).question, "Tabs or spaces?");
  assert.equal(pollAt(ann, 0).slide, 3);

  presenter.say({ type: "define", polls: [{ ...fixed, options: ["Tabs", "Spaces", "Both"] }] });
  await after(120);
  assert.deepEqual(pollAt(ann, 0).votes, [0, 0, 0], "a third option starts afresh");
  assert.equal(pollAt(ann, 0).total, 0);
  assert.equal(pollAt(ann, 0).state, "idle");

  presenter.close();
  ann.close();
  http.close();
});

test("a blind poll hides its distribution from the room until voting closes", async () => {
  const { http, url } = await serve();
  const presenter = await join(url, { role: "presenter" });
  const ann = await join(url, { voter: "ann" });

  const poll = { id: "next", slide: 1, question: "Next?", options: ["Rust", "Go"], blind: true };
  presenter.say({ type: "define", polls: [poll] });
  presenter.say({ type: "open", id: poll.id });
  await after(120);
  ann.say({ type: "vote", id: poll.id, option: 0 });
  await after(120);
  assert.equal(pollAt(ann, 0).votes, null);
  assert.equal(pollAt(ann, 0).total, 1);
  assert.deepEqual(pollAt(presenter, 0).votes, [1, 0]);

  presenter.say({ type: "close", id: poll.id });
  await after(120);
  assert.deepEqual(pollAt(ann, 0).votes, [1, 0]);

  presenter.close();
  ann.close();
  http.close();
});

test("an answer can change while voting is open, but not after, nor after moderation", async () => {
  const { http, url } = await serve();
  const presenter = await join(url, { role: "presenter" });
  const ann = await join(url, { voter: "ann" });
  const bob = await join(url, { voter: "bob" });
  const words = (peer: Peer) => pollAt(peer, 1).words;

  const choice = { id: "c", slide: 1, question: "Which?", options: ["a", "b"] };
  const cloud = { id: "w", slide: 1, question: "Word?" };
  presenter.say({ type: "define", polls: [choice, cloud] });
  presenter.say({ type: "open", id: choice.id });
  presenter.say({ type: "open", id: cloud.id });
  await after(120);

  ann.say({ type: "vote", id: choice.id, option: 0 });
  ann.say({ type: "vote", id: choice.id, option: 1 });
  ann.say({ type: "word", id: cloud.id, text: "teh" });
  ann.say({ type: "word", id: cloud.id, text: "the" });
  bob.say({ type: "word", id: cloud.id, text: "the" });
  await after(120);
  assert.deepEqual(pollAt(presenter, 0).votes, [0, 1]);
  assert.equal(pollAt(presenter, 0).total, 1);
  assert.deepEqual(words(presenter), [["the", 2]]);

  bob.say({ type: "word", id: cloud.id, text: "rude" });
  await after(120);
  presenter.say({ type: "remove", id: cloud.id, word: "rude" });
  await after(120);
  bob.say({ type: "word", id: cloud.id, text: "nice" }); // removed: no second try
  presenter.say({ type: "close", id: choice.id });
  await after(120);
  ann.say({ type: "vote", id: choice.id, option: 0 }); // closed
  await after(120);
  assert.deepEqual(words(presenter), [["the", 1]]);
  assert.equal(pollAt(presenter, 1).total, 2);
  assert.deepEqual(pollAt(presenter, 0).votes, [0, 1]);

  for (const peer of [presenter, ann, bob]) {
    peer.close();
  }
  http.close();
});
