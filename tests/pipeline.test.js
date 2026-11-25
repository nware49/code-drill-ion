import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBank, isLive, serializePrompt } from '../scripts/lib/bank.mjs';
import { validateBank, validatePrompt, validatePuzzle } from '../scripts/lib/validate.mjs';
import { planPuzzle, usageFrom, gapFor, addDays, daysBetween } from '../scripts/lib/planner.mjs';
import { collectHistory } from '../scripts/lib/history.mjs';
import { parseCommand, decideScheduled, decideEvent, readDeadline, withDeadline, deadlineMarker } from '../scripts/lib/review.mjs';
import { retier, fetchViews, resolveTitles, addViews } from '../scripts/lib/pageviews.mjs';
import { growBank } from '../scripts/lib/grow.mjs';
import { mergeAnswers, repairPrompt } from '../scripts/lib/generate.mjs';
import { fromPuzzle, materialize, judge, compilePrompt } from '../js/engine.js';
import { fakeLLM, fakeFetch } from './fixtures/fake-llm.mjs';

const BANK = loadBank().filter(isLive);

/** A large synthetic bank: copies of real prompts with new ids, questions and categories. */
function bigBank(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = BANK[i % BANK.length];
    out.push({ ...src, id: `${src.id}-${i}`, q: `${src.q.slice(0, -1)} (set ${i}).`, cat: `cat-${i % 17}` });
  }
  return out;
}

/** Plan `days` consecutive puzzles, each seeing every earlier one as history. */
function simulate(bank, start, days) {
  const puzzles = [];
  const warnings = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const r = planPuzzle({ bank, date, usage: usageFrom(puzzles) });
    puzzles.push(r.puzzle);
    warnings.push(...r.warnings);
  }
  return { puzzles, warnings };
}

/* ---------------- bank files ---------------- */

test('the bank on disk is valid', () => {
  assert.deepEqual(validateBank(BANK), []);
});

test('prompt files round-trip through the serializer', () => {
  for (const p of loadBank()) assert.deepEqual(JSON.parse(serializePrompt(p)), p, p.id);
});

test('the validator catches broken prompts', () => {
  const good = structuredClone(BANK.find((p) => p.id === 'sorting'));
  assert.deepEqual(validatePrompt(good), []);
  const longLore = structuredClone(good);
  longLore.answers[0].l = 'x'.repeat(300);
  assert.match(validatePrompt(longLore)[0], /lore is 300 characters/);
  const collide = structuredClone(good);
  collide.answers[1].alias = ['qsort'];
  assert.ok(validatePrompt(collide).some((e) => /matches Quicksort and Merge sort/.test(e)));
  const badTrap = structuredClone(good);
  badTrap.traps = [{ q: 'Name it.', answer: 'Smoothsort' }];
  assert.ok(validatePrompt(badTrap).some((e) => /famous/.test(e)));
  const shadow = structuredClone(good);
  shadow.nope = { quicksort: 'no' };
  assert.ok(validatePrompt(shadow).some((e) => /hides a real answer/.test(e)));
});

/* ---------------- planner ---------------- */

test('with enough prompts, nothing repeats within 30 days over four months', () => {
  const { puzzles, warnings } = simulate(bigBank(220), '2026-12-01', 120);
  assert.deepEqual(warnings, []);
  const last = new Map();
  for (const pz of puzzles) {
    assert.deepEqual(validatePuzzle(pz), [], pz.date);
    const rootPos = pz.prompts.findIndex((p) => p.id === pz.root.id);
    assert.ok(rootPos >= 0 && rootPos <= 2, `${pz.date}: root calls back to prompt ${rootPos + 1}`);
    for (const p of pz.prompts) {
      if (last.has(p.id)) assert.ok(daysBetween(last.get(p.id), pz.date) > 30, `${p.id} repeated on ${pz.date}`);
      last.set(p.id, pz.date);
    }
  }
});

test('with too few prompts, the planner reuses the least recently used and says so', () => {
  const { puzzles, warnings } = simulate(BANK, '2026-12-01', 10);
  assert.ok(warnings.length > 0, 'expected repeat warnings with a 35-prompt bank');
  for (const pz of puzzles) assert.deepEqual(validatePuzzle(pz), []);
  // Day 7 must reuse something; it should be one of the oldest available.
  const usage = usageFrom(puzzles.slice(0, 6));
  const day7 = puzzles[6].prompts.map((p) => gapFor(usage, p.id, puzzles[6].date));
  assert.ok(day7.every((g) => g >= 5 || g === Infinity), `reused prompts too recently: ${day7}`);
});

