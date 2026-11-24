# Daily puzzles

One file per day, named `YYYY-MM-DD.json`. Each is a self-contained snapshot of that day's six prompts (with their full answer lists) and the root question, so later edits to the bank never change a past puzzle.

Files arrive here by pull request from the **Daily puzzle** workflow, two days ahead. A file on the default branch is approved. Days without a file fall back to the generator in `js/engine.js`.

To plan one by hand: `npm run plan -- --date 2026-12-01` (add `--dry-run` to preview).
