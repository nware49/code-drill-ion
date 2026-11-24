// Picks the prompts for one day's puzzle. Pure: no files, no network, no clock.
import { rng, shuffle, arrangeDay, dayForIso } from '../../js/engine.js';

export const PLAN_DEFAULTS = { promptsPerDay: 6, noRepeatDays: 30 };

const DAY_MS = 86400000;
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
export function addDays(iso, n) {
  return new Date(toUTC(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Map of prompt id -> dates it appeared, from puzzles ({ date, prompts:[{id}] } or { date, ids }). */
export function usageFrom(puzzles) {
  const usage = new Map();
  for (const pz of puzzles) {
    const ids = pz.ids ?? pz.prompts.map((p) => p.id);
    for (const id of ids) {
      if (!usage.has(id)) usage.set(id, new Set());
      usage.get(id).add(pz.date);
    }
  }
  return usage;
}

/** Days between `date` and the closest other use of a prompt, before or after. */
export function gapFor(usage, id, date) {
  let gap = Infinity;
  for (const d of usage.get(id) ?? []) {
    if (d === date) continue;
    gap = Math.min(gap, Math.abs(daysBetween(d, date)));
  }
  return gap;
}

/** A copy of a bank prompt for a puzzle file: only the client's fields, and only root's trap. */
export function snapshotPrompt(raw, trapIndex = null) {
  const { status, added, ...rest } = raw;
  return {
    ...rest,
    answers: raw.answers.map(({ wiki, views, src, ...a }) => a),
    traps: trapIndex === null ? [] : [raw.traps[trapIndex]],
  };
}

// Fresher prompts first: never used, then the longest gaps, in one-week buckets so the
// rotation doesn't settle into the same groups. Random order inside a bucket.
function byFreshness(cands, usage, date, rand) {
  const bucket = (p) => {
    const g = gapFor(usage, p.id, date);
    return g === Infinity ? 1e9 : Math.floor(g / 7);
  };
  return shuffle(cands, rand).sort((a, b) => bucket(b) - bucket(a));
}

// Prefer one prompt per category, then two, then anything.
function pickDiverse(ordered, n, already = []) {
  const picked = [];
  const count = (cat) => [...already, ...picked].filter((p) => p.cat === cat).length;
  for (const cap of [1, 2, Infinity]) {
    for (const p of ordered) {
      if (picked.length + already.length >= n) return picked;
      if (!picked.includes(p) && count(p.cat) < cap) picked.push(p);
    }
  }
  return picked;
}

/**
 * Plan a puzzle for `date` (YYYY-MM-DD).
 *   bank      live raw prompts
 *   usage     usageFrom(...) over every other puzzle, published or pending
 *   previous  an existing puzzle for this date, for swapping one slot (swapSlot is 1-based)
 *   exclude   prompt ids that must not be chosen (a reroll excludes the current six)
 * Returns { puzzle, warnings, fresh } where fresh counts prompts outside the no-repeat window.
 */
export function planPuzzle({ bank, date, usage = new Map(), seed = date, config = {}, previous = null, swapSlot = null, exclude = [] }) {
  const cfg = { ...PLAN_DEFAULTS, ...config };
  const rand = rng(`plan:${date}:${seed}`);
  const warnings = [];
  const withTraps = (p) => (p.traps ?? []).length > 0;
  const isFresh = (p) => gapFor(usage, p.id, date) > cfg.noRepeatDays;
  const blocked = new Set(exclude);
  const pool = bank.filter((p) => !blocked.has(p.id));
  const fresh = pool.filter(isFresh);

  const fill = (n, already) => {
    let picks = pickDiverse(byFreshness(fresh.filter((p) => !already.includes(p)), usage, date, rand), n, already);
    if (picks.length + already.length < n) {
      // Reuse strictly oldest-first, so a repeat is as far from its last use as possible.
      const stale = shuffle(pool.filter((p) => !isFresh(p) && !already.includes(p) && !picks.includes(p)), rand)
        .sort((a, b) => gapFor(usage, b.id, date) - gapFor(usage, a.id, date));
      const extra = pickDiverse(stale, n, [...already, ...picks]);
      for (const p of extra) {
        warnings.push(`Not enough fresh prompts: "${p.q}" was used ${gapFor(usage, p.id, date)} days from this date.`);
      }
      picks = picks.concat(extra);
    }
    if (picks.length + already.length < n) throw new Error(`The bank has only ${bank.length} prompts; a puzzle needs ${n}.`);
    return picks;
  };

  let order;
  let root;
  if (previous && swapSlot) {
    const slot = swapSlot - 1;
    const byId = new Map(bank.map((p) => [p.id, p]));
    order = previous.prompts.map((p) => byId.get(p.id) ?? p);
    if (slot < 0 || slot >= order.length) throw new Error(`There is no prompt ${swapSlot} to swap.`);
    const removed = order[slot];
    blocked.add(removed.id);
    const others = order.filter((_, i) => i !== slot);
    const [replacement] = fill(cfg.promptsPerDay, others).filter((p) => p.id !== removed.id);
    order[slot] = replacement;
    root = previous.root;
    if (root.id === removed.id) {
      const target = order.slice(0, 3).find(withTraps) ?? order.find(withTraps);
      const pos = order.indexOf(target);
      if (pos > 2) [order[0], order[pos]] = [order[pos], order[0]];
      root = { id: target.id, trap: Math.floor(rand() * target.traps.length) };
    } else {
      const target = byId.get(root.id);
      root = { id: root.id, trap: Math.max(0, (target?.traps ?? []).findIndex((t) => t.q === previous.prompts.find((p) => p.id === root.id)?.traps?.[0]?.q)) };
    }
  } else {
    const chosen = fill(cfg.promptsPerDay, []);
    if (!chosen.some(withTraps)) throw new Error('None of the chosen prompts has a root question.');
    const plan = arrangeDay(chosen, rand);
    const byId = new Map(chosen.map((p) => [p.id, p]));
    order = plan.slice(0, -1).map((s) => byId.get(s.id));
    root = { id: plan[plan.length - 1].id, trap: plan[plan.length - 1].trap };
  }

  const puzzle = {
    date,
    number: dayForIso(date),
    seed: String(seed),
    root: { id: root.id, trap: 0 },
    prompts: order.map((p) => snapshotPrompt(p, p.id === root.id ? root.trap : null)),
  };
  return { puzzle, warnings, fresh: fresh.length };
}
