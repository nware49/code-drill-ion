// One definition of "valid" for prompts, the whole bank and daily puzzles.
// Used by the test suite, the bank generator, the puzzle planner and the auto-approver.
import { compilePrompt, compileTrap, judge } from '../../js/engine.js';

export const MAX_LORE = 220;
export const MIN_ANSWERS = 12;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const TRAP_END_RE = /[.?]["”']?$/;

/** Problems with one raw prompt, as readable strings. An empty list means it is valid. */
export function validatePrompt(raw, { requireTraps = true, checkAliases = true } = {}) {
  const errs = [];
  const at = (msg) => errs.push(`${raw?.id ?? '(no id)'}: ${msg}`);
  if (!raw || typeof raw !== 'object') return ['prompt is not an object'];
  if (!ID_RE.test(raw.id ?? '')) at('id must be lowercase letters, digits and dashes');
  if (typeof raw.q !== 'string' || !raw.q.endsWith('.')) at('question must end with a period');
  if (typeof raw.cat !== 'string' || !raw.cat.trim()) at('missing category');
  if (![1, 2, 3].includes(raw.d)) at('difficulty d must be 1, 2 or 3');
  if (!Array.isArray(raw.answers)) return [...errs, `${raw.id}: answers must be a list`];
  if (raw.answers.length < MIN_ANSWERS) at(`only ${raw.answers.length} answers (need ${MIN_ANSWERS})`);
  if (!raw.answers.some((a) => a.t === 0)) at('needs at least one topsoil (tier 0) answer');
  if (!raw.answers.some((a) => a.t === 5)) at('needs at least one inner core (tier 5) answer');
  for (const a of raw.answers) {
    if (!a || typeof a.n !== 'string' || !a.n.trim()) { at('an answer has no name'); continue; }
    if (!Number.isInteger(a.t) || a.t < 0 || a.t > 5) at(`"${a.n}": tier must be 0-5`);
    if (typeof a.l !== 'string') at(`"${a.n}": lore must be text`);
    else if (a.l.length > MAX_LORE) at(`"${a.n}": lore is ${a.l.length} characters (max ${MAX_LORE})`);
    if (/lorem|\btodo\b|\btbd\b/i.test(a.l ?? '')) at(`"${a.n}": placeholder lore`);
    if (a.alias !== undefined && !Array.isArray(a.alias)) at(`"${a.n}": alias must be a list`);
  }
  const traps = raw.traps ?? [];
  if (requireTraps && traps.length < 1) at('needs a root (trap) question');
  if (errs.length) return errs;

  let compiled;
  try { compiled = compilePrompt(raw); } catch (e) { return [`${raw.id}: does not compile (${e.message})`]; }
  for (const [form, list] of compiled.index) {
    if (new Set(list.map((a) => a.key)).size > 1) at(`typing "${form}" matches ${list.map((a) => a.n).join(' and ')}`);
  }
  const keys = compiled.answers.map((a) => a.key);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (dupes.length) at(`duplicate answers: ${dupes.join(', ')}`);
  for (const form of compiled.nope.keys()) if (compiled.index.has(form)) at(`"nope" entry "${form}" hides a real answer`);
  traps.forEach((trap, i) => {
    const target = raw.answers.find((a) => a.n === trap.answer);
    if (!target) { at(`root question ${i + 1} names "${trap.answer}", which is not an answer`); return; }
    if (target.t > 1) at(`root question ${i + 1}: "${trap.answer}" should be a famous (tier 0-1) answer`);
    if (!TRAP_END_RE.test(trap.q ?? '')) at(`root question ${i + 1} must end with a period or question mark`);
    try { compileTrap(compiled, i); } catch (e) { at(`root question ${i + 1}: ${e.message}`); }
  });
  if (checkAliases && !errs.length) {
    for (const a of raw.answers) {
      for (const typed of [a.n, ...(a.alias ?? [])]) {
        const r = judge(compiled, typed);
        if (r.status !== 'hit' || r.answer.n !== a.n) at(`typing "${typed}" gives ${r.status}${r.answer ? ` (${r.answer.n})` : ''}, not "${a.n}"`);
      }
    }
  }
  return errs;
}

/** Problems across the whole bank: each prompt, plus duplicate ids and questions. */
export function validateBank(prompts) {
  const errs = prompts.flatMap((p) => validatePrompt(p));
  const seen = new Map();
  for (const p of prompts) {
    const q = p.q?.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(q)) errs.push(`${p.id}: same question as ${seen.get(q)}`);
    seen.set(q, p.id);
  }
  return errs;
}

/** Problems with a daily puzzle file. */
export function validatePuzzle(puzzle, { promptsPerDay = 6 } = {}) {
  const errs = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzle?.date ?? '')) return ['puzzle: date must be YYYY-MM-DD'];
  const at = (msg) => errs.push(`puzzle ${puzzle.date}: ${msg}`);
  if (!Array.isArray(puzzle.prompts) || puzzle.prompts.length !== promptsPerDay) {
    at(`needs exactly ${promptsPerDay} prompts`);
    return errs;
  }
  const ids = puzzle.prompts.map((p) => p.id);
  if (new Set(ids).size !== ids.length) at('a prompt appears twice');
  const rootPos = ids.indexOf(puzzle.root?.id);
  if (rootPos < 0) at('root must point at one of the six prompts');
  for (const p of puzzle.prompts) errs.push(...validatePrompt(p, { requireTraps: false, checkAliases: false }));
  if (rootPos >= 0) {
    const target = puzzle.prompts[rootPos];
    const trap = target.traps?.[puzzle.root.trap ?? 0];
    if (!trap) at(`root question ${puzzle.root.trap ?? 0} is missing from ${target.id}`);
  }
  return errs;
}
