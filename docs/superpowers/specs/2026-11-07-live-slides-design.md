# Live slides on the voting page

Status: approved, 2026-11-07

## Goal

People in the back of a raked hall can follow the slides on their phone, on the same page
where they vote and react. The deck opts in. Works on the dev server (`slidev --remote`)
and on static builds (`slidev build` + `server/standalone.ts`).

Also in this spec, because they touch the same settings: all settings move into one
`polls` object (part 0), and reactions can be images (part 4).

Out of scope: screen or video streaming, the presenter timer, slide snapshots, syncing
between decks on different origins.

## Decisions

- **All the addon's settings live in one `polls` object** (part 0). Slidev has no `polls`
  key of its own. The two new ones are off by default:

  ```yaml
  polls:
    showSlides: true
    showDrawings: true
  ```
- **`showSlides`** shows the slides on the voting page.
  - Dev server: Slidev's own sync moves them; the addon adds no sync code in dev.
  - Build: the same, plus the addon's own sync over the poll socket, because a build has
    no Slidev server to sync through.
- **`showDrawings`** adds the presenter's drawings, and needs `showSlides`. Builds only: on
  the dev server Slidev sends drawings to every viewer anyway. Hiding them there would
  mean styling Slidev's drawing layer, which has no stable class name. The README says so.
- **Same features as the dev server, otherwise.** Page, clicks and the cursor or laser
  pointer. Not the timer.
- **One deliberate difference from dev:** in builds only the presenter can send sync
  messages, and the server enforces it. Viewers never move anyone's slides, and only the
  presenter's drawings sync whatever `drawings.syncAll` says.
- **The presenter password fix is not behind the switch.** It is a bug today (part 1).

## Part 0: one settings object (breaking)

The existing headmatter keys move into `polls`, with no fallback for the old names:

| Old                | New                      | Per slide too |
| ------------------ | ------------------------ | ------------- |
| `pollUrl`          | `polls.url`              | no            |
| `reactions`        | `polls.reactions`        | yes           |
| `reactionCooldown` | `polls.reactionCooldown` | yes           |
| (new)              | `polls.showSlides`       | no            |
| (new)              | `polls.showDrawings`     | no            |

A slide's own `polls:` frontmatter overrides the headmatter key by key, so
`polls: { reactions: [...] }` on one slide keeps the deck's `reactionCooldown`. On a slide,
only the two per-slide keys count.

Files: `client.ts` (`PollConfig`), `global-bottom.vue`, `global-top.vue` (doc comment),
`components/PollQr.vue`, `README.md`, `demo/slides.md`. Version 0.4.0 → 0.5.0: before 1.0 a
breaking change bumps the minor, and `^0.4.0` will not pick it up by itself.

## Part 1: presenter password in builds (bug fix)

