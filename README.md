# code drillion

**Mine your software knowledge with the daily Code Drill.** A daily trivia drill for software engineers, built around one idea: the obvious answer barely scratches the topsoil, and the deep cut only you would think of drills your rig toward the center of the Earth.

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

- **Every answer works once.** Reuse one on another of the six regular prompts and you get a *use-after-free*.
- **The seventh prompt is root:** a trivia question with exactly one right answer, hidden in the nether and worth 100. It often calls back to an earlier prompt ("Name the sorting algorithm Tony Hoare invented in 1959"), and answers you already used are allowed there.
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
| [Krillion](https://krillion.io) | Rarity-weighted answers and the depth metaphor (better answers dive you deeper, and points become meters), and the pixel-art style of its deep dive |
| [MedRare](https://medrare.io) | The same loop for one profession (medicine), with tiers named after anatomical depth and a reference for every answer |
| [Kabloom](https://kabloom.io) | No answer can be used twice, and a final question that calls back to an earlier one |

New here: a drilling rig instead of a dive, with layers of the Earth as the tiers and real kilometers as the depth; the **autocomplete baseline** (a greedy "always say the likeliest answer" player that scores 160 points, 1,456 km, on every drill), use-after-free for reused answers, a root trivia question to finish, and a line of history on every answer.

## Artwork

The whole site sits on one pixel-art picture of the Earth, styled after Krillion's deep dive but going down instead of under. It is painted procedurally in `js/art.js` from seeded noise, small palettes and ordered (Bayer) dithering, so it looks the same on every visit and the game ships with no image files. One art pixel is 3 to 5 screen pixels, scaled up with `image-rendering: pixelated`.

From the top:

- **The surface** at dusk: stars, drifting clouds, a low sun behind purple mountains, pine trees, the drill pad, a control hut and the autocomplete robot waiting by the rig.
- **Topsoil** with roots, pebbles, a buried bone and wriggling worms.
- **The crust**: sandstone, shale, limestone and a coal seam, with fossils from two kinds of history (ammonites and trilobites next to floppy disks, punch cards, vacuum tubes and cassettes).
- **The caves**: boulder walls, stalactites, stalagmites, pools, glowworms, glowing mushrooms and bats.
- **The mines**: timbered galleries with rails, a moving mine cart, lanterns, a ladder, gold and copper ore.
- **Deep crust** in banded gneiss, then the Moho.
- **The upper mantle**: flowing peridotite, olivine crystals, magma pockets and veins, and diamonds around 150 km.
- **The transition zone** with blue ringwoodite crystals.
- **The lower mantle**: convection swirls, a rising plume and a sinking slab of old seafloor.
- **D″** with its two continent-sized blobs, then **the outer core** of flowing liquid iron and magnetic field lines, and **the inner core** of iron crystals.
- **The nether**: an amethyst geode at the center of the Earth, where root's golden key floats.

Every layer is placed at its real depth, and notes beside the descent mark real facts at real depths (the deepest cave, the deepest mine, the Kola Superdeep Borehole, the 410 and 660 km discontinuities, Inge Lehmann's inner core). Thin layers people care about, like the caves and the mines, are drawn taller so the rig spends time passing them.

- **Home** is a scroll down the column: each tier card stops over its layer.
- **During a drill** the camera follows the rig. A scored answer drills it down to the new depth with debris, a landing shake and the points popping up beside it; deep answers flash, root flashes purple; wrong guesses make the bit sputter, and the screen edge glows red in the last five seconds. The rig's lamp lights up the dark layers.
- **Results** park the camera at your final depth and show a compact cross-section with your rig and the autocomplete's grey one.
- **Tier badges** are 24×24 pixel vignettes, and the wordmark is a pixel font filled with the layers of the Earth.

Everything respects `prefers-reduced-motion`: the rig jumps instead of drilling and nothing moves on its own.

## How each day's puzzle is made

A puzzle is planned two days ahead, reviewed in a pull request, and published when it's approved. If you say nothing, it approves itself after 24 hours.

```
00:17 UTC   Daily puzzle workflow plans the puzzle for two days out
            -> no prompt used within 30 days of that date (published or still in review)
            -> if fewer than 12 fresh prompts remain, Claude writes new ones first
            -> opens a pull request that previews all seven questions, sample answers, and the root answer
hourly      Puzzle review workflow merges any pull request 24 hours old with no feedback
on merge    Deploy site workflow publishes it to GitHub Pages
```

**Reviewing.** Each puzzle pull request is assigned to you and asks for your review. Comment with:

| Command | Effect |
|---|---|
| `/approve` (or approve the pull request) | Publish now |
| `/hold` (or any other comment, or a review that requests changes) | Stop auto-approval until you decide |
| `/release` | Resume auto-approval with a fresh 24-hour window |
| `/reroll` | Replace all six prompts; the window restarts |
| `/swap 3` | Replace prompt 3 only (1 to 6); the window restarts |

You can also edit `puzzles/YYYY-MM-DD.json` on the branch and then `/approve`. Only the repository owner, members and collaborators can approve, hold or change a puzzle; anyone else's comments are ignored. A puzzle still on hold once its date has passed is closed; players that day got the built-in generator's puzzle instead.

**Why two days ahead.** Players get the puzzle for their own calendar date. Planning at 00:17 UTC two days out means the 24-hour window ends around 00:17 UTC the day before, well before the earliest time zone (UTC+14) reaches the puzzle's date.

**No repeats for a month.** The planner never picks a prompt used within 30 days of the date, counting puzzles already published, puzzles waiting in pull requests, and days the fallback generator served. That needs about 180 prompts in rotation (6 a day for 30 days). Until the bank is that large, the planner reuses the least recently used prompts and lists each repeat under **Warnings** in the pull request, and the daily job asks Claude for new prompts whenever fewer than 12 fresh ones remain.

## Growing the bank

The **Grow the bank** workflow runs every Monday (or on demand from the Actions tab). It uses Claude (`claude-opus-5-5`) to:

1. **Write new prompts**, each with about 120 answers across all six layers, lore for every answer, aliases, common wrong answers and two root questions.
2. **Add answers to existing prompts**, starting with the ones that have the fewest.
3. **Fact-check everything a second time.** Each answer is checked against its prompt, and every lore line for accuracy; anything that can't be confirmed is dropped, and wrong lore is corrected. The pull request lists what was dropped.
4. **Rank rarity by pageviews**, the way MedRare does for medicine: a generated answer's layer is the average of Claude's estimate and how often its Wikipedia article is read in a year. Hand-ranked answers never change.
5. **Validate** with the same checks as the test suite (no alias that matches two answers, no "nope" entry hiding a real answer, root questions pointing at famous answers, lore under 220 characters). Prompts that fail are reported and not written.

The result opens as a pull request with the same commands and 24-hour window (set `growth.autoApprove` to `false` in `drill.config.json` to require a manual merge). Locally: `npm run grow -- --propose 3 --expand 0 --dry-run`.

## Setting it up

1. **Merge this branch into `main`.** Scheduled workflows only run from the default branch.
2. **Let Actions open pull requests.** Settings → Actions → General → Workflow permissions: choose *Read and write permissions* and tick *Allow GitHub Actions to create and approve pull requests*.
3. **Turn on Pages.** Settings → Pages → Source: *GitHub Actions*.
4. **Connect Claude** for bank growth, with Workload Identity Federation instead of an API key: GitHub proves which workflow is calling, and Claude issues a token that expires within minutes, so the repository stores no secret.
   - In the Claude Console, open the Workload identity page, click **Connect workload** and choose **GitHub Actions**. Give the rule exactly three conditions, so only `main` can sign in:
     - **Subject prefix:** `repo:<owner>@<owner-id>/<repo>@<repo-id>:ref:refs/heads/main`. GitHub puts numeric IDs in the subject, so the name-only form `repo:<owner>/<repo>:…` never matches. To get it exactly, run **Check Claude sign-in** once and copy `sub` from the failed attempt in the Console's authentication history.
     - **Audience:** `https://api.anthropic.com`.
     - **One claim:** `repository_owner` = your GitHub owner. Don't add others, such as the workflow name, `event_name` or `ref_protected`: the daily, growth and review workflows each send different values, and a mismatched claim fails every sign-in.

     Every Claude call runs from `main`: the schedules, manual runs, and `/reroll` and `/swap` comments. Pull-request runs carry a different subject and can't sign in. Skip the test workflow the wizard offers; this repository has its own.
   - Settings → Secrets and variables → Actions → **Variables**: add `ANTHROPIC_FEDERATION_RULE_ID` (`fdrl_…`), `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID` (`svac_…`) and `ANTHROPIC_WORKSPACE_ID` (`wrkspc_…`). These are IDs, not secrets. Don't also add an `ANTHROPIC_API_KEY` secret: a key takes priority over federation.
   - Run **Check Claude sign-in** from the Actions tab to test it. If it's denied, the Console's authentication history says why.

   Without this step, puzzles are still planned from the existing bank. For local runs, export `ANTHROPIC_API_KEY`.
5. *(Optional)* Add a repository variable `WIKIMEDIA_USER_AGENT` with a contact address, as Wikimedia asks of API clients.
6. *(Optional)* Branch protection that requires reviews on `main` will block the automatic merge. Leave reviews optional, or let the GitHub Actions bot bypass them.

The first puzzle pull request opens at the next 00:17 UTC; run **Daily puzzle** from the Actions tab to get one sooner. Settings such as the review window, the no-repeat window and the model live in `drill.config.json`.

## Run it locally

```bash
npm install        # only needed for bank growth (the Anthropic SDK)
npm start          # http://localhost:8000
npm test           # game engine, the whole bank, planner, review rules, generator (with a fake Claude)
npm run build      # dist/code-drillion.html, one self-contained file that also works from file://
npm run plan -- --dry-run      # preview the next puzzle without writing it
```

Set `<meta name="drill:share-url">` in `index.html` to your public URL if you want it appended to shared results. Progress, streaks and stats live in the browser's `localStorage`.

## Project layout

```
index.html                 page shell (home, play, results views and dialogs)
styles.css                 all styling: pixel-framed panels over the world canvas
js/engine.js               game logic: matching, scoring, puzzle files, the fallback generator
js/art.js                  procedural pixel art: the Earth column, rig, robot, creatures, depth notes, badges, wordmark
js/app.js                  rendering, timer, storage, loading puzzles
bank/prompts/*.json        the answer bank, one prompt per file, one answer per line
puzzles/YYYY-MM-DD.json    approved daily puzzles
drill.config.json          review window, no-repeat window, generation settings
scripts/plan-puzzle.mjs    plans a day's puzzle and writes the pull request text
scripts/review-puzzles.mjs applies review commands and the 24-hour auto-approval
scripts/grow-bank.mjs      writes, fact-checks and ranks new prompts and answers with Claude
scripts/lib/               bank files, validation, planner, history, generation, pageviews
scripts/build.mjs          single-file build, and the GitHub Pages site (--site)
.github/workflows/         daily puzzle, puzzle review, bank growth, deploy, tests
tests/                     node:test suites, including a mock GitHub API
```

## Editing prompts by hand

Each prompt is a JSON file in `bank/prompts/`:

```json
{
  "id": "sorting",
  "cat": "algorithms",
  "d": 1,
  "q": "Name a sorting algorithm.",
  "strip": ["sort", "sorting", "algorithm"],
  "answers": [
    {"n":"Quicksort","t":0,"l":"Tony Hoare, 1959, devised while he was a visiting student in Moscow.","alias":["quick sort","qsort"]},
    {"n":"Powersort","t":5,"l":"Munro and Wild, 2018. Its merge policy replaced Timsort's in CPython 3.11."}
  ],
  "nope": {"quickselect": "A close cousin. It finds the k-th element without sorting the rest."},
  "traps": [{"q": "Name the sorting algorithm Tony Hoare invented in 1959.", "answer": "Quicksort"}]
}
```

- `d` is difficulty from 1 to 3; easier prompts come first in a puzzle. `strip` lists words ignored when matching ("merge sort" = "merge").
- Each answer has a name `n`, a tier `t` from 0 (topsoil) to 5 (inner core), lore `l` and optional `alias`. Generated answers also carry `src`, `wiki` and `views`. `k` forces answers in different prompts to count as the same for use-after-free.
- `numeric: true` matches the first number typed (ports, status codes, RFCs). `keep: "_"` makes underscores significant (C's `_Bool` is not `bool`).
- `nope` gives a reason for a common wrong answer instead of "not in the bank".
- `traps` are root questions. Each answer must be a tier 0 or 1 answer in the same prompt.
- `"status": "draft"` keeps a prompt out of rotation.

Run `npm test` afterwards; it validates every prompt. Rarity blends hand ranking with Wikipedia pageviews. Suggestions and corrections are welcome as issues.
