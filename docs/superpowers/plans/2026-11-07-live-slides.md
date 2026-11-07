# Live Slides, Settings Object and Custom Emotes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phones on the voting page can show the presenter's slides (pages, clicks, pointer, optionally drawings) on the dev server and in static builds; settings move into one `polls:` object; reactions can be images.

**Architecture:** The dev server keeps Slidev's own sync. In builds, a Slidev sync method (`addSyncMethod`) sends the presenter's state over the existing poll WebSocket, and the poll server relays it to display sockets. Presenters authenticate when the socket opens, which also lets the server give only them a bigger message cap. The voting page embeds the deck's play view in an iframe.

**Tech Stack:** TypeScript run directly by Node 24 (`node --test`), Vue 3 (deck side), Alpine (voting page), `ws`, valibot, Slidev 53.

**Spec:** `docs/superpowers/specs/2026-11-07-live-slides-design.md`

## Global Constraints

- Settings live under `polls:` with exactly these keys: `url`, `reactions`, `reactionCooldown`, `showSlides`, `showDrawings`. No fallback for the old top-level names (`pollUrl`, `reactions`, `reactionCooldown`).
- A slide's own `polls:` frontmatter may set only `reactions` and `reactionCooldown`, and overrides the deck key by key.
- Version `0.4.0` → `0.5.0`.
- Message caps: `MAX_PAYLOAD = 16 * 1024` for every socket that is not an authenticated presenter; `PRESENTER_MAX_PAYLOAD = 256 * 1024` for authenticated presenters.
- Throttles: cursor-only shared changes and drawings, one message per 100 ms, trailing. Page or click changes go at once.
- `MAX_REACTION = 512` (replaces `MAX_EMOJI = 16`).
- Image reactions: `.png .apng .gif .webp .avif .svg .jpg .jpeg`, case-insensitive, query string ignored.
- Storage keys: `sessionStorage` `poll-token`; `localStorage` `poll-slides`.
- Presenter socket URL: `<base>polls?presenter&token=<password>` (`token` only when there is one).
- iframe: `src="<base>?embedded=true"`, `pointer-events: none`.
- The addon's sync runs only when `!__SLIDEV_HAS_SERVER__ && polls.showSlides`.
- No new runtime dependencies.
- New files carry the repo's header comment with `@author Claude` and `@author Denis Zhidkikh`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Lint only source paths: `npx biome check *.ts *.vue components server setup scripts`. A whole-repo `npm run lint` fails on the untracked `brag-output*` folders, not on our code.
- Commit only the files a task names. The working tree has an unrelated modified `.ai-attestation.yaml` and untracked `brag-output*` folders: never stage them.

## Review Focus

1. **Presenter reloads after Slidev dropped `?password=` from the address**: still presenter. Check in Task 2.
2. **`/vote` with slides opened on the presenter's own machine at `localhost`**, where Slidev trusts the origin: the presenter's slides must not move. Check in Task 3.
3. **The same tab switches from play view to presenter view**: it reconnects as presenter and the poll controls work. Check in Task 2.
4. **Standalone server restarted mid-talk**: once the presenter reconnects, every display is back on the current slide. Unit test in Task 5, plus a check.
5. **A deck with no `polls:` key at all**: default reactions, default cooldown, no slides toggle. Unit test in Task 1, plus a check in Task 3.

---

## Setup (before Task 1)

- [ ] **Branch and commit the spec and this plan**

```bash
git switch -c feat/live-slides
git add docs/superpowers/specs/2026-11-07-live-slides-design.md docs/superpowers/plans/2026-11-07-live-slides.md
git commit -m "docs: spec and plan for live slides, settings object and custom emotes"
```

- [ ] **Build test rig** (scratch, never committed). Tasks 2, 5, 6 and 7 test a static build with it. It serves a build directory with an SPA fallback, and puts the poll server on the same port, so no proxy is needed. Save as `$SCRATCH/serve-build.ts`, where `$SCRATCH` is the session's scratchpad directory:

```ts
// Usage: TOKEN=secret node $SCRATCH/serve-build.ts <build dir> [port]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { attachPolls } from "<repo>/server/polls.ts";

const [root = "", port = "4000"] = process.argv.slice(2);
const types: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".woff2": "font/woff2",
};
const server = createServer((req, res) => {
  let file = join(root, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) file = join(root, "index.html"); // SPA fallback for /presenter, /3, …
  res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
});
attachPolls(server, { token: process.env.TOKEN });
server.listen(Number(port), "0.0.0.0", () => console.log(`http://localhost:${port}/`));
```

Build the demo deck into the scratchpad: `npx slidev build demo/slides.md --out $SCRATCH/build`.

For a "phone", use a phone-sized window at the machine's LAN address (`http://<lan-ip>:<port>/vote`), never `localhost`. Slidev trusts `localhost`, and a window on the same origin also shares Slidev's same-browser sync, which would hide whether our sync works.

---

### Task 1: One settings object (spec part 0)