test('a prompt pending on another date counts as used', () => {
  const bank = bigBank(60);
  const pending = planPuzzle({ bank, date: '2026-12-02' }).puzzle;
  const next = planPuzzle({ bank, date: '2026-12-03', usage: usageFrom([pending]) }).puzzle;
  const overlap = next.prompts.filter((p) => pending.prompts.some((q) => q.id === p.id));
  assert.deepEqual(overlap, []);
});

test('planning is deterministic for a date and seed', () => {
  const a = planPuzzle({ bank: BANK, date: '2026-12-01' }).puzzle;
  const b = planPuzzle({ bank: BANK, date: '2026-12-01' }).puzzle;
  const c = planPuzzle({ bank: BANK, date: '2026-12-01', seed: 'other' }).puzzle;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.prompts.map((p) => p.id), c.prompts.map((p) => p.id));
});

test('/swap N replaces only that prompt; /reroll replaces all six', () => {
  const bank = bigBank(80);
  const base = planPuzzle({ bank, date: '2026-12-01' }).puzzle;
  const rootPos = base.prompts.findIndex((p) => p.id === base.root.id);
  const slot = rootPos === 2 ? 4 : 3; // swap a non-root prompt
  const swapped = planPuzzle({ bank, date: '2026-12-01', previous: base, swapSlot: slot, seed: 'x' }).puzzle;
  base.prompts.forEach((p, i) => {
    if (i === slot - 1) assert.notEqual(swapped.prompts[i].id, p.id);
    else assert.equal(swapped.prompts[i].id, p.id);
  });
  assert.equal(swapped.root.id, base.root.id);
  assert.deepEqual(validatePuzzle(swapped), []);

  const swapRoot = planPuzzle({ bank, date: '2026-12-01', previous: base, swapSlot: rootPos + 1, seed: 'y' }).puzzle;
  assert.notEqual(swapRoot.root.id, base.root.id);
  assert.deepEqual(validatePuzzle(swapRoot), []);

  const rerolled = planPuzzle({ bank, date: '2026-12-01', exclude: base.prompts.map((p) => p.id), seed: 'z' }).puzzle;
  assert.equal(rerolled.prompts.filter((p) => base.prompts.some((q) => q.id === p.id)).length, 0);
});

