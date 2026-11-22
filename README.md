# code drillion

**Drill below the autocomplete.** A daily trivia drill for software engineers, built around one idea: the obvious answer is worth 10 points, and the deep cut only you would think of is worth 100.

A language model is built to produce the most probable next token. Ask one to name a sorting algorithm and you get quicksort. This game scores the opposite. The outage you were paged for, the RFC you read for fun, the man page you actually finished: that knowledge is how you tell when generated code is wrong, and it's what code drillion rewards. Every drill also shows what a pure autocomplete would have scored, so you can see by how much you beat it.

## How it plays

- **Seven prompts a day**, the same for everyone, 30 seconds each (45 with extended time). *Name a sorting algorithm. Name an RFC by number. Name a Turing Award winner.*
- **Type any valid answer.** Wrong guesses only cost time. Case, punctuation and small typos don't matter (`quciksort` is autocorrected to Quicksort).
- **Rarer answers drill deeper.** Every answer in the bank sits in a layer named after x86 privilege rings:

  | Layer | Points | Meaning |
  |---|---|---|
  | autocomplete | 10 | What everyone, and every model, says first |
  | ring 3 (userland) | 25 | Solid working knowledge |
  | ring 0 (kernel) | 40 | You've shipped it and read the docs |
  | ring −1 (hypervisor) | 60 | Specialist knowledge |
  | ring −2 (SMM) | 80 | You were there, or you read the postmortem |
  | ring −3 (ME) | 100 | Below everything. Nobody expects it |

- **Every answer works once per drill.** Reuse one, even on a different prompt, and you get a *use-after-free*.
- **The seventh prompt is root:** exactly one right answer, worth 100, and it is usually the famous answer to an earlier prompt. Spend Quicksort on "name a sorting algorithm" and you can't use it when root asks for Hoare's 1959 algorithm.
- **After every prompt** you see the lore behind your answer, what the autocomplete would have said, and one deeper answer from each lower layer.
- **Results** show your depth (decimal and hex, max 700 / `0x2BC`), a to-scale core sample, the autocomplete's depth on the same drill, and a spoiler-free share grid:

  ```
  code drillion #1 · depth 320/700 (0x140) · 🤖 60
  🟨🟧⬜🟧🟧🟧🔑
  ```

Practice drills are unlimited and unscored. Past daily drills can be replayed from the Stats panel.

## Where the design came from

The format comes from three daily games, combined and moved into software engineering:

| From | What it contributed |
|---|---|
| [Krillion](https://krillion.io) | Rarity-weighted answers and the depth metaphor: points become meters as you dive |
| [MedRare](https://medrare.io) | The same loop for one profession (medicine), with tiers named after anatomical depth and a reference for every answer |
| [Kabloom](https://kabloom.io) | No answer can be used twice, and each day is built around a trap: the last question's only answer is the famous one people spent earlier |

New here: x86 privilege rings as the depth scale, the **autocomplete baseline** (a greedy "always say the likeliest answer" player, which usually falls into the root trap), use-after-free and root as the burn and trap mechanics, and a line of history on every one of the 1,912 answers.

## Run it

No dependencies and no build step are needed to play.

```bash
npm start          # serves the repo at http://localhost:8000
npm test           # bank integrity, matching, daily generation, scoring
npm run build      # dist/code-drillion.html, one self-contained file that also works from file://
```

To deploy, serve the repository root from any static host. GitHub Pages works as is (Settings → Pages → deploy from branch, root folder). Set `<meta name="drill:share-url">` in `index.html` to your public URL if you want it appended to shared results.

Daily drills are generated deterministically from the local calendar date (drill #1 is 22 Nov 2026), so everyone gets the same seven prompts without a server. No prompt repeats within a five-day window. Progress, streaks and stats live in the browser's `localStorage`.

## Project layout

```
index.html            page shell (home, play, results views and dialogs)
styles.css            all styling; light and dark themes
js/engine.js          pure game logic: normalization, fuzzy matching, burn keys, daily plans, scoring
js/app.js             rendering, timer, storage
js/bank/*.js          the answer bank: 35 prompts in four themed files
tests/engine.test.js  node:test suite, which also checks the whole bank
scripts/build.mjs     single-file bundler
scripts/serve.mjs     tiny static server
```

## Adding prompts and answers

Each prompt is a plain object in one of the `js/bank/*.js` files:

```js
{
  id: 'sorting', cat: 'algorithms', d: 1,          // d: difficulty 1-3, easier prompts come first
  q: 'Name a sorting algorithm.',
  strip: ['sort', 'algorithm'],                    // words ignored when matching ("merge sort" = "merge")
  answers: [
    ans('Quicksort', 0, 'Tony Hoare, 1959, ...', ['quick sort', 'qsort']),
    ans('Powersort', 5, 'Munro and Wild, 2018. ...'),
  ],
  nope: { quickselect: 'A close cousin. It finds the k-th element without sorting the rest.' },
  traps: [{ q: 'Name the sorting algorithm Tony Hoare invented in 1959.', answer: 'Quicksort' }],
}
```

- `ans(name, tier, lore, aliases?, key?)`: tier 0 (autocomplete) to 5 (ring −3). `key` forces two answers in different prompts to count as the same answer for use-after-free (Dijkstra the person and Dijkstra's algorithm share one).
- `numeric: true` matches the first number typed (ports, status codes, RFCs). `keep: '_'` makes underscores significant (C's `_Bool` is not `bool`).
- `nope` gives a reason for a common wrong answer instead of "not in the bank".
- `traps` become root prompts. Their answer must be a tier 0 or 1 answer of the same prompt.

Then run `npm test`. It checks every name and alias against its own answer, and flags aliases that collide, `nope` entries that shadow real answers, missing tiers, over-long lore, and broken traps.

Rarity is editorial: answers are ranked by hand by how unlikely an engineer, or a model, would be to say them first. Suggestions and corrections are welcome as issues.
