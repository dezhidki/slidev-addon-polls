# slidev-addon-polls

[![AI License](https://oss.korext.com/api/ai-license-badge/unknown/unknown)](https://oss.korext.com/ai-license)

Live polls, quizzes, word clouds and reactions for [Slidev](https://sli.dev) slides. The
audience answers on their phones. The poll backend runs inside Slidev's own dev server, so
there is no extra server; a static build uses a small standalone one.

<div align="center">
<video src="https://github.com/user-attachments/assets/05d0b3d9-52b4-4044-99bc-63b8fa6c3e0c"></video>
</div>

## Quick start

1. Install the addon from GitHub (any package manager works):

   ```bash
   npm install github:dezhidki/slidev-addon-polls
   ```

2. Add it to your deck's headmatter and put a poll on a slide:

   ```md
   ---
   addons:
     - slidev-addon-polls
   ---

   <Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" />
   ```

3. Start Slidev with a presenter password:

   ```bash
   slidev --remote=your-password
   ```

4. Open the **presenter view** and click **Open voting** under the poll.
5. The audience scans the QR code on the slide, or opens `/vote`.

You should see: phones show the question and its options. On the slide, the bars fill in
as votes arrive, and the status line under the poll reads `Voting open` with the number of
answers.

`--remote` opens the dev server to the network. Read [Security](#security) before a large
or untrusted room.

## Poll types

|                                      |                                     |
| ------------------------------------ | ----------------------------------- |
| ![](demo/screenshots/choice.png)     | ![](demo/screenshots/quiz.png)      |
| **Polls**                            | **Quizzes**                         |
| ![](demo/screenshots/word_cloud.png) | ![](demo/screenshots/reactions.gif) |
| **Word clouds**                      | **Reactions**                       |

### Choice poll

```md
<Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" />
```

- `question` (string, required): the question to show.
- `options` (array, required): the answer options.
- More than one poll on a slide: add more `<Poll />` elements. They usually stack well.

### Quiz

```md
<Poll question="What is 2 + 2?" :options="['3', '4', '5']" :correct="1" />
```

`correct` is the index of the right option, counted from 0.

- Quizzes are always blind: the room sees the results once voting closes.
- To show the right answer, the presenter clicks **Reveal answer**.

### Word cloud

```md
<Poll question="What do you think of me?" />
```

Leave out `options` to get a word cloud.

- While voting is open, only the presenter sees the words, so they can be moderated first.
- To moderate, click a word in the presenter view. It is removed, and the word is banned.

### Several polls on one slide

```md
<PollSet :polls="[
  { question: 'First line of output?', options: ['3', '1', 'lift-off'], correct: 2 },
  { question: 'And the last line?', options: ['3', '1', 'lift-off'], correct: 0 },
]" />
```

`<PollSet>` shows its polls one at a time. Each click on the slide moves to the next poll,
and the phones follow. Use it for 3 or more polls on one slide, or to keep other content
(such as code) on screen beside them.

### Keep answers when you edit a poll

```md
<Poll id="my-poll-1" question="Speed of an unladen swallow?" :options="['European?', 'African?']" />
```

Give the poll an `id`, unique in the deck. Then you can move it or reword it live.

- Without an `id`, a poll is known by its slide number and question. Inserting a slide
  before it, or rewording its question, starts it afresh.
- With or without an `id`, changing the number of options starts it afresh.
- Other edits keep the answers, counted by position: reordering options moves their votes
  to other options.

### Hide results until voting closes

```md
<Poll question="Which talk next?" :options="['Rust', 'Go']" blind />
```

Without `blind`, the slide shows a choice poll's results live while voting is open. With
it, the room sees them once voting closes.

## Running a poll

In presenter mode, each poll has these controls under it:

- **Open voting / Close voting**: phones can answer only while voting is open, once per
  person. Until voting closes they can change their answer, e.g. after a misclick. After a
  close, the button reads **Reopen voting**.
- **Reveal answer** (quiz only): closes voting and marks the right option everywhere.
- **Reset**: clears the answers. Click it twice within 3 seconds, so a misclick is safe.
- **A word in a word cloud**: click it to remove and ban it.

## Settings

**Upgrading from before 0.5.0?** Move the top-level `pollUrl`, `reactions` and
`reactionCooldown` under `polls:`, as `url`, `reactions` and `reactionCooldown`. 0.5.0 moved
them there, and the old top-level keys no longer work.

Every setting lives under one `polls:` key in the headmatter:

```yaml
polls:
  reactions: ["👏", "🤯", "❓"]
  showSlides: true
```

| Key                | Does                                           | Default                                          | Per slide |
| ------------------ | ---------------------------------------------- | ------------------------------------------------ | --------- |
| `url`              | Voting page address for the QR code            | Worked out, see [address](#voting-page-address)  | no        |
| `reactions`        | `false`, or a list of emoji and image paths    | 👍 👎 🤔 ❤️                                      | yes       |
| `reactionCooldown` | Seconds between two reactions from one person  | `3`                                              | yes       |
| `showSlides`       | Whether phones can follow the slides           | off                                              | no        |
| `showDrawings`     | Whether phones show the presenter's drawings   | off; needs `showSlides`                          | no        |

"Per slide" means a slide's own frontmatter can set it under `polls:`, and that beats the
headmatter for that slide.

## Reactions

```yaml
polls:
  reactions: ["👏", "🤯", "❓"] # your own set
  reactionCooldown: 1 # seconds between reactions per person (default 3)
```

Put this in the headmatter for the whole deck, or in a slide's frontmatter for that slide.
To turn reactions off:

```yaml
polls:
  reactions: false
```

The voting page has a row of emoji. Tapping one floats it up the side of the slide. In
presenter mode, a corner of the slide counts the reactions on the current slide, so a
"thumbs up if this made sense" shows up as a number.

Defaults: on, with 👍 👎 🤔 ❤️, and one reaction per person every 3 seconds.

- The server enforces the cooldown per person, not per connection. Reloading or opening a
  second tab does not skip it.
- The server only accepts emoji that the current slide lists.
- A flood of reactions thins out on screen instead of slowing it down.
- With reduced motion, nothing floats. Every view but the presenter's shows the counts in
  a still badge at the slide's bottom right; the presenter keeps the corner count.

### Custom emotes

1. Put the image in the deck's `public/` folder, e.g. `public/emotes/party.png`.
2. List its path in `polls.reactions`:

   ```yaml
   polls:
     reactions: ["👏", "emotes/party.png", "emotes/wave.gif"]
   ```

You should see: phones show the image on its button, the projector floats it, and the
presenter's count shows it.

File rules:

- Extensions: `.png`, `.apng`, `.gif`, `.webp`, `.avif`, `.svg`, `.jpg`, `.jpeg`.
- A path is read from the deck's base, so `emotes/party.png` is `public/emotes/party.png`.
- A full URL (`https://...`) makes phones fetch it from that host.
- Every phone downloads each image, so keep each to tens of kB.

Behaviour:

- The deck preloads every emote, so the first tap floats at once.
- Animated images keep playing on phone buttons with reduced motion; only the floating on
  the big screen stops.

## QR code

Every slide with a poll shows a QR code in its top right corner. For a big "join now" code
without a poll, e.g. on an early slide so the back rows can scan it:

```md
<PollQr class="w-60" />
```

It shows the code and the voting page address.

To size one poll's code:

```md
<Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" qr-size="180px" />
```

To set the defaults for the whole deck, set these in its `style.css`:

| Variable          | Does                                 | Default |
| ----------------- | ------------------------------------ | ------- |
| `--poll-qr-size`  | Its size, capped by the title's band | `140px` |
| `--poll-qr-top`   | Distance from the top                | `12px`  |
| `--poll-qr-right` | Distance from right                  | `32px`  |

Where it sits:

- Beside the title, with its address next to it, in the empty band above the slide's
  content. It never overlaps the content.
- It is the same size on every slide with a one-line title. A long title wraps before
  reaching it.
- On a slide without a title, or with a theme that leaves little room above the content,
  the code keeps its full size and the poll makes room for it.
- To stay readable at that size, it uses the lowest error-correction level and an
  upper-case scheme and host (QR codes store capitals more densely).

## Voting page address

Set `polls.url` when your public address differs from the one you browse, e.g. with
`slidev --remote --tunnel`:

```yaml
polls:
  url: https://something.trycloudflare.com/vote
```

The QR code and the address on the slides come from the first of these that applies:

1. `polls.url` in the headmatter.
2. The address you opened the slides at, unless it is `localhost`.
3. The dev server's LAN address.

A `<PollQr url="…" />` uses its own `url` before all three.

Phones must be able to reach that address. Some networks block devices from reaching each
other. There, use `--tunnel` or host the deck on a server.

## Live slides on phones

1. Turn it on in the headmatter:

   ```yaml
   polls:
     showSlides: true
   ```

2. Start the deck: `slidev --remote=your-password`, or a build with the standalone server
   and `TOKEN` set (see [Static builds](#static-builds)).
3. Phones open `/vote`, or scan the QR code.

You should see: each phone shows the slides above the polls, on the same page and click as
the presenter.

On the phone:

- Taps on the slide do nothing.
- Turned sideways, the slides and the polls sit side by side, and the polls scroll on
  their own.
- The slides start as large as fits with the poll's question visible. Drag the bar between
  the slides and the polls to resize them, or focus it and use the arrow keys. A size you
  set is remembered; End goes back to the largest.
- The arrow button on that bar hides the slides for that phone. The phone remembers, and a
  hidden deck is not loaded at all.
- The phone's copy of the slides leaves out the QR codes.

Dev server or build:

- **Dev server:** the phone loads the deck as a viewer, and Slidev's own sync moves it. The
  first load is heavy; see [Known limits](#known-limits).
- **Build:** the voting page embeds the built deck. The addon syncs the presenter's page,
  clicks and pointer through the poll server, and only the presenter can move them. A
  phone that joins mid-talk lands on the current slide. This needs `TOKEN` set on the
  standalone server.

### Drawings

1. Add `showDrawings` next to `showSlides`:

   ```yaml
   polls:
     showSlides: true
     showDrawings: true
   ```

2. Draw with Slidev's pen in the presenter view.

You should see: phones show what the presenter draws, and clear when the presenter clears.

- `showDrawings` needs `showSlides`; on its own it does nothing.
- It matters in builds only: the dev server always sends drawings to viewers.
- Only the presenter's drawings sync. Without `showDrawings`, a build keeps drawings on the
  presenter's machine.
- For the size limit, see [Known limits](#known-limits).

## Static builds

1. Build the deck. With the addon enabled, the output folder gets the voting page at
   `vote/index.html`.

   ```bash
   slidev build
   ```

2. Run the standalone poll server, with your presenter password as `TOKEN`:

   ```bash
   PORT=3031 TOKEN=your-remote-password node node_modules/slidev-addon-polls/server/standalone.ts
   ```

   Node runs this TypeScript as it stands on v22.18+ or v23.6+. On an older Node, add
   `--experimental-strip-types`.

3. Proxy `<deck url>/polls` to it, including WebSocket upgrades.
4. Present from `<deck url>/presenter?password=your-remote-password`. The deck keeps the
   password for the tab, so a reload without it still presents.
5. Phones open `<deck url>/vote`, or scan the QR code.

You should see: the presenter's polls show **Open voting**. If the status line under a poll
reads `Poll server offline`, the proxy does not reach the poll server. If the controls read
`The poll server rejected the presenter password.`, the password and `TOKEN` differ.

## PDF export

```bash
slidev export
```

The export _should_ work. It prints each poll as its question and lettered options only: no
bars, QR code or controls. A `<PollSet>` prints all its questions one under another, or one
per page with `--with-clicks`.

## Security

- **Dev server (`slidev --remote`):** Slidev hands the password to every browser that loads
  the deck (`/@slidev/configs`), and its sync takes updates from anyone. For a large or
  untrusted room, serve a build instead.
- **No password:** without `TOKEN` on the standalone server, or with a bare `--remote` on
  the dev server, anyone may present: open, close, reveal and reset polls, and remove
  words. The standalone server warns about this when it starts.
- **Builds need `TOKEN` for live slides:** the standalone server syncs slides and drawings
  to phones only when `TOKEN` is set. Without it anyone may present, and could then move
  every phone's slides or run script on them through a drawing.
- **Quiz answers are readable in the deck's JavaScript.** With `showSlides`, every phone
  loads the whole deck, so keep it off for a quiz that must stay secret. Keeping it off
  stops phones from loading the deck, but anyone who opens the deck's own address (the
  voting address without `/vote`) can still read the answer.

## Known limits

Live slides:

- On the dev server, a phone's first load of the slides is heavy, because the dev server
  sends modules one by one: 503 requests and 15.6 MB on the demo deck (headless Chrome,
  counting response headers and bodies).
- A page whose drawing passes 256 kB stops syncing, with a warning in the presenter's
  console.

Polls:

- Answers are kept in memory only, for as long as the poll server runs (the dev server, or
  the standalone one).

## Development

```bash
npm install     # also builds the voting page
npm run build   # rebuild dist/vote.html after changing server/vote.*
npm run dev     # demo deck with --remote (builds first)
npm test        # the protocol's parsers, the slide sync and the server
npm run typecheck
npm run lint    # biome
```
