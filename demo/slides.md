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
  id="paradigm"
  question="Which paradigm do you reach for first?"
  :options="['Object-oriented', 'Functional', 'Procedural', 'Whatever the codebase uses']"
/>

<!--
Open voting and move on without closing it: the next slide shows what phones do then.
The `id` keeps the answers if this slide moves or the question is reworded.
-->

---

# A normal slide

No poll here. What the phones show depends on the poll you just left:

- **Still open:** phones keep showing it, and late voters can still answer.
- **Closed:** phones show "No poll right now".

Tap a reaction on your phone: it floats up the side of this slide.

<!--
Go back, close the poll, and come here again to see the phones switch.
-->

---
reactions: ["👏", "🤯", "❓"]
---

# Another normal slide

This slide has its own reactions: 👏 🤯 ❓. Phones switch their emoji row when you
arrive here.

```yaml
---
reactions: ["👏", "🤯", "❓"]
---
```

---

# Choice (hide results)

<Poll
  question="Which ice cream flavor is the best?"
  :options="['Chocolate', 'Vanilla', 'Strawberry', 'Stracciatella']"
  blind
/>

<!--
The room sees only the number of answers until you close voting.
-->

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

# Two polls, one slide

<div class="grid grid-cols-2 gap-8">
  <Poll question="Tabs or spaces?" :options="['Tabs', 'Spaces']" />
  <Poll question="Light or dark mode?" :options="['Light', 'Dark']" />
</div>

<!--
Phones show both. Open and close them independently.
-->

---

# Code quiz

<div class="grid grid-cols-2 gap-8">

```js
let n = 3;
while (n > 0) {
  console.log(n);
  n--;
}
console.log("lift-off");
```

<PollSet :polls="[
  { question: 'First line of output?', options: ['3', '1', 'lift-off'], correct: 0 },
  { question: 'And the last line?', options: ['3', '1', 'lift-off'], correct: 2 },
]" />

</div>

<!--
Press → to step to the next question. Phones follow along.
-->

---

# Word cloud

<Poll question="One word for this lecture so far?" />

<!--
Words appear here as they arrive. Click one to remove it. Close voting to show the cloud.
-->

---

# Thanks!

No poll here either. Close the word cloud first, or phones keep showing it.
