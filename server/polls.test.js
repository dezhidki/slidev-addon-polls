// npm test
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebSocket } from "ws";
import { attachPolls } from "./polls.js";

test("a poll's life: auth, define, vote once, quiz secrecy, re-define keeps votes, moderation, reactions and their cooldown", async () => {
  const http = createServer();
  attachPolls(http, { token: "secret" });
  await new Promise((r) => http.listen(0, r));
  const url = `ws://localhost:${http.address().port}/polls`;

  // Each client remembers the last state it was sent.
  const join = async (hello) => {
    const ws = new WebSocket(url);
    ws.on("message", (m) => {
      const msg = JSON.parse(m);
      if (msg.type === "state") ws.state = msg;
      else ws.denied = true;
    });
    await new Promise((r) => ws.on("open", r));
    ws.say = (msg) => ws.send(JSON.stringify(msg));
    ws.say({ type: "hello", ...hello });
    return ws;
  };
  const settle = () => new Promise((r) => setTimeout(r, 120));
  const poll = (ws) => ws.state.polls[0];

  const presenter = await join({ role: "presenter", token: "secret" });
  const impostor = await join({ role: "presenter", token: "nope" });
  const ann = await join({ voter: "ann" });
  const bob = await join({ voter: "bob" });

  const quiz = { id: "3:2+2?", slide: 3, question: "2+2?", options: ["3", "4"], correct: 1 };
  impostor.say({ type: "define", poll: { ...quiz, id: "evil" } });
  presenter.say({ type: "define", poll: quiz });
  ann.say({ type: "vote", id: quiz.id, option: 1 }); // not open yet
  await settle();
  assert.ok(impostor.denied);
  assert.equal(ann.state.polls.length, 1, "impostor's poll was ignored");
  assert.equal(poll(ann).total, 0, "no votes before opening");
  assert.equal(ann.state.audience, 2);

  presenter.say({ type: "open", id: quiz.id });
  await settle();
  ann.say({ type: "vote", id: quiz.id, option: 1 });
  ann.say({ type: "vote", id: quiz.id, option: 0 }); // second answer is dropped
  bob.say({ type: "vote", id: quiz.id, option: 7 }); // out of range
  bob.say({ type: "vote", id: quiz.id, option: 0 });
  presenter.say({ type: "define", poll: quiz }); // slide re-mounted
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

  const cloud = { id: "4:word?", slide: 4, question: "word?" };
  presenter.say({ type: "define", poll: cloud });
  presenter.say({ type: "open", id: cloud.id });
  await settle();
  ann.say({ type: "word", id: cloud.id, text: "  Hello   World " });
  bob.say({ type: "word", id: cloud.id, text: "__proto__" });
  await settle();
  const cloudOf = (ws) => ws.state.polls[1];
  assert.deepEqual(cloudOf(ann).words, [], "the room doesn't see words while voting is open");
  assert.equal(cloudOf(ann).total, 2);
  assert.deepEqual(cloudOf(presenter).words, [
    ["hello world", 1],
    ["__proto__", 1],
  ]);

  // Moderation: removed words stay out, even if someone sends them again.
  const cat = await join({ voter: "cat" });
  presenter.say({ type: "remove", id: cloud.id, word: "__proto__" });
  ann.say({ type: "remove", id: cloud.id, word: "hello world" }); // not a presenter
  await settle();
  cat.say({ type: "word", id: cloud.id, text: "__PROTO__" });
  presenter.say({ type: "close", id: cloud.id });
  await settle();
  assert.deepEqual(cloudOf(ann).words, [["hello world", 1]], "closing shows the weeded cloud");
  cat.terminate();

  // The presenter's screen decides what phones show, and which reactions they may send.
  presenter.say({ type: "slide", slide: 4, ids: [cloud.id], reactions: ["👍", "❤️"] });
  await settle();
  assert.deepEqual(ann.state.visible, [cloud.id]);
  assert.deepEqual(ann.state.reactions, ["👍", "❤️"]);

  presenter.on("message", (m) => {
    const msg = JSON.parse(m);
    if (msg.type === "reactions") presenter.reactions = msg;
  });
  ann.say({ type: "react", emoji: "❤️" });
  ann.say({ type: "react", emoji: "❤️" }); // too soon after the first
  bob.say({ type: "react", emoji: "❤️" });
  bob.say({ type: "react", emoji: "<script>" }); // not on the slide's list
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(presenter.reactions.burst, { "❤️": 2 });
  assert.deepEqual(presenter.reactions.tally, { "❤️": 2 });
  assert.equal(ann.denied, undefined, "phones got nothing but state: no reaction stream");

  // The cooldown is the deck's to set, and it follows the person, not the connection.
  assert.equal(ann.state.cooldown, 3000, "three seconds unless the deck says otherwise");
  presenter.say({ type: "slide", slide: 4, ids: [], reactions: ["👍"], cooldown: 0.6 });
  await new Promise((r) => setTimeout(r, 650));
  assert.equal(ann.state.cooldown, 600);
  ann.say({ type: "react", emoji: "👍" }); // cooled down by now: counts
  const annAgain = await join({ voter: "ann" }); // same person, fresh tab
  annAgain.say({ type: "react", emoji: "👍" }); // still cooling: dropped
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(presenter.reactions.tally, { "❤️": 2, "👍": 1 });
  annAgain.terminate();

  for (const ws of [presenter, impostor, ann, bob]) ws.terminate();
  http.close();
});