Today the deck sends `configs.remote` as its poll token (`client.ts`, `#greet`). A build
has no `remote` in its configs (checked in the demo build's `assets/slidev/configs-*.js`),
so in a build the presenter sends no token. With `TOKEN` set, the standalone server
refuses the presenter, and without it anyone may present.

Fix: the token is the first of

1. `?password=` in the URL the tab was opened with (Slidev's printed remote-control link
   already has it). Kept in `sessionStorage` (`poll-token`), so a reload after Slidev
   drops the query still works.
2. `configs.remote` (the dev server, same as today).

README, static builds: open the presenter as `<deck url>/presenter?password=<TOKEN>`.

**The password goes on the socket URL, not in `hello`.** A presenter tab connects to
`<base>/polls?presenter&token=<password>`. The server checks it during the upgrade:

- `presenter` given, and the token matches (or the server has none): the socket may
  present, and gets the presenter size cap (part 3).
- Anything else: an ordinary socket, 16 kB cap. A `hello` asking for `presenter` on it
  gets `denied` and stays a display, as today.
- `hello` loses its `token` field.
- A tab that switches between presenter and play view reconnects, instead of sending a new
  `hello` on the same socket.

This authenticates presenters before the server reads any of their messages. It exposes
nothing new: the password is already in URLs (`/presenter?password=…`).

Known and not fixable here: on the dev server, Slidev itself serves the `--remote` password
to every browser in `/@slidev/configs`, and its sync accepts updates from anyone. The README
says so: for a large or untrusted room, use a build.

## Part 2: slides on the voting page

**Telling the page.** The voting page is the same file in dev and in builds, so the Vite
plugin (`setup/vite-plugins.ts`) marks it where it serves or emits it: with
`polls.showSlides` on, `<html>` gets `data-slides="<aspect ratio>"` from
`options.data.config.aspectRatio`.
Both the dev middleware and `generateBundle` apply it. No protocol change.

**Layout** (`server/vote.html`, `server/vote.ts`):

- A "Show slides" / "Hide slides" toggle at the top, only when `data-slides` is set.
  Starts on, because the deck opted in. The choice is kept in `localStorage`
  (`poll-slides`).
- When on: `<iframe src="<base>?embedded=true">` at the deck's aspect ratio. In portrait
  it is full width and sticky at the top. In landscape the slides and the polls sit side by
  side: the slides on the left, as tall as the space above the reaction bar allows and at
  most about 60% of the width, the polls on the right, scrolling on their own, with the
  toggle at their top.
- `pointer-events: none` on the iframe. Taps and swipes on Slidev's play view navigate
  locally, which would take the phone off the presenter's slide. Being exactly the
  slide's aspect ratio also keeps Slidev's nav bar hidden.
- `x-if`, not `x-show`: with slides off, the deck is never loaded.

The embedded deck connects to the poll server as a `display`, like any other screen, so
polls on the slide and floating reactions appear as on the projector.

## Part 3: sync for builds

Only when `!__SLIDEV_HAS_SERVER__ && polls.showSlides`.

**Deck side** (`client.ts`). The client registers a `Sync` (Slidev's exported interface) with
`addSyncMethod` when the module loads. Slidev hands it every channel, including ones
created before registration.

- Channels it takes: the one ending in ` - shared`, and the one ending in ` - drawings`
  when `polls.showDrawings` is on. It returns nothing for the rest.
- Writing (presenter tab only, and never while `updating` is true, which is Slidev
  replaying a received update; this is what stops echoes with Slidev's same-browser
  BroadcastChannel sync):
  - `shared`: `page`, `clicks`, `clicksTotal`, `cursor`, `lastUpdate`. When page or clicks
    changed, send at once. Cursor-only changes are throttled to one per 100 ms, trailing.
  - `drawings`: only pages whose dump differs from the last one sent, throttled to one per
    100 ms, trailing. Slidev updates the dump on every pointer move during a stroke.
  - A key that became `undefined` (the cursor hidden) is sent as `null`.
  - A message bigger than the presenter cap is not sent; the client logs a warning
    instead. Sending it would get the presenter's socket closed (`ws` closes with 1009 on
    an oversized message), and the full resend on reconnect would close it again.
- When a presenter socket opens, the client sends the full current state of each channel
  it takes (for drawings, one message per page), so a restarted server catches up.
- Receiving (non-presenter tabs): `sync` from the server goes to that channel's `onUpdate`,
  with `null` turned back into `undefined`. Slidev's own follow logic (`setup/root.ts`)
  does the navigation, including a viewer's "don't follow" toggle.

**Protocol** (`protocol.ts`):

- Client to server, added to `PRESENTER_ONLY`:
  `{ type: "sync", channel: "shared" | "drawings", data }`
  - `shared` data: optional `page`, `clicks`, `clicksTotal` (counts); `cursor`
    (`{ x, y, style? }` or `null`); `lastUpdate` (`{ id, type, time }`).
  - `drawings` data: record of page number to SVG dump string.
- Server to client: the same shape.
- **Size caps by sender, not by deck setting.** The standalone server never sees the
  deck's headmatter, so a cap that followed `showDrawings` would need a second, matching
  setting on the server. Instead:
  - Presenter sockets (authenticated at upgrade, part 1): 256 kB, for drawing dumps.
  - Every other socket: 16 kB, as today. Phones can never send big messages.
  - Two `WebSocketServer`s with different `maxPayload`, chosen during the upgrade.
  - With drawings off, no presenter message comes near 16 kB anyway, so the bigger cap
    costs nothing.

**Server** (`server/polls.ts`):

- Keeps the latest merged data per channel (`Object.assign`; `null` values kept, so late
  joiners get them too).
- Relays each `sync` to `display` sockets only. The voting pages don't need it.
- On a display's hello, sends the stored data of each non-empty channel.
- Like `react`, a `sync` triggers no state broadcast.

## Part 4: custom emotes

An entry in `polls.reactions` is an image when it ends in an image extension, and an
emoji otherwise:

```yaml
polls:
  reactions: ["👍", "emotes/catjam.png", "emotes/party.gif"]
```

- **Where the files live:** the deck's `public/` folder, which Slidev serves in dev and
  copies into builds. Relative paths resolve against the deck's base URL. Absolute URLs
  work too, but then every phone fetches from that host, which the venue's wifi may not
  reach. The README recommends `public/`.
- **Recognising images:** one helper in `protocol.ts`, `isImage(reaction)`, matching
  `.png .apng .gif .webp .avif .svg .jpg .jpeg` (ignoring a query string). All three sides
  already import `protocol.ts`.
- **Protocol:** `MAX_EMOJI` (16) becomes `MAX_REACTION` (512), so paths and URLs fit. The
  shape of every message stays the same. Phones still cannot put anything on screen that
  the presenter's slide does not list: the server only counts listed entries.
- **Rendering**, an `<img>` for images and text as now for emoji:
  - floating reactions (`global-top.vue`), base `import.meta.env.BASE_URL`;
  - the presenter's tally (`global-top.vue`);
  - the phone's reaction buttons (`server/vote.html`). The base comes from the page's own
    address, the same one `vote.ts` already works out for the socket. Hoist it into one
    constant.
- **Size:** the image fills the box the emoji takes now (`object-fit: contain`).
  - APNG, animated GIF and animated WebP play on their own in `<img>`.
- **Labels:** the file name without extension, e.g. "React with catjam".
- **Preloading on the deck:** every image the deck can float is known at startup: the
  headmatter's `polls.reactions` plus each slide's frontmatter (`useNav().slides`).
  - `global-top.vue` collects them, removes duplicates, and keeps them as hidden `<img>`s
    for the whole talk. Not in print mode.
  - An image in the document stays loaded and decoded, so the first float of an emote
    shows at once.
  - All at startup, not a few slides ahead like Slidev does: a deck has a handful of
    emotes of tens of kB.
  - Slidev's own preloader cannot do this. It only reads the `image`, `backgroundImage`
    and `background` frontmatter keys, and it isn't exported.
  - The per-slide lookup that part 0 needs moves from `global-bottom.vue` to `client.ts`,
    so both layers read reactions the same way.
- **Phones** only learn a slide's reactions when it comes up, so their buttons load then.
  That is one small file each, from the same server.
- **Known limit:** animated images keep playing on the phone buttons even with reduced
  motion on. The floating stays off as today.
- **README:** every phone downloads these files, so keep each to tens of kB.

## Testing

- `server/polls.test.ts`:
  - A socket opened with the right token may present; with a wrong or missing token its
    presenter `hello` gets `denied`.
  - A presenter may send a 100 kB `sync`; any other socket sending more than 16 kB is
    closed.
  - `sync` from an audience or display socket is dropped.
  - A presenter's `sync` reaches displays and not the audience.
  - A display joining late gets the merged state.
  - A drawings update for one page leaves the others alone.
- `protocol.test.ts`:
  - `sync` parses for both channels; a non-string drawing, or a channel other than the
    two, does not.
  - `isImage`: true for `emotes/a.png`, `https://x/a.webp?v=2` and `A.GIF`; false for `👍`,
    `❤️` and `png`.
  - A 300-character reaction path parses in `slide` and `react`.
- `npm run typecheck` catches a change to Slidev's `Sync` interface.
- By hand, in Chrome, with the demo deck:
  - Dev with `--remote`: phone-sized window on `/vote` follows the presenter.
  - Build with `showSlides` and `showDrawings`, served statically, standalone server with
    `TOKEN`:
    - The presenter controls polls (part 1).
    - The phone window follows pages, clicks and the laser, and shows drawings.
    - A second display joining mid-talk lands on the current slide.
  - An APNG and a GIF emote in the demo deck: they animate on the phone buttons, float on
    the projector and show in the presenter's tally.
  - On a slide that sets its own image reactions: the projector's network panel shows
    the files fetched at startup, not at the first reaction.

## Order

0. Part 0, so the new settings land in their final place.
1. Part 1. Stands alone and fixes a bug.
2. Part 2. Works on the dev server as soon as it lands.
3. Part 3, page, clicks and cursor.
4. Part 3, drawings.

Part 4 depends only on part 0 and can land any time after it.

## Known limits

- Phones load the whole deck, so a quiz's `correct` index is readable in its JavaScript.
  That is true today for anyone opening the deck URL; this feature puts the deck on every
  phone that shows slides. Documented in the README.
- Dev server load with many phones is unmeasured: they load Vite's unbundled modules from
  the presenter's laptop. The README points large rooms at builds.
- A single page's drawing dump over 256 kB is not sent to phones; the presenter's console
  says so.
- Hash router mode (`routerMode: hash`) is untested for the iframe address.
