#!/usr/bin/env node
// Plan a daily puzzle and write puzzles/YYYY-MM-DD.json plus a pull request body.
//   node scripts/plan-puzzle.mjs                      date = today (UTC) + lookaheadDays
//   node scripts/plan-puzzle.mjs --date 2026-12-01
//   node scripts/plan-puzzle.mjs --date 2026-12-01 --reroll     replace all six prompts
//   node scripts/plan-puzzle.mjs --date 2026-12-01 --swap 3     replace prompt 3
//   options: --generate (add new prompts with Claude when the fresh pool is low)
//            --skip-existing (do nothing if that date already has a puzzle, published or pending)
//            --body pr.md  --no-pending  --seed X  --dry-run
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBank, isLive, savePuzzle, PUZZLES_DIR } from './lib/bank.mjs';
import { loadConfig, parseArgs } from './lib/config.mjs';
import { collectHistory, pendingPuzzles } from './lib/history.mjs';
import { planPuzzle, usageFrom, gapFor, addDays } from './lib/planner.mjs';
import { validatePuzzle } from './lib/validate.mjs';
import { deadlineMarker } from './lib/review.mjs';
import { TIERS } from '../js/engine.js';

const args = parseArgs();
const config = loadConfig();
const now = new Date();
const date = args.date ?? addDays(now.toISOString().slice(0, 10), config.lookaheadDays);
const file = join(PUZZLES_DIR, `${date}.json`);
const previous = (args.reroll || args.swap) && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
if ((args.reroll || args.swap) && !previous) throw new Error(`No puzzle for ${date} to ${args.reroll ? 'reroll' : 'swap'}.`);
if (args['skip-existing'] && (existsSync(file) || pendingPuzzles().some((p) => p.date === date))) {
  console.log(`A puzzle for ${date} already exists or is waiting for review. Nothing to do.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skipped=true\ndate=${date}\n`);
  process.exit(0);
}

let bank = loadBank().filter(isLive);
const history = collectHistory({ date, bank, windowDays: config.noRepeatDays, includePending: !args['no-pending'] });
const usage = usageFrom(history);
const freshCount = () => bank.filter((p) => gapFor(usage, p.id, date) > config.noRepeatDays).length;

// Grow the bank first when there aren't enough unused prompts for a month without repeats.
let generated = null;
if (args.generate && freshCount() < config.minFreshPrompts) {
  const { hasClaudeCredentials } = await import('./lib/claude.mjs');
  if (!hasClaudeCredentials()) {
    console.warn(`Only ${freshCount()} fresh prompts and no Claude credentials; planning without new prompts.`);
  } else {
    const { createClaude } = await import('./lib/claude.mjs');
    const { growBank } = await import('./lib/grow.mjs');
    const llm = await createClaude({ model: config.model, effort: config.effort });
    generated = await growBank({
      llm, bank, propose: config.newPromptsWhenShort, expand: 0,
      answersPerNewPrompt: config.growth.answersPerNewPrompt, date: now.toISOString().slice(0, 10),
      write: !args['dry-run'], log: (m) => console.log(m),
    });
    bank = [...bank, ...generated.created.map((c) => c.prompt)];
  }
}

const { puzzle, warnings, fresh } = planPuzzle({
  bank,
  date,
  usage,
  seed: args.seed ?? (args.reroll || args.swap ? now.toISOString() : date),
  config,
  previous,
  swapSlot: args.swap ? Number(args.swap) : null,
  exclude: args.reroll ? previous.prompts.map((p) => p.id) : [],
});
puzzle.generatedAt = now.toISOString();
const errors = validatePuzzle(puzzle);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
if (!args['dry-run']) savePuzzle(puzzle);

const body = puzzleBody({ puzzle, warnings, fresh, history, generated, config, now, change: args.reroll ? 'reroll' : args.swap ? `swap ${args.swap}` : null });
if (args.body) writeFileSync(args.body, body);
const title = `Puzzle #${puzzle.number} for ${longDate(date)}`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `date=${date}\nnumber=${puzzle.number}\ntitle=${title}\n`);
console.log(`${title}\n${puzzle.prompts.map((p, i) => `  ${i + 1}. ${p.q}`).join('\n')}\n  R. ${puzzle.prompts.find((p) => p.id === puzzle.root.id).traps[0].q}`);
for (const w of warnings) console.warn(`warning: ${w}`);

function longDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function puzzleBody({ puzzle, warnings, fresh, history, generated, config, now, change }) {
  const at = new Date(now.getTime() + config.approvalHours * 3600000);
  const when = at.toUTCString().replace(' GMT', ' UTC');
  const lastUse = new Map();
  for (const h of history) for (const id of h.ids ?? h.prompts.map((p) => p.id)) lastUse.set(id, h.date);
  const sample = (p, t) => p.answers.filter((a) => a.t === t).slice(0, 3).map((a) => a.n).join(', ') || 'none';
  const rootPrompt = puzzle.prompts.find((p) => p.id === puzzle.root.id);
  const trap = rootPrompt.traps[0];
  const lines = [
    `## Code Drill #${puzzle.number}, ${longDate(puzzle.date)}`,
    '',
    change ? `Updated with \`/${change}\`. ` : '',
    `**Auto-approves ${when}** if nobody leaves feedback. Merging publishes it to the site.`,
    '',
    '| # | Prompt | Category | Answers | Last used | Topsoil answers | Inner core answers |',
    '|---|---|---|---|---|---|---|',
    ...puzzle.prompts.map((p, i) => `| ${i + 1} | ${p.q} | ${p.cat} | ${p.answers.length} | ${lastUse.get(p.id) ?? 'never'} | ${sample(p, 0)} | ${sample(p, 5)} |`),
    '',
    `**Root:** ${trap.q} **Answer: ${trap.answer}** (calls back to prompt ${puzzle.prompts.indexOf(rootPrompt) + 1})`,
    '',
    `${fresh} prompts in the bank haven't been used within ${config.noRepeatDays} days of this date.`,
  ];
  if (warnings.length) lines.push('', '### Warnings', '', ...warnings.map((w) => `- ${w}`));
  if (generated && (generated.created.length || generated.rejected.length)) lines.push('', '### New prompts added to the bank in this pull request', '', generated.summary);
  lines.push(
    '',
    '### Commands',
    '',
    'Comment with one of these:',
    '',
    '- `/approve` publish now (approving the pull request works too)',
    '- `/hold` stop auto-approval. Any other comment or review also holds it.',
    '- `/release` resume auto-approval, with a fresh 24-hour window',
    '- `/reroll` replace all six prompts',
    '- `/swap 3` replace prompt 3 (any number from 1 to 6)',
    '',
    `You can also edit \`puzzles/${puzzle.date}.json\` on this branch, then \`/approve\`.`,
    `Tier key: ${TIERS.map((t) => `${t.id} ${t.name}`).join(', ')}.`,
    '',
    `<!-- drill-puzzle date: ${puzzle.date} -->`,
    deadlineMarker(at, now),
  );
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n');
}
