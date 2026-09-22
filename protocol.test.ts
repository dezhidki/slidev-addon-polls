/**
 * The parsers are the only thing between the wire and the rest of the code. Valibot does
 * the checking, so these cover the policy around it: what is allowed to be missing, what
 * is pulled into range rather than rejected, and what the deck is trusted to get right.
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
});

test("a socket that does not say who it is gets the least privileged role", () => {
  assert.deepEqual(parseClientMessage(wire({ type: "hello" })), {
    type: "hello",
    role: "audience",
  });
  assert.deepEqual(parseClientMessage(wire({ type: "hello", role: "presenter", token: "s" })), {
    type: "hello",
    role: "presenter",
    token: "s",
  });
  assert.equal(parseClientMessage(wire({ type: "hello", role: "root" })), undefined);
  const long = wire({ type: "hello", voter: "v".repeat(65) });
  assert.equal(parseClientMessage(long), undefined, "an over-long voter id is refused");
});

test("one define carries every poll, and a word cloud is one without options", () => {
  const polls = [
    { id: "1:q", slide: 1, question: "q", options: ["a", "b"], correct: 1 },
    { id: "2:cloud", slide: 2, question: "cloud" },
  ];
  assert.deepEqual(parseClientMessage(wire({ type: "define", polls })), {
    type: "define",
    polls: [polls[0], { id: "2:cloud", slide: 2, question: "cloud" }],
  });
  // A poll with no id is a bug in the deck, not a phone being clever: refuse the message
  // rather than quietly present a slide with one question missing.
  const broken = wire({ type: "define", polls: [polls[0], { question: "no id" }] });
  assert.equal(parseClientMessage(broken), undefined);
});

test("a cooldown out of range is pulled into range, not dropped", () => {
  const cooldownOf = (cooldown: unknown) => {
    const msg = parseClientMessage(
      wire({ type: "slide", slide: 4, ids: [], reactions: [], cooldown }),
    );
    return msg?.type === "slide" ? msg.cooldown : undefined;
  };
  assert.equal(cooldownOf(99_999), 3600);
  assert.equal(cooldownOf(-5), 0);
  assert.equal(cooldownOf(0.6), 0.6);
  assert.equal(cooldownOf(undefined), undefined, "no cooldown means the deck's default");
  assert.equal(
    parseClientMessage(wire({ type: "slide", slide: 4, ids: [], reactions: [], cooldown: "soon" })),
    undefined,
  );
});

test("answers need an id and a plausible answer", () => {
  assert.deepEqual(parseClientMessage(wire({ type: "vote", id: "a", option: 2 })), {
    type: "vote",
    id: "a",
    option: 2,
  });
  for (const option of [-1, 1.5, "1", null]) {
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

test("a state message arrives whole or not at all", () => {
  const state = {
    type: "state",
    slide: 4,
    visible: ["b"],
    reactions: ["👍"],
    cooldown: 3000,
    tally: { "👍": 2 },
    audience: 7,
    polls: [
      {
        id: "b",
        slide: 4,
        question: "open quiz",
        options: ["a"],
        quiz: true,
        state: "open",
        revealed: false,
        round: 1,
        total: 2,
        votes: null,
        words: [],
        correct: null,
      },
    ],
  };
  assert.deepEqual(parseServerMessage(wire(state)), state);
  assert.equal(parseServerMessage(wire({ type: "state" })), undefined, "half a state is no state");
  assert.equal(
    parseServerMessage(wire({ ...state, polls: [{ ...state.polls[0], state: "nowhere" }] })),
    undefined,
    "a poll in a state nobody knows takes the message with it",
  );
});

test("a tally key named __proto__ cannot reach a prototype", () => {
  const msg = parseServerMessage('{"type":"reactions","burst":{"__proto__":2,"👍":3},"tally":{}}');
  assert.equal(msg?.type, "reactions");
  const burst = msg?.type === "reactions" ? msg.burst : {};
  assert.deepEqual(burst, { "👍": 3 });
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});
