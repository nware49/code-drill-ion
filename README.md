# code drillion

**Drill below the autocomplete.** A daily trivia drill for software engineers, built around one idea: the obvious answer barely scratches the topsoil, and the deep cut only you would think of drills your rig toward the center of the Earth.

A language model is built to produce the most probable next token. Ask one to name a sorting algorithm and you get quicksort. This game scores the opposite. The outage you were paged for, the RFC you read for fun, the man page you actually finished: that knowledge is how you tell when generated code is wrong, and it's what code drillion rewards. Every drill also shows what a pure autocomplete would have scored, so you can see by how much you beat it.

## How it plays

- **Seven prompts a day**, the same for everyone, 30 seconds each (45 with extended time). *Name a sorting algorithm. Name an RFC by number. Name a Turing Award winner.*
- **Type any valid answer.** Wrong guesses only cost time. Case, punctuation and small typos don't matter (`quciksort` is autocorrected to Quicksort).
- **Rarer answers drill deeper.** Every answer in the bank sits in a layer of the Earth:

  | Layer | Points | Meaning |
  |---|---|---|
  | topsoil | 10 | The autocomplete layer: what everyone, and every model, says first |
  | crust | 25 | Solid working knowledge |
  | upper mantle | 40 | You've shipped it and read the docs |
  | lower mantle | 60 | Specialist knowledge |
  | outer core | 80 | You were there, or you read the postmortem |
  | inner core | 100 | Below everything. Nobody expects it |
  | the nether | 100 | Root's one answer (see below) |

- **Every answer works once per drill.** Reuse one, even on a different prompt, and you get a *use-after-free*.
- **The seventh prompt is root:** exactly one right answer, hidden in the nether and worth 100, and it is usually the famous answer to an earlier prompt. Spend Quicksort on "name a sorting algorithm" and you can't use it when root asks for Hoare's 1959 algorithm.
- **After every prompt** you see the lore behind your answer, what the autocomplete would have said, and one deeper answer from each lower layer.
- **Points become real depth**, the way Krillion turns points into meters: each point is about 9.1 km, so a perfect 700 reaches 6,371 km, the center of the Earth. Your rank is the geological layer you stop in (the transition zone, the lower mantle, the outer core and so on).
- **Results** show your depth, a cross-section of your whole dive beside the autocomplete's stalled rig, a to-scale score bar, and a spoiler-free share grid:

  ```
  code drillion #2 · 2,912 km down, the outer core · 🤖 1,456 km
  🟥🟧⬜🟧🟧🟧🔑
  ```

Practice drills are unlimited and unscored. Past daily drills can be replayed from the Stats panel.

## Where the design came from

The format comes from three daily games, combined and moved into software engineering:

| From | What it contributed |
|---|---|
| [Krillion](https://krillion.io) | Rarity-weighted answers and the depth metaphor: better answers dive you deeper, and points become meters |
| [MedRare](https://medrare.io) | The same loop for one profession (medicine), with tiers named after anatomical depth and a reference for every answer |
| [Kabloom](https://kabloom.io) | No answer can be used twice, and each day is built around a trap: the last question's only answer is the famous one people spent earlier |

New here: a drilling rig instead of a dive, with layers of the Earth as the tiers and real kilometers as the depth; the **autocomplete baseline** (a greedy "always say the likeliest answer" player, which usually falls into the root trap), use-after-free and root as the burn and trap mechanics, and a line of history on every one of the 1,912 answers.

## Artwork

All the art is drawn procedurally with Canvas 2D from seeded randomness (`js/art.js`), so it is identical on every load and the game ships with no image files:

- **The rig**, a tracked drilling machine whose cab window is a terminal prompt, drills down a borehole as you score. During play the camera follows it; on the results screen you see the whole dive.
- **The autocomplete** is a small robot that waits on the surface. On the results screen its grey rig shows how deep it got on the same drill.
- **The layers** are textured from real geology: roots and pebbles in the topsoil; sedimentary strata in the crust, with fossil ammonites and trilobites next to floppy disks and punch cards; magma veins and green olivine in the upper mantle; blue ringwoodite in the transition zone; slow convection swirls and plumes in the lower mantle; the D″ layer; liquid-iron flow and magnetic field lines in the outer core; iron crystals in the inner core. The nether is an amethyst geode holding root's key.
- **Tier badges** illustrate each layer on the home page, in the help dialog and on every answer card.

Layer boundaries in the cross-section are the real seismic depths in km. Thin layers are drawn taller so they stay visible.

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
js/art.js             procedural artwork: the rig, the robot, layer textures, badges, drilling scenes
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

- `ans(name, tier, lore, aliases?, key?)`: tier 0 (topsoil, the autocomplete layer) to 5 (inner core). `key` forces two answers in different prompts to count as the same answer for use-after-free (Dijkstra the person and Dijkstra's algorithm share one).
- `numeric: true` matches the first number typed (ports, status codes, RFCs). `keep: '_'` makes underscores significant (C's `_Bool` is not `bool`).
- `nope` gives a reason for a common wrong answer instead of "not in the bank".
- `traps` become root prompts. Their answer must be a tier 0 or 1 answer of the same prompt.

Then run `npm test`. It checks every name and alias against its own answer, and flags aliases that collide, `nope` entries that shadow real answers, missing tiers, over-long lore, and broken traps.

Rarity is editorial: answers are ranked by hand by how unlikely an engineer, or a model, would be to say them first. Suggestions and corrections are welcome as issues.