**Files:**
- Modify: `protocol.ts` (add settings type, defaults, `slideReactions`)
- Modify: `client.ts` (replace `PollConfig`/`pollConfig` with `settings`)
- Modify: `global-bottom.vue`, `global-top.vue` (doc comment only), `components/PollQr.vue`
- Modify: `README.md`, `demo/slides.md`, `package.json` (`version`)
- Test: `protocol.test.ts`

**Interfaces:**
- Produces, in `protocol.ts`:
  - `export interface PollSettings { url?: string; reactions?: unknown; reactionCooldown?: number; showSlides?: boolean; showDrawings?: boolean }`
  - `export const DEFAULT_REACTIONS: string[]` = `["👍", "👎", "🤔", "❤️"]` (moved from `global-bottom.vue`)
  - `export function slideReactions(deck: PollSettings, slide: PollSettings | undefined): { reactions: string[]; cooldown: number | undefined }`
- Produces, in `client.ts`: `export const settings: PollSettings`, the deck's `polls:` headmatter or `{}`.

- [ ] **Step 1: Write the failing test** in `protocol.test.ts`

```ts
test("a slide's own polls settings beat the deck's, key by key", () => {
  assert.deepEqual(slideReactions({}, undefined), { reactions: DEFAULT_REACTIONS, cooldown: undefined });
  const deck = { reactions: ["👏"], reactionCooldown: 1 };
  assert.deepEqual(slideReactions(deck, undefined), { reactions: ["👏"], cooldown: 1 });
  assert.deepEqual(slideReactions(deck, { reactions: ["❓"] }), { reactions: ["❓"], cooldown: 1 });
  assert.deepEqual(slideReactions(deck, { reactions: false }), { reactions: [], cooldown: 1 });
  assert.deepEqual(slideReactions({ reactions: false }, { reactionCooldown: 5 }), { reactions: [], cooldown: 5 });
  assert.deepEqual(slideReactions({ reactions: "yes" }, undefined).reactions, DEFAULT_REACTIONS);
  assert.deepEqual(slideReactions({ reactions: [1, "👍"] }, undefined).reactions, ["1", "👍"]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL, `slideReactions` / `DEFAULT_REACTIONS` not exported.

- [ ] **Step 3: Implement** `PollSettings`, `DEFAULT_REACTIONS`, `slideReactions` in `protocol.ts`, next to `DEFAULT_COOLDOWN`. Same rules as today's `reactionsFor` in `global-bottom.vue`: `false` → `[]`, an array → `.map(String)`, anything else → `DEFAULT_REACTIONS`. `slide?.reactions ?? deck.reactions`, then `slide?.reactionCooldown ?? deck.reactionCooldown`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS (12 tests).

- [ ] **Step 5: Switch the deck to `settings`**
  - `client.ts`: drop `PollConfig` and `pollConfig`. Export `settings` (typed `PollSettings`). Read `remote` from `configs` directly in `#greet`.
  - `global-bottom.vue`: `slideReactions(settings, frontmatter?.polls)`, where `frontmatter` is the current slide's `meta.slide.frontmatter`, typed `{ polls?: PollSettings }`. Delete `reactionsFor` and `DEFAULT_REACTIONS`.
  - `PollQr.vue`: `settings.url` in place of `pollConfig.pollUrl`, doc comment to match.
  - Doc comments in `global-top.vue` and `global-bottom.vue`: show `polls: { reactions: … }`.

- [ ] **Step 6: Docs and demo**
  - `README.md`: a short "Settings" section with a table of all five `polls.*` keys and which ones work per slide. Then update every example: Reactions, "Setting the voting page URL", and the tunnel example.
  - Add a note: "0.5.0 moved all settings under `polls:`".
  - `demo/slides.md`: the headmatter's commented `pollUrl` becomes a commented `polls:` / `url:`. The "Another normal slide" frontmatter and its code sample become `polls:` / `reactions: [...]`.
  - `package.json` `"version": "0.5.0"`.

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck && npx biome check *.ts *.vue components server setup scripts`
Expected: all pass.

Run `npm run dev`. Open `http://localhost:3030/presenter` and a phone window on `/vote`. On "Another normal slide" the phone shows 👏 🤯 ❓, and on other slides it shows 👍 👎 🤔 ❤️.

- [ ] **Step 8: Commit**

```bash
git add protocol.ts protocol.test.ts client.ts global-bottom.vue global-top.vue components/PollQr.vue README.md demo/slides.md package.json
git commit -m "feat!: move all settings under polls:"
```

---

### Task 2: Presenters authenticate when the socket opens (spec part 1)

**Files:**
- Modify: `protocol.ts` (hello without `token`; payload constants)
- Modify: `server/polls.ts` (two `WebSocketServer`s, upgrade check, `hello`)
- Modify: `client.ts` (token source, socket URL, reconnect on role change)
- Modify: `README.md`
- Test: `server/polls.test.ts`, `protocol.test.ts`

