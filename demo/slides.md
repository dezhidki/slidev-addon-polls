---
theme: slidev-theme-jyu
addons:
  - slidev-addon-polls
title: "Slidev Polls Demo"
download: false
favicon: https://jyu-polls.dezhidki-hermes.party/jyu-logo-cover.svg
pollQr: "https://jyu-polls.dezhidki-hermes.party/vote.html"
---

# Slidev Poll Addon

Real-time audience polling for Slidev presentations.

🗳️ **Choice Polls** · 🎯 **Quizzes** · ☁️ **Word Clouds** · 📱 **QR Code Join**

---

# How It Works

1. **Start the poll server**
   ```bash
   node poll-server/server.js 3031 your-secret-token
   ```
2. **Add `<Poll>` to any slide**
   ```vue
   <Poll :questions="[
     { type: 'choice', question: 'Which?', options: ['A', 'B'] },
     { type: 'quiz', question: 'What is CSS?', options: [...], correctAnswer: 1 },
     { type: 'wordcloud', question: 'One word:' },
   ]" />
   ```
3. **Share the vote page** at `/vote.html`

---

# Choice Poll 🗳️

Multiple polls on one slide — switch between them with tabs.

<Poll :questions="[
  { type: 'choice', question: 'Which programming paradigm do you prefer?', options: ['Object-Oriented', 'Functional', 'Procedural', 'Declarative'] },
  { type: 'choice', question: 'What is your favorite language?', options: ['Python', 'TypeScript', 'Rust', 'Haskell'] },
]" />

---

# Quiz Time 🎯

Start the poll, let the audience vote, close it, then reveal the answer!

<Poll :questions="[
  { type: 'quiz', question: 'What does CSS stand for?', options: ['Computer Style Sheets', 'Cascading Style Sheets', 'Creative Style System', 'Colorful Style Sheets'], correctAnswer: 1 },
]" />

---

# Word Cloud ☁️

Free-form text input — audience types words and they form a live cloud.

<Poll :questions="[
  { type: 'wordcloud', question: 'Describe this presentation in one word:' },
]" />

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
