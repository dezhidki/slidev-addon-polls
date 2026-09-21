---
theme: default
addons:
  - "@/.." # this repo; in your own deck: slidev-addon-polls
title: Slidev polls demo
# pollUrl: https://your-public-host/vote
---

# Live polls for Slidev

Scan, vote, watch the slide update.

<PollQr class="w-40 mx-auto mt-8" />

<!--
Run with `npm run dev`, open the presenter view, and open /vote on your phone.
-->

---

# Choice

<Poll
  question="Which paradigm do you reach for first?"
  :options="['Object-oriented', 'Functional', 'Procedural', 'Whatever the codebase uses']"
/>

---

# Quiz

<Poll
  question="What does CSS stand for?"
  :options="['Computer Style Sheets', 'Cascading Style Sheets', 'Creative Style System']"
  :correct="1"
/>

<!--
The room only sees the distribution once you close the voting, and the right answer
once you reveal it. You see both all along.
-->

---

# Word cloud

<Poll question="One word for this lecture so far?" />

---

# No poll here

Phones show "No poll right now" — unless the last poll is still open.