**Interfaces:**
- Produces, in `protocol.ts`: `export const MAX_PAYLOAD = 16 * 1024` (moved from `server/polls.ts`) and `export const PRESENTER_MAX_PAYLOAD = 256 * 1024`. `hello` is `{ type: "hello", role, voter? }`, with no `token`.
- Produces, in `server/polls.ts`: `attachPolls(httpServer, options): void`. Nothing uses the old return value.
- Server rule: a socket may present only if its upgrade URL has a `presenter` parameter, and either the server has no token or `token` equals it. Such sockets go to the 256 kB server; all others to the 16 kB one. A presenter `hello` on any other socket gets `denied` and becomes a `display`.

- [ ] **Step 1: Update the test harness** in `server/polls.test.ts`:
  - `join(url, hello)`: when `hello.role === "presenter"`, add `presenter` (empty value) and, if given, `token` to the URL's search params. Stop putting `token` in the `hello` message.
  - `Peer` gains `closed: Promise<number>`, resolving with the close code.

- [ ] **Step 2: Write the failing tests**

In `server/polls.test.ts`:

```ts
test("presenters prove themselves on the socket address, and only they may send big messages", async () => {
  const { http, url } = await serve({ token: "secret" });
  const presenter = await join(url, { role: "presenter", token: "secret" });
  const wrong = await join(url, { role: "presenter", token: "nope" });
  const missing = await join(url, { role: "presenter" });
  const screen = await join(url, { role: "display" });
  screen.say({ type: "hello", role: "presenter" }); // a plain socket asking to present
  await after(120);
  assert.equal(presenter.denied, false);
  assert.ok(wrong.denied && missing.denied && screen.denied);

  const define = (n: number) => ({
    type: "define" as const,
    polls: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, slide: 1, question: "q".repeat(2000) })),
  });
  presenter.say(define(50)); // about 100 kB
  const phone = await join(url, { voter: "ann" });
  phone.say(define(9)); // about 18 kB
  assert.equal(await phone.closed, 1009);
  await after(120);
  assert.equal(seen(presenter).polls.length, 50, "the presenter's 100 kB message went through");
  http.close();
});

test("without a server token, a socket opened as presenter may present", async () => {
  const { http, url } = await serve();
  const presenter = await join(url, { role: "presenter" });
  await after(120);
  assert.equal(presenter.denied, false);
  http.close();
});
```

In `protocol.test.ts`, change the hello test: `{ type: "hello", role: "presenter", token: "s" }` now parses to `{ type: "hello", role: "presenter" }`.

- [ ] **Step 3: Run them and see them fail**

Run: `npm test`
Expected: FAIL. `wrong`/`missing` are not denied with the old code, the 100 kB message closes the presenter, and the hello test still keeps `token`.

- [ ] **Step 4: Implement**
  - `protocol.ts`: the constants and `hello` without `token`. Update the `text()` doc comment, which mentions the 16 kB limit.
  - `server/polls.ts`: two `WebSocketServer({ noServer: true, maxPayload })`, a `WeakSet<WebSocket>` of sockets that may present, and the upgrade rule above. The connection handler body is unchanged, called from each `handleUpgrade` callback. `hello` checks the set instead of the token.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS, including every existing test.

- [ ] **Step 6: Implement the deck side** in `client.ts`
  - `function presenterToken(): string | undefined`, evaluated once at module load. Return the first of:
    1. `new URLSearchParams(location.search).get("password")`, also saved to `sessionStorage` `poll-token`;
    2. `sessionStorage` `poll-token`;
    3. `configs.remote` when it is a string.

    Wrap storage access in try/catch, as `vote.ts` does.
  - `#connect()`: when `#presenter`, set `presenter` and (if any) `token` search params on the socket URL.
  - `sync()`: on a role change with a socket already open, call a new `#reconnect()`. It clears the old socket's `onclose`, closes it, resets `#nextAttempt` and `state.denied`, then calls `#connect()`. With no socket yet, connect. Otherwise announce as now.
  - `#greet()`: `hello` without `token`.

