---
theme: slidev-theme-jyu
addons:
  - slidev-addon-polls
title: "Slidev Polls Demo"
download: false
favicon: https://jyu-polls.dezhidki-hermes.party/jyu-logo-cover.svg
---

# Slidev Poll Addon

Real-time audience polling for Slidev presentations.

🗳️ **Choice Polls** · 🎯 **Quizzes** · ☁️ **Word Clouds** · 📱 **QR Code Join**

<PollQR url="https://polls.dezhidki-hermes.party/vote.html" size="large" />

---

# How It Works

1. **Start the poll server**
   ```bash
   node poll-server/server.js 3031 your-secret-token
   ```
2. **Add components to your slides**
   - `<PollServer>` — configures polls + connects as presenter
   - `<PollPresenter>` — shows controls, tabs, voting bars
   - `<PollAudience>` — shows live results for audience
   - `<PollQR>` — scannable QR code for joining
3. **Share the vote page** at `/vote.html`

---

# Choice Poll 🗳️

Demonstrates multiple polls on one slide with tab switching.

<PollServer presenter token="changeme" :polls="[
  { id: 'paradigm', question: 'Which programming paradigm do you prefer?', type: 'choice', options: ['Object-Oriented', 'Functional', 'Procedural', 'Declarative'], slideIndex: 2 },
  { id: 'language', question: 'What is your favorite language?', type: 'choice', options: ['Python', 'TypeScript', 'Rust', 'Haskell'], slideIndex: 2 },
]"/>

<PollPresenter />

<PollAudience />

---

# Quiz Time 🎯

A quiz poll with a correct answer. Start the poll, let the audience vote, close it, then reveal!

<PollServer presenter token="changeme" :polls="[
  { id: 'css-quiz', question: 'What does CSS stand for?', type: 'quiz', options: ['Computer Style Sheets', 'Cascading Style Sheets', 'Creative Style System', 'Colorful Style Sheets'], correctAnswer: 1, slideIndex: 3 },
]"/>

<PollPresenter />

<PollAudience />

---

# Word Cloud ☁️

Free-form text input — audience types words and they form a live cloud.

<PollServer presenter token="changeme" :polls="[
  { id: 'describe', question: 'Describe this presentation in one word:', type: 'wordcloud', slideIndex: 4 },
]"/>

<PollPresenter />

<PollAudience />

---

# Join the Poll 📱

Scan the QR code or visit the URL below on your phone to participate:

<PollQR url="https://polls.dezhidki-hermes.party/vote.html" size="normal" />

---

layout: fact

## Did You Know?

Slidev supports **dark mode** out of the box. The JYU theme includes custom dark mode styling with the university brand colors.

Toggle dark mode with the button in the corner! 🌙

---

layout: end

# Thank You 🎓

## Resources

- 🌐 Theme: [github.com/dezhidki/jyu-slidev-theme](https://github.com/dezhidki/jyu-slidev-theme)
- 📊 Addon: [github.com/dezhidki/slidev-addon-polls](https://github.com/dezhidki/slidev-addon-polls)
- 📧 Contact: denis@dezhidki-hermes.party