test('history reconstructs days served by the fallback generator', () => {
  const hist = collectHistory({ date: '2026-11-26', bank: BANK, files: [], includePending: false });
  assert.deepEqual(hist.map((h) => h.date), ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
  assert.ok(hist.every((h) => h.generated && h.ids.length === 6));
});

test('a puzzle file plays in the client exactly as planned', () => {
  const { puzzle } = planPuzzle({ bank: BANK, date: '2026-12-01' });
  const json = JSON.parse(JSON.stringify(puzzle));
  const { plan, byId } = fromPuzzle(json);
  const items = materialize(plan, byId);
  assert.equal(items.length, 7);
  assert.deepEqual(items.slice(0, 6).map((p) => p.q), puzzle.prompts.map((p) => p.q));
  const root = items[6];
  const target = puzzle.prompts.find((p) => p.id === puzzle.root.id);
  assert.equal(judge(root, target.traps[0].answer).status, 'hit');
  assert.ok(puzzle.prompts.filter((p) => p.id !== puzzle.root.id).every((p) => p.traps.length === 0), 'only root keeps a trap');
  assert.ok(puzzle.prompts.every((p) => !('status' in p) && p.answers.every((a) => !('src' in a))), 'snapshots carry only client fields');
});

/* ---------------- review rules ---------------- */

const human = (login, assoc = 'OWNER') => ({ login, type: 'User', assoc });
const commentBy = (u, body, at) => ({ user: { login: u.login, type: u.type }, author_association: u.assoc, body, created_at: at });
const T0 = new Date('2026-12-01T00:17:00Z');
const prAt = (labels = ['drill-puzzle', 'auto-approve']) => ({
  labels: labels.map((name) => ({ name })),
  created_at: T0.toISOString(),
  body: `table\n${deadlineMarker(new Date(T0.getTime() + 24 * 3600000), T0)}`,
});
const at = (h) => new Date(T0.getTime() + h * 3600000);

test('commands parse', () => {
  assert.deepEqual(parseCommand('/approve'), { cmd: 'approve' });
  assert.deepEqual(parseCommand('  /SWAP 3 please'), { cmd: 'swap', slot: 3 });
  assert.equal(parseCommand('/swap 9').cmd, 'invalid');
  assert.equal(parseCommand('looks good /approve'), null);
});

test('auto-approval waits 24 hours, then merges when nobody objected', () => {
  const base = { pr: prAt(), comments: [], reviews: [], hours: 24, today: '2026-12-01', puzzleDate: '2026-12-03' };
  assert.equal(decideScheduled({ ...base, now: at(23) }).action, 'wait');
  assert.equal(decideScheduled({ ...base, now: at(24.1) }).action, 'merge');
  assert.equal(decideScheduled({ ...base, now: at(25), checks: 'pending' }).action, 'wait');
  assert.equal(decideScheduled({ ...base, now: at(25), checks: 'failed' }).action, 'hold');
  assert.equal(decideScheduled({ ...base, now: at(25), validationErrors: ['bad'] }).action, 'hold');
});

test('feedback from a trusted person holds auto-approval; strangers and bots do not', () => {
  const base = { pr: prAt(), reviews: [], hours: 24, today: '2026-12-01', now: at(30) };
  assert.equal(decideScheduled({ ...base, comments: [commentBy(human('owner'), 'swap the RFC one?', at(2).toISOString())] }).action, 'hold');
  assert.equal(decideScheduled({ ...base, comments: [commentBy(human('rando', 'NONE'), 'nope', at(2).toISOString())] }).action, 'merge');
  assert.equal(decideScheduled({ ...base, comments: [commentBy({ login: 'github-actions[bot]', type: 'Bot', assoc: 'NONE' }, 'Merged', at(2).toISOString())] }).action, 'merge');
  assert.equal(decideScheduled({ ...base, comments: [commentBy(human('owner'), '/release', at(2).toISOString())] }).action, 'merge');
  assert.equal(decideScheduled({ ...base, pr: prAt(['drill-puzzle', 'auto-approve', 'hold']), comments: [] }).action, 'wait');
  assert.equal(decideScheduled({ ...base, pr: prAt(['drill-bank']), comments: [] }).action, 'wait', 'no auto-approve label');
});

test('/release restarts the window from now', () => {
  const pr = prAt();
  const body = withDeadline(pr.body, at(40), at(16));
  const { at: deadline, setAt } = readDeadline(body, pr.created_at, 24);
  assert.equal(deadline.toISOString(), at(40).toISOString());
  assert.equal(setAt.toISOString(), at(16).toISOString());
  const oldComment = commentBy(human('owner'), 'hmm', at(10).toISOString());
  assert.equal(decideScheduled({ pr: { ...pr, body }, comments: [oldComment], reviews: [], hours: 24, today: '2026-12-01', now: at(41) }).action, 'merge', 'feedback before the release does not count');
});

test('stale puzzles close instead of merging', () => {
  const d = decideScheduled({ pr: prAt(), comments: [], reviews: [], hours: 24, today: '2026-12-05', now: at(100), puzzleDate: '2026-12-03' });
  assert.equal(d.action, 'close');
});

test('events map to actions', () => {
  const owner = human('owner');
  const c = (body) => commentBy(owner, body, at(1).toISOString());
  assert.equal(decideEvent({ kind: 'comment', item: c('/approve'), isPuzzle: true }).action, 'merge');
  assert.equal(decideEvent({ kind: 'comment', item: c('/hold'), isPuzzle: true }).action, 'hold');
  assert.equal(decideEvent({ kind: 'comment', item: c('too hard'), isPuzzle: true }).action, 'hold');
  assert.deepEqual(decideEvent({ kind: 'comment', item: c('/swap 2'), isPuzzle: true }), { action: 'rework', mode: 'swap', slot: 2 });
  assert.equal(decideEvent({ kind: 'comment', item: c('/reroll'), isPuzzle: false }).action, 'reply');
  assert.equal(decideEvent({ kind: 'comment', item: commentBy(human('x', 'NONE'), '/approve', at(1).toISOString()), isPuzzle: true }), null);
  const review = (state) => ({ user: { login: 'owner', type: 'User' }, author_association: 'OWNER', state, submitted_at: at(1).toISOString() });
  assert.equal(decideEvent({ kind: 'review', item: review('APPROVED'), isPuzzle: true }).action, 'merge');
  assert.equal(decideEvent({ kind: 'review', item: review('CHANGES_REQUESTED'), isPuzzle: true }).action, 'hold');
});

/* ---------------- rarity from pageviews ---------------- */

// Real yearly views (Nov 2026) for answers to "Name a computer bus or wired hardware interface."
// None reaches a million, which is what fixed cutoffs needed for topsoil.
const busAnswers = () => [
  { n: 'HDMI', t: 0, views: 436680 }, { n: 'USB', t: 0, views: 422564 },
  { n: 'PCI Express', t: 1, views: 383091 }, { n: 'Ethernet', t: 1, views: 225894 },
  { n: 'SATA', t: 2, views: 153259 }, { n: 'Serial port', t: 2, views: 64085 },
  { n: 'I²C', t: 3, views: 24654 }, { n: 'SPI', t: 4, views: 9000 },
  { n: 'GPIB', t: 5, views: 3100 },
].map((a) => ({ ...a, l: 'x', src: 'llm' }));

test('famous answers keep topsoil though no answer has a million views', () => {
  const r = retier({ answers: busAnswers() }).answers;
  assert.deepEqual(r.map((a) => a.t), [0, 0, 1, 1, 2, 2, 3, 4, 5]);
});

test('pageviews reorder answers within the tiers Claude used; ties go to Claude', () => {
  const r = retier({ answers: [
    { n: 'Hand', t: 3, l: 'x' },
    { n: 'Hyped', t: 0, l: 'x', src: 'llm', views: 50 },
    { n: 'Famous', t: 4, l: 'x', src: 'llm', views: 2e5 },
    { n: 'Middle', t: 1, l: 'x', src: 'llm', views: 1e4 },
    { n: 'NoViews', t: 5, l: 'x', src: 'llm' },
    { n: 'Classic', t: 0, l: 'x', src: 'llm', views: 3e5 },
  ] }).answers;
  // Views rank Classic, Famous, Middle, Hyped into Claude's tiers 0, 0, 1, 4. Blends: Classic
  // stays 0, Famous (4+0)/2 = 2, Middle stays 1, Hyped (0+4)/2 = 2. Hand-ranked and view-less
  // answers are untouched.
  assert.deepEqual(r.map((a) => [a.n, a.t]), [['Hand', 3], ['Hyped', 2], ['Famous', 2], ['Middle', 1], ['NoViews', 5], ['Classic', 0]]);
  const tie = retier({ answers: [
    { n: 'A', t: 0, l: 'x', src: 'llm', views: 10 },
    { n: 'B', t: 1, l: 'x', src: 'llm', views: 20 },
  ] }).answers;
  assert.deepEqual(tie.map((a) => a.t), [0, 1], 'a half-tier disagreement keeps Claude’s tier');
});

test('blending never empties topsoil or the inner core that Claude filled', () => {
  const r = retier({ answers: [
    { n: 'Claimed', t: 0, l: 'x', src: 'llm', views: 100 },
    { n: 'Rare', t: 3, l: 'x', src: 'llm', views: 9e5 },
    { n: 'Odd', t: 5, l: 'x', src: 'llm', views: 8e5 },
    { n: 'Low', t: 3, l: 'x', src: 'llm', views: 10 },
  ] }).answers;
  // Blends: Claimed 1, Rare 2, Odd 4, Low 4, so nothing is left in tiers 0 or 5. The closest
  // answer moves to each: Claimed to topsoil, and of the two at 4, the less-viewed Low to the core.
  assert.deepEqual(r.map((a) => [a.n, a.t]), [['Claimed', 0], ['Rare', 2], ['Odd', 4], ['Low', 5]]);
});

test('generated topsoil answers are capped at four', () => {
  const answers = Array.from({ length: 8 }, (_, i) => ({ n: `A${i}`, t: 0, l: 'x', src: 'llm', views: 5e6 + i }));
  const r = retier({ answers }).answers;
  assert.equal(r.filter((a) => a.t === 0).length, 4);
});

test('views come from the article a title redirects to; missing articles are ignored', async () => {
  const fetchImpl = fakeFetch({ USB: 422564, 'PCI Express': 383091, 'Universal Serial Bus': 13455 }, {
    redirects: { 'Universal Serial Bus': 'USB', PCIe: 'PCI Express' },
    missing: ['Made-up bus'],
  });
  assert.equal(await fetchViews('USB', { fetchImpl }), 422564);
  assert.equal(await fetchViews('Nope', { fetchImpl }), null, 'no article means no data, not zero views');
  const resolved = await resolveTitles(['Universal_Serial_Bus', 'PCIe', 'USB', 'Made-up bus'], { fetchImpl });
  assert.deepEqual(Object.fromEntries(resolved), { Universal_Serial_Bus: 'USB', PCIe: 'PCI Express', USB: 'USB', 'Made-up bus': null });

  const answers = [
    { n: 'USB', t: 0, src: 'llm', wiki: 'Universal Serial Bus' },
    { n: 'PCIe', t: 1, src: 'llm', wiki: 'PCIe' },
    { n: 'Made-up bus', t: 5, src: 'llm', wiki: 'Made-up bus' },
  ];
  const stats = await addViews(answers, { fetchImpl });
  assert.deepEqual(stats, { found: 2, redirected: 2, missing: 1, unchecked: 0 });
  assert.deepEqual(answers.map((a) => [a.wiki, a.views]), [['USB', 422564], ['PCI Express', 383091], [undefined, undefined]]);
});

test('when the title lookup fails, titles are used as given', async () => {
  const fetchImpl = fakeFetch({ USB: 422564 }, { failLookup: true });
  const answers = [{ n: 'USB', t: 0, src: 'llm', wiki: 'USB' }, { n: 'Gone', t: 5, src: 'llm', wiki: 'Gone' }];
  const stats = await addViews(answers, { fetchImpl });
  assert.deepEqual(stats, { found: 1, redirected: 0, missing: 0, unchecked: 2 });
  assert.deepEqual(answers.map((a) => a.views), [422564, undefined]);
});

/* ---------------- generation (fake Claude) ---------------- */

test('a growth run fact-checks, repairs and validates before writing', async () => {
  const llm = fakeLLM({ invalid: ['Juliett'], badLore: ['Kilo'] });
  const r = await growBank({ llm, bank: BANK, propose: 1, expandIds: ['sorting'], answersPerExpansion: 4, write: false, date: '2026-12-01', fetchImpl: fakeFetch({ Alpha: 4e5, Bravo: 3e5, Charlie: 9e4, Echo: 2e4, Oscar: 900 }) });
  assert.equal(r.rejected.length, 0);
  const created = r.created[0].prompt;
  assert.deepEqual(validatePrompt(created), []);
  assert.ok(!created.answers.some((a) => a.n === 'Juliett'), 'invalid answer dropped');
  assert.match(created.answers.find((a) => a.n === 'Kilo').l, /corrected/);
  assert.ok(!('Alpha' in created.nope), 'nope entry that is a real answer removed');
  assert.deepEqual(created.traps.map((t) => t.answer), ['Alpha'], 'root question about an obscure answer dropped');
  assert.equal(r.expanded[0].added, 3);
  assert.deepEqual(r.expanded[0].skipped, ['Quicksort']);
  assert.match(r.summary, /1 new prompts/);
});

test('merging answers never duplicates an existing answer or alias', () => {
  const sorting = BANK.find((p) => p.id === 'sorting');
  const { prompt, added, skipped } = mergeAnswers(sorting, [
    { n: 'qsort', t: 3, l: 'dup by alias', alias: [] },
    { n: 'Brand New Sort', t: 5, l: 'A real fact.', alias: ['quick'] },
  ]);
  assert.deepEqual(skipped, ['qsort']);
  assert.equal(added, 1);
  assert.deepEqual(prompt.answers.at(-1).alias, [], 'colliding alias stripped');
  assert.deepEqual(validatePrompt(prompt), []);
  assert.deepEqual(repairPrompt(sorting).fixes, [], 'a clean prompt needs no repairs');
  assert.equal(compilePrompt(prompt).answers.length, sorting.answers.length + 1);
});
