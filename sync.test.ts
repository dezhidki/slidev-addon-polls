/**
 * The slide sync method, driven the way Slidev drives it: `init` once per channel, then
 * `write` on every change. Timers are mocked, so the 100 ms throttle runs instantly.
 *
 *     npm test
 *
 * @author Claude
 * @author Denis Zhidkikh
 */
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { SyncMessage } from "./protocol.ts";
import { createSlideSync } from "./sync.ts";

const lastUpdate = { id: "p", type: "presenter" as const, time: 1 };

function baseState() {
  return {
    page: 2,
    clicks: 0,
    clicksTotal: 1,
    cursor: undefined as { x: number; y: number } | undefined,
    lastUpdate,
    timer: { status: "stopped" },
  };
}

function rig(t: TestContext, drawings = false) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent: SyncMessage[] = [];
  const updates: unknown[] = [];
  const flags = { presenter: true };
  const slide = createSlideSync({
    send: (msg) => sent.push(msg),
    isPresenter: () => flags.presenter,
    drawings,
  });
  const state = baseState();
  const write = slide.sync.init("Deck - shared", (data) => updates.push(data), state);
  assert.ok(write);
  return {
    slide,
    sent,
    updates,
    flags,
    state,
    write,
    tick: (ms: number) => t.mock.timers.tick(ms),
  };
}

test("only the presenter's own changes go out", (t) => {
  const { flags, state, write, sent } = rig(t);
  flags.presenter = false;
  write(state);
  assert.equal(sent.length, 0);
  flags.presenter = true;
  write(state, true);
  assert.equal(sent.length, 0);
});

test("a new page goes out at once, without the timer, a hidden cursor as null", (t) => {
  const { state, write, sent } = rig(t);
  write(state);
  assert.deepEqual(sent[0], {
    type: "sync",
    channel: "shared",
    data: { page: 2, clicks: 0, clicksTotal: 1, cursor: null, lastUpdate },
  });
});

test("pointer moves are thinned to one per 100 ms, carrying the latest position", (t) => {
  const { state, write, sent, tick } = rig(t);
  write(state);
  write({ ...state, cursor: { x: 1, y: 1 } });
  write({ ...state, cursor: { x: 2, y: 2 } });
  assert.equal(sent.length, 1);
  tick(100);
  assert.equal(sent.length, 2);
  assert.deepEqual((sent[1] as { data: { cursor: unknown } }).data.cursor, { x: 2, y: 2 });
});

test("a page change sends a pending pointer move along, and nothing is sent twice", (t) => {
  const { state, write, sent, tick } = rig(t);
  write(state);
  write({ ...state, cursor: { x: 1, y: 1 } });
  const next = { ...state, page: 3, cursor: { x: 1, y: 1 } };
  write(next);
  assert.equal(sent.length, 2);
  assert.deepEqual((sent[1] as { data: unknown }).data, {
    page: 3,
    clicks: 0,
    clicksTotal: 1,
    cursor: { x: 1, y: 1 },
    lastUpdate,
  });
  tick(100);
  assert.equal(sent.length, 2);
  write(next);
  assert.equal(sent.length, 2);
  write({ ...next, timer: { status: "running" } });
  tick(100);
  assert.equal(sent.length, 2);
});

test("received slide state reaches Slidev with null as undefined, but not in the presenter tab", (t) => {
  const { slide, updates, flags } = rig(t);
  const msg: SyncMessage = { type: "sync", channel: "shared", data: { page: 4, cursor: null } };
  flags.presenter = false;
  slide.receive(msg);
  assert.deepEqual(updates, [{ page: 4, cursor: undefined }]);
  flags.presenter = true;
  slide.receive(msg);
  assert.equal(updates.length, 1);
});

test("channels other than shared are not ours", (t) => {
  const { slide } = rig(t);
  assert.equal(
    slide.sync.init("Deck - snapshots", () => {}, {}),
    undefined,
  );
  assert.equal(
    slide.sync.init("Deck - drawings", () => {}, {}),
    undefined,
  );
});

test("resend sends the whole current state, even when unchanged", (t) => {
  const { slide, state, write, sent } = rig(t);
  write(state);
  slide.resend();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
});

test("a message over the presenter cap is dropped with one warning", (t) => {
  const { state, write, sent } = rig(t);
  const warn = t.mock.method(console, "warn", () => {});
  const big = { ...state, cursor: { x: 1, y: "x".repeat(300 * 1024) } as never };
  write(big);
  write({ ...big, clicks: 1 });
  assert.equal(sent.length, 0);
  assert.equal(warn.mock.callCount(), 1);
});

test("resend sends the live state, even when no write was accepted yet", (t) => {
  const { slide, state, write, sent, flags } = rig(t);
  flags.presenter = false;
  write(state);
  state.page = 5;
  flags.presenter = true;
  slide.resend();
  assert.equal(sent.length, 1);
  assert.equal((sent[0] as { data: { page: number } }).data.page, 5);
});
