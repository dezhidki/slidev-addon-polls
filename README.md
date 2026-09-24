# slidev-addon-polls

Live polls for [Slidev](https://sli.dev): choice polls, quizzes and word clouds. The
audience scans a QR code and answers on their phones. The slide updates as they vote.

No extra server: the poll backend runs inside Slidev's own dev server.

> @author Claude · @author Denis Zhidkikh — see [How it is put together](#how-it-is-put-together).

## Quick start

1. Install from GitHub (not on npm yet):

   ```bash
   npm install github:dezhidki/slidev-addon-polls
   ```

   This installs the latest `main`. To stay on one version, add a commit hash:
   `github:dezhidki/slidev-addon-polls#e83f341`. Update with `npm update slidev-addon-polls`.

2. Add the addon to your deck's headmatter and put a poll on a slide:

   ```md
   ---
   addons:
     - slidev-addon-polls
   ---

   <Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" />
   ```

3. Start Slidev with a presenter password: `slidev --remote=your-password`
4. Open the **presenter view** and click **Open voting** under the poll.
5. The audience scans the QR code on the slide, or opens `/vote`.

## Poll types

| Type       | How to write it                      | What the room sees while voting |
| ---------- | ------------------------------------ | ------------------------------- |
| Choice     | `options`                            | Bars move live                  |
| Blind      | `options` + `blind`                  | Only the number of answers      |
| Quiz       | `options` + `correct` (option index) | Only the number of answers      |
| Word cloud | no `options`                         | Only the number of answers      |

```md
<Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" />
<Poll question="Which talk next?" :options="['Rust', 'Go']" blind />
<Poll question="What is 2 + 2?" :options="['3', '4', '5']" :correct="1" />
<Poll question="One word for this lecture so far?" />
```

- **Several polls on one slide:** just add more `<Poll>`s.
- **Keep answers when you move or edit a poll:** give it an `id`, unique in the deck:
  `<Poll id="tabs" question="Tabs or spaces?" … />`. Without one, a poll is known by its
  slide number and question, so inserting a slide before it or rewording it starts it
  afresh. With an `id`, only changing the number of options does.
- **Big "join now" QR code:** `<PollQr class="w-60" />` shows only the QR code. Put it on
  an early slide so the back rows can scan it.

### Several questions in the space of one: `<PollSet>`

`<PollSet>` shows one poll at a time, which fits next to a code block. Step through the
questions with → and ←, like any other click on the slide. Phones follow along.

```md
<PollSet :polls="[
  { question: 'First line of output?', options: ['3', '1', 'lift-off'], correct: 2 },
  { question: 'And the last line?', options: ['3', '1', 'lift-off'], correct: 0 },
]" />
```

## Running a poll

The controls appear under each poll, in presenter mode only:

- **Open voting / Close voting**: phones can answer only while voting is open, once per
  person. Until voting closes they can change their answer, e.g. after a misclick.
- **Reveal answer** (quiz only): closes voting and marks the right option everywhere.
- **Reset**: clears the answers. Click it twice within 3 seconds, so a misclick is safe.

### Why blind polls, quizzes and word clouds hide results

While voting is open, only you see the answers arriving. Everyone else sees the count.
This stops the distribution from steering the vote, and no phone receives the right
answer before you reveal it.

### Moderating a word cloud

1. Words appear in your presenter view as they arrive.
2. Click a word to remove it for good. It cannot be sent again, and its sender has used
   up their answer.
3. Click **Close voting** to show the cloud to everyone. You can still remove words after
   that.

### What phones show

- The polls on your screen right now: for a `<PollSet>`, the current question only. Polls
  in the next-slide preview do not count.
- Any poll that is still open, even on another slide.

A poll you deleted, or renamed without an `id`, never shows up.

### Where answers are kept

In the server's memory. They survive slide changes and page reloads. Restarting `slidev`
clears them.

## Reactions

The voting page has a row of emoji. Tapping one floats it up the side of the slide. In
presenter mode, a corner of the slide counts reactions per slide, so "thumbs up if this
made sense" is readable at a glance.

Defaults: on, with 👍 👎 🤔 ❤️, and one reaction per person every 3 seconds. Change them
for the whole deck in the headmatter, or for one slide in its frontmatter:

```yaml
reactions: false               # turn off
reactions: ["👏", "🤯", "❓"]   # your own set
reactionCooldown: 1            # seconds between reactions per person (default 3)
```

How the limits work:

- The server enforces the cooldown per person, not per connection. Reloading or opening
  a second tab does not skip it.
- The server only accepts emoji that the current slide lists.
- A flood of reactions thins out on screen instead of slowing it down.
- People who prefer reduced motion see the counts without the floating.

## Where the audience connects

The QR code and address on the slides come from the first of these that applies:

1. `pollUrl` in the headmatter. Set this when your public address differs from the one
   you browse, e.g. with `slidev --remote --tunnel`:

   ```yaml
   pollUrl: https://something.trycloudflare.com/vote
   ```

2. The address you opened the slides at, unless it is `localhost`.
3. The dev server's LAN address.

Phones must be able to reach that address. Some networks (e.g. eduroam) block devices
from reaching each other. There, use `--tunnel` or host the deck on a server.

## Who can run polls

Anyone in presenter mode with the `--remote` password. Without a password, anyone who
opens the presenter view.

This is the same light guard Slidev itself uses: the password ships in the client
bundle. It keeps the room honest. It does not stop a determined attacker.

## Styling

`<Poll>` uses the slide's own text colour and font, and `--slidev-theme-primary` for the
bars. It follows whatever theme you use.

### The QR code on poll slides

It sits in the top right corner, next to the title, with its address beside it. It fills
the empty band above the slide content, so it never overlaps the content and is the same
size on every slide with a one-line title. A long title wraps before reaching it.

On a slide without a title, or with a theme that leaves little room above the content,
the code keeps its full size and the poll makes room for it.

To stay readable at that size, the code uses the lowest error-correction level and an
upper-case scheme and host (QR codes store capitals more densely).

Size one poll's code with the `qrSize` prop:

```md
<Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" qr-size="180px" />
```

Or set the defaults for the whole deck in its `style.css`:

| Variable          | Does                                  | Default |
| ----------------- | ------------------------------------- | ------- |
| `--poll-qr-size`  | Its size, capped by the title's band  | `140px` |
| `--poll-qr-top`   | Distance from the top                 | `12px`  |
| `--poll-qr-right` | Distance from right                   | `32px`  |

## PDF export

`slidev export` prints each poll as its question and lettered options only: no bars, QR
code or controls. A `<PollSet>` prints all its questions one under another, or one per
page with `--with-clicks`.

## Static builds (`slidev build`)

The voting page ships as `vote/index.html`, so it is at `/vote` there too. A static host
has no poll backend, though, so:

1. Run the standalone backend:

   ```bash
   PORT=3031 TOKEN=your-remote-password node node_modules/slidev-addon-polls/server/standalone.ts
   ```

   The server is TypeScript that Node runs as it stands (v22.18+ or v23.6+). On an older
   Node, add `--experimental-strip-types`.

2. Proxy `<deck url>/polls` to it, including WebSocket upgrades.

## How it is put together

Three sides speak one protocol, and [`protocol.ts`](protocol.ts) is all of it: the message
types, and the parsers that turn a JSON string into one of them or into nothing. Both
directions are parsed, so nothing downstream re-checks a field.

| File                 | Runs in                | Does                                       |
| -------------------- | ---------------------- | ------------------------------------------ |
| `protocol.ts`        | everywhere             | Message types, limits, parsing             |
| `client.ts`          | the deck               | One socket per tab, the reactive state     |
| `components/*.vue`   | the deck               | The polls on the slides                    |
| `server/polls.ts`    | Slidev's dev server    | All poll state, in memory                  |
| `server/vote.ts`     | the phones             | The voting page, driven by Alpine          |

The voting page is built into one self-contained `dist/vote.html` — Alpine and the page's
own code inlined, no CDN and no second request — because the phones are on the venue's
wifi and not necessarily on the internet.

## Development

```bash
npm install     # also builds the voting page
npm run build   # rebuild dist/vote.html after changing server/vote.*
npm run dev     # demo deck with --remote (builds first)
npm test        # the protocol's parsers and the server
npm run typecheck
npm run lint
```

`npm run typecheck` covers the TypeScript modules. The `.vue` components need `vue-tsc`,
which also reports errors from `@slidev/client`'s own sources, so filter them out:

```bash
npx vue-tsc --noEmit --pretty false | grep -v '^node_modules/'
```

**New layer file never shows up?** (`global-top.vue`, `slide-top.vue`, …) Vite serves
Slidev's list of layer files as immutable, so a browser that loaded the deck before the
file existed keeps the old list, even across server restarts. Hard-reload once
(Ctrl/Cmd+Shift+R, or tick "Disable cache" in DevTools).

## Upgrading from 0.3

Nothing to change in a deck. For anyone running the standalone backend or importing the
addon's modules:

- `server/standalone.js` and `server/polls.js` are now `.ts`, run directly by Node.
- `client.ts` exports one `polls` object: `polls.state.*` for what the server says,
  `polls.send/sync/define/show` for saying something back.
- The wire protocol moved to `protocol.ts`, and `define` now carries every poll at once.

## Upgrading from 0.2

- `<Poll :questions="[…]">` is now one `<Poll>` per question. `type` is inferred, and
  `correctAnswer` is now `correct`.
- `pollQr` is now `pollUrl`.
- The voting page moved from `/vote.html` to `/vote`.
- With `slidev` dev servers, the separate poll server and its reverse-proxy rule are no
  longer needed.
