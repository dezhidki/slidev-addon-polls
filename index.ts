/**
 * Slidev Poll Addon
 *
 * Usage in slides.md:
 *
 *   <!-- First slide headmatter only (optional — shows a floating QR badge) -->
 *   ---
 *   pollQr: "https://your-site/vote.html"
 *   ---
 *
 *   <!-- Any slide — declare polls with the single Poll component -->
 *   <Poll :questions="[
 *     { type: 'choice',    question: 'Which do you prefer?', options: ['A', 'B', 'C'] },
 *     { type: 'quiz',      question: 'What is 2+2?', options: ['3','4','5'], correctAnswer: 1 },
 *     { type: 'wordcloud', question: 'One word to describe this talk:' },
 *   ]" />
 *
 * The presenter password is read from Slidev's --remote=<password> flag automatically.
 * No token configuration needed in slides.
 */

export {};