- [ ] **Step 7: README**
  - Static builds: open the presenter as `<deck url>/presenter?password=<TOKEN>`, with `TOKEN` set on the standalone server.
  - Dev server: Slidev serves the `--remote` password to every browser that loads the deck (`/@slidev/configs`), and its sync takes updates from anyone. For a large or untrusted room, use a build.

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npx biome check *.ts *.vue components server setup scripts`
Expected: all pass.

Build test (rig from Setup), `TOKEN=secret`:
- `/presenter?password=secret` can open a poll, and the phone sees it.
- Navigate a few slides, then reload the presenter tab without the query. Still presenter: the poll controls work (Review Focus 1).
- In one tab, go from `/3` to `/presenter/3?password=secret`. The controls work without a reload (Review Focus 3).
- `/presenter` with no password in a fresh incognito window: the controls show the denied state.

Dev: `npx slidev demo/slides.md --remote=secret`, open Slidev's printed remote-control link. The controls work.

- [ ] **Step 9: Commit**

```bash
git add protocol.ts protocol.test.ts server/polls.ts server/polls.test.ts client.ts README.md
git commit -m "fix: authenticate presenters on the socket address, so builds can present"
```

---

### Task 3: Slides on the voting page (spec part 2)

**Files:**
- Modify: `setup/vite-plugins.ts`
- Modify: `server/vote.ts`, `server/vote.html`
- Modify: `README.md`, `demo/slides.md`

**Interfaces:**
- Consumes: `PollSettings` (Task 1).
- Produces, in `server/vote.ts`: a module-level `const base: string`, the deck's base URL with a trailing slash, worked out from `location.href` with the regex `connect()` uses today. The socket becomes `${base.replace(/^http/, "ws")}polls`. Task 7 uses `base`.
- Page contract: `<html data-slides="<ratio>">` is present only when the deck has `polls.showSlides: true`. The ratio is `options.data.config.aspectRatio` as a number string (e.g. `1.7777777777777777`).

- [ ] **Step 1: Mark the page** in `setup/vite-plugins.ts`
  - `votePageHtml()` takes the resolved options and returns a string.
  - With `(options.data.config as { polls?: PollSettings }).polls?.showSlides`, replace `<html lang="en">` with `<html lang="en" data-slides="${aspectRatio}">`. Throw a clear error if `<html lang="en">` is not in the file, as `scripts/build-vote.mjs` does for its placeholder.
  - Both the dev middleware and `generateBundle` use it.

- [ ] **Step 2: Toggle and iframe**

In `server/vote.ts`, add to `votePage`:
  - `slidesRatio: document.documentElement.dataset.slides` (string or undefined);
  - `showSlides: load<boolean>("poll-slides") ?? true`;
  - `slidesUrl: \`${base}?embedded=true\``;
  - `toggleSlides()`, which flips `showSlides` and saves it.

