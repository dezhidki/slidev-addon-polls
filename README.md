# slidev-addon-polls

Live polls for [Slidev](https://sli.dev): choice polls, quizzes and word clouds. The
audience scans a QR code and answers on their phones; the slide updates as they do.

No extra server to run: the poll backend lives inside Slidev's own dev server.

```md
---
addons:
  - slidev-addon-polls
---

<Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" />
```

```bash
slidev --remote=your-password
```

Open the **presenter view** to run the polls; the audience opens `/vote`.

## Poll types

```md
<!-- Choice: the room sees the bars move live -->
<Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" />

<!-- Quiz: `correct` is the index of the right option -->
<Poll question="What is 2 + 2?" :options="['3', '4', '5']" :correct="1" />

<!-- Word cloud: no options -->
<Poll question="One word for this lecture so far?" />
```

The QR code sits in the slide's top right corner, beside the title, with its address next
to it. It is as large as the empty band above the slide's content allows — from the top of
the slide to the bottom of the title's margin — so it never reaches into the content, and
it is the same size on every slide with a one-line title, whatever the layout. A long
title wraps before it.

To keep that small code readable it is made as simple as possible: the lowest
error-correction level (nothing on a projector is torn or smudged) and scheme and host in
capitals, which QR codes store more densely. For the back rows, show a big one first:
`<PollQr class="w-60" />` on a "join now" slide.

`--poll-qr-size` (default 140px) caps it, `--poll-qr-top` and `--poll-qr-right` move it;
set them in the deck's `style.css`. On a slide without a title, or a theme with hardly any
room above the content, the code keeps its full size and the poll makes room for it.

Put several `<Poll>`s on one slide if you like. `<PollQr class="w-60" />` shows just the
QR code, for a "join now" slide at the start.

### Several questions about the same thing

`<PollSet>` shows one poll at a time in the space of one — handy next to a code block.
You move through them like any other click on the slide (→ and ←), and the phones follow.

```md
<PollSet :polls="[
  { question: 'First line of output?', options: ['3', '1', 'lift-off'], correct: 2 },
  { question: 'And the last line?', options: ['3', '1', 'lift-off'], correct: 0 },
]" />
```

### In a PDF

`slidev export` prints just the question and its lettered options: no bars, QR code or
controls. A `<PollSet>` prints all of its questions under each other (or one per page
with `--with-clicks`).

`<Poll>` draws with the slide's own text colour and font, and uses
`--slidev-theme-primary` for the bars, so it follows whatever theme you use.

## Running a poll

Controls appear under each poll in presenter mode only:

- **Open voting / Close voting** — phones can answer only while it is open, once each.
- **Reveal answer** (quiz) — closes the voting and marks the right option everywhere.
- **Reset** — clears the answers; asks once more before it does.

A choice poll shows its bars to everyone as the votes come in. Quizzes and word clouds
hold back: while voting is open only you see what is arriving, and the room and the phones
see the number of answers. That keeps a quiz's distribution from steering the vote, and
nobody's phone receives the right answer before you reveal it.

It is also how you moderate a **word cloud**: the words show up in your presenter view as
they arrive, and a click removes one for good — it cannot be sent again, and whoever sent
it has used up their answer. Closing the voting shows the cloud to everyone. You can keep
removing words after that, too.

Phones follow your screen: they show the polls that are on it right now — the current
member of a `<PollSet>`, not the ones in the next-slide preview — plus any poll that is
still open. A poll you renamed or deleted while editing can therefore never show up. Answers survive you moving between slides and reloading; they live in the
server's memory, so restarting `slidev` clears them.

## Reactions

The voting page has a row of emoji; tapping one sends it floating up the side of the
slide, each emoji from its own spot. In presenter mode the corner of the slide counts
them per slide, which makes a quick "thumbs up if this made sense" readable at a glance.

They are on by default with 👍 👎 🤔 ❤️, and each person can send one every three seconds.
Change either for the deck in the headmatter, or for one slide in its frontmatter:

```yaml
reactions: false               # off
reactions: ["👏", "🤯", "❓"]   # your own set
reactionCooldown: 1            # seconds a person waits between reactions (default 3)
```

During the cooldown the emoji on the phone sit out, with a line that runs down until they
are back. The server enforces the same wait per person, not per connection, so reloading
the page or opening a second tab doesn't get around it. It also only accepts emoji the
current slide lists, and a flood thins out on screen instead of slowing it down. People
who prefer reduced motion get the counts without the floating.

## Where the audience connects

The QR code and address shown on the slides are, first match wins:

1. `pollUrl` in the headmatter — set this when your public address differs from what
   you browse, e.g. with `slidev --remote --tunnel`:
   ```yaml
   pollUrl: https://something.trycloudflare.com/vote
   ```
2. the address you opened the slides at, unless that is `localhost`;
3. the dev server's LAN address.

Phones must be able to reach that address. On networks that isolate clients from each
other (eduroam), use `--tunnel` or host the deck on a server.

## Who may run polls

Whoever is in presenter mode with the `--remote` password. This is the same light guard
Slidev itself uses — the password ships in the client bundle — so it keeps the room
honest, not a determined attacker out. Without a password, anyone who opens the presenter
view can run polls.

## Statically built decks

`slidev build` ships the voting page as `vote/index.html`, so it is at `/vote` there too,
but a static host has no poll backend. Run the standalone one and proxy
`<deck url>/polls` to it, WebSocket upgrade included:

```bash
PORT=3031 TOKEN=your-remote-password node node_modules/slidev-addon-polls/server/standalone.js
```

## Development

```bash
npm install
npm run dev   # demo deck with --remote
npm test      # the server's one test
```

If you add a new layer file (`global-top.vue`, `slide-top.vue`, …) and it never shows up:
Vite serves Slidev's list of layer files as immutable, so a browser that loaded the deck
before the file existed keeps the old list across server restarts. Hard-reload once
(Ctrl/Cmd+Shift+R, or "Disable cache" in DevTools).

Upgrading from 0.2: `<Poll :questions="[…]">` became one `<Poll>` per question (`type` is
inferred, `correctAnswer` is `correct`), `pollQr` became `pollUrl`, the voting page moved
from `/vote.html` to `/vote`, and the separate poll server and reverse-proxy rule are no
longer needed with `slidev` dev servers.
