// Which prompts were used on which days: published puzzle files, puzzles still waiting
// for approval on their pull-request branches, and days the old generator served.
import { execFileSync } from 'node:child_process';
import { compilePrompt, dailyPlan, dayForIso, isoForDay } from '../../js/engine.js';
import { loadPuzzleFiles, ROOT_DIR } from './bank.mjs';
import { addDays } from './planner.mjs';

export const PUZZLE_BRANCH_PREFIX = 'puzzle/';

const git = (args) => execFileSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Puzzles on remote puzzle/* branches (pending approval). Run `git fetch` for those refs first. */
export function pendingPuzzles() {
  let refs = [];
  try {
    refs = git(['for-each-ref', '--format=%(refname:short)', `refs/remotes/origin/${PUZZLE_BRANCH_PREFIX}`]).split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const out = [];
  for (const ref of refs) {
    const date = ref.slice(ref.lastIndexOf('/') + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    try {
      out.push(JSON.parse(git(['show', `${ref}:puzzles/${date}.json`])));
    } catch { /* branch without a puzzle file */ }
  }
  return out;
}

/**
 * Every known use of a prompt within `windowDays` of `date`.
 * Days with no puzzle file (before the pipeline existed) are reconstructed with the
 * browser's fallback generator, which is what players were given on those days.
 */
export function collectHistory({ date, bank, windowDays = 30, includePending = true, files = loadPuzzleFiles() }) {
  const puzzles = new Map(files.map((p) => [p.date, p]));
  if (includePending) for (const p of pendingPuzzles()) if (!puzzles.has(p.date)) puzzles.set(p.date, p);
  const compiled = bank.map(compilePrompt);
  const firstDay = isoForDay(1);
  for (let back = 1; back <= windowDays; back++) {
    const d = addDays(date, -back);
    if (d < firstDay || puzzles.has(d)) continue;
    const plan = dailyPlan(compiled, dayForIso(d));
    puzzles.set(d, { date: d, ids: plan.slice(0, -1).map((s) => s.id), generated: true });
  }
  puzzles.delete(date);
  return [...puzzles.values()].sort((a, b) => a.date.localeCompare(b.date));
}
