# Slidev Addon: Live Polls

Real-time audience polling for Slidev presentations. Supports choice polls, quizzes with answer reveal, and word clouds. Includes QR code generation for audience join.

## Features

- 🗳️ **Choice Polls** — Multiple choice with live bars
- 🎯 **Quizzes** — Choice with correct answer reveal
- ☁️ **Word Clouds** — Free text aggregation
- 📱 **QR Code** — `<PollQR>` component for audience join
- 🎛️ **Presenter Controls** — Start / stop / reveal from slides
- 📊 **Real-time** — WebSocket updates without refresh

## Install

```bash
npm install slidev-addon-polls
```

In your `slides.md` front matter:

```yaml
addons:
  - slidev-addon-polls
```

## Components

### `<PollPresenter />` (recommended)

Full presenter view with controls. Embeds directly on a slide.

```markdown
<PollPresenter :polls="[{
  id: 'q1',
  question: 'Your question?',
  type: 'choice',
  options: ['A', 'B', 'C']
}]" />
```

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `polls` | `Array` | `[]` | Poll definitions |
| `token` | `string` | `''` | Presenter auth token |
| `size` | `'compact' \| 'normal'` | `'normal'` | Layout size |

**Poll definition:**

```ts
interface Poll {
  id: string           // unique identifier
  question: string     // displayed question
  type: 'choice' | 'quiz' | 'wordcloud'
  options?: string[]   // choices for choice/quiz
  correctAnswer?: number  // index for quiz reveal
}
```

### `<PollInline />` (compact display)

Read-only results without controls. Good for summary slides.

```markdown
<PollInline
  question="Results so far"
  type="choice"
  :options="['A', 'B', 'C']"
  :votes="[12, 5, 8]"
/>
```

### `<PollQR />` (audience join)

Shows URL + QR code for audience to open on their phones.

```markdown
<PollQR url="https://your-site/vote.html" />
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `url` | `string` | auto-detected | Audience voting page URL |
| `image` | `string` | none | QR code image path |

## Poll Server

The addon includes a Node.js WebSocket server in `poll-server/server.js`.

### Start

```bash
cd node_modules/slidev-addon-polls/poll-server
node server.js [PORT] [TOKEN]
```

Defaults: `PORT=3031`, `TOKEN=changeme`

### Environment variables

```bash
PORT=3031
TOKEN=your-secret-token
```

### Reverse proxy (nginx)

```nginx
location /polls {
    proxy_pass http://127.0.0.1:3031;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

## Audience Page

The `public/vote.html` file is a standalone, no-app-needed voting page.

Serve it at the root of your Slidev deployment (copied automatically by `public/` folder convention), or proxy it alongside the WebSocket.

## How It Works

1. **Presenter slide** loads `<PollPresenter />` → connects to WebSocket → authenticates with token
2. **Presenter** clicks **Start** → poll state becomes `voting`
3. **Audience** opens `/vote.html` → sees active polls → votes
4. **Results** update live on both presenter slide and audience page
5. **Presenter** clicks **Close** → stops voting, shows final results
6. **Quiz mode** → after close, click **Reveal** to highlight correct answer

## Demo

[Live demo →](https://polls.dezhidki-hermes.party)

## License

MIT
