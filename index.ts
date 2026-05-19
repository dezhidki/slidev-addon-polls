/**
 * Slidev Poll Addon
 *
 * Usage in slides.md:
 *
 *   <PollServer presenter token="changeme" :polls="[
 *     { id: 'q1', question: 'Which do you prefer?', type: 'choice',
 *       options: ['A', 'B', 'C'], slideIndex: 1 },
 *     { id: 'q2', question: 'Rate this talk', type: 'quiz',
 *       options: ['Good', 'Great', 'Okay'], correctAnswer: 1, slideIndex: 2 }
 *   ]"/>
 *
 *   <PollPresenter />
 *   <PollAudience />
 *   <PollQR url="https://polls.dezhidki-hermes.party/vote.html" />
 *
 * Components:
 * - PollServer  — declares polls + connects to WS as presenter (put on slide 0, v-show=false)
 * - PollPresenter — shows controls, tabs, vote bars (presenter view)
 * - PollAudience  — shows live vote bars for audience
 * - PollQR      — scannable QR code for audience to join
 */

export {}