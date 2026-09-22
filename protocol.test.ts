/**
 * The parsers are the only thing between the wire and the rest of the code, so they get
 * fed the shapes an honest client never sends.
 *
 *     npm test
 *
 * @author Written by Claude (Anthropic) under human review.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientMessage, parseServerMessage } from "./protocol.ts";

const wire = (msg: unknown) => JSON.stringify(msg);

test("junk never becomes a message", () => {
  for (const raw of ["", "not json", wire(null), wire([1, 2]), wire("hello"), wire(3)]) {
    assert.equal(parseClientMessage(raw), undefined, raw);
    assert.equal(parseServerMessage(raw), undefined, raw);
  }
  assert.equal(parseClientMessage(wire({ type: "nonsense" })), undefined);
  assert.equal(parseClientMessage(wire({ type: 7 })), undefined);
  assert.equal(parseServerMessage(wire({ type: "state!" })), undefined);
});

test("hello falls back to the least privileged role", () => {
  assert.deepEqual(parseClientMessage(wire({ type: "hello", role: "root" })), {
    type: "hello",
    role: "audience",
    token: undefined,
    voter: undefined,
  });
  assert.deepEqual(parseClientMessage(wire({ type: "hello", role: "presenter", token: "s" })), {
    type: "hello",
    role: "presenter",
    token: "s",
    voter: undefined,
  });
  const long = parseClientMessage(wire({ type: "hello", voter: "v".repeat(65) }));
  assert.equal(long?.type === "hello" && long.voter, undefined, "an over-long voter id drops");
});

test("one define carries every poll, and the unusable ones drop out", () => {
  const msg = parseClientMessage(
    wire({
      type: "define",
      polls: [
        { id: "1:q", slide: 1, question: "q", options: ["a", "b"], correct: 1 },
        { id: "", question: "no id" },
        { question: "no id at all" },
        { id: "2:cloud", slide: 2, question: "cloud", options: [] },
        { id: "3:bad", slide: 3, question: "bad", options: ["a"], correct: 9 },
        "not a poll",
      ],
    }),
  );
  assert.equal(msg?.type, "define");
  assert.deepEqual(msg?.type === "define" && msg.polls, [
    { id: "1:q", slide: 1, question: "q", options: ["a", "b"], correct: 1 },
    { id: "2:cloud", slide: 2, question: "cloud", options: undefined, correct: undefined },
    { id: "3:bad", slide: 3, question: "bad", options: ["a"], correct: undefined },
  ]);
  assert.equal(parseClientMessage(wire({ type: "define", polls: [] })), undefined);
  assert.equal(parseClientMessage(wire({ type: "define", polls: "all of them" })), undefined);
});

test("what the presenter's screen says about itself is clamped, not trusted", () => {
  assert.deepEqual(
    parseClientMessage(
      wire({ type: "slide", slide: 4, ids: ["a", 7, "b"], reactions: ["👍"], cooldown: 99_999 }),
    ),
    { type: "slide", slide: 4, ids: ["a", "b"], reactions: ["👍"], cooldown: 3600 },
  );
  assert.deepEqual(parseClientMessage(wire({ type: "slide" })), {
    type: "slide",
    slide: 0,
    ids: [],
    reactions: [],
    cooldown: undefined,
  });
});

test("answers need an id and a plausible answer", () => {
  assert.deepEqual(parseClientMessage(wire({ type: "vote", id: "a", option: 2 })), {
    type: "vote",
    id: "a",
    option: 2,
  });
  for (const option of [-1, 1.5, "1", null, 999]) {
    assert.equal(parseClientMessage(wire({ type: "vote", id: "a", option })), undefined);
  }
  assert.equal(parseClientMessage(wire({ type: "vote", option: 1 })), undefined);

  // Longer than a word on purpose: the server is the one that trims and cuts it to size.
  const phrase = "x".repeat(100);
  assert.deepEqual(parseClientMessage(wire({ type: "word", id: "a", text: phrase })), {
    type: "word",
    id: "a",
    text: phrase,
  });
  assert.equal(
    parseClientMessage(wire({ type: "word", id: "a", text: "x".repeat(200) })),
    undefined,
  );
  assert.equal(parseClientMessage(wire({ type: "react", emoji: "x".repeat(17) })), undefined);
});

test("a state message with nothing in it still renders", () => {
  assert.deepEqual(parseServerMessage(wire({ type: "state" })), {
    type: "state",
    slide: 0,
    visible: [],
    reactions: [],
    cooldown: 3000,
    tally: {},
    audience: 0,
    joinUrl: undefined,
    polls: [],
  });
});

test("a poll that cannot be shown is left out of the state", () => {
  const msg = parseServerMessage(
    wire({
      type: "state",
      polls: [
        { id: "a", question: "q", state: "nowhere" },
        { id: "b", question: "open quiz", state: "open", quiz: true, votes: null, correct: null },
        { id: "c", question: "cloud", state: "closed", words: [["hi", 2], ["bad"], "nope"] },
      ],
    }),
  );
  assert.equal(msg?.type, "state");
  const [quiz, cloud] = msg?.type === "state" ? msg.polls : [];
  assert.equal(quiz?.id, "b", "the poll with a state nobody knows is left out");
  assert.equal(quiz?.votes, null, "an open quiz keeps its distribution hidden");
  assert.equal(cloud?.id, "c");
  assert.deepEqual(cloud?.words, [["hi", 2]], "half a word count is no word count");
});

test("a tally key named __proto__ lands as an ordinary field", () => {
  const msg = parseServerMessage(
    '{"type":"reactions","burst":{"__proto__":2,"👍":"x"},"tally":{}}',
  );
  assert.equal(msg?.type, "reactions");
  const burst = msg?.type === "reactions" ? msg.burst : {};
  assert.ok(Object.hasOwn(burst, "__proto__"));
  assert.equal(Object.getPrototypeOf(burst), Object.prototype);
  assert.equal("👍" in burst, false, "a count that is not a number drops");
});