In `server/vote.html`:
  - Before `<main>`: `<template x-if="slidesRatio && showSlides">` wrapping `<div class="slides">` with `<iframe :src="slidesUrl" title="Slides">`. `x-if`, so a hidden deck is never loaded.
  - First thing in `<main>`: a button shown only when `slidesRatio` is set, reading "Hide slides" or "Show slides".
  - CSS:
    - `.slides`: full width (outside `main`'s max-width), `aspect-ratio: var(--ratio)` set from `slidesRatio`, black background.
    - The iframe fills it: `border: 0`, `pointer-events: none`.
    - `@media (orientation: portrait)`: `position: sticky; top: 0`.
    - `@media (orientation: landscape)`: `max-height: 100dvh`.
    - The `#offline` banner stays above the slides (higher `z-index`).

- [ ] **Step 3: Build the page and check the mark**

Add to the `demo/slides.md` headmatter:

```yaml
polls:
  showSlides: true
```

Run: `npm run build && npx slidev build demo/slides.md --out $SCRATCH/build && grep -o 'data-slides="[^"]*"' $SCRATCH/build/vote/index.html`
Expected: `data-slides="1.7777777777777777"`.

Then remove `showSlides`, build again, and the same `grep` prints nothing (Review Focus 5). Put `showSlides: true` back; the later tasks use it.

- [ ] **Step 4: Check in Chrome on the dev server** (`npm run dev`)
  - Presenter at `http://localhost:3030/presenter`. Phone window at `http://<lan-ip>:3030/vote`: the slides show at the top and follow page and clicks.
  - Taps on the slide do nothing.
  - "Hide slides" removes the iframe from the DOM, and the choice survives a reload.
  - Rotated to landscape: the slides fit the screen and the polls scroll below.
  - **Review Focus 2:** with the presenter on slide 3 with clicks, open `http://localhost:3030/vote` in a normal window. The presenter must stay on slide 3, same click. If it moves, stop and report it with what you saw; do not work around it in this task.
  - Note the request count and transfer size of the phone's first load (DevTools network panel), for the README.

- [ ] **Step 5: README**

A "Live slides on phones" section covering:
  - `polls.showSlides`;
  - the toggle;
  - the dev server: Slidev's own sync, and the load numbers measured in step 4;
  - builds: needs Task 5, but write the section as final;
  - phones load the whole deck, so a quiz's answer is readable in its JavaScript.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run typecheck && npx biome check *.ts *.vue components server setup scripts`
Expected: all pass.

```bash
git add setup/vite-plugins.ts server/vote.ts server/vote.html README.md demo/slides.md
git commit -m "feat: show the slides on the voting page (polls.showSlides)"
```

---

### Task 4: `sync` messages and the server relay (spec part 3, server side)

**Files:**
- Modify: `protocol.ts`, `server/polls.ts`
- Test: `protocol.test.ts`, `server/polls.test.ts`

**Interfaces:**
- Produces, in `protocol.ts`:
  - `export type SyncMessage`: `{ type: "sync", channel: "shared", data: SharedSync } | { type: "sync", channel: "drawings", data: Record<string, string> }`.
  - `SharedSync` holds these optional fields:
    - `page`, `clicks`, `clicksTotal`: counts;
    - `cursor`: `{ x: number; y: number; style?: "cursor" | "laser" } | null`;
    - `lastUpdate`: `{ id: string; type: "presenter" | "viewer"; time: number } | null`.
  - Drawings keys must match `/^\d+$/`.
  - Unknown shared keys (such as `timer`) are stripped.
  - `sync` is in both the client and server message unions, and in `PRESENTER_ONLY`.
- Server behaviour:
  - Keeps the merged `data` per channel. `Object.assign` into objects made with `Object.create(null)`; `null` values are kept.
  - Relays each presenter `sync` unchanged to `display` sockets only.
  - When a socket says hello as `display` (including a denied presenter), sends it one `sync` per non-empty channel with the merged data.
  - A `sync` triggers no state broadcast.

- [ ] **Step 1: Write the failing tests**

`protocol.test.ts`:

```ts
test("sync carries the presenter's slide state, and drawings by page number", () => {
  const shared = { type: "sync", channel: "shared", data: { page: 3, clicks: 1, clicksTotal: 2, cursor: null, lastUpdate: { id: "a", type: "presenter", time: 5 } } };
  assert.deepEqual(parseClientMessage(wire(shared)), shared);
  assert.deepEqual(parseServerMessage(wire(shared)), shared);
  assert.deepEqual(parseClientMessage(wire({ ...shared, data: { page: 1, timer: {} } }))?.data, { page: 1 });
  const drawings = { type: "sync", channel: "drawings", data: { "3": "<path/>", "4": "" } };
  assert.deepEqual(parseClientMessage(wire(drawings)), drawings);
  assert.equal(parseClientMessage(wire({ ...drawings, data: { "3": 7 } })), undefined);
  assert.equal(parseClientMessage(wire({ ...drawings, data: { title: "<path/>" } })), undefined, "keys are page numbers");
  // valibot drops a `__proto__` key instead of refusing the message (see the tally test).
  assert.deepEqual(
    parseClientMessage('{"type":"sync","channel":"drawings","data":{"__proto__":"x"}}')?.data,
    {},
  );
  assert.equal(parseClientMessage(wire({ type: "sync", channel: "timer", data: {} })), undefined);
});
```

`server/polls.test.ts`: `Peer` gains `sync: SyncMessage[]`, collecting every `sync` received. Then:

```ts
test("the presenter's slide state reaches every screen and only screens, also late ones", async () => {
  const { http, url } = await serve({ token: "secret" });
  const presenter = await join(url, { role: "presenter", token: "secret" });
  const screen = await join(url, { role: "display" });
  const phone = await join(url, { voter: "ann" });
  screen.say({ type: "sync", channel: "shared", data: { page: 9 } }); // not the presenter
  phone.say({ type: "sync", channel: "shared", data: { page: 9 } });
  presenter.say({ type: "sync", channel: "shared", data: { page: 3, clicks: 1, cursor: null } });
  presenter.say({ type: "sync", channel: "drawings", data: { "3": "<a/>", "4": "<b/>" } });
  presenter.say({ type: "sync", channel: "drawings", data: { "4": "" } });
  const big = "x".repeat(100 * 1024);
  presenter.say({ type: "sync", channel: "drawings", data: { "5": big } });
  await after(120);
  assert.equal(screen.sync.length, 4);
  assert.deepEqual(screen.sync[0]?.data, { page: 3, clicks: 1, cursor: null });
  assert.equal(phone.sync.length, 0, "phones don't get slide state");
  assert.equal(presenter.sync.length, 0);

  const late = await join(url, { role: "display" });
  await after(120);
  const byChannel = Object.fromEntries(late.sync.map((m) => [m.channel, m.data]));
  assert.deepEqual(byChannel.shared, { page: 3, clicks: 1, cursor: null });
  assert.deepEqual(byChannel.drawings, { "3": "<a/>", "4": "", "5": big });
  http.close();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test`
Expected: FAIL, `sync` does not parse.

- [ ] **Step 3: Implement** the schemas (a nested `v.variant("channel", …)` inside the `type` variant) and the server behaviour above.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npx biome check *.ts *.vue components server setup scripts`
Expected: all pass.

Also make sure `client.ts` `#receive` returns early on `sync`. Today any message that isn't `denied` or `reactions` is treated as `state`. Return early until Task 5 wires it.

- [ ] **Step 5: Commit**

```bash
git add protocol.ts protocol.test.ts server/polls.ts server/polls.test.ts client.ts
git commit -m "feat: relay the presenter's slide state to screens"
```

---

### Task 5: Sync for builds: page, clicks and pointer (spec part 3, deck side)

**Files:**
- Create: `sync.ts` (Slidev sync method; imports only `protocol.ts` and, as types, `@slidev/client`)
- Create: `sync.test.ts`
- Modify: `client.ts`, `shims.d.ts`, `package.json` (`test` script and `files`), `README.md`

**Interfaces:**
- Consumes: `SyncMessage`, `PRESENTER_MAX_PAYLOAD` (Tasks 2, 4); `settings` (Task 1).
- Produces, in `sync.ts`:

```ts
import type { addSyncMethod } from "@slidev/client";
type Sync = Parameters<typeof addSyncMethod>[0];

export interface SlideSyncOptions {
  /** Puts one message on the poll socket. */
  send: (msg: SyncMessage) => void;
  /** Only the presenter tab's changes go out. */
  isPresenter: () => boolean;
  /** Whether the drawings channel is synced too (`polls.showDrawings`). Task 6. */
  drawings: boolean;
}
export interface SlideSync {
  /** For Slidev's `addSyncMethod`. */
  sync: Sync;
  /** A `sync` from the server; ignored in the presenter tab. */
  receive(msg: SyncMessage): void;
  /** Sends every channel's full current state; called when a presenter socket opens. */
  resend(): void;
}
export function createSlideSync(options: SlideSyncOptions): SlideSync;
```

- Behaviour, `shared` channel (the `init` key ends in ` - shared`; any other key returns `undefined` in this task):
  - The write ignores calls when `!isPresenter()` or `updating` is true.
  - It picks `page, clicks, clicksTotal, cursor, lastUpdate`, with `undefined` → `null`.
  - Unchanged from the last message sent (compare as JSON) → nothing.
  - `page`, `clicks` or `clicksTotal` changed → send now, cancelling any pending message.
  - Otherwise → one trailing message after 100 ms, with the latest state.
  - Any message whose UTF-8 JSON is over `PRESENTER_MAX_PAYLOAD` is not sent; `console.warn` once per page or channel instead.
- `receive`: for the channel's `onUpdate`, with `null` values turned into `undefined`.
- `resend`: sends the picked shared state unconditionally.
- `client.ts` wiring:
  - `PollsClient` gets `get presenter(): boolean`.
  - After `polls`: create `slideSync` when `!__SLIDEV_HAS_SERVER__ && settings.showSlides`. Its `send` is `(msg) => polls.send(msg)`, `isPresenter` is `() => polls.presenter`, `drawings` is `settings.showDrawings === true`. Then `addSyncMethod(slideSync.sync)`.
  - `#receive` hands `sync` to `slideSync?.receive`.
  - `#greet` calls `slideSync?.resend()` after `hello` when presenter.
- `shims.d.ts`: `declare const __SLIDEV_HAS_SERVER__: boolean;`

- [ ] **Step 1: Write the failing tests** in `sync.test.ts`. Use `t.mock.timers.enable({ apis: ["setTimeout"] })` and a rig whose fake `send` pushes into `sent: SyncMessage[]`. `isPresenter` reads a mutable flag. The shared state starts as `{ page: 2, clicks: 0, clicksTotal: 1, cursor: undefined, lastUpdate: { id: "p", type: "presenter", time: 1 }, timer: { status: "stopped" } }`.

```ts
test("only the presenter's own changes go out", (t) => {
  // isPresenter false → write(state) → sent.length 0
  // isPresenter true, write(state, true) (a replayed update) → sent.length 0
});
test("a new page goes out at once, without the timer, a hidden cursor as null", (t) => {
  // write(state) → sent[0] deepEqual { type: "sync", channel: "shared",
  //   data: { page: 2, clicks: 0, clicksTotal: 1, cursor: null, lastUpdate: { id: "p", type: "presenter", time: 1 } } }
});
test("pointer moves are thinned to one per 100 ms, carrying the latest position", (t) => {
  // after the first send: cursor {x:1,y:1} write, cursor {x:2,y:2} write → sent.length 1
  // tick(100) → sent.length 2, sent[1].data.cursor deepEqual { x: 2, y: 2 }
});
test("a page change sends a pending pointer move along, and nothing is sent twice", (t) => {
  // cursor write, then page 3 write → sent.length +1 with page 3 and the new cursor
  // tick(100) → no further message; write the same state again → none; timer-only change → none
});
test("received slide state reaches Slidev with null as undefined, but not in the presenter tab", (t) => {
  // isPresenter false: receive({ type:"sync", channel:"shared", data:{ page: 4, cursor: null } })
  //   → onUpdate called once with { page: 4, cursor: undefined }
  // isPresenter true: receive(...) → onUpdate not called again
});
test("channels other than shared are not ours", (t) => {
  // init("Deck - snapshots", …) → undefined; init("Deck - drawings", …) with drawings: false → undefined
});
test("resend sends the whole current state, even when unchanged", (t) => {
  // after a send, resend() → one more message equal to the full picked state (Review Focus 4)
});
```

Write each as real assertions following the comments; the comments give the exact values.

- [ ] **Step 2: Run them and see them fail**

Add `sync.test.ts` to the `test` script in `package.json`, then run `npm test`.
Expected: FAIL, `./sync.ts` not found.

- [ ] **Step 3: Implement `createSlideSync`** in `sync.ts` (shared channel only), per the behaviour above.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire it** in `client.ts` and `shims.d.ts` as specified. Add `"sync.ts"` to `files` in `package.json`.

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npx biome check *.ts *.vue components server setup scripts`
Expected: all pass.

Build test (`polls.showSlides: true`, `TOKEN=secret`, presenter at `/presenter?password=secret`, phone at the LAN address):
- The phone's slides follow pages, `v-click` steps and the laser pointer.
- A second phone opened mid-talk lands on the current slide and click.
- Stop the rig and start it again: within a few seconds the presenter reconnects, and both phones are on the current slide. Then they follow again (Review Focus 4).
- Dev server (`npm run dev`), same checks: nothing changed, since our sync is off there.

- [ ] **Step 7: README**

In "Live slides on phones", say that in builds the addon syncs page, clicks and pointer through the poll server, and only the presenter can move them.

- [ ] **Step 8: Commit**

```bash
git add sync.ts sync.test.ts client.ts shims.d.ts package.json README.md
git commit -m "feat: sync slides to phones in static builds"
```

---

### Task 6: Drawings in builds (spec part 3, `polls.showDrawings`)

**Files:**
- Modify: `sync.ts`, `sync.test.ts`, `README.md`, `demo/slides.md`

**Interfaces:**
- Consumes: `createSlideSync` and its options (Task 5).
- Behaviour, `drawings` channel (the `init` key ends in ` - drawings`, and `options.drawings`):
  - The write ignores non-presenter and `updating` calls.
  - It sends only pages whose string differs from the last one sent for that page, one message per page.
  - At most one flush per 100 ms, trailing, from the latest state.
  - Pages over the cap are skipped, with a warning once per page, and are not marked as sent.
  - `resend` sends one message per non-empty page.
  - `receive` passes `data` to `onUpdate` as is.

- [ ] **Step 1: Write the failing tests** in `sync.test.ts`

```ts
test("drawings go out page by page, only changed pages, at most every 100 ms", (t) => {
  // drawings: true; write({1:"a"}), write({1:"ab"}) → sent 0; tick(100) → sent [{channel:"drawings", data:{"1":"ab"}}]
  // write({1:"ab", 2:"c"}); tick(100) → one more, data {"2":"c"}
  // write({1:"", 2:"c"}); tick(100) → one more, data {"1":""} (a cleared page)
});
test("a drawing too big to send is skipped with one warning", (t) => {
  // t.mock.method(console, "warn"); write({1: "x".repeat(300 * 1024)}); tick(100) twice with a further change to page 1
  // → sent 0, console.warn called once; write({1: "…", 2: "small"}); tick(100) → page 2 sent
});
test("resend sends every drawn page on its own", (t) => {
  // state {1:"a", 2:"", 3:"c"}; resend() → two drawings messages, data {"1":"a"} and {"3":"c"}
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test`
Expected: FAIL. The drawings channel isn't taken yet (`init` returns `undefined`).

- [ ] **Step 3: Implement** the drawings channel in `sync.ts`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Verify in a build**

Add `showDrawings: true` under `polls:` in `demo/slides.md`.
- The presenter draws on a slide: the phone shows the strokes within a moment.
- Clear: the phone clears too.
- A late phone gets the drawings.
- With `showDrawings` removed, drawings stay on the presenter's machine.

- [ ] **Step 6: README**

Document `polls.showDrawings`:
- builds only;
- on the dev server Slidev always sends drawings to viewers;
- only the presenter's drawings sync;
- a page whose drawing passes 256 kB stops syncing, with a console warning.

- [ ] **Step 7: Commit**

```bash
git add sync.ts sync.test.ts README.md demo/slides.md
git commit -m "feat: sync the presenter's drawings in builds (polls.showDrawings)"
```

---

### Task 7: Custom emotes (spec part 4)

**Files:**
- Modify: `protocol.ts`, `protocol.test.ts`
- Modify: `global-top.vue` (render and preload), `server/vote.html`, `server/vote.ts` (render)
- Create: `demo/public/emotes/party.png` (APNG), `demo/public/emotes/wave.gif`
- Modify: `demo/slides.md`, `README.md`

**Interfaces:**
- Consumes: `slideReactions`, `settings` (Task 1); `base` in `vote.ts` (Task 3).
- Produces, in `protocol.ts`:
  - `MAX_REACTION = 512`, replacing `MAX_EMOJI` everywhere;
  - `export function isImage(reaction: string): boolean`;
  - `export function reactionUrl(reaction: string, base: string): string`. Full URLs (`http:`, `https:`, `//`) are returned unchanged. Otherwise the result is `base` without its trailing slash, plus `/`, plus the path without its leading slash, the same as Slidev's preloader;
  - `export function reactionLabel(reaction: string): string`: an image's file name without its extension, else the reaction itself.

- [ ] **Step 1: Write the failing tests** in `protocol.test.ts`

```ts
test("a reaction is an image when it ends in an image extension", () => {
  for (const r of ["emotes/a.png", "https://x/a.webp?v=2", "A.GIF", "b.apng", "c.avif", "d.svg", "e.jpg", "f.jpeg"]) {
    assert.ok(isImage(r), r);
  }
  for (const r of ["👍", "❤️", "png", "a.png.txt"]) {
    assert.equal(isImage(r), false, r);
  }
});

test("an image reaction is found under the deck's base, unless it is a full URL", () => {
  assert.equal(reactionUrl("emotes/a.png", "/"), "/emotes/a.png");
  assert.equal(reactionUrl("/emotes/a.png", "/talk/"), "/talk/emotes/a.png");
  assert.equal(reactionUrl("emotes/a.png", "http://h:3030/talk/"), "http://h:3030/talk/emotes/a.png");
  assert.equal(reactionUrl("https://cdn/x.gif", "/talk/"), "https://cdn/x.gif");
  assert.equal(reactionUrl("//cdn/x.gif", "/"), "//cdn/x.gif");
});

test("an image reaction is named after its file", () => {
  assert.equal(reactionLabel("emotes/catjam.png"), "catjam");
  assert.equal(reactionLabel("https://x/y/party.gif?v=1"), "party");
  assert.equal(reactionLabel("👍"), "👍");
});

test("a reaction can be a path of a few hundred characters", () => {
  const path = `emotes/${"a".repeat(300)}.png`;
  assert.ok(parseClientMessage(wire({ type: "slide", slide: 1, ids: [], reactions: [path] })));
  assert.ok(parseClientMessage(wire({ type: "react", emoji: path })));
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test`
Expected: FAIL, the helpers are missing and the long path is refused.

- [ ] **Step 3: Implement** the constant and the three helpers.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Render images**

Where a reaction is shown, show `<img :src="reactionUrl(r, base)" alt="">` when `isImage(r)`, else the text as now:
  - `global-top.vue`, floaters and the presenter tally, with base `import.meta.env.BASE_URL`;
  - `server/vote.html`, the buttons, with `base` from `vote.ts`. Expose `src(r)` and `label(r)` on `votePage`. `aria-label` is `` `React with ${label(r)}` ``.

Images are `width: 1em; height: 1em; object-fit: contain`, so they take the emoji's box: floaters already size by `font-size`; on the buttons, 1em is the 1.6rem emoji size.

- [ ] **Step 6: Preload on the deck** in `global-top.vue`. Hidden `<img>` elements, outside print mode, one per image URL in the deck. `slides` comes from `useNav()`:

```ts
[...new Set(slides.value.flatMap((route) =>
  slideReactions(settings, route.meta?.slide?.frontmatter?.polls).reactions))].filter(isImage)
```

Slides without their own reactions return the deck's, so the headmatter is covered. Use a `div` with the `hidden` attribute; the browser still loads `<img>` inside it.

- [ ] **Step 7: Demo emotes and docs**

Make two looping 64×64 emotes, each under 20 kB (shorten `-t` if one is bigger):

```bash
mkdir -p demo/public/emotes
ffmpeg -y -f lavfi -i "testsrc2=size=64x64:rate=8" -t 1 -plays 0 -f apng demo/public/emotes/party.png
ffmpeg -y -f lavfi -i "testsrc2=size=64x64:rate=8" -t 1 -loop 0 demo/public/emotes/wave.gif
ls -l demo/public/emotes
```

- `demo/slides.md`: "Another normal slide" gets `reactions: ["👏", "emotes/party.png", "emotes/wave.gif"]` and matching text.
- README: a "Custom emotes" section covering:
  - files go in the deck's `public/`;
  - the list of image extensions;
  - every phone downloads them, so keep each to tens of kB;
  - full URLs make phones fetch from that host;
  - animated images keep playing on phone buttons with reduced motion.

- [ ] **Step 8: Verify**

Run: `npm test && npm run typecheck && npx biome check *.ts *.vue components server setup scripts`
Expected: all pass.

Dev and build:
- On "Another normal slide" the phone buttons show both emotes animating.
- Tapping one floats it on the projector at once, and it shows in the presenter's tally.
- The projector's DevTools network panel shows `party.png` and `wave.gif` fetched at startup, before any reaction.

- [ ] **Step 9: Commit**

```bash
git add protocol.ts protocol.test.ts global-top.vue server/vote.html server/vote.ts demo/public/emotes demo/slides.md README.md
git commit -m "feat: image reactions (PNG, APNG, GIF, WebP) with preloading on the deck"
```

---

### Task 8: Whole-branch check

**Files:** none new. Fix-ups go in the file at fault, committed as `fix: …`.

- [ ] **Step 1: Automated checks**

Run: `npm test && npm run typecheck && npx biome check *.ts *.vue components server setup scripts`
Expected: all pass.

- [ ] **Step 2: Fresh build of the voting page**

Run: `npm run build && git status --short`
Expected: `dist/` is ignored, so no new tracked changes.

- [ ] **Step 3: Read the README top to bottom**

Every example uses `polls:`, and nothing still mentions `pollUrl` or top-level `reactions:` (`grep -n "pollUrl\|^reactions:" README.md demo/slides.md` prints nothing).

- [ ] **Step 4: The Review Focus list once more**

Re-run checks 1–5 on the final branch, in dev and in a build where they apply.

- [ ] **Step 5: Hand over** with `superpowers:finishing-a-development-branch`.
