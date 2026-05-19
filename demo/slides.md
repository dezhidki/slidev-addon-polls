---
theme: ../../jyu-slidev-theme
addons:
  - ..
title: "Slidev Polls Demo"
download: false
---

# Slidev Poll Addon

## Live audience polling for presentations

🗳️ **Choice polls** · 🎯 **Quizzes** · ☁️ **Word clouds**

---

# How It Works

1. **Start the poll server**
   ```bash
   node poll-server/server.js 3031 your-secret-token
   ```

2. **Audience opens** `/vote.html` on their phone

3. **Presenter drops** `<PollPresenter />` on any slide

4. **Control** start / stop / reveal from the slide itself

---

# Choice Poll

<div style="padding: 0.5rem 0">

<PollPresenter :polls="[{
  id: 'preference',
  question: 'Which paradigm do you prefer?',
  type: 'choice',
  options: ['Object-oriented', 'Functional', 'Procedural', 'Declarative']
}]" size="compact" />

</div>

Click **Start** to open voting and watch results update live.

---

# Quiz with Reveal

<div style="padding: 0.5rem 0">

<PollPresenter :polls="[{
  id: 'css-quiz',
  question: 'What does CSS stand for?',
  type: 'quiz',
  options: ['Computer Style Sheets', 'Cascading Style Sheets', 'Creative Style System', 'Colorful Style Sheets'],
  correctAnswer: 1
}]" size="compact" />

</div>

Start → let audience vote → **Close** → **Reveal** to highlight the correct answer.

---

# Word Cloud

<div style="padding: 0.5rem 0">

<PollPresenter :polls="[{
  id: 'describe',
  question: 'Describe this presentation in one word:',
  type: 'wordcloud'
}]" size="compact" />

</div>

Audience types free-form words — results form a live cloud.

---

layout: center

# Join the Poll

Scan or visit the URL to vote:

<PollQR url="https://polls.dezhidki-hermes.party/vote.html" image="qr-vote.png" />

---

# Components

| Component | Purpose |
|-----------|---------|
| `<PollPresenter />` | Full presenter view with controls |
| `<PollInline />` | Compact inline results (no controls) |
| `<PollQR />` | QR code + URL for audience |

## Markdown Usage

```markdown
<PollPresenter :polls="[{
  id: 'q1',
  question: 'Your question?',
  type: 'choice',
  options: ['A', 'B', 'C']
}]" />
```

---

layout: end

# Thank You 🎓

Try the poll! The server and this deck are both live.